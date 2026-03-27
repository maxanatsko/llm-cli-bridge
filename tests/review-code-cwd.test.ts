import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getCurrentGitState } from '../src/utils/gitStateDetector.ts';

function createTempGitRepo(): { rootDir: string; repoDir: string } {
  const rootDir = mkdtempSync(join(tmpdir(), 'review-code-cwd-'));
  const repoDir = join(rootDir, 'repo');

  execFileSync('git', ['init', '-b', 'main', repoDir], { stdio: 'pipe' });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: repoDir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repoDir, stdio: 'pipe' });

  writeFileSync(join(repoDir, 'tracked.txt'), 'ok\n');
  execFileSync('git', ['add', 'tracked.txt'], { cwd: repoDir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: repoDir, stdio: 'pipe' });

  return { rootDir, repoDir };
}

describe('getCurrentGitState cwd handling', () => {
  it('uses the provided cwd when process cwd is not a git repo', async () => {
    const { rootDir, repoDir } = createTempGitRepo();
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(rootDir);

    try {
      const state = await getCurrentGitState(repoDir);

      expect(state.branch).toBe('main');
      expect(state.commitHash).toMatch(/^[0-9a-f]{40}$/);
      expect(state.workingTreeClean).toBe(true);
      expect(state.hasUncommittedChanges).toBe(false);
    } finally {
      cwdSpy.mockRestore();
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it('fails when cwd is omitted and process cwd is not a git repo', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'review-code-cwd-miss-'));
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(rootDir);

    try {
      await expect(getCurrentGitState()).rejects.toThrow(
        "Git state detection failed. Ensure you're in a git repository"
      );
    } finally {
      cwdSpy.mockRestore();
      rmSync(rootDir, { recursive: true, force: true });
    }
  });
});

describe('reviewCodeTool cwd propagation', () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.unmock('../src/backends/index.js');
    vi.unmock('../src/utils/gitStateDetector.js');
    vi.unmock('../src/utils/reviewSessionManager.js');
    vi.unmock('../src/utils/reviewPromptBuilder.js');
    vi.unmock('../src/utils/reviewResponseParser.js');
    vi.unmock('../src/utils/reviewFormatter.js');
  });

  async function loadReviewCodeTool() {
    const gitState = {
      branch: 'main',
      commitHash: '1234567890abcdef1234567890abcdef12345678',
      workingTreeClean: true,
      hasUncommittedChanges: false,
      timestamp: 123,
    };

    const getCurrentGitStateMock = vi.fn().mockResolvedValue(gitState);
    const createNewSessionMock = vi.fn((sessionId: string, currentGitState: typeof gitState, files?: string[]) => ({
      sessionId,
      createdAt: 1,
      lastAccessedAt: 1,
      gitState: currentGitState,
      currentGitState,
      rounds: [],
      allComments: [],
      filesTracked: files ?? [],
      focusFiles: files,
      reviewScope: files ? 'focused' : 'full',
      totalRounds: 0,
      sessionState: 'active',
    }));
    const loadReviewSessionMock = vi.fn().mockResolvedValue(null);
    const saveReviewSessionMock = vi.fn().mockResolvedValue(undefined);
    const formatSessionNotFoundMock = vi.fn().mockReturnValue('SESSION_NOT_FOUND');

    vi.doMock('../src/utils/gitStateDetector.js', () => ({
      getCurrentGitState: getCurrentGitStateMock,
      generateSessionId: vi.fn().mockReturnValue('review-main-12345678'),
      detectSessionContinuation: vi.fn().mockReturnValue({ canContinue: true }),
    }));

    vi.doMock('../src/backends/index.js', () => ({
      getBackend: vi.fn().mockResolvedValue({
        name: 'gemini',
        execute: vi.fn().mockResolvedValue({
          response: 'No issues found.',
          backend: 'gemini',
        }),
      }),
    }));

    vi.doMock('../src/utils/reviewSessionManager.js', () => ({
      loadReviewSession: loadReviewSessionMock,
      saveReviewSession: saveReviewSessionMock,
      createNewSession: createNewSessionMock,
    }));

    vi.doMock('../src/utils/reviewPromptBuilder.js', () => ({
      buildReviewPrompt: vi.fn().mockReturnValue('review prompt'),
      extractFilesFromPrompt: vi.fn().mockReturnValue(['src/index.ts']),
    }));

    vi.doMock('../src/utils/reviewResponseParser.js', () => ({
      parseReviewResponse: vi.fn().mockReturnValue([]),
      validateComments: vi.fn((comments: unknown[]) => comments),
    }));

    vi.doMock('../src/utils/reviewFormatter.js', () => ({
      formatReviewResponse: vi.fn().mockReturnValue('FORMATTED_REVIEW'),
      formatSessionNotFound: formatSessionNotFoundMock,
      formatGitStateWarning: vi.fn().mockReturnValue('GIT_WARNING'),
    }));

    const { reviewCodeTool } = await import('../src/tools/review-code.tool.ts');

    return {
      reviewCodeTool,
      getCurrentGitStateMock,
      createNewSessionMock,
      loadReviewSessionMock,
      saveReviewSessionMock,
      formatSessionNotFoundMock,
    };
  }

  it('passes cwd into git-state bootstrap for a new review session', async () => {
    const { reviewCodeTool, getCurrentGitStateMock } = await loadReviewCodeTool();

    const result = await reviewCodeTool.execute({
      prompt: 'Short review',
      backend: 'gemini',
      files: ['src/index.ts'],
      includeHistory: false,
      reviewType: 'general',
      severity: 'all',
      cwd: '/tmp/target-repo',
    });

    expect(result).toBe('FORMATTED_REVIEW');
    expect(getCurrentGitStateMock).toHaveBeenCalledWith('/tmp/target-repo');
  });

  it('passes cwd into git-state bootstrap when forceNewSession is true', async () => {
    const { reviewCodeTool, getCurrentGitStateMock, createNewSessionMock, loadReviewSessionMock } = await loadReviewCodeTool();

    const result = await reviewCodeTool.execute({
      prompt: 'Short review',
      backend: 'gemini',
      files: ['src/index.ts'],
      includeHistory: false,
      forceNewSession: true,
      reviewType: 'general',
      severity: 'all',
      cwd: '/tmp/forced-repo',
    });

    expect(result).toBe('FORMATTED_REVIEW');
    expect(getCurrentGitStateMock).toHaveBeenCalledWith('/tmp/forced-repo');
    expect(createNewSessionMock).toHaveBeenCalledTimes(1);
    expect(loadReviewSessionMock).not.toHaveBeenCalled();
  });

  it('passes cwd into git-state bootstrap for explicit sessionId lookup', async () => {
    const { reviewCodeTool, getCurrentGitStateMock, formatSessionNotFoundMock } = await loadReviewCodeTool();

    const result = await reviewCodeTool.execute({
      prompt: 'Short review',
      backend: 'gemini',
      files: ['src/index.ts'],
      includeHistory: false,
      sessionId: 'manual-session',
      reviewType: 'general',
      severity: 'all',
      cwd: '/tmp/session-repo',
    });

    expect(result).toBe('SESSION_NOT_FOUND');
    expect(getCurrentGitStateMock).toHaveBeenCalledWith('/tmp/session-repo');
    expect(formatSessionNotFoundMock).toHaveBeenCalledTimes(1);
  });
});
