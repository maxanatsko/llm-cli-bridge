import { z } from 'zod';
import { UnifiedTool } from './registry.js';
import { getBackend, BackendType } from '../backends/index.js';
import {
  getCurrentGitState,
  generateSessionId,
  detectSessionContinuation
} from '../utils/gitStateDetector.js';
import {
  loadReviewSession,
  saveReviewSession,
  createNewSession
} from '../utils/reviewSessionManager.js';
import type {
  ReviewCodeSessionData as CodeReviewSession,
  ReviewComment,
  ReviewRound,
} from '../utils/sessionSchemas.js';
import { buildReviewPrompt, extractFilesFromPrompt } from '../utils/reviewPromptBuilder.js';
import { parseReviewResponse, validateComments } from '../utils/reviewResponseParser.js';
import {
  formatReviewResponse,
  formatSessionNotFound,
  formatGitStateWarning
} from '../utils/reviewFormatter.js';
import { Logger } from '../utils/logger.js';
import { MODELS } from '../constants.js';

const reviewCodeArgsSchema = z.object({
  prompt: z
    .string()
    .min(1)
    .describe('Review request or follow-up question'),
  backend: z
    .enum(['gemini', 'codex'])
    .optional()
    .describe("AI backend to use: 'gemini' (default) or 'codex'. Gemini offers 1M+ token context, Codex integrates with OpenAI models."),
  files: z
    .array(z.string())
    .optional()
    .describe('Specific files to review (uses @ syntax internally)'),
  sessionId: z
    .string()
    .optional()
    .describe('Explicit session ID to continue (auto-detected from git if omitted)'),
  forceNewSession: z
    .boolean()
    .default(false)
    .describe('Force create new session ignoring git state'),
  reviewType: z
    .enum(['security', 'performance', 'quality', 'architecture', 'general'])
    .default('general')
    .describe('Type of review to perform'),
  severity: z
    .enum(['all', 'critical-only', 'important-and-above'])
    .default('all')
    .describe('Filter issues by severity level'),
  commentDecisions: z
    .array(
      z.object({
        commentId: z.string(),
        // Accept both legacy verbs and persisted status values for compatibility.
        decision: z.enum([
          'accept',
          'reject',
          'modify',
          'defer',
          'accepted',
          'rejected',
          'modified',
          'deferred'
        ]),
        notes: z.string().optional()
      })
    )
    .optional()
    .describe('Responses to previous round\'s comments'),
  model: z
    .string()
    .optional()
    .describe("Model override. Gemini: 'gemini-3.1-pro' (default), 'gemini-3-flash', 'gemini-2.5-pro', 'gemini-2.5-flash'. Codex: 'gpt-5.4' (default), 'gpt-5.4-mini', 'gpt-5.3-codex', 'gpt-5.2-codex', 'gpt-5.2'"),
  reasoningEffort: z
    .enum(['low', 'medium', 'high', 'xhigh'])
    .optional()
    .describe("Reasoning effort level (Codex only): 'low', 'medium' (default), 'high', 'xhigh'. Use 'high'/'xhigh' for complex tasks."),
  includeHistory: z
    .boolean()
    .default(true)
    .describe('Include conversation history in prompt'),
  allowedTools: z
    .array(z.string())
    .optional()
    .describe('Tools that AI can auto-approve without confirmation (e.g., [\'run_shell_command\']). Use sparingly for security.'),
  cwd: z
    .string()
    .optional()
    .describe('Working directory for CLI execution. Use this to match your IDE workspace directory if you get \'Directory mismatch\' errors.')
});

export const reviewCodeTool: UnifiedTool = {
  name: 'review-code',
  description:
    'Interactive code review with session continuity. Auto-detects git state for session management. Maintains conversation history and tracks review decisions across iterations.',
  zodSchema: reviewCodeArgsSchema,
  annotations: {
    readOnlyHint: true,      // Only reads files and git state
    destructiveHint: false,  // Doesn't modify or delete data
    idempotentHint: false,   // Same input yields different AI responses
    openWorldHint: true,     // Interacts with external AI APIs
  },
  category: 'ai',

  execute: async (args, onProgress) => {
    const {
      prompt,
      backend: backendChoice,
      files,
      sessionId,
      forceNewSession,
      reviewType,
      severity,
      commentDecisions,
      model,
      reasoningEffort,
      includeHistory,
      allowedTools,
      cwd
    } = args;

    try {
      // Step 1: Determine session
      onProgress?.('🔍 Detecting git state and session...');
      const currentGitState = await getCurrentGitState(cwd as string | undefined);
      const detectedSessionId = generateSessionId(currentGitState);

      // Sanitize user-provided session ID to prevent path traversal
      const sanitizeSessionId = (id: string): string => {
        // Only allow alphanumeric, hyphens, underscores; limit to 100 chars
        return id.replace(/[^a-zA-Z0-9-_]/g, '-').slice(0, 100);
      };

      // If user provides a session ID, incorporate git state to prevent cross-task context bleeding
      // e.g., "iterative-review" becomes "iterative-review-main-abc12345"
      const sanitizedSessionId = sessionId ? sanitizeSessionId(sessionId as string) : null;
      const targetSessionId = sanitizedSessionId
        ? `${sanitizedSessionId}-${currentGitState.branch.replace(/[^a-zA-Z0-9-_]/g, '-')}-${currentGitState.commitHash.slice(0, 8)}`
        : detectedSessionId;

      Logger.debug(`Current git state: ${currentGitState.branch} @ ${currentGitState.commitHash.slice(0, 8)}`);
      Logger.debug(`Target session ID: ${targetSessionId}`);

      // Step 2: Load or create session
      let session: CodeReviewSession;
      let isNewSession = false;

      if (forceNewSession) {
        Logger.debug('Force new session requested');
        session = createNewSession(targetSessionId, currentGitState, files);
        isNewSession = true;
      } else {
        const existing = await loadReviewSession(targetSessionId);

        if (existing) {
          // Validate git state hasn't diverged
          const continuationCheck = detectSessionContinuation(
            currentGitState,
            existing.gitState
          );

          if (!continuationCheck.canContinue) {
            onProgress?.(formatGitStateWarning(continuationCheck.reason!, true));
          }

          session = existing;
          session.currentGitState = currentGitState;
          Logger.debug(`Loaded existing session with ${session.totalRounds} rounds`);
        } else {
          if (sanitizedSessionId) {
            // User explicitly requested a session that doesn't exist
            return formatSessionNotFound(
              targetSessionId,
              currentGitState.branch,
              currentGitState.commitHash
            );
          }
          // Create new session
          session = createNewSession(targetSessionId, currentGitState, files);
          isNewSession = true;
          Logger.debug('Created new session');
        }
      }

      // Step 3: Process comment decisions from previous round
      if (commentDecisions && commentDecisions.length > 0) {
        applyCommentDecisions(session, commentDecisions);
        onProgress?.(`✅ Applied ${commentDecisions.length} comment decision(s)`);
      }

      // Step 4: Update files tracked - use Set for efficient uniqueness handling
      if (files && files.length > 0) {
        session.filesTracked = [...new Set([...session.filesTracked, ...files])];
      }

      // Step 5: Build review prompt with context
      const reviewPrompt = buildReviewPrompt({
        userPrompt: prompt as string,
        session,
        files: files as string[] | undefined,
        reviewType: reviewType as string,
        severity: severity as string,
        includeHistory: !!includeHistory,
        currentGitState
      });

      Logger.debug(`Built review prompt (${reviewPrompt.length} chars)`);

      // Step 6: Execute review via selected backend (defaults to session's last backend, then Gemini)
      const backendType: BackendType = backendChoice || session.lastBackend || 'gemini';
      const backend = await getBackend(backendType);

      onProgress?.(`🤖 Using ${backend.name} backend...`);
      onProgress?.(
        `🔍 Round ${session.totalRounds + 1}: Reviewing ${files?.length || 'tracked'} file(s)...`
      );

      const selectedModel =
        backendType === 'gemini'
          ? (model as string | undefined) || MODELS.FLASH
          : (model as string | undefined);

      // Pass existing codexThreadId for native session resume when using Codex
      const backendResult = await backend.execute(
        reviewPrompt,
        {
          provider: backendType,
          model: selectedModel,
          sandbox: false,
          changeMode: false,
          allowedTools: allowedTools as string[] | undefined,
          cwd: cwd as string | undefined,
          codexThreadId: session.codexThreadId, // For Codex native session resume
          reasoningEffort: reasoningEffort as 'low' | 'medium' | 'high' | 'xhigh' | undefined,
        },
        onProgress
      );

      // Always track which backend was used
      session.lastBackend = backendType;

      // Store Codex thread ID for native session resume
      if (backendResult.codexThreadId && backendResult.codexThreadId.length > 0) {
        session.codexThreadId = backendResult.codexThreadId;
        const threadPreview = backendResult.codexThreadId.slice(0, 8);
        onProgress?.(`🔗 Codex thread: ${threadPreview}...`);
      }

      // Step 7: Parse response into structured comments
      onProgress?.('📝 Parsing review feedback...');
      let newComments = parseReviewResponse(backendResult.response, session.totalRounds + 1);
      newComments = validateComments(newComments);

      // Apply severity filter if requested
      if (severity === 'critical-only') {
        newComments = newComments.filter(c => c.severity === 'critical');
      } else if (severity === 'important-and-above') {
        newComments = newComments.filter(
          c => c.severity === 'critical' || c.severity === 'important'
        );
      }

      Logger.debug(`Parsed ${newComments.length} comments (after filtering)`);

      // Step 8: Create new review round
      const filesReviewed = files || extractFilesFromPrompt(reviewPrompt);
      const newRound: ReviewRound = {
        roundNumber: session.totalRounds + 1,
        timestamp: Date.now(),
        filesReviewed: filesReviewed as string[],
        userPrompt: prompt as string,
        response: backendResult.response,
        commentsGenerated: newComments,
        gitState: currentGitState
      };

      session.rounds.push(newRound);
      session.allComments.push(...newComments);
      session.totalRounds++;
      session.lastAccessedAt = Date.now();

      // Step 9: Save session
      await saveReviewSession(session);
      onProgress?.('💾 Session saved');

      // Step 10: Format and return response
      const formattedResponse = formatReviewResponse({
        session,
        currentRound: newRound,
        newComments,
        showHistory: !!includeHistory
      });

      return formattedResponse;
    } catch (error) {
      Logger.error(`Review code execution error: ${error}`);
      throw new Error(`Code review failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
};

/**
 * Applies comment decisions from the user to the session
 * Uses Map for O(1) comment lookups instead of O(N) linear search
 * @param session The current session
 * @param decisions Array of comment decisions
 */
function applyCommentDecisions(
  session: CodeReviewSession,
  decisions: Array<{ commentId: string; decision: string; notes?: string }>
): void {
  // Create a Map for O(1) lookups instead of O(N) linear search
  const commentMap = new Map(session.allComments.map(c => [c.id, c]));

  const normalizeDecision = (decision: string): ReviewComment['status'] | null => {
    switch (decision) {
      case 'accept':
        return 'accepted';
      case 'reject':
        return 'rejected';
      case 'modify':
        return 'modified';
      case 'defer':
        return 'deferred';
      case 'accepted':
      case 'rejected':
      case 'modified':
      case 'deferred':
        return decision;
      default:
        return null;
    }
  };

  for (const decision of decisions) {
    const comment = commentMap.get(decision.commentId);

    if (comment) {
      const normalized = normalizeDecision(decision.decision);
      if (!normalized) {
        Logger.debug(`Ignoring unknown decision '${decision.decision}' for comment ${decision.commentId}`);
        continue;
      }

      comment.status = normalized;
      if (decision.notes) {
        comment.resolution = decision.notes;
      }
      Logger.debug(`Applied decision '${decision.decision}' to comment ${decision.commentId}`);
    } else {
      Logger.debug(`Comment ${decision.commentId} not found in session`);
    }
  }
}
