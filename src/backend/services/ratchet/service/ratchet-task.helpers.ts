import { toError } from '@/backend/lib/error-utils';
import type { createLogger } from '@/backend/services/logger.service';
import type { ActiveTaskRepo } from '@/backend/services/task';
import type { RatchetGitHubBridge, RatchetPRStateSnapshot } from './bridges';
import { fixerSessionService } from './fixer-session.service';

type Logger = ReturnType<typeof createLogger>;

const TASK_RATCHET_WORKFLOW = 'ratchet';

/** Build a ratchet repair prompt that spans multiple task repos. */
export function buildTaskRatchetPrompt(
  taskRoot: string,
  failingRepos: Array<{ slug: string; prUrl: string; reason: string }>
): string {
  const lines = failingRepos.map(
    (r) => `- \`repos/${r.slug}\` — PR: ${r.prUrl}\n  Issue: ${r.reason}`
  );
  return `Ratchet update for task at \`${taskRoot}\`.

The following repository PRs require attention:

${lines.join('\n\n')}

Please investigate and fix each issue in the corresponding \`repos/<slug>\` subdirectory.
Before finishing, check whether the same root cause affects other repositories in this task root.`;
}

interface TaskRepoFailure {
  slug: string;
  prUrl: string;
  reason: string;
}

function classifyPRFailureReason(snapshot: RatchetPRStateSnapshot): string | null {
  if (snapshot.prState === 'MERGED' || snapshot.prState === 'CLOSED') {
    return null;
  }
  if (snapshot.prCiStatus === 'FAILURE') {
    return 'CI checks failing';
  }
  if (snapshot.prReviewState === 'CHANGES_REQUESTED') {
    return 'review comments require changes';
  }
  return null;
}

async function collectTaskRepoFailures(
  taskRepos: ActiveTaskRepo[],
  githubBridge: RatchetGitHubBridge,
  logger: Logger
): Promise<
  Map<string, { taskRoot: string; sentinelWorkspaceId: string; failures: TaskRepoFailure[] }>
> {
  const byTaskWorkspace = new Map<
    string,
    { taskRoot: string; sentinelWorkspaceId: string; failures: TaskRepoFailure[] }
  >();

  for (const taskRepo of taskRepos) {
    const taskWorkspace = taskRepo.task.workspace;
    if (!(taskWorkspace && taskRepo.prUrl)) {
      continue;
    }

    const entry = byTaskWorkspace.get(taskWorkspace.id) ?? {
      taskRoot: taskWorkspace.taskRoot,
      sentinelWorkspaceId: taskWorkspace.workspaceId,
      failures: [],
    };

    let prSnapshot: RatchetPRStateSnapshot | null = null;
    try {
      prSnapshot = await githubBridge.fetchAndComputePRState(taskRepo.prUrl);
    } catch (err) {
      logger.warn('Failed to fetch PR state for task repo', {
        taskRepoId: taskRepo.id,
        projectSlug: taskRepo.project.slug,
        error: toError(err).message,
      });
      continue;
    }

    const reason = prSnapshot ? classifyPRFailureReason(prSnapshot) : null;
    if (reason) {
      entry.failures.push({ slug: taskRepo.project.slug, prUrl: taskRepo.prUrl, reason });
    }

    byTaskWorkspace.set(taskWorkspace.id, entry);
  }

  return byTaskWorkspace;
}

export async function checkAndDispatchTaskRatchet(params: {
  taskRepos: ActiveTaskRepo[];
  githubBridge: RatchetGitHubBridge;
  logger: Logger;
}): Promise<void> {
  const { taskRepos, githubBridge, logger } = params;

  const byTaskWorkspace = await collectTaskRepoFailures(taskRepos, githubBridge, logger);

  for (const [taskWorkspaceDbId, { taskRoot, sentinelWorkspaceId, failures }] of byTaskWorkspace) {
    if (failures.length === 0) {
      continue;
    }

    logger.info('Dispatching ratchet repair for task', {
      taskWorkspaceDbId,
      failingRepos: failures.map((f) => f.slug),
    });

    try {
      await fixerSessionService.acquireAndDispatch({
        workspaceId: sentinelWorkspaceId,
        workflow: TASK_RATCHET_WORKFLOW,
        sessionName: 'Ratchet',
        runningIdleAction: 'send_message',
        dispatchMode: 'start_empty_and_send',
        buildPrompt: () => buildTaskRatchetPrompt(taskRoot, failures),
      });
    } catch (err) {
      logger.error('Failed to dispatch ratchet repair for task', toError(err), {
        taskWorkspaceDbId,
      });
    }
  }
}
