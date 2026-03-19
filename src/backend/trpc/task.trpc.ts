import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { initializeTaskWorktrees } from '@/backend/orchestration/task-init.orchestrator';
import { gitOpsService } from '@/backend/services/git-ops.service';
import { createLogger } from '@/backend/services/logger.service';
import {
  taskAccessor,
  taskLifecycleService,
  taskProjectAccessor,
  taskRepoAccessor,
  taskRoutingService,
  taskWorkspaceAccessor,
} from '@/backend/services/task';
import { publicProcedure, router } from './trpc';

const logger = createLogger('task-router');

export const taskRouter = router({
  create: publicProcedure
    .input(
      z.object({
        prompt: z.string().min(1),
        title: z.string().optional(),
      })
    )
    .mutation(({ input }) => {
      return taskLifecycleService.createTask(input.prompt, input.title);
    }),

  get: publicProcedure.input(z.object({ id: z.string() })).query(({ input }) => {
    return taskLifecycleService.getTask(input.id);
  }),

  list: publicProcedure
    .input(
      z
        .object({
          limit: z.number().min(1).max(100).optional(),
          offset: z.number().min(0).optional(),
        })
        .optional()
    )
    .query(({ input }) => {
      return taskLifecycleService.listTasks(input);
    }),

  route: publicProcedure.input(z.object({ id: z.string() })).mutation(({ input }) => {
    return taskLifecycleService.routeTask(input.id);
  }),

  confirmProjects: publicProcedure
    .input(
      z.object({
        id: z.string(),
        projectIds: z.array(z.string()).min(1),
      })
    )
    .mutation(({ input }) => {
      return taskLifecycleService.confirmProjects(input.id, input.projectIds);
    }),

  launch: publicProcedure.input(z.object({ id: z.string() })).mutation(async ({ input }) => {
    const task = await taskAccessor.findById(input.id);
    if (!task) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
    }

    void initializeTaskWorktrees(input.id).catch((error) => {
      logger.error(
        'Task initialization failed',
        error instanceof Error ? error : new Error(String(error)),
        { taskId: input.id }
      );
    });

    return { id: input.id };
  }),

  getTaskWorkspace: publicProcedure.input(z.object({ id: z.string() })).query(async ({ input }) => {
    const tw = await taskWorkspaceAccessor.findByTaskId(input.id);
    if (!tw) {
      return null;
    }
    return { workspaceId: tw.workspaceId, taskRoot: tw.taskRoot };
  }),

  repoGitSummaries: publicProcedure.input(z.object({ id: z.string() })).query(async ({ input }) => {
    const task = await taskAccessor.findById(input.id);
    if (!task) {
      return [];
    }

    const taskProjects = await taskProjectAccessor.findByTaskId(input.id);
    const repos = await taskRepoAccessor.findByTaskId(input.id);
    const summaries: Array<{
      projectId: string;
      slug: string;
      branchName: string | null;
      mountPath: string | null;
      status: string;
      gitStats: {
        total: number;
        additions: number;
        deletions: number;
        hasUncommitted: boolean;
      } | null;
    }> = [];

    for (const repo of repos) {
      const project = taskProjects.find((tp) => tp.projectId === repo.projectId)?.project;
      const slug = project?.slug ?? repo.projectId;

      let gitStats: (typeof summaries)[number]['gitStats'] = null;
      if (repo.mountPath && repo.status === 'READY') {
        try {
          const stats = await gitOpsService.getWorkspaceGitStats(
            repo.mountPath,
            project?.defaultBranch ?? 'main'
          );
          if (stats) {
            gitStats = stats;
          }
        } catch {
          // non-fatal
        }
      }

      summaries.push({
        projectId: repo.projectId,
        slug,
        branchName: repo.branchName,
        mountPath: repo.mountPath,
        status: repo.status,
        gitStats,
      });
    }

    return summaries;
  }),

  projectsByOrg: publicProcedure.query(() => {
    return taskRoutingService.getProjectsByOrg();
  }),
});
