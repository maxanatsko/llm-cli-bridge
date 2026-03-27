import { executeCommand } from './commandExecutor.js';
import { Logger } from './logger.js';

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
export async function getCurrentGitState(cwd?: string): Promise<GitState> {
  try {
    // Execute git commands in parallel for better performance
    const [branch, commitHash, statusOutput] = await Promise.all([
      executeCommand('git', ['rev-parse', '--abbrev-ref', 'HEAD'], undefined, cwd),
      executeCommand('git', ['rev-parse', 'HEAD'], undefined, cwd),
      executeCommand('git', ['status', '--porcelain'], undefined, cwd)
    ]);

    const workingTreeClean = statusOutput.trim() === '';

    return {
      branch: branch.trim(),
      commitHash: commitHash.trim(),
      workingTreeClean,
      hasUncommittedChanges: !workingTreeClean,
      timestamp: Date.now()
    };
  } catch (error) {
    Logger.error(`Failed to get git state: ${error}`);
    throw new Error(`Git state detection failed. Ensure you're in a git repository: ${error}`);
  }
}

/**
 * Generates a session ID from git state
 * Format: review-{branch}-{shortHash}
 * @param gitState The git state to generate ID from
 * @returns Session ID string
 */
export function generateSessionId(gitState: GitState): string {
  const shortHash = gitState.commitHash.slice(0, 8);
  // Sanitize branch name for filesystem safety
  const safeBranch = gitState.branch.replace(/[^a-zA-Z0-9-_]/g, '-');
  return `review-${safeBranch}-${shortHash}`;
}

/**
 * Checks if a session can continue based on git state comparison
 * @param currentGitState Current git state
 * @param sessionGitState Git state from existing session
 * @returns Object indicating if continuation is allowed and reason if not
 */
export function detectSessionContinuation(
  currentGitState: GitState,
  sessionGitState: GitState
): { canContinue: boolean; reason?: string } {
  // Same branch and commit = auto-continue
  if (
    currentGitState.branch === sessionGitState.branch &&
    currentGitState.commitHash === sessionGitState.commitHash
  ) {
    return { canContinue: true };
  }

  // Different commit on same branch = warn but allow
  if (currentGitState.branch === sessionGitState.branch) {
    return {
      canContinue: false,
      reason: `Git state changed: commit ${sessionGitState.commitHash.slice(0, 8)} → ${currentGitState.commitHash.slice(0, 8)}`
    };
  }

  // Different branch = don't auto-continue
  return {
    canContinue: false,
    reason: `Branch changed: ${sessionGitState.branch} → ${currentGitState.branch}`
  };
}
