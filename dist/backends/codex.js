/**
 * Codex Backend - Executes prompts via OpenAI's Codex CLI
 *
 * Uses `codex exec` for non-interactive execution mode.
 * Supports native session resume via thread_id from JSON output.
 * Codex CLI does not support @file syntax, so files must be read and inlined.
 */
import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import { constants as fsConstants } from 'fs';
import * as path from 'path';
import { Logger } from '../utils/logger.js';
import { CODEX_CLI, CODEX_FILE_REF, CODEX_OUTPUT, CODEX_MODELS, ERROR_MESSAGES } from '../constants.js';
import { getAllowedEnv } from '../utils/envAllowlist.js';
import { getChangeModeInstructionsCondensed } from '../utils/changeModeInstructions.js';
export class CodexBackend {
    name = 'codex';
    async execute(prompt, config, onProgress) {
        // Security: Validate model name to prevent argument injection
        if (config.model && config.model.startsWith('-')) {
            throw new Error(`Invalid model name: model cannot start with '-'`);
        }
        if (config.codexThreadId && config.codexThreadId.startsWith('-')) {
            throw new Error(`Invalid codex thread id: thread id cannot start with '-'`);
        }
        // Translate @file references to inline content since Codex doesn't support them
        const processedPrompt = await this.translateFileRefs(prompt, config.cwd);
        // Apply changeMode instructions if enabled
        const finalPrompt = config.changeMode
            ? this.applyChangeModeInstructions(processedPrompt)
            : processedPrompt;
        // Build args - use resume if we have an existing threadId
        const args = this.buildArgs(config);
        // Execute and parse JSON output
        const result = await this.executeCommand(args, finalPrompt, onProgress, config.cwd);
        return {
            response: result.response,
            backend: this.name,
            model: config.model ?? (config.codexThreadId ? undefined : CODEX_MODELS.DEFAULT),
            codexThreadId: result.threadId,
        };
    }
    async isAvailable() {
        return new Promise((resolve) => {
            const checker = process.platform === 'win32' ? 'where' : 'which';
            const child = spawn(checker, ['codex']);
            child.on('close', (code) => resolve(code === 0));
            child.on('error', () => resolve(false));
        });
    }
    getModels() {
        return [
            CODEX_MODELS.GPT_5_4,
            CODEX_MODELS.GPT_5_4_MINI,
            CODEX_MODELS.GPT_5_3_CODEX,
            CODEX_MODELS.GPT_5_2_CODEX,
            CODEX_MODELS.GPT_5_2,
        ];
    }
    supportsFileRefs() {
        return false; // Codex reads files directly, doesn't use @ syntax
    }
    getFileRefSyntax() {
        return ''; // No file ref syntax
    }
    buildArgs(config) {
        const args = [];
        // Codex parses approval/sandbox options as global flags; place before subcommands.
        // On resume, prefer Codex's thread-associated model unless the user explicitly overrides `model`.
        const modelToUse = config.model ?? (config.codexThreadId ? undefined : CODEX_MODELS.DEFAULT);
        if (modelToUse) {
            args.push(CODEX_CLI.FLAGS.MODEL, modelToUse);
        }
        // Approval mode
        if (config.approvalMode) {
            args.push(CODEX_CLI.FLAGS.APPROVAL, config.approvalMode);
        }
        else if (config.fullAuto) {
            args.push(CODEX_CLI.FLAGS.FULL_AUTO);
        }
        else {
            // Default to on-request for safety
            args.push(CODEX_CLI.FLAGS.APPROVAL, CODEX_CLI.APPROVAL_MODES.ON_REQUEST);
        }
        // Sandbox mode
        const sandboxMode = config.sandboxMode ??
            (config.sandbox ? CODEX_CLI.SANDBOX_MODES.WORKSPACE_WRITE : CODEX_CLI.SANDBOX_MODES.READ_ONLY);
        if (sandboxMode === CODEX_CLI.SANDBOX_MODES.FULL_ACCESS) {
            Logger.warn('⚠️ SECURITY: Codex full filesystem access enabled (danger-full-access)');
        }
        args.push(CODEX_CLI.FLAGS.SANDBOX, sandboxMode);
        // Reasoning effort is configured via --config (not --reasoning-effort) in current Codex CLI.
        if (config.reasoningEffort) {
            args.push(CODEX_CLI.FLAGS.CONFIG, `model_reasoning_effort="${config.reasoningEffort}"`);
        }
        // Use `codex exec` and `codex exec resume <threadId>` for non-interactive mode.
        args.push(CODEX_CLI.COMMANDS.EXEC);
        if (config.codexThreadId) {
            args.push(CODEX_CLI.COMMANDS.RESUME, config.codexThreadId);
        }
        // Enable JSON output to capture thread_id
        args.push(CODEX_CLI.FLAGS.JSON);
        // Read prompt from stdin
        args.push(CODEX_CLI.FLAGS.STDIN);
        return args;
    }
    /**
     * Validate that a resolved path is within the allowed workspace
     * Prevents path traversal attacks including Windows drive letter escapes
     */
    isPathWithinWorkspace(resolvedPath, workingDir) {
        const normalizedPath = path.normalize(resolvedPath);
        const normalizedWorkDir = path.normalize(workingDir);
        const relative = path.relative(normalizedWorkDir, normalizedPath);
        // Check: empty string (workspace root) is allowed, doesn't escape via '..', not absolute (handles Windows drive letters)
        return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
    }
    /**
     * Translate @file references to inline content
     * Codex doesn't support @ syntax, so we read files and include their content
     * Handles paths with dots, slashes, dashes, underscores, and relative paths like @../src/file.ts
     * Includes path traversal protection to prevent reading files outside workspace
     */
    async translateFileRefs(prompt, cwd) {
        const workingDir = cwd || process.cwd();
        const lexicalWorkDir = path.resolve(workingDir);
        const canonicalWorkDir = await fs.realpath(workingDir).catch(() => lexicalWorkDir);
        // Match @file references - handles:
        // - Relative paths: @../src/file.ts, @./file.ts
        // - Absolute paths: @/home/user/file.ts
        // - Paths with special chars: @src/file-name.test.ts
        // Stops at whitespace or another @ symbol
        const fileRefs = prompt.match(/@(?:\.\.?\/)?[^\s@]+/g) || [];
        if (fileRefs.length === 0) {
            return prompt;
        }
        let translated = prompt;
        const missingFiles = [];
        const deniedFiles = [];
        // Max file size: 10MB to prevent memory exhaustion
        let totalInlinedBytes = 0;
        const alreadyProcessedRefs = new Set();
        const alreadyProcessedTargets = new Map();
        for (const ref of fileRefs) {
            const filePath = ref.substring(1); // Remove @ prefix
            // Avoid re-reading/re-inlining the same @reference multiple times.
            // Replace duplicates with a small pointer to the first inlined instance.
            if (alreadyProcessedRefs.has(ref)) {
                translated = translated.replace(ref, `\n--- Duplicate @reference: ${filePath} (see earlier in prompt) ---\n`);
                continue;
            }
            alreadyProcessedRefs.add(ref);
            const absolutePath = path.isAbsolute(filePath)
                ? filePath
                : path.join(workingDir, filePath);
            // Resolve for basic path normalization (does not follow symlinks)
            const resolvedPath = path.resolve(absolutePath);
            // Security check: Ensure path is within workspace
            if (!this.isPathWithinWorkspace(resolvedPath, lexicalWorkDir)) {
                deniedFiles.push(filePath);
                Logger.warn(`Path traversal blocked for @reference: ${filePath} (resolved to ${resolvedPath})`);
                translated = translated.replace(ref, `${ERROR_MESSAGES.ACCESS_DENIED_OUTSIDE_WORKSPACE} (${filePath})`);
                continue;
            }
            try {
                try {
                    await fs.access(absolutePath, fsConstants.F_OK);
                }
                catch {
                    // Extra security: if file doesn't exist and path contains .., deny access.
                    // This prevents potential TOCTOU attacks where file is created after check.
                    if (filePath.includes('..')) {
                        deniedFiles.push(filePath);
                        Logger.warn(`Path traversal blocked for non-existent path with ..: ${filePath}`);
                        translated = translated.replace(ref, ERROR_MESSAGES.ACCESS_DENIED_PATH_TRAVERSAL);
                        continue;
                    }
                    missingFiles.push(filePath);
                    Logger.warn(`File not found for @reference: ${filePath}`);
                    translated = translated.replace(ref, `${ERROR_MESSAGES.FILE_NOT_FOUND}: ${filePath}`);
                    continue;
                }
                // Canonicalize to prevent parent-directory symlink traversal (e.g., workspace/subdir -> /etc)
                const canonicalTargetPath = await fs.realpath(absolutePath);
                const isSymlinkedPath = path.normalize(canonicalTargetPath) !== path.normalize(path.resolve(absolutePath));
                if (!this.isPathWithinWorkspace(canonicalTargetPath, canonicalWorkDir)) {
                    deniedFiles.push(filePath);
                    Logger.warn(`Symlink traversal blocked for @reference: ${filePath} (realpath: ${canonicalTargetPath})`);
                    translated = translated.replace(ref, `${isSymlinkedPath ? ERROR_MESSAGES.ACCESS_DENIED_SYMLINK_OUTSIDE_WORKSPACE : ERROR_MESSAGES.ACCESS_DENIED_OUTSIDE_WORKSPACE} (${filePath})`);
                    continue;
                }
                if (alreadyProcessedTargets.has(canonicalTargetPath)) {
                    translated = translated.replace(ref, `\n--- Duplicate @reference: ${filePath} (see earlier in prompt) ---\n`);
                    continue;
                }
                const stat = await fs.stat(canonicalTargetPath);
                if (stat.isDirectory()) {
                    // For directories, list files but don't inline all content (bounded)
                    const fileNames = [];
                    let truncated = false;
                    const dir = await fs.opendir(canonicalTargetPath);
                    try {
                        while (true) {
                            const dirent = await dir.read();
                            if (!dirent)
                                break;
                            if (fileNames.length < CODEX_FILE_REF.MAX_DIR_ENTRIES) {
                                fileNames.push(dirent.name);
                                continue;
                            }
                            truncated = true;
                            break;
                        }
                    }
                    finally {
                        await dir.close();
                    }
                    const suffix = truncated ? `, ... (showing first ${CODEX_FILE_REF.MAX_DIR_ENTRIES})` : '';
                    const directoryListing = `\n--- Directory: ${filePath} ---\nFiles: ${fileNames.join(', ')}${suffix}\n--- end directory ---\n`;
                    const listingBytes = Buffer.byteLength(directoryListing, 'utf8');
                    if (totalInlinedBytes + listingBytes > CODEX_FILE_REF.MAX_TOTAL_BYTES) {
                        Logger.warn(`Inline limit reached while listing directory: ${filePath}`);
                        translated = translated.replace(ref, `${ERROR_MESSAGES.INLINE_LIMIT_REACHED}: ${filePath}`);
                        continue;
                    }
                    totalInlinedBytes += listingBytes;
                    alreadyProcessedTargets.set(canonicalTargetPath, directoryListing);
                    translated = translated.replace(ref, directoryListing);
                    continue;
                }
                // Check file size before reading
                if (stat.size > CODEX_FILE_REF.MAX_FILE_BYTES) {
                    Logger.warn(`File too large for @reference: ${filePath} (${(stat.size / 1024 / 1024).toFixed(2)}MB > 10MB limit)`);
                    translated = translated.replace(ref, `${ERROR_MESSAGES.FILE_TOO_LARGE}: ${filePath} (${(stat.size / 1024 / 1024).toFixed(2)}MB exceeds 10MB limit)`);
                    continue;
                }
                if (totalInlinedBytes + stat.size > CODEX_FILE_REF.MAX_TOTAL_BYTES) {
                    Logger.warn(`Inline limit reached; skipping file: ${filePath} (${stat.size} bytes)`);
                    translated = translated.replace(ref, `${ERROR_MESSAGES.INLINE_LIMIT_REACHED}: ${filePath}`);
                    continue;
                }
                const content = await fs.readFile(canonicalTargetPath, 'utf-8');
                const fileBlock = `\n--- File: ${filePath} ---\n${content}\n--- end file: ${filePath} ---\n`;
                totalInlinedBytes += stat.size;
                alreadyProcessedTargets.set(canonicalTargetPath, fileBlock);
                translated = translated.replace(ref, fileBlock);
            }
            catch (error) {
                const errMsg = error instanceof Error ? error.message : String(error);
                Logger.error(`Error reading file ${filePath}: ${errMsg}`);
                translated = translated.replace(ref, `${ERROR_MESSAGES.ERROR_READING_FILE}: ${filePath}`);
            }
        }
        // Log warnings for security and missing files
        if (deniedFiles.length > 0) {
            Logger.warn(`Security: Blocked access to ${deniedFiles.length} file(s) outside workspace`);
        }
        if (missingFiles.length > 0) {
            Logger.warn(`Missing file references: ${missingFiles.join(', ')}`);
        }
        return translated;
    }
    applyChangeModeInstructions(prompt) {
        return getChangeModeInstructionsCondensed(prompt);
    }
    /**
     * Parse JSONL output from Codex CLI
     * Extracts thread_id from thread.started event and response text from message events
     */
    parseJsonOutput(jsonlOutput) {
        const allLines = jsonlOutput.trim().split('\n');
        // Defensive line limit to prevent DoS via massive JSONL output
        const lines = allLines.slice(0, CODEX_OUTPUT.MAX_JSONL_LINES);
        if (allLines.length >= CODEX_OUTPUT.MAX_JSONL_LINES) {
            Logger.warn(`Truncated JSONL output to ${CODEX_OUTPUT.MAX_JSONL_LINES} lines`);
        }
        let threadId;
        const responseChunks = [];
        for (const line of lines) {
            if (!line.trim())
                continue;
            try {
                const event = JSON.parse(line);
                // Extract thread_id from thread.started event
                if (event.type === 'thread.started' && event.thread_id) {
                    threadId = event.thread_id;
                    Logger.debug(`Codex thread started: ${threadId}`);
                }
                // Extract response text from various event types
                // Agent messages contain the actual response
                if (event.type === 'item.agent_message' && event.content) {
                    responseChunks.push(event.content);
                }
                // Newer Codex JSONL emits completed items with nested payload.
                // Example: {"type":"item.completed","item":{"type":"agent_message","text":"..."}}
                if (event.type === 'item.completed' && event.item) {
                    const item = event.item;
                    if (item.type === 'agent_message') {
                        if (typeof item.text === 'string') {
                            responseChunks.push(item.text);
                        }
                        else if (typeof item.content === 'string') {
                            responseChunks.push(item.content);
                        }
                        else if (Array.isArray(item.content)) {
                            for (const part of item.content) {
                                if (part?.type === 'text' && part.text) {
                                    responseChunks.push(part.text);
                                }
                            }
                        }
                    }
                }
                // Also check for message content in turn.completed
                if (event.type === 'turn.completed' && event.output) {
                    if (typeof event.output === 'string') {
                        responseChunks.push(event.output);
                    }
                    else if (event.output.content) {
                        responseChunks.push(event.output.content);
                    }
                }
                // Handle item.message for direct message content
                if (event.type === 'item.message' && event.content) {
                    if (Array.isArray(event.content)) {
                        for (const part of event.content) {
                            if (part.type === 'text' && part.text) {
                                responseChunks.push(part.text);
                            }
                        }
                    }
                    else if (typeof event.content === 'string') {
                        responseChunks.push(event.content);
                    }
                }
            }
            catch (parseError) {
                // Not all lines may be valid JSON, skip them
                Logger.debug(`Skipping non-JSON line: ${line.substring(0, 50)}...`);
            }
        }
        // Join all response chunks
        const response = responseChunks.join('\n').trim();
        // If no response extracted from events, use raw output minus JSON structure
        if (!response) {
            Logger.warn('No structured response found in Codex JSON output, using raw text extraction');
            // Try to extract any text content from the raw output
            const textMatch = jsonlOutput.match(/"text"\s*:\s*"([^"]+)"/g);
            if (textMatch) {
                const extractedTexts = textMatch.map(m => {
                    const match = m.match(/"text"\s*:\s*"([^"]+)"/);
                    return match ? match[1] : '';
                }).filter(Boolean);
                return { response: extractedTexts.join('\n'), threadId };
            }
            return { response: jsonlOutput, threadId };
        }
        return { response, threadId };
    }
    executeCommand(args, prompt, onProgress, cwd) {
        return new Promise((resolve, reject) => {
            const startTime = Date.now();
            Logger.commandExecution('codex', args, startTime);
            const childProcess = spawn('codex', args, {
                env: getAllowedEnv(),
                shell: false,
                stdio: ['pipe', 'pipe', 'pipe'],
                cwd: cwd || process.cwd(),
            });
            // Write prompt to stdin
            childProcess.stdin.write(prompt);
            childProcess.stdin.end();
            let stdout = '';
            let stderr = '';
            let isResolved = false;
            let outputSizeExceeded = false;
            childProcess.stdout.on('data', (data) => {
                // Security: Prevent memory exhaustion from massive output
                if (outputSizeExceeded)
                    return;
                const chunk = data.toString();
                if (stdout.length + chunk.length > CODEX_OUTPUT.MAX_OUTPUT_SIZE) {
                    Logger.warn(`Output exceeds ${CODEX_OUTPUT.MAX_OUTPUT_SIZE / 1024 / 1024}MB limit, killing process`);
                    outputSizeExceeded = true;
                    childProcess.kill('SIGTERM');
                    return;
                }
                stdout += chunk;
                // For JSON output, try to parse and report progress from events
                if (onProgress) {
                    const newLines = chunk.split('\n');
                    for (const line of newLines) {
                        if (!line.trim())
                            continue;
                        try {
                            const event = JSON.parse(line);
                            // Report agent messages as progress
                            if (event.type === 'item.agent_message' && event.content) {
                                onProgress(event.content);
                            }
                        }
                        catch {
                            // Skip non-JSON lines
                        }
                    }
                }
            });
            childProcess.stderr.on('data', (data) => {
                stderr += data.toString();
            });
            childProcess.on('error', (error) => {
                if (!isResolved) {
                    isResolved = true;
                    Logger.error('Process error:', error);
                    reject(new Error(`Failed to spawn codex command: ${error.message}`));
                }
            });
            childProcess.on('close', (code) => {
                if (!isResolved) {
                    isResolved = true;
                    if (code === 0) {
                        Logger.commandComplete(startTime, code, stdout.length);
                        // Parse JSON output to extract thread_id and response
                        const result = this.parseJsonOutput(stdout);
                        resolve(result);
                    }
                    else {
                        Logger.commandComplete(startTime, code);
                        Logger.error(`Codex failed with exit code ${code}`);
                        const errorMessage = stderr.trim() || 'Unknown error';
                        reject(new Error(`Codex command failed with exit code ${code}: ${errorMessage}`));
                    }
                }
            });
        });
    }
}
//# sourceMappingURL=codex.js.map