/**
 * Gemini Backend - Executes prompts via Google's Gemini CLI
 */
import { BackendExecutor, BackendConfig, BackendType, BackendResult } from './types.js';
export declare class GeminiBackend implements BackendExecutor {
    name: BackendType;
    private resolveModel;
    execute(prompt: string, config: BackendConfig, onProgress?: (output: string) => void): Promise<BackendResult>;
    isAvailable(): Promise<boolean>;
    getModels(): string[];
    supportsFileRefs(): boolean;
    getFileRefSyntax(): string;
    private buildArgs;
    private applyChangeModeInstructions;
    private executeCommand;
}
//# sourceMappingURL=gemini.d.ts.map