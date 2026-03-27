import { executeCommand } from './commandExecutor.js';
import { Logger } from './logger.js';
import { ERROR_MESSAGES, STATUS_MESSAGES, MODELS, CLI, GEMINI_MODEL_ALIASES } from '../constants.js';
import { parseChangeModeOutput, validateChangeModeEdits } from './changeModeParser.js';
import { formatChangeModeResponse, summarizeChangeModeEdits } from './changeModeTranslator.js';
import { getChangeModeInstructions } from './changeModeInstructions.js';
export async function executeGeminiCLI(prompt, model, sandbox, changeMode, onProgress, allowedTools, cwd) {
    let prompt_processed = prompt;
    const resolvedModel = model ? (GEMINI_MODEL_ALIASES[model] || model) : MODELS.PRO_3;
    if (changeMode) {
        prompt_processed = prompt.replace(/file:(\S+)/g, '@$1');
        prompt_processed = getChangeModeInstructions(prompt_processed);
    }
    const args = [];
    args.push(CLI.FLAGS.MODEL, resolvedModel);
    if (sandbox) {
        args.push(CLI.FLAGS.SANDBOX);
    }
    // Add allowed tools for auto-approval (e.g., run_shell_command for git commands)
    if (allowedTools && allowedTools.length > 0) {
        for (const tool of allowedTools) {
            args.push(CLI.FLAGS.ALLOWED_TOOLS, tool);
        }
    }
    // Ensure @ symbols work cross-platform by wrapping in quotes if needed
    const finalPrompt = prompt_processed.includes('@') && !prompt_processed.startsWith('"')
        ? `"${prompt_processed}"`
        : prompt_processed;
    args.push(CLI.FLAGS.PROMPT, finalPrompt);
    try {
        return await executeCommand(CLI.COMMANDS.GEMINI, args, onProgress, cwd);
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (errorMessage.includes(ERROR_MESSAGES.QUOTA_EXCEEDED) && resolvedModel !== MODELS.FLASH) {
            Logger.warn(`${ERROR_MESSAGES.QUOTA_EXCEEDED}. Falling back to ${MODELS.FLASH}.`);
            await sendStatusMessage(STATUS_MESSAGES.FLASH_RETRY);
            const fallbackArgs = [];
            fallbackArgs.push(CLI.FLAGS.MODEL, MODELS.FLASH);
            if (sandbox) {
                fallbackArgs.push(CLI.FLAGS.SANDBOX);
            }
            // Include allowed tools in fallback as well
            if (allowedTools && allowedTools.length > 0) {
                for (const tool of allowedTools) {
                    fallbackArgs.push(CLI.FLAGS.ALLOWED_TOOLS, tool);
                }
            }
            // Same @ symbol handling for fallback
            const fallbackPrompt = prompt_processed.includes('@') && !prompt_processed.startsWith('"')
                ? `"${prompt_processed}"`
                : prompt_processed;
            fallbackArgs.push(CLI.FLAGS.PROMPT, fallbackPrompt);
            try {
                const result = await executeCommand(CLI.COMMANDS.GEMINI, fallbackArgs, onProgress, cwd);
                Logger.warn(`Successfully executed with ${MODELS.FLASH} fallback.`);
                await sendStatusMessage(STATUS_MESSAGES.FLASH_SUCCESS);
                return result;
            }
            catch (fallbackError) {
                const fallbackErrorMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
                throw new Error(`${resolvedModel} quota exceeded, ${MODELS.FLASH} fallback also failed: ${fallbackErrorMessage}`);
            }
        }
        else {
            throw error;
        }
    }
}
export function processChangeModeOutput(rawResult) {
    // Parse OLD/NEW format
    const edits = parseChangeModeOutput(rawResult);
    if (edits.length === 0) {
        return `No edits found in Gemini's response. Please ensure Gemini uses the OLD/NEW format.\n\n${rawResult}`;
    }
    // Validate edits
    const validation = validateChangeModeEdits(edits);
    if (!validation.valid) {
        return `Edit validation failed:\n${validation.errors.join('\n')}`;
    }
    // Format the response
    let result = formatChangeModeResponse(edits);
    // Add summary if many edits
    if (edits.length > 5) {
        result = summarizeChangeModeEdits(edits) + '\n\n' + result;
    }
    Logger.debug(`ChangeMode: Parsed ${edits.length} edits`);
    return result;
}
// Placeholder
async function sendStatusMessage(message) {
    Logger.debug(`Status: ${message}`);
}
//# sourceMappingURL=geminiExecutor.js.map