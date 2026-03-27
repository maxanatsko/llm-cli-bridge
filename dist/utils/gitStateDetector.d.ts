export interface GitState {
    branch: string;
    commitHash: string;
    workingTreeClean: boolean;
    hasUncommittedChanges: boolean;
    timestamp: number;
}
/**
 * Gets the current git state of the repository
 * Executes git commands in parallel for better performance
 * @param cwd Optional working directory to run git commands in
 * @returns GitState object with branch, commit, and status info
 */
export declare function getCurrentGitState(cwd?: string): Promise<GitState>;
/**
 * Generates a session ID from git state
 * Format: review-{branch}-{shortHash}
 * @param gitState The git state to generate ID from
 * @returns Session ID string
 */
export declare function generateSessionId(gitState: GitState): string;
/**
 * Checks if a session can continue based on git state comparison
 * @param currentGitState Current git state
 * @param sessionGitState Git state from existing session
 * @returns Object indicating if continuation is allowed and reason if not
 */
export declare function detectSessionContinuation(currentGitState: GitState, sessionGitState: GitState): {
    canContinue: boolean;
    reason?: string;
};
//# sourceMappingURL=gitStateDetector.d.ts.map