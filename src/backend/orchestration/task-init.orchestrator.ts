import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { SessionProvider } from '@prisma-gen/client';
import { toError } from '@/backend/lib/error-utils';
import { DEFAULT_FOLLOWUP } from '@/backend/prompts/workflows';
import { configService } from '@/backend/services/config.service';
import { gitOpsService } from '@/backend/services/git-ops.service';
import { createLogger } from '@/backend/services/logger.service';
import {
  chatMessageHandlerService,
  sessionDataService,
  sessionService,
} from '@/backend/services/session';
import { taskAccessor, taskRepoAccessor, taskWorkspaceAccessor } from '@/backend/services/task';
import { projectAccessor, workspaceAccessor } from '@/backend/services/workspace';

const logger = createLogger('task-init-orchestrator');

/** The slug used for the system project that owns sentinel task workspaces. */
const TASKS_SYSTEM_PROJECT_SLUG = '__tasks__';

/**
 * Get or create the sentinel `__tasks__` system project.
 * This project owns all task sentinel workspaces. It is not a real repository.
 */
async function getOrCreateTasksSystemProject(): Promise<{ id: string }> {
  const existing = await projectAccessor.findBySlug(TASKS_SYSTEM_PROJECT_SLUG);
  if (existing) {
    return { id: existing.id };
  }

  const baseDir = configService.getBaseDir();
  const created = await projectAccessor.createSystem({
    name: 'Tasks',
    slug: TASKS_SYSTEM_PROJECT_SLUG,
    repoPath: baseDir,
    worktreeBasePath: path.join(baseDir, 'tasks'),
    defaultBranch: 'main',
  });
  return { id: created.id };
}

async function handleTaskInitFailure(taskId: string, error: Error): Promise<void> {
  logger.error('Failed to initialize task worktrees', error, { taskId });
  await taskAccessor.update(taskId, {
    status: 'FAILED',
    errorMessage: error.message,
  });
  // Stop any sessions that may have been started
  const taskWorkspace = await taskWorkspaceAccessor.findByTaskId(taskId);
  if (taskWorkspace) {
    try {
      await sessionService.stopWorkspaceSessions(taskWorkspace.workspaceId);
    } catch (stopError) {
      logger.warn('Failed to stop task workspace sessions after init failure', {
        taskId,
        workspaceId: taskWorkspace.workspaceId,
        error: stopError instanceof Error ? stopError.message : String(stopError),
      });
    }
  }
}

function buildTaskSystemPrompt(taskPrompt: string, repoSlugs: string[]): string {
  const repoList = repoSlugs.map((s) => `- \`repos/${s}\``).join('\n');
  return `Top-level task: ${taskPrompt}

You are working in a task root that contains multiple repositories under \`repos/\`.
The available repositories are:
${repoList}

When making changes, prefer repository-relative commands and be explicit about which repo you are editing.`;
}

/**
 * Initialize a task: creates per-repo git worktrees, a sentinel workspace,
 * and starts a shared agent session with workingDir set to the task root.
 *
 * Called fire-and-forget from the task.confirm tRPC mutation.
 */
export async function initializeTaskWorktrees(taskId: string): Promise<void> {
  const task = await taskAccessor.findWithRepos(taskId);
  if (!task) {
    logger.error('Task not found for initialization', new Error('Task not found'), { taskId });
    return;
  }

  try {
    const baseDir = configService.getBaseDir();
    const taskRoot = path.join(baseDir, 'tasks', taskId);
    const reposDir = path.join(taskRoot, 'repos');

    // Create the aggregate task root directory
    await fs.mkdir(reposDir, { recursive: true });
    logger.info('Created task root directory', { taskId, taskRoot });

    // Get or create the __tasks__ system project for sentinel workspace
    const systemProject = await getOrCreateTasksSystemProject();

    // Create the sentinel Workspace record
    const sentinelWorkspace = await workspaceAccessor.create({
      projectId: systemProject.id,
      name: task.name,
      description: `Task: ${task.prompt.slice(0, 100)}`,
    });
    logger.info('Created sentinel workspace for task', {
      taskId,
      workspaceId: sentinelWorkspace.id,
    });

    // Create TaskWorkspace linking the task to its sentinel workspace
    await taskWorkspaceAccessor.create({
      taskId,
      workspaceId: sentinelWorkspace.id,
      taskRoot,
    });

    // Materialize each repo as a git worktree in parallel
    const repoResults = await Promise.allSettled(
      task.repos.map(async (taskRepo) => {
        const project = taskRepo.project;
        const worktreeName = `task-${taskId}-${project.slug}`;
        let worktreeInfo: { worktreePath: string; branchName: string };

        try {
          await gitOpsService.ensureBaseBranchExists(
            project,
            project.defaultBranch,
            project.defaultBranch
          );
          worktreeInfo = await gitOpsService.createWorktree(
            project,
            worktreeName,
            project.defaultBranch,
            { workspaceName: `task-${task.name}-${project.slug}` }
          );
        } catch (error) {
          logger.error('Failed to create worktree for task repo', toError(error), {
            taskId,
            projectSlug: project.slug,
          });
          await taskRepoAccessor.update(taskRepo.id, { status: 'FAILED' });
          throw error;
        }

        // Symlink: <taskRoot>/repos/<slug> → worktreePath
        const symlinkPath = path.join(reposDir, project.slug);
        try {
          await fs.symlink(worktreeInfo.worktreePath, symlinkPath);
        } catch (symlinkError) {
          // If symlink fails (e.g., already exists), fall back to storing path directly
          logger.warn('Could not create symlink for task repo, skipping', {
            taskId,
            projectSlug: project.slug,
            error: symlinkError instanceof Error ? symlinkError.message : String(symlinkError),
          });
        }

        await taskRepoAccessor.update(taskRepo.id, {
          worktreePath: worktreeInfo.worktreePath,
          branchName: worktreeInfo.branchName,
          status: 'READY',
        });

        logger.info('Task repo worktree ready', {
          taskId,
          projectSlug: project.slug,
          worktreePath: worktreeInfo.worktreePath,
          branchName: worktreeInfo.branchName,
        });

        return project.slug;
      })
    );

    const succeededSlugs: string[] = [];
    const failedSlugs: string[] = [];
    for (const [i, result] of repoResults.entries()) {
      const slug = task.repos[i]?.project.slug ?? 'unknown';
      if (result.status === 'fulfilled') {
        succeededSlugs.push(result.value);
      } else {
        failedSlugs.push(slug);
      }
    }

    if (failedSlugs.length > 0) {
      throw new Error(`Failed to provision worktrees for repos: ${failedSlugs.join(', ')}`);
    }

    // Create and start the shared agent session
    const session = await sessionDataService.createAgentSession({
      workspaceId: sentinelWorkspace.id,
      name: 'Task Session',
      workflow: DEFAULT_FOLLOWUP,
      provider: SessionProvider.CLAUDE,
      providerProjectPath: null,
    });

    const initialPrompt = buildTaskSystemPrompt(task.prompt, succeededSlugs);

    try {
      await sessionService.startSession(session.id, {
        initialPrompt,
        startupModePreset: 'non_interactive',
      });
      await chatMessageHandlerService.tryDispatchNextMessage(session.id);
    } catch (sessionError) {
      logger.warn('Failed to start task agent session', {
        taskId,
        sessionId: session.id,
        error: sessionError instanceof Error ? sessionError.message : String(sessionError),
      });
    }

    // Mark task as READY
    await taskAccessor.transitionStatus(taskId, 'PROVISIONING', 'READY');
    logger.info('Task initialization complete', { taskId, taskRoot });
  } catch (error) {
    await handleTaskInitFailure(taskId, toError(error));
  }
}
