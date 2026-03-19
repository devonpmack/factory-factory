import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { initializeTaskWorktrees } from '@/backend/orchestration/task-init.orchestrator';
import { createLogger } from '@/backend/services/logger.service';
import { taskInferenceService, taskLifecycleService } from '@/backend/services/task';
import { projectAccessor } from '@/backend/services/workspace';
import { publicProcedure, router } from './trpc';

const logger = createLogger('task-router');

export const taskRouter = router({
  list: publicProcedure
    .input(
      z
        .object({
          status: z
            .enum(['PENDING_CONFIRMATION', 'PROVISIONING', 'READY', 'FAILED', 'ARCHIVED'])
            .optional(),
        })
        .optional()
    )
    .query(({ input }) => taskLifecycleService.list(input?.status)),

  get: publicProcedure.input(z.object({ id: z.string() })).query(async ({ input }) => {
    const task = await taskLifecycleService.getTaskDetails(input.id);
    if (!task) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
    }
    return task;
  }),

  /** Step 1: Create task and get inferred project suggestions. */
  create: publicProcedure
    .input(
      z.object({
        name: z.string().min(1, 'Name is required'),
        prompt: z.string().min(1, 'Prompt is required'),
      })
    )
    .mutation(({ input }) => taskLifecycleService.createTask(input)),

  /** Step 2: Confirm selected projects and kick off worktree provisioning. */
  confirm: publicProcedure
    .input(
      z.object({
        taskId: z.string(),
        confirmedProjectIds: z.array(z.string()).min(1, 'Select at least one project'),
      })
    )
    .mutation(async ({ input }) => {
      const task = await taskLifecycleService.confirmTask(input);
      // Fire-and-forget worktree initialization
      void initializeTaskWorktrees(input.taskId).catch((error) => {
        logger.error(
          'Task initialization failed',
          error instanceof Error ? error : new Error(String(error)),
          {
            taskId: input.taskId,
          }
        );
      });
      return task;
    }),

  archive: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => taskLifecycleService.archiveTask(input.id)),

  /** Score all active projects against a prompt (no task created). */
  inferProjects: publicProcedure
    .input(z.object({ prompt: z.string().min(1) }))
    .query(async ({ input }) => {
      const projects = await projectAccessor.list({ isArchived: false, isSystem: false });
      return taskInferenceService.scoreProjectsForPrompt(input.prompt, projects);
    }),
});
