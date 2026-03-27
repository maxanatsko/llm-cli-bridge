import { z } from 'zod';
import { getBackend } from '../backends/index.js';
import { processChangeModeOutput } from '../utils/geminiExecutor.js';
import { ERROR_MESSAGES, CODEX_MODELS, MODELS } from '../constants.js';
import { askSessionManager } from '../utils/askSessionManager.js';
import { extractFilesFromPrompt } from '../utils/reviewPromptBuilder.js';
import { Logger } from '../utils/logger.js';
const askArgsSchema = z.object({
    prompt: z.string().min(1).describe("Analysis request. Use @ syntax to include files (e.g., '@largefile.js explain what this does') or ask general questions"),
    backend: z.enum(['gemini', 'codex']).optional().describe("AI backend to use: 'gemini' (default) or 'codex'. Gemini offers 1M+ token context, Codex integrates with OpenAI models."),
    session: z.string().optional().describe("Session ID for conversation continuity (e.g., 'typescript-learning'). Maintains context across multiple questions."),
    model: z.string().optional().describe("Model override. Gemini: 'gemini-3.1-pro' (default), 'gemini-3-flash', 'gemini-2.5-pro', 'gemini-2.5-flash'. Codex: 'gpt-5.4' (default), 'gpt-5.4-mini', 'gpt-5.3-codex', 'gpt-5.2-codex', 'gpt-5.2'"),
    reasoningEffort: z.enum(['low', 'medium', 'high', 'xhigh']).optional().describe("Reasoning effort level (Codex only): 'low', 'medium' (default), 'high', 'xhigh'. Use 'high'/'xhigh' for complex tasks."),
    sandbox: z.boolean().default(false).describe("Sandbox (Gemini) / workspace-write (Codex). For Codex: false => read-only (default), true => workspace-write. Ignored if sandboxMode is set."),
    sandboxMode: z.enum(['read-only', 'workspace-write', 'danger-full-access']).optional().describe("Codex-only override for sandbox policy (takes precedence over sandbox). Use 'danger-full-access' only with explicit opt-in."),
    changeMode: z.boolean().default(false).describe("Enable structured change mode - formats prompts to prevent tool errors and returns structured edit suggestions that Claude can apply directly"),
    includeHistory: z.boolean().default(true).describe("Include conversation history in context (only applies when session is provided). Default: true"),
    allowedTools: z.array(z.string()).optional().describe("Tools that the AI can auto-approve without confirmation (e.g., ['run_shell_command'] for git commands). Use sparingly for security."),
    cwd: z.string().optional().describe("Working directory for CLI execution. Use this to match your IDE workspace directory if you get 'Directory mismatch' errors."),
});
export const askTool = {
    name: "ask",
    description: "Query AI with file analysis, session continuity, and dual-backend support (Gemini/Codex). Use backend:'codex' for OpenAI, defaults to Gemini.",
    zodSchema: askArgsSchema,
    annotations: {
        readOnlyHint: false, // Can modify state via sessions
        destructiveHint: false, // Doesn't delete data
        idempotentHint: false, // Same input may yield different AI responses
        openWorldHint: true, // Interacts with external AI APIs
    },
    prompt: {
        description: "Execute AI query with optional file references, session management, and backend selection.",
    },
    category: 'ai',
    execute: async (args, onProgress) => {
        const { prompt, backend: backendChoice, session, model, reasoningEffort, sandbox, sandboxMode, changeMode, includeHistory, allowedTools, cwd } = args;
        if (!prompt?.trim()) {
            throw new Error(ERROR_MESSAGES.NO_PROMPT_PROVIDED);
        }
        // Session handling - load first so we can use lastBackend for backend selection
        let sessionData = null;
        let enhancedPrompt = prompt;
        if (session) {
            try {
                sessionData = await askSessionManager.getOrCreate(session);
                // Build conversation context if history is enabled
                if (includeHistory && sessionData.conversationHistory.length > 0) {
                    const historyContext = askSessionManager.buildConversationContext(sessionData, 3);
                    enhancedPrompt = `${historyContext}\n\n# Current Question\n${prompt}`;
                }
                onProgress?.(`📝 Session '${session}' (Round ${sessionData.totalRounds + 1})`);
            }
            catch (error) {
                onProgress?.(`⚠️  Session loading failed: ${error instanceof Error ? error.message : String(error)}`);
                Logger.error(`Failed to load session '${session}': ${error}`);
                // Continue without session
            }
        }
        // Get the appropriate backend (defaults to session's last backend, then Gemini)
        const backendType = backendChoice || sessionData?.lastBackend || 'gemini';
        const backend = await getBackend(backendType);
        onProgress?.(`🤖 Using ${backend.name} backend...`);
        // Execute via the selected backend
        // Pass existing codexThreadId for native session resume when using Codex
        const result = await backend.execute(enhancedPrompt, {
            provider: backendType,
            model: model,
            sandbox: !!sandbox,
            sandboxMode: sandboxMode,
            changeMode: !!changeMode,
            allowedTools: allowedTools,
            cwd: cwd,
            codexThreadId: sessionData?.codexThreadId, // For Codex native session resume
            reasoningEffort: reasoningEffort,
        }, onProgress);
        // Save to session if provided
        if (session && sessionData) {
            try {
                const contextFiles = extractFilesFromPrompt(prompt);
                // Use model from backend result (actual model used), fallback to input or default
                const usedModel = result.model ||
                    model ||
                    (backendType === 'codex' ? CODEX_MODELS.DEFAULT : MODELS.PRO_3);
                askSessionManager.addRound(sessionData, prompt, result.response, usedModel, contextFiles, backendType, result.codexThreadId // Store Codex thread ID for native session resume
                );
                await askSessionManager.save(sessionData);
                onProgress?.(`💾 Saved to session '${session}' (${sessionData.totalRounds} rounds)`);
                if (result.codexThreadId && result.codexThreadId.length > 0) {
                    const threadPreview = result.codexThreadId.slice(0, 8);
                    onProgress?.(`🔗 Codex thread: ${threadPreview}...`);
                }
            }
            catch (error) {
                onProgress?.(`⚠️  Session save failed: ${error instanceof Error ? error.message : String(error)}`);
                Logger.error(`Failed to save session '${session}': ${error}`);
                // Continue - result is still valid even if session save failed
            }
        }
        if (changeMode) {
            return processChangeModeOutput(result.response);
        }
        // Use backend-aware response prefix
        const backendName = backend.name.charAt(0).toUpperCase() + backend.name.slice(1);
        return `${backendName} response:\n${result.response}`;
    }
};
// Backward compatibility: register as a separate tool name
export const askGeminiTool = {
    ...askTool,
    name: 'ask-gemini',
    description: "Backward-compatible alias for 'ask'.",
};
//# sourceMappingURL=ask.tool.js.map