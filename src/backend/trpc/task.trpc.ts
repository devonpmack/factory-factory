import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { materializeTaskRepos } from '@/backend/orchestration/task-init.orchestrator';
import { gitOpsService } from '@/backend/services/git-ops.service';
import { sessionDataService, sessionProviderResolverService } from '@/backend/services/session';
import {
  taskAccessor,
  taskLifecycleService,
  taskProjectAccessor,
  taskRepoAccessor,
  taskRoutingService,
} from '@/backend/services/task';
import { workspaceAccessor, workspaceStateMachine } from '@/backend/services/workspace';
import { TaskStatus } from '@/shared/core';
import { publicProcedure, router } from './trpc';

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

  launch: publicProcedure.input(z.object({ id: z.string() })).mutation(({ input }) => {
    return materializeTaskRepos(input.id);
  }),

  startSession: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const task = await taskAccessor.findById(input.id);
      if (!task) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
      }
      if (task.status !== TaskStatus.READY) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `Task must be READY before starting a session, got: ${task.status}`,
        });
      }
      if (!task.rootPath) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Task has no root path',
        });
      }

      const taskProjects = await taskProjectAccessor.findByTaskId(input.id);
      const firstProject = taskProjects[0]?.project;
      if (!firstProject) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Task has no confirmed projects',
        });
      }

      // Build repo-aware system preamble with AI descriptions
      const repoList = task.taskRepos
        .filter((r) => r.mountPath)
        .map((r) => {
          const project = taskProjects.find((tp) => tp.projectId === r.projectId)?.project;
          const slug = project?.slug ?? r.projectId;
          const desc = project?.aiDescription;
          return desc ? `- \`repos/${slug}\` — ${desc}` : `- \`repos/${slug}\``;
        })
        .join('\n');

      const taskPrompt = `# Task: ${task.title ?? 'Cross-project task'}

${task.prompt}

---

You are working in a task root that contains multiple repositories under \`repos/\`.
The available repositories are:
${repoList}

When making changes:
- Use repository-relative paths and be explicit about which repo you are editing
- Run commands from within the relevant repo directory (e.g., \`cd repos/<slug> && ...\`)
- If changes in one repo affect another, check both repos for consistency
- Create separate branches and commits per repo as needed`;

      // Create a workspace for the task, backed by the first project
      const workspace = await workspaceAccessor.create({
        projectId: firstProject.id,
        name: task.title ?? `Task ${input.id}`,
        description: task.prompt.slice(0, 200),
        creationSource: 'MANUAL',
        creationMetadata: { taskId: input.id, initialPrompt: taskPrompt },
      });

      // Set worktreePath directly to the task root and mark ready
      await workspaceAccessor.update(workspace.id, {
        worktreePath: task.rootPath,
      });
      await workspaceStateMachine.startProvisioning(workspace.id);
      await workspaceStateMachine.markReady(workspace.id);

      const { sessionService, sessionDomainService, chatMessageHandlerService } =
        ctx.appContext.services;

      const provider = await sessionProviderResolverService.resolveSessionProvider({
        workspaceId: workspace.id,
      });

      const session = await sessionDataService.createAgentSession({
        workspaceId: workspace.id,
        workflow: 'implement',
        provider,
      });

      await sessionService.startSession(session.id, { initialPrompt: '' });

      // Send the task prompt through the queue
      const messageId = `task-init-${Date.now()}`;
      const enqueueResult = sessionDomainService.enqueue(session.id, {
        id: messageId,
        text: taskPrompt,
        timestamp: new Date().toISOString(),
        settings: {
          selectedModel: session.model,
          reasoningEffort: null,
          thinkingEnabled: false,
          planModeEnabled: false,
        },
      });
      if (!('error' in enqueueResult)) {
        await chatMessageHandlerService.tryDispatchNextMessage(session.id);
      }

      await taskAccessor.update(input.id, {
        status: TaskStatus.RUNNING,
        primarySessionId: session.id,
      });

      return { workspaceId: workspace.id, sessionId: session.id };
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
