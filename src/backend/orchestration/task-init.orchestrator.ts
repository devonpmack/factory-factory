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
import {
  taskAccessor,
  taskProjectAccessor,
  taskRepoAccessor,
  taskWorkspaceAccessor,
} from '@/backend/services/task';
import { projectAccessor, workspaceAccessor } from '@/backend/services/workspace';
import { TaskRepoStatus, TaskStatus } from '@/shared/core';

const logger = createLogger('task-init-orchestrator');

const TASKS_SYSTEM_PROJECT_SLUG = '__tasks__';

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

function buildTaskSystemPrompt(taskPrompt: string, repoSlugs: string[]): string {
  const repoList = repoSlugs.map((s) => `- \`repos/${s}\``).join('\n');
  return `Top-level task: ${taskPrompt}

You are working in a task root that contains multiple repositories under \`repos/\`.
The available repositories are:
${repoList}

When making changes, prefer repository-relative commands and be explicit about which repo you are editing.`;
}

interface MaterializeResult {
  slug: string;
  worktreePath: string;
  branchName: string;
}

async function materializeSingleRepo(
  taskId: string,
  taskTitle: string | null,
  taskRepoId: string,
  project: { slug: string; repoPath: string; worktreeBasePath: string; defaultBranch: string },
  reposDir: string
): Promise<MaterializeResult> {
  const worktreeName = `task-${taskId}-${project.slug}`;
  await gitOpsService.ensureBaseBranchExists(project, project.defaultBranch, project.defaultBranch);
  const worktreeInfo = await gitOpsService.createWorktree(
    project,
    worktreeName,
    project.defaultBranch,
    { workspaceName: `task-${taskTitle ?? taskId}-${project.slug}` }
  );

  const symlinkPath = path.join(reposDir, project.slug);
  try {
    await fs.symlink(worktreeInfo.worktreePath, symlinkPath);
  } catch (symlinkError) {
    logger.warn('Could not create symlink for task repo, using worktree path directly', {
      taskId,
      projectSlug: project.slug,
      error: toError(symlinkError).message,
    });
  }

  await taskRepoAccessor.update(taskRepoId, {
    mountPath: worktreeInfo.worktreePath,
    branchName: worktreeInfo.branchName,
    status: TaskRepoStatus.READY,
  });

  return {
    slug: project.slug,
    worktreePath: worktreeInfo.worktreePath,
    branchName: worktreeInfo.branchName,
  };
}

async function startTaskSession(
  workspaceId: string,
  taskPrompt: string,
  succeededSlugs: string[],
  taskId: string
): Promise<string> {
  const session = await sessionDataService.createAgentSession({
    workspaceId,
    name: 'Task Session',
    workflow: DEFAULT_FOLLOWUP,
    provider: SessionProvider.CLAUDE,
    providerProjectPath: null,
  });

  const initialPrompt = buildTaskSystemPrompt(taskPrompt, succeededSlugs);

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
      error: toError(sessionError).message,
    });
  }

  return session.id;
}

async function materializeAllRepos(
  taskId: string,
  taskTitle: string | null,
  reposDir: string
): Promise<string[]> {
  const taskProjects = await taskProjectAccessor.findByTaskId(taskId);
  const taskRepos = await taskRepoAccessor.findByTaskId(taskId);
  const succeededSlugs: string[] = [];

  for (const taskRepo of taskRepos) {
    const project = taskProjects.find((tp) => tp.projectId === taskRepo.projectId)?.project;
    if (!project) {
      await taskRepoAccessor.update(taskRepo.id, {
        status: TaskRepoStatus.FAILED,
        errorMessage: 'Project not found',
      });
      continue;
    }

    await taskRepoAccessor.update(taskRepo.id, { status: TaskRepoStatus.MATERIALIZING });
    try {
      const result = await materializeSingleRepo(taskId, taskTitle, taskRepo.id, project, reposDir);
      succeededSlugs.push(result.slug);
      logger.info('Task repo worktree ready', { taskId, ...result });
    } catch (error) {
      logger.error('Failed to materialize task repo', toError(error), {
        taskId,
        projectSlug: project.slug,
      });
      await taskRepoAccessor.update(taskRepo.id, {
        status: TaskRepoStatus.FAILED,
        errorMessage: toError(error).message,
      });
    }
  }

  return succeededSlugs;
}

async function handleTaskInitFailure(taskId: string): Promise<void> {
  await taskAccessor.update(taskId, { status: TaskStatus.FAILED });
  const tw = await taskWorkspaceAccessor.findByTaskId(taskId);
  if (!tw) {
    return;
  }
  try {
    await sessionService.stopWorkspaceSessions(tw.workspaceId);
  } catch (stopError) {
    logger.warn('Failed to stop sessions after init failure', {
      taskId,
      error: toError(stopError).message,
    });
  }
}

/**
 * Initialize a task: creates per-repo git worktrees with symlinks under the task root,
 * a sentinel workspace, and starts a shared agent session.
 */
export async function initializeTaskWorktrees(taskId: string): Promise<void> {
  const task = await taskAccessor.findById(taskId);
  if (!task) {
    logger.error('Task not found for initialization', new Error('Task not found'), { taskId });
    return;
  }

  if (task.status !== TaskStatus.CONFIRMED && task.status !== TaskStatus.MATERIALIZING) {
    return;
  }

  await taskAccessor.update(taskId, { status: TaskStatus.MATERIALIZING });

  try {
    const baseDir = configService.getBaseDir();
    const taskRoot = path.join(baseDir, 'tasks', taskId);
    const reposDir = path.join(taskRoot, 'repos');
    await fs.mkdir(reposDir, { recursive: true });
    await taskAccessor.update(taskId, { rootPath: taskRoot });

    const systemProject = await getOrCreateTasksSystemProject();
    const sentinelWorkspace = await workspaceAccessor.create({
      projectId: systemProject.id,
      name: task.title ?? `Task ${taskId.slice(0, 8)}`,
      description: `Task: ${task.prompt.slice(0, 100)}`,
    });
    await taskWorkspaceAccessor.create({ taskId, workspaceId: sentinelWorkspace.id, taskRoot });

    const succeededSlugs = await materializeAllRepos(taskId, task.title, reposDir);
    if (succeededSlugs.length === 0) {
      throw new Error('No repos materialized successfully');
    }

    const sessionId = await startTaskSession(
      sentinelWorkspace.id,
      task.prompt,
      succeededSlugs,
      taskId
    );
    await taskAccessor.update(taskId, { status: TaskStatus.READY, primarySessionId: sessionId });
    logger.info('Task initialization complete', { taskId, taskRoot });
  } catch (error) {
    logger.error('Task initialization failed', toError(error), { taskId });
    await handleTaskInitFailure(taskId);
  }
}
