

// Logging
export const LOG_PREFIX = "[GMCPT]";

// Error messages
export const ERROR_MESSAGES = {
  QUOTA_EXCEEDED: "Quota exceeded for quota metric 'Gemini 2.5 Pro Requests'",
  QUOTA_EXCEEDED_SHORT: "⚠️ Gemini 2.5 Pro daily quota exceeded. Please retry with model: 'gemini-2.5-flash'",
  TOOL_NOT_FOUND: "not found in registry",
  NO_PROMPT_PROVIDED: "Please provide a prompt for analysis. Use @ syntax to include files (e.g., '@largefile.js explain what this does') or ask general questions",
  // Codex @file inlining (translateFileRefs)
  ACCESS_DENIED_PATH_TRAVERSAL: "[Access denied: path traversal not allowed]",
  ACCESS_DENIED_OUTSIDE_WORKSPACE: "[Access denied: path is outside workspace]",
  ACCESS_DENIED_SYMLINK_OUTSIDE_WORKSPACE: "[Access denied: symlink points outside workspace]",
  FILE_TOO_LARGE: "[File too large]",
  FILE_NOT_FOUND: "[File not found]",
  ERROR_READING_FILE: "[Error reading file]",
  INLINE_LIMIT_REACHED: "[Inline limit reached]",
} as const;

// Status messages
export const STATUS_MESSAGES = {
  QUOTA_SWITCHING: "🚫 Gemini 2.5 Pro quota exceeded, switching to Flash model...",
  FLASH_RETRY: "⚡ Retrying with Gemini 2.5 Flash...",
  FLASH_SUCCESS: "✅ Flash model completed successfully",
  SANDBOX_EXECUTING: "🔒 Executing CLI command in sandbox mode...",
  // Timeout prevention messages
  PROCESSING_START: "🔍 Starting analysis (may take 5-15 minutes for large codebases)",
  PROCESSING_CONTINUE: "⏳ Still processing... Working on your request",
  PROCESSING_COMPLETE: "✅ Analysis completed successfully",
} as const;

// Models
export const MODELS = {
  PRO_3: "gemini-3.1-pro",
  FLASH_3: "gemini-3-flash",
  PRO: "gemini-2.5-pro",
  FLASH: "gemini-2.5-flash",
} as const;

// Backward-compatible model aliases for deprecated Gemini model names
export const GEMINI_MODEL_ALIASES: Record<string, string> = {
  "gemini-3-pro-preview": MODELS.PRO_3,
  "gemini-3-flash-preview": MODELS.FLASH_3,
};

// MCP Protocol Constants
export const PROTOCOL = {
  // Message roles
  ROLES: {
    USER: "user",
    ASSISTANT: "assistant",
  },
  // Content types
  CONTENT_TYPES: {
    TEXT: "text",
  },
  // Status codes
  STATUS: {
    SUCCESS: "success",
    ERROR: "error",
    FAILED: "failed",
    REPORT: "report",
  },
  // Notification methods
  NOTIFICATIONS: {
    PROGRESS: "notifications/progress",
  },
  // Timeout prevention
  KEEPALIVE_INTERVAL: 25000, // 25 seconds
} as const;


// CLI Constants
export const CLI = {
  // Command names
  COMMANDS: {
    GEMINI: "gemini",
    ECHO: "echo",
  },
  // Command flags
  FLAGS: {
    MODEL: "-m",
    SANDBOX: "-s",
    PROMPT: "-p",
    HELP: "-help",
    ALLOWED_TOOLS: "--allowed-tools",
  },
  // Default values
  DEFAULTS: {
    MODEL: MODELS.PRO_3, // Tool default model used when no specific model is provided
    BOOLEAN_TRUE: "true",
    BOOLEAN_FALSE: "false",
  },
} as const;

// Backend Constants
export const BACKENDS = {
  GEMINI: 'gemini',  // Default backend
  CODEX: 'codex',
} as const;

// Codex CLI Constants
export const CODEX_CLI = {
  COMMANDS: {
    EXEC: 'exec',
    RESUME: 'resume',
  },
  FLAGS: {
    CONFIG: '--config',
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
  REASONING_EFFORT: {
    LOW: 'low',
    MEDIUM: 'medium',      // Default, recommended for most tasks
    HIGH: 'high',
    XHIGH: 'xhigh',        // Extra high, for hardest tasks
  },
} as const;

export const CODEX_FILE_REF = {
  MAX_FILE_BYTES: 10 * 1024 * 1024, // 10MB
  MAX_TOTAL_BYTES: 20 * 1024 * 1024, // 20MB total inlined content
  MAX_DIR_ENTRIES: 200, // Prevent huge directory listings
} as const;

export const CODEX_OUTPUT = {
  MAX_OUTPUT_SIZE: 10 * 1024 * 1024, // 10MB max output to prevent memory exhaustion
  MAX_JSONL_LINES: 10000, // Maximum JSONL lines to parse
} as const;

// Codex Models
export const CODEX_MODELS = {
  // Recommended
  GPT_5_4: 'gpt-5.4',                  // Latest general-purpose model
  GPT_5_4_MINI: 'gpt-5.4-mini',        // Faster/cheaper GPT-5.4 variant
  GPT_5_3_CODEX: 'gpt-5.3-codex',      // Agentic coding model
  GPT_5_2_CODEX: 'gpt-5.2-codex',      // Agentic coding model
  GPT_5_2: 'gpt-5.2',                  // General-purpose model
  // Default (used when no model is specified)
  DEFAULT: 'gpt-5.4',
} as const;

// Shared Session Management Constants
export const SESSION = {
  BASE_DIR: '.ai-cli-mcp/sessions', // Base directory in user's home
  DEFAULT_TTL: 24 * 60 * 60 * 1000, // 24 hours default
  DEFAULT_MAX_SESSIONS: 20,
  DEFAULT_EVICTION_POLICY: 'lru' as const,

  // Per-tool configurations
  TOOL_CONFIGS: {
    'review-code': {
      TTL: 24 * 60 * 60 * 1000, // 24 hours
      MAX_SESSIONS: 20,
      EVICTION_POLICY: 'lru' as const
    },
    'ask': {
      TTL: 7 * 24 * 60 * 60 * 1000, // 7 days
      MAX_SESSIONS: 50,
      EVICTION_POLICY: 'lru' as const
    },
    'ask-gemini': { // Backward compatibility alias
      TTL: 7 * 24 * 60 * 60 * 1000, // 7 days
      MAX_SESSIONS: 50,
      EVICTION_POLICY: 'lru' as const
    },
    'brainstorm': {
      TTL: 14 * 24 * 60 * 60 * 1000, // 14 days
      MAX_SESSIONS: 30,
      EVICTION_POLICY: 'lru' as const
    }
  }
} as const;

// Code Review Constants
export const REVIEW = {
  // Session configuration (deprecated - use SESSION constants)
  SESSION: {
    TTL: 60 * 60 * 1000, // 60 minutes (deprecated)
    MAX_SESSIONS: 20,
    CACHE_DIR_NAME: 'ai-cli-mcp-review-sessions', // deprecated
  },
  // Review types
  TYPES: {
    SECURITY: 'security',
    PERFORMANCE: 'performance',
    QUALITY: 'quality',
    ARCHITECTURE: 'architecture',
    GENERAL: 'general',
  },
  // Comment severity levels
  SEVERITY: {
    CRITICAL: 'critical',
    IMPORTANT: 'important',
    SUGGESTION: 'suggestion',
    QUESTION: 'question',
  },
  // Comment status
  STATUS: {
    PENDING: 'pending',
    ACCEPTED: 'accepted',
    REJECTED: 'rejected',
    MODIFIED: 'modified',
    DEFERRED: 'deferred',
  },
  // Session state
  SESSION_STATE: {
    ACTIVE: 'active',
    PAUSED: 'paused',
    COMPLETED: 'completed',
  },
  // Review scope
  SCOPE: {
    FULL: 'full',
    CHANGES_ONLY: 'changes-only',
    FOCUSED: 'focused',
  },
  // Formatting
  MAX_HISTORY_ROUNDS: 3, // How many previous rounds to include in context
  SEVERITY_EMOJI: {
    critical: '🔴',
    important: '🟠',
    suggestion: '🟡',
    question: '💬',
  } as const,
} as const;


// (merged PromptArguments and ToolArguments)
export interface ToolArguments {
  prompt?: string;
  model?: string;
  sandbox?: boolean | string;
  changeMode?: boolean | string;
  chunkIndex?: number | string; // Which chunk to return (1-based)
  chunkCacheKey?: string; // Optional cache key for continuation
  message?: string; // For Ping tool -- Un-used.

  // --> Backend selection (defaults to gemini)
  backend?: 'gemini' | 'codex';

  // --> shared session parameters (ask, brainstorm, review-code)
  session?: string; // Session ID for conversation continuity
  includeHistory?: boolean; // Include conversation/review history in prompt

  // --> tool permissions (ask)
  allowedTools?: string[]; // Tools that the AI backend can auto-approve (e.g., ["run_shell_command"])

  // --> brainstorm tool
  methodology?: string; // Brainstorming framework to use
  domain?: string; // Domain context for specialized brainstorming
  constraints?: string; // Known limitations or requirements
  existingContext?: string; // Background information to build upon
  ideaCount?: number; // Target number of ideas to generate
  includeAnalysis?: boolean; // Include feasibility and impact analysis

  // --> review-code tool
  files?: string[]; // Specific files to review
  sessionId?: string; // Explicit session ID override (review-code uses this OR git-based)
  forceNewSession?: boolean; // Force create new session
  reviewType?: string; // Type of review (security, performance, etc.)
  severity?: string; // Filter by severity level
  commentDecisions?: Array<{
    commentId: string;
    decision: string;
    notes?: string;
  }>; // Decision tracking for previous comments

  [key: string]: string | boolean | number | undefined | string[] | Array<any>; // Allow additional properties
}
