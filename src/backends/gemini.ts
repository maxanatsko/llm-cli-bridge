/**
 * Gemini Backend - Executes prompts via Google's Gemini CLI
 */

import { spawn } from 'child_process';
import { BackendExecutor, BackendConfig, BackendType, BackendResult } from './types.js';
import { Logger } from '../utils/logger.js';
import {
  ERROR_MESSAGES,
  STATUS_MESSAGES,
  MODELS,
  CLI,
  GEMINI_MODEL_ALIASES
} from '../constants.js';
import { getAllowedEnv } from '../utils/envAllowlist.js';
import { getChangeModeInstructions } from '../utils/changeModeInstructions.js';

export class GeminiBackend implements BackendExecutor {
  name: BackendType = 'gemini';

  private resolveModel(requestedModel: string | undefined): string {
    if (!requestedModel || requestedModel.trim().length === 0) {
      return MODELS.PRO_3;
    }

    const normalized = GEMINI_MODEL_ALIASES[requestedModel] || requestedModel;
    if (normalized !== requestedModel) {
      Logger.warn(`Gemini model '${requestedModel}' is deprecated; using '${normalized}' instead.`);
    }
    return normalized;
  }

  async execute(
    prompt: string,
    config: BackendConfig,
    onProgress?: (output: string) => void
  ): Promise<BackendResult> {
    // Security: Validate model name to prevent argument injection
    if (config.model && config.model.startsWith('-')) {
      throw new Error(`Invalid model name: model cannot start with '-'`);
    }

    let processedPrompt = prompt;
    const model = this.resolveModel(config.model);
    const primaryModel = model;
    let usedModel = model;

    // Apply changeMode instructions if enabled
    if (config.changeMode) {
      processedPrompt = this.applyChangeModeInstructions(prompt);
    }

    const args = this.buildArgs(processedPrompt, { ...config, model });

    try {
      const response = await this.executeCommand(args, onProgress, config.cwd);
      return {
        response,
        backend: this.name,
        model: usedModel,
      };
    } catch (error) {
      // Handle quota exceeded with fallback to Flash model
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes(ERROR_MESSAGES.QUOTA_EXCEEDED) && model !== MODELS.FLASH) {
        Logger.warn(`${ERROR_MESSAGES.QUOTA_EXCEEDED}. Falling back to ${MODELS.FLASH}.`);
        onProgress?.(STATUS_MESSAGES.FLASH_RETRY);

        const fallbackConfig = { ...config, model: MODELS.FLASH };
        const fallbackArgs = this.buildArgs(processedPrompt, fallbackConfig);
        usedModel = MODELS.FLASH;

        try {
          const response = await this.executeCommand(fallbackArgs, onProgress, config.cwd);
          Logger.warn(`Successfully executed with ${MODELS.FLASH} fallback.`);
          onProgress?.(STATUS_MESSAGES.FLASH_SUCCESS);
          return {
            response,
            backend: this.name,
            model: usedModel,
          };
        } catch (fallbackError) {
          const fallbackErrorMessage = fallbackError instanceof Error
            ? fallbackError.message
            : String(fallbackError);
          throw new Error(
            `${primaryModel} quota exceeded, ${MODELS.FLASH} fallback also failed: ${fallbackErrorMessage}`
          );
        }
      }
      throw error;
    }
  }

  async isAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const checker = process.platform === 'win32' ? 'where' : 'which';
      const child = spawn(checker, ['gemini'], { shell: true });
      child.on('close', (code) => resolve(code === 0));
      child.on('error', () => resolve(false));
    });
  }

  getModels(): string[] {
    return [
      MODELS.PRO_3,
      MODELS.FLASH_3,
      MODELS.PRO,
      MODELS.FLASH
    ];
  }

  supportsFileRefs(): boolean {
    return true;
  }

  getFileRefSyntax(): string {
    return '@';
  }

  private buildArgs(prompt: string, config: BackendConfig): string[] {
    const args: string[] = [];

    if (config.model) {
      args.push(CLI.FLAGS.MODEL, config.model);
    }

    if (config.sandbox) {
      args.push(CLI.FLAGS.SANDBOX);
    }

    // Add allowed tools for auto-approval
    if (config.allowedTools && config.allowedTools.length > 0) {
      for (const tool of config.allowedTools) {
        args.push(CLI.FLAGS.ALLOWED_TOOLS, tool);
      }
    }

    // Ensure @ symbols work cross-platform by wrapping in quotes if needed
    const finalPrompt = prompt.includes('@') && !prompt.startsWith('"')
      ? `"${prompt}"`
      : prompt;

    args.push(CLI.FLAGS.PROMPT, finalPrompt);

    return args;
  }

  private applyChangeModeInstructions(prompt: string): string {
    const processedPrompt = prompt.replace(/file:(\S+)/g, '@$1');
    return getChangeModeInstructions(processedPrompt);
  }

  private executeCommand(
    args: string[],
    onProgress?: (output: string) => void,
    cwd?: string
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      Logger.commandExecution(CLI.COMMANDS.GEMINI, args, startTime);

      const childProcess = spawn(CLI.COMMANDS.GEMINI, args, {
        env: getAllowedEnv(),
        shell: process.platform === 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: cwd || process.cwd(),
      });

      let stdout = '';
      let stderr = '';
      let isResolved = false;
      let lastReportedLength = 0;

      childProcess.stdout.on('data', (data) => {
        stdout += data.toString();

        if (onProgress && stdout.length > lastReportedLength) {
          const newContent = stdout.substring(lastReportedLength);
          lastReportedLength = stdout.length;
          onProgress(newContent);
        }
      });

      childProcess.stderr.on('data', (data) => {
        stderr += data.toString();
        if (stderr.includes('RESOURCE_EXHAUSTED')) {
          const modelMatch = stderr.match(/Quota exceeded for quota metric '([^']+)'/);
          const model = modelMatch ? modelMatch[1] : 'Unknown Model';
          Logger.error(`Gemini Quota Error: Quota exceeded for ${model}`);
        }
      });

      childProcess.on('error', (error) => {
        if (!isResolved) {
          isResolved = true;
          Logger.error('Process error:', error);
          reject(new Error(`Failed to spawn gemini command: ${error.message}`));
        }
      });

      childProcess.on('close', (code) => {
        if (!isResolved) {
          isResolved = true;
          if (code === 0) {
            Logger.commandComplete(startTime, code, stdout.length);
            resolve(stdout.trim());
          } else {
            Logger.commandComplete(startTime, code);
            Logger.error(`Failed with exit code ${code}`);
            const errorMessage = stderr.trim() || 'Unknown error';
            reject(new Error(`Gemini command failed with exit code ${code}: ${errorMessage}`));
          }
        }
      });
    });
  }
}
