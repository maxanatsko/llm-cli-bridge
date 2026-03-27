export declare const LOG_PREFIX = "[GMCPT]";
export declare const ERROR_MESSAGES: {
    readonly QUOTA_EXCEEDED: "Quota exceeded for quota metric 'Gemini 2.5 Pro Requests'";
    readonly QUOTA_EXCEEDED_SHORT: "⚠️ Gemini 2.5 Pro daily quota exceeded. Please retry with model: 'gemini-2.5-flash'";
    readonly TOOL_NOT_FOUND: "not found in registry";
    readonly NO_PROMPT_PROVIDED: "Please provide a prompt for analysis. Use @ syntax to include files (e.g., '@largefile.js explain what this does') or ask general questions";
    readonly ACCESS_DENIED_PATH_TRAVERSAL: "[Access denied: path traversal not allowed]";
    readonly ACCESS_DENIED_OUTSIDE_WORKSPACE: "[Access denied: path is outside workspace]";
    readonly ACCESS_DENIED_SYMLINK_OUTSIDE_WORKSPACE: "[Access denied: symlink points outside workspace]";
    readonly FILE_TOO_LARGE: "[File too large]";
    readonly FILE_NOT_FOUND: "[File not found]";
    readonly ERROR_READING_FILE: "[Error reading file]";
    readonly INLINE_LIMIT_REACHED: "[Inline limit reached]";
};
export declare const STATUS_MESSAGES: {
    readonly QUOTA_SWITCHING: "🚫 Gemini 2.5 Pro quota exceeded, switching to Flash model...";
    readonly FLASH_RETRY: "⚡ Retrying with Gemini 2.5 Flash...";
    readonly FLASH_SUCCESS: "✅ Flash model completed successfully";
    readonly SANDBOX_EXECUTING: "🔒 Executing CLI command in sandbox mode...";
    readonly PROCESSING_START: "🔍 Starting analysis (may take 5-15 minutes for large codebases)";
    readonly PROCESSING_CONTINUE: "⏳ Still processing... Working on your request";
    readonly PROCESSING_COMPLETE: "✅ Analysis completed successfully";
};
export declare const MODELS: {
    readonly PRO_3: "gemini-3.1-pro";
    readonly FLASH_3: "gemini-3-flash";
    readonly PRO: "gemini-2.5-pro";
    readonly FLASH: "gemini-2.5-flash";
};
export declare const GEMINI_MODEL_ALIASES: Record<string, string>;
export declare const PROTOCOL: {
    readonly ROLES: {
        readonly USER: "user";
        readonly ASSISTANT: "assistant";
    };
    readonly CONTENT_TYPES: {
        readonly TEXT: "text";
    };
    readonly STATUS: {
        readonly SUCCESS: "success";
        readonly ERROR: "error";
        readonly FAILED: "failed";
        readonly REPORT: "report";
    };
    readonly NOTIFICATIONS: {
        readonly PROGRESS: "notifications/progress";
    };
    readonly KEEPALIVE_INTERVAL: 25000;
};
export declare const CLI: {
    readonly COMMANDS: {
        readonly GEMINI: "gemini";
        readonly ECHO: "echo";
    };
    readonly FLAGS: {
        readonly MODEL: "-m";
        readonly SANDBOX: "-s";
        readonly PROMPT: "-p";
        readonly HELP: "-help";
        readonly ALLOWED_TOOLS: "--allowed-tools";
    };
    readonly DEFAULTS: {
        readonly MODEL: "gemini-3.1-pro";
        readonly BOOLEAN_TRUE: "true";
        readonly BOOLEAN_FALSE: "false";
    };
};
export declare const BACKENDS: {
    readonly GEMINI: "gemini";
    readonly CODEX: "codex";
};
export declare const CODEX_CLI: {
    readonly COMMANDS: {
        readonly EXEC: "exec";
        readonly RESUME: "resume";
    };
    readonly FLAGS: {
        readonly CONFIG: "--config";
        readonly MODEL: "-m";
        readonly APPROVAL: "-a";
        readonly SANDBOX: "-s";
        readonly FULL_AUTO: "--full-auto";
        readonly JSON: "--json";
        readonly STDIN: "-";
    };
    readonly APPROVAL_MODES: {
        readonly UNTRUSTED: "untrusted";
        readonly ON_FAILURE: "on-failure";
        readonly ON_REQUEST: "on-request";
        readonly NEVER: "never";
    };
    readonly SANDBOX_MODES: {
        readonly READ_ONLY: "read-only";
        readonly WORKSPACE_WRITE: "workspace-write";
        readonly FULL_ACCESS: "danger-full-access";
    };
    readonly REASONING_EFFORT: {
        readonly LOW: "low";
        readonly MEDIUM: "medium";
        readonly HIGH: "high";
        readonly XHIGH: "xhigh";
    };
};
export declare const CODEX_FILE_REF: {
    readonly MAX_FILE_BYTES: number;
    readonly MAX_TOTAL_BYTES: number;
    readonly MAX_DIR_ENTRIES: 200;
};
export declare const CODEX_OUTPUT: {
    readonly MAX_OUTPUT_SIZE: number;
    readonly MAX_JSONL_LINES: 10000;
};
export declare const CODEX_MODELS: {
    readonly GPT_5_4: "gpt-5.4";
    readonly GPT_5_4_MINI: "gpt-5.4-mini";
    readonly GPT_5_3_CODEX: "gpt-5.3-codex";
    readonly GPT_5_2_CODEX: "gpt-5.2-codex";
    readonly GPT_5_2: "gpt-5.2";
    readonly DEFAULT: "gpt-5.4";
};
export declare const SESSION: {
    readonly BASE_DIR: ".ai-cli-mcp/sessions";
    readonly DEFAULT_TTL: number;
    readonly DEFAULT_MAX_SESSIONS: 20;
    readonly DEFAULT_EVICTION_POLICY: "lru";
    readonly TOOL_CONFIGS: {
        readonly 'review-code': {
            readonly TTL: number;
            readonly MAX_SESSIONS: 20;
            readonly EVICTION_POLICY: "lru";
        };
        readonly ask: {
            readonly TTL: number;
            readonly MAX_SESSIONS: 50;
            readonly EVICTION_POLICY: "lru";
        };
        readonly 'ask-gemini': {
            readonly TTL: number;
            readonly MAX_SESSIONS: 50;
            readonly EVICTION_POLICY: "lru";
        };
        readonly brainstorm: {
            readonly TTL: number;
            readonly MAX_SESSIONS: 30;
            readonly EVICTION_POLICY: "lru";
        };
    };
};
export declare const REVIEW: {
    readonly SESSION: {
        readonly TTL: number;
        readonly MAX_SESSIONS: 20;
        readonly CACHE_DIR_NAME: "ai-cli-mcp-review-sessions";
    };
    readonly TYPES: {
        readonly SECURITY: "security";
        readonly PERFORMANCE: "performance";
        readonly QUALITY: "quality";
        readonly ARCHITECTURE: "architecture";
        readonly GENERAL: "general";
    };
    readonly SEVERITY: {
        readonly CRITICAL: "critical";
        readonly IMPORTANT: "important";
        readonly SUGGESTION: "suggestion";
        readonly QUESTION: "question";
    };
    readonly STATUS: {
        readonly PENDING: "pending";
        readonly ACCEPTED: "accepted";
        readonly REJECTED: "rejected";
        readonly MODIFIED: "modified";
        readonly DEFERRED: "deferred";
    };
    readonly SESSION_STATE: {
        readonly ACTIVE: "active";
        readonly PAUSED: "paused";
        readonly COMPLETED: "completed";
    };
    readonly SCOPE: {
        readonly FULL: "full";
        readonly CHANGES_ONLY: "changes-only";
        readonly FOCUSED: "focused";
    };
    readonly MAX_HISTORY_ROUNDS: 3;
    readonly SEVERITY_EMOJI: {
        readonly critical: "🔴";
        readonly important: "🟠";
        readonly suggestion: "🟡";
        readonly question: "💬";
    };
};
export interface ToolArguments {
    prompt?: string;
    model?: string;
    sandbox?: boolean | string;
    changeMode?: boolean | string;
    chunkIndex?: number | string;
    chunkCacheKey?: string;
    message?: string;
    backend?: 'gemini' | 'codex';
    session?: string;
    includeHistory?: boolean;
    allowedTools?: string[];
    methodology?: string;
    domain?: string;
    constraints?: string;
    existingContext?: string;
    ideaCount?: number;
    includeAnalysis?: boolean;
    files?: string[];
    sessionId?: string;
    forceNewSession?: boolean;
    reviewType?: string;
    severity?: string;
    commentDecisions?: Array<{
        commentId: string;
        decision: string;
        notes?: string;
    }>;
    [key: string]: string | boolean | number | undefined | string[] | Array<any>;
}
//# sourceMappingURL=constants.d.ts.map