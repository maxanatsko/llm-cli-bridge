# Feature Specification: Dual-Backend MCP Server (Gemini + OpenAI Codex)

## Executive Summary

This document proposes extending the `gemini-mcp-tool` to support **both Google Gemini CLI and OpenAI Codex CLI** as backends, enabling brainstorm and code review workflows with either AI provider. The architecture is well-suited for this extension due to its modular design.

---

## 1. Current State Analysis

### 1.1 Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         MCP Clients                              │
│              (Claude Desktop, Codex CLI, etc.)                   │
└─────────────────────────────────┬───────────────────────────────┘
                                  │ MCP Protocol (STDIO)
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                      gemini-mcp-tool                             │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    Tool Registry                          │   │
│  │   • ask-gemini    (Q&A with file analysis)               │   │
│  │   • brainstorm    (creative ideation)                    │   │
│  │   • review-code   (git-aware code review)                │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              │                                   │
│                              ▼                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                   Gemini Executor                         │   │
│  │   spawn("gemini", ["-m", model, "-p", prompt])           │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
                         ┌───────────────┐
                         │  Gemini CLI   │
                         │   (Google)    │
                         └───────────────┘
```

### 1.2 Key Integration Points

| Component | File | Purpose |
|-----------|------|---------|
| Tool Registry | `src/tools/registry.ts` | Unified tool definition & execution |
| Gemini Executor | `src/utils/geminiExecutor.ts` | CLI command construction & spawning |
| Command Executor | `src/utils/commandExecutor.ts` | Generic process spawner |
| Constants | `src/constants.ts` | Models, CLI flags, configuration |
| Session Managers | `src/utils/*SessionManager.ts` | Per-tool session persistence |

### 1.3 Current Capabilities

**Tools:**
- `ask-gemini`: General Q&A with `@file` references, session continuity
- `brainstorm`: 6 methodologies (divergent, convergent, SCAMPER, design-thinking, lateral, auto)
- `review-code`: Git-aware multi-round code review with comment tracking

**Workflows Supported:**
- Large codebase analysis (200k+ token context)
- Multi-turn conversations with history
- Structured code editing (change mode)
- Creative ideation with scoring
- Security/performance/quality reviews

---

## 2. Integration Approaches

### 2.1 Approach A: MCP Server FOR Codex (Current Compatibility)

**The current MCP server already works with Codex CLI!**

Codex CLI can consume any MCP server configured in `~/.codex/config.toml`:

```toml
[mcp_servers.gemini-cli]
command = "npx"
args = ["-y", "maxanatsko/gemini-mcp-tool"]
enabled = true
tool_timeout_sec = 300
```

This gives Codex CLI access to Gemini's extended context window (1M+ tokens) for:
- Analyzing massive codebases
- Brainstorming with multiple methodologies
- Structured code reviews

**Pros:** Zero code changes, immediate functionality
**Cons:** Only uses Gemini as backend, not Codex's own models

---

### 2.2 Approach B: Dual-Backend MCP Server (Proposed Feature)

Abstract the backend to support **both Gemini CLI and Codex CLI** as execution engines:

```
┌─────────────────────────────────────────────────────────────────┐
│                         MCP Clients                              │
│              (Claude Desktop, Codex CLI, etc.)                   │
└─────────────────────────────────┬───────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                        llm-mcp-tool                              │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    Tool Registry                          │   │
│  │   • ask           (Q&A with file analysis)               │   │
│  │   • brainstorm    (creative ideation)                    │   │
│  │   • review-code   (git-aware code review)                │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              │                                   │
│                              ▼                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │           Backend Executor (default: Gemini)              │   │
│  │   ┌─────────────────┐     ┌─────────────────┐            │   │
│  │   │ GeminiBackend   │     │  CodexBackend   │            │   │
│  │   │  gemini -p ...  │     │  codex exec ... │            │   │
│  │   └─────────────────┘     └─────────────────┘            │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Detailed Feature Specification

### 3.1 New Backend Abstraction Layer

#### 3.1.1 Interface Definition

```typescript
// src/backends/types.ts
export interface BackendConfig {
  provider: 'gemini' | 'codex';
  model?: string;
  sandbox?: boolean;
  allowedTools?: string[];
  cwd?: string;
  // Codex-specific
  approvalMode?: 'untrusted' | 'on-failure' | 'on-request' | 'never';
  fullAuto?: boolean;
}

export interface BackendExecutor {
  name: string;
  execute(
    prompt: string,
    config: BackendConfig,
    onProgress?: (output: string) => void
  ): Promise<string>;

  isAvailable(): Promise<boolean>;
  getModels(): string[];
  supportsFileRefs(): boolean;
  getFileRefSyntax(): string; // '@' for Gemini, TBD for Codex
}
```

#### 3.1.2 Gemini Backend (Refactored)

```typescript
// src/backends/gemini.ts
export class GeminiBackend implements BackendExecutor {
  name = 'gemini';

  async execute(prompt: string, config: BackendConfig, onProgress?: Function): Promise<string> {
    const args = this.buildArgs(prompt, config);
    return executeCommand('gemini', args, onProgress, config.cwd);
  }

  private buildArgs(prompt: string, config: BackendConfig): string[] {
    const args = [];
    if (config.model) args.push('-m', config.model);
    if (config.sandbox) args.push('-s');
    if (config.allowedTools) {
      config.allowedTools.forEach(t => args.push('--allowed-tools', t));
    }
    args.push('-p', prompt);
    return args;
  }

  async isAvailable(): Promise<boolean> {
    // Check if 'gemini' command exists
  }

  getModels(): string[] {
    return ['gemini-3.1-pro', 'gemini-3-flash', 'gemini-2.5-pro', 'gemini-2.5-flash'];
  }

  supportsFileRefs(): boolean { return true; }
  getFileRefSyntax(): string { return '@'; }
}
```

#### 3.1.3 Codex Backend (New)

```typescript
// src/backends/codex.ts
export class CodexBackend implements BackendExecutor {
  name = 'codex';

  async execute(prompt: string, config: BackendConfig, onProgress?: Function): Promise<string> {
    const args = this.buildArgs(prompt, config);
    return executeCommand('codex', args, onProgress, config.cwd);
  }

  private buildArgs(prompt: string, config: BackendConfig): string[] {
    const args = ['exec']; // Use non-interactive exec mode

    if (config.model) args.push('-m', config.model);

    // Approval mode
    if (config.approvalMode) {
      args.push('-a', config.approvalMode);
    } else if (config.fullAuto) {
      args.push('--full-auto');
    }

    // Sandbox mode
    if (config.sandbox === false) {
      args.push('-s', 'danger-full-access');
    } else {
      args.push('-s', 'workspace-write');
    }

    // Prompt via stdin for complex prompts
    args.push('-'); // Read from stdin

    return args;
  }

  async isAvailable(): Promise<boolean> {
    // Check if 'codex' command exists
  }

  getModels(): string[] {
    return ['gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex', 'gpt-5.2-codex', 'gpt-5.2'];
  }

  supportsFileRefs(): boolean { return false; } // Codex reads files directly
  getFileRefSyntax(): string { return ''; }
}
```

### 3.2 Updated Tool Arguments

```typescript
// src/constants.ts (additions)
export interface ToolArguments {
  // ... existing args ...

  // NEW: Backend selection (user must explicitly choose, defaults to gemini)
  backend?: 'gemini' | 'codex';  // Default: 'gemini'
}
```

### 3.3 Backend Registry

```typescript
// src/backends/registry.ts
import { GeminiBackend } from './gemini.js';
import { CodexBackend } from './codex.js';

const backends = new Map<string, BackendExecutor>([
  ['gemini', new GeminiBackend()],
  ['codex', new CodexBackend()],
]);

/**
 * Get the requested backend. Defaults to Gemini if not specified.
 * User must explicitly choose 'codex' to use Codex backend.
 */
export async function getBackend(preference?: 'gemini' | 'codex'): Promise<BackendExecutor> {
  const backendName = preference || 'gemini'; // Default to Gemini
  const backend = backends.get(backendName);

  if (!backend) {
    throw new Error(`Unknown backend: '${backendName}'`);
  }

  if (!await backend.isAvailable()) {
    throw new Error(
      `Backend '${backendName}' not available. ` +
      `Please install the ${backendName} CLI first.`
    );
  }

  return backend;
}
```

### 3.4 Updated Constants

```typescript
// src/constants.ts (additions)
export const BACKENDS = {
  GEMINI: 'gemini',  // Default backend
  CODEX: 'codex',
} as const;

export const CODEX_CLI = {
  COMMANDS: {
    EXEC: 'exec',
    RESUME: 'resume',
  },
  FLAGS: {
    MODEL: '-m',
    APPROVAL: '-a',
    SANDBOX: '-s',
    FULL_AUTO: '--full-auto',
    JSON: '--json',
    STDIN: '-',
  },
  APPROVAL_MODES: {
    UNTRUSTED: 'untrusted',
    ON_FAILURE: 'on-failure',
    ON_REQUEST: 'on-request',
    NEVER: 'never',
  },
  SANDBOX_MODES: {
    READ_ONLY: 'read-only',
    WORKSPACE_WRITE: 'workspace-write',
    FULL_ACCESS: 'danger-full-access',
  },
} as const;

export const CODEX_MODELS = {
  GPT_5_4: 'gpt-5.4',
  GPT_5_4_MINI: 'gpt-5.4-mini',
  GPT_5_3_CODEX: 'gpt-5.3-codex',
  GPT_5_2_CODEX: 'gpt-5.2-codex',
  GPT_5_2: 'gpt-5.2',
} as const;
```

---

## 4. Tool Updates for Dual Backend

### 4.1 ask (renamed from ask-gemini)

```typescript
// src/tools/ask.tool.ts
const askSchema = z.object({
  prompt: z.string().describe('Your question or analysis request'),
  backend: z.enum(['gemini', 'codex']).optional()
    .describe('AI backend to use (default: gemini)'),
  model: z.string().optional()
    .describe('Model override (backend-specific)'),
  sandbox: z.boolean().optional()
    .describe('Enable sandbox mode for code execution'),
  session: z.string().optional()
    .describe('Session ID for conversation continuity'),
  changeMode: z.boolean().optional()
    .describe('Enable structured code edit output'),
});
```

### 4.2 brainstorm

```typescript
// src/tools/brainstorm.tool.ts
const brainstormSchema = z.object({
  prompt: z.string().describe('The challenge or problem to brainstorm'),
  backend: z.enum(['gemini', 'codex']).optional()
    .describe('AI backend to use (default: gemini)'),
  methodology: z.enum([
    'divergent', 'convergent', 'scamper',
    'design-thinking', 'lateral', 'auto'
  ]).optional(),
  domain: z.string().optional(),
  constraints: z.string().optional(),
  session: z.string().optional(),
});
```

### 4.3 review-code

```typescript
// src/tools/review-code.tool.ts
const reviewCodeSchema = z.object({
  prompt: z.string().describe('Review instructions or follow-up'),
  backend: z.enum(['gemini', 'codex']).optional()
    .describe('AI backend to use (default: gemini)'),
  files: z.array(z.string()).optional()
    .describe('Files to review'),
  reviewType: z.enum([
    'security', 'performance', 'quality',
    'architecture', 'general'
  ]).optional(),
  severity: z.enum(['critical', 'important', 'suggestion', 'question']).optional(),
  sessionId: z.string().optional(),
});
```

---

## 5. Backend-Specific Adaptations

### 5.1 File Reference Translation

| Backend | Syntax | Example |
|---------|--------|---------|
| Gemini | `@file` | `@src/main.ts explain this` |
| Codex | Direct read | Read file, include content in prompt |

```typescript
// src/utils/fileRefTranslator.ts
export function translateFileRefs(
  prompt: string,
  backend: BackendExecutor
): string {
  if (backend.supportsFileRefs()) {
    return prompt; // Keep @file syntax for Gemini
  }

  // For Codex: extract @file refs, read files, inline content
  const fileRefs = prompt.match(/@[\w/.]+/g) || [];
  let translated = prompt;

  for (const ref of fileRefs) {
    const filePath = ref.substring(1);
    const content = fs.readFileSync(filePath, 'utf-8');
    translated = translated.replace(
      ref,
      `\n--- ${filePath} ---\n${content}\n--- end ${filePath} ---\n`
    );
  }

  return translated;
}
```

### 5.2 Model Mapping

```typescript
// src/utils/modelMapper.ts
export function mapModel(
  requestedModel: string | undefined,
  backend: 'gemini' | 'codex'
): string | undefined {
  if (!requestedModel) return undefined;

  // Allow explicit model names to pass through
  if (requestedModel.includes('-')) return requestedModel;

  // Map generic model names
  const modelMap: Record<string, Record<string, string>> = {
    'fast': {
      gemini: 'gemini-3-flash',
      codex: 'gpt-5.4-mini',
    },
    'smart': {
      gemini: 'gemini-3.1-pro',
      codex: 'gpt-5.4',
    },
    'latest': {
      gemini: 'gemini-3.1-pro',
      codex: 'gpt-5.4',
    },
  };

  return modelMap[requestedModel]?.[backend] || requestedModel;
}
```

---

## 6. Configuration

### 6.1 Environment-Based Configuration

```typescript
// src/config.ts
export interface MCPConfig {
  gemini: {
    defaultModel: string;
    fallbackModel: string;
  };
  codex: {
    defaultModel: string;
    approvalMode: string;
    sandboxMode: string;
  };
}

export function loadConfig(): MCPConfig {
  return {
    gemini: {
      defaultModel: process.env.GEMINI_MODEL || 'gemini-3.1-pro',
      fallbackModel: process.env.GEMINI_FALLBACK || 'gemini-3-flash',
    },
    codex: {
      defaultModel: process.env.CODEX_MODEL || 'gpt-5.4',
      approvalMode: process.env.CODEX_APPROVAL || 'on-request',
      sandboxMode: process.env.CODEX_SANDBOX || 'workspace-write',
    },
  };
}
```

### 6.2 MCP Client Configuration

**For Claude Desktop (`~/.config/claude/claude_desktop_config.json`):**
```json
{
  "mcpServers": {
    "llm-cli": {
      "command": "npx",
      "args": ["-y", "maxanatsko/llm-mcp-tool"]
    }
  }
}
```

**For Codex CLI (`~/.codex/config.toml`):**
```toml
[mcp_servers.llm-cli]
command = "npx"
args = ["-y", "maxanatsko/llm-mcp-tool"]
enabled = true
tool_timeout_sec = 300
```

---

## 7. Workflow Examples

### 7.1 Default Workflow (Gemini)

```
User: Use the ask tool to analyze @src/main.ts

→ Backend defaults to Gemini (no backend specified)
→ Gemini CLI processes with 1M token context
→ Returns analysis
```

### 7.2 Brainstorm with Gemini (Large Context)

```
User: Use the brainstorm tool with methodology:scamper
      to generate ideas for improving our authentication system.
      Include @src/auth for context.

→ Backend defaults to Gemini
→ Gemini CLI processes with 1M token context
→ Returns structured SCAMPER analysis with scoring
```

### 7.3 Code Review with Codex (Explicit Selection)

```
User: Use the review-code tool with backend:codex reviewType:security
      to review @src/api/handlers.ts

→ User explicitly selected Codex backend
→ Codex CLI runs security analysis
→ Can execute static analysis tools if needed
→ Returns structured security findings
```

### 7.4 Ask with Codex (Explicit Selection)

```
User: Use the ask tool with backend:codex to explain @src/utils.ts

→ User explicitly selected Codex backend
→ Codex CLI processes the request
→ Returns explanation using OpenAI models
```

---

## 8. Implementation Phases

### Phase 1: Backend Abstraction (Foundation)
- [ ] Create `src/backends/` directory structure
- [ ] Define `BackendExecutor` interface
- [ ] Refactor `geminiExecutor.ts` → `GeminiBackend`
- [ ] Add `CodexBackend` implementation
- [ ] Create backend registry (Gemini as default)

### Phase 2: Tool Updates
- [ ] Rename `ask-gemini` → `ask`
- [ ] Add `backend` parameter to all tools (default: 'gemini')
- [ ] Update tool schemas with backend option
- [ ] Implement file reference translation for Codex
- [ ] Add model mapping utility
- [ ] Update session managers for backend awareness

### Phase 3: Configuration & Polish
- [ ] Add environment-based configuration
- [ ] Create unified error handling
- [ ] Add backend availability detection
- [ ] Update documentation
- [ ] Rename package to `llm-mcp-tool`

### Phase 4: Testing & Documentation
- [ ] Unit tests for each backend
- [ ] Integration tests with both CLIs
- [ ] Update README with dual-backend docs
- [ ] Create example configurations

---

## 9. Comparison: Gemini vs Codex Capabilities

| Capability | Gemini CLI | Codex CLI |
|------------|-----------|-----------|
| Context Window | 1M+ tokens | ~128k tokens |
| File References | `@file` syntax | Direct file read |
| Code Execution | Sandbox mode | Shell + sandbox |
| Non-interactive | `-p prompt` | `exec` command |
| Session Resume | Not native | Built-in |
| Web Search | Limited | Built-in tool |
| MCP Support | Consumer | Both (server & client) |

### Recommended Backend Selection

| Use Case | Recommended Backend | Reason |
|----------|-------------------|--------|
| Large codebase analysis | Gemini | 1M+ token context |
| Quick code review | Codex | Faster, integrated tools |
| Brainstorming | Gemini | Better creative output |
| Security audit | Codex | Can run security tools |
| Multi-file refactoring | Gemini | Full context visibility |
| Interactive debugging | Codex | Shell access |

---

## 10. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| CLI availability | Clear error messages when selected backend unavailable |
| Model quota limits | Fallback logic (already exists for Gemini) |
| Different output formats | Response normalization layer |
| Breaking changes | Backward-compatible `backend` parameter, `ask-gemini` alias |
| Session incompatibility | Per-backend session storage |

---

## 11. Success Metrics

1. **Functionality**: All 3 tools work with both backends
2. **Performance**: <5% overhead from abstraction layer
3. **Usability**: Gemini works by default, Codex available via explicit `backend` param
4. **Clarity**: Clear error messages when backend unavailable
5. **Adoption**: Works with Claude, Codex, and other MCP clients

---

## 12. Conclusion

The current `gemini-mcp-tool` architecture is **well-suited for dual-backend support**. The modular design with:
- Unified tool registry
- Generic command executor
- Abstracted session management

...makes adding Codex CLI support a **medium-complexity enhancement** rather than a rewrite.

**Immediate benefit**: The current MCP server already works as an MCP tool for Codex CLI, giving Codex access to Gemini's 1M+ token context window.

**Proposed enhancement**: Adding Codex as a backend enables users to:
1. Choose between Gemini and Codex via explicit `backend` parameter
2. Use Gemini by default (no config change needed for existing users)
3. Use consistent workflows (`ask`, `brainstorm`, `review-code`) regardless of backend
4. Leverage each backend's strengths (Gemini for context, Codex for execution)

**Package renaming**: `gemini-mcp-tool` → `llm-mcp-tool` to reflect multi-backend support.

---

*Document Version: 1.1*
*Date: 2026-01-18*
*Author: Claude (Audit & Feature Specification)*
