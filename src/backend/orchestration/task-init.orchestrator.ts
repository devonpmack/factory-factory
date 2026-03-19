import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { GitClientFactory } from '@/backend/clients/git.client';
import { toError } from '@/backend/lib/error-utils';
import { configService } from '@/backend/services/config.service';
import { createLogger } from '@/backend/services/logger.service';
import { taskAccessor, taskProjectAccessor, taskRepoAccessor } from '@/backend/services/task';
import { TaskRepoStatus, TaskStatus } from '@/shared/core';

const logger = createLogger('task-init-orchestrator');

/**
 * Materialize all confirmed repos for a task into an aggregate task root.
 *
 * Layout:
 *   <tasksDir>/task-<id>/
 *     repos/<project-slug>/  (worktree per repo)
 */
export async function materializeTaskRepos(taskId: string): Promise<{ rootPath: string }> {
  const task = await taskAccessor.findById(taskId);
  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }

  if (task.status !== TaskStatus.CONFIRMED) {
    throw new Error(`Task must be CONFIRMED before materialization, got: ${task.status}`);
  }

  await taskAccessor.update(taskId, { status: TaskStatus.MATERIALIZING });

  const tasksDir = configService.getTasksDir();
  const rootPath = join(tasksDir, `task-${taskId}`);
  const reposDir = join(rootPath, 'repos');

  try {
    await mkdir(reposDir, { recursive: true });
    await taskAccessor.update(taskId, { rootPath });

    const taskProjects = await taskProjectAccessor.findByTaskId(taskId);
    const taskRepos = await taskRepoAccessor.findByTaskId(taskId);

    for (const taskRepo of taskRepos) {
      const project = taskProjects.find((tp) => tp.projectId === taskRepo.projectId)?.project;
      if (!project) {
        logger.warn('No project found for task repo', {
          taskId,
          projectId: taskRepo.projectId,
        });
        await taskRepoAccessor.update(taskRepo.id, {
          status: TaskRepoStatus.FAILED,
          errorMessage: 'Project not found',
        });
        continue;
      }

      await taskRepoAccessor.update(taskRepo.id, { status: TaskRepoStatus.MATERIALIZING });

      try {
        const worktreeName = project.slug;

        const gitClient = GitClientFactory.forProject({
          repoPath: project.repoPath,
          worktreeBasePath: reposDir,
        });

        const worktreeInfo = await gitClient.createWorktree(worktreeName, project.defaultBranch, {
          workspaceName: `task-${taskId}-${project.slug}`,
        });

        const mountPath = join(reposDir, worktreeName);

        await taskRepoAccessor.update(taskRepo.id, {
          mountPath,
          branchName: worktreeInfo.branchName,
          status: TaskRepoStatus.READY,
        });

        logger.info('Materialized task repo', {
          taskId,
          projectSlug: project.slug,
          mountPath,
          branchName: worktreeInfo.branchName,
        });
      } catch (error) {
        logger.error('Failed to materialize task repo', toError(error), {
          taskId,
          projectSlug: project.slug,
        });
        await taskRepoAccessor.update(taskRepo.id, {
          status: TaskRepoStatus.FAILED,
          errorMessage: error instanceof Error ? error.message : 'Materialization failed',
        });
      }
    }

    // Check if all repos are ready
    const updatedRepos = await taskRepoAccessor.findByTaskId(taskId);
    const allReady = updatedRepos.every((r) => r.status === TaskRepoStatus.READY);
    const anyFailed = updatedRepos.some((r) => r.status === TaskRepoStatus.FAILED);

    if (allReady) {
      await taskAccessor.update(taskId, { status: TaskStatus.READY });
      logger.info('All task repos materialized successfully', { taskId, rootPath });
    } else if (anyFailed) {
      await taskAccessor.update(taskId, { status: TaskStatus.FAILED });
      logger.warn('Some task repos failed to materialize', { taskId });
    }

    return { rootPath };
  } catch (error) {
    logger.error('Task materialization failed', toError(error), { taskId });
    await taskAccessor.update(taskId, { status: TaskStatus.FAILED });
    throw error;
  }
}
