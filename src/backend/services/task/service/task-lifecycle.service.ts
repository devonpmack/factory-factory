import { createLogger } from '@/backend/services/logger.service';
import { TaskRoutingStatus, TaskStatus } from '@/shared/core';
import { taskAccessor } from '../resources/task.accessor';
import { taskProjectAccessor } from '../resources/task-project.accessor';
import { taskRepoAccessor } from '../resources/task-repo.accessor';
import { type RoutingResult, taskRoutingService } from './task-routing.service';

const logger = createLogger('task-lifecycle-service');

const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  [TaskStatus.NEW]: [TaskStatus.ROUTING, TaskStatus.FAILED],
  [TaskStatus.ROUTING]: [TaskStatus.AWAITING_CONFIRMATION, TaskStatus.FAILED],
  [TaskStatus.AWAITING_CONFIRMATION]: [TaskStatus.CONFIRMED, TaskStatus.FAILED],
  [TaskStatus.CONFIRMED]: [TaskStatus.MATERIALIZING, TaskStatus.FAILED],
  [TaskStatus.MATERIALIZING]: [TaskStatus.READY, TaskStatus.FAILED],
  [TaskStatus.READY]: [TaskStatus.RUNNING, TaskStatus.FAILED],
  [TaskStatus.RUNNING]: [TaskStatus.DONE, TaskStatus.FAILED],
  [TaskStatus.DONE]: [],
  [TaskStatus.FAILED]: [TaskStatus.NEW],
};

class TaskLifecycleService {
  async createTask(prompt: string, title?: string) {
    const task = await taskAccessor.create({ prompt, title });
    logger.info('Task created', { taskId: task.id });
    return task;
  }

  async routeTask(taskId: string): Promise<RoutingResult> {
    const task = await taskAccessor.findById(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    this.assertTransition(task.status as TaskStatus, TaskStatus.ROUTING);

    await taskAccessor.update(taskId, {
      status: TaskStatus.ROUTING,
      routingStatus: TaskRoutingStatus.IN_PROGRESS,
    });

    try {
      const result = await taskRoutingService.routePrompt(task.prompt);

      // Persist candidate projects
      await taskProjectAccessor.deleteByTaskId(taskId);
      if (result.candidates.length > 0) {
        await taskProjectAccessor.createMany(
          result.candidates.map((c) => ({
            taskId,
            projectId: c.projectId,
            confidenceScore: c.confidenceScore,
            reasonSummary: c.reasonSummary,
          }))
        );
      }

      await taskAccessor.update(taskId, {
        status: TaskStatus.AWAITING_CONFIRMATION,
        routingStatus: TaskRoutingStatus.COMPLETED,
        routingSummary: result.summary,
      });

      logger.info('Task routing completed', {
        taskId,
        candidateCount: result.candidates.length,
      });

      return result;
    } catch (error) {
      await taskAccessor.update(taskId, {
        status: TaskStatus.FAILED,
        routingStatus: TaskRoutingStatus.FAILED,
        routingSummary: error instanceof Error ? error.message : 'Routing failed',
      });
      throw error;
    }
  }

  async confirmProjects(taskId: string, projectIds: string[]): Promise<{ confirmedCount: number }> {
    const task = await taskAccessor.findById(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    this.assertTransition(task.status as TaskStatus, TaskStatus.CONFIRMED);

    // Remove unconfirmed projects, mark confirmed ones
    await taskProjectAccessor.deleteByTaskId(taskId);
    const candidates = await taskRoutingService.routePrompt(task.prompt);
    const confirmedCandidates = candidates.candidates.filter((c) =>
      projectIds.includes(c.projectId)
    );

    // Re-create only confirmed projects
    await taskProjectAccessor.createMany(
      confirmedCandidates.map((c) => ({
        taskId,
        projectId: c.projectId,
        selectionSource: 'USER_CONFIRMED' as const,
        confidenceScore: c.confidenceScore,
        reasonSummary: c.reasonSummary,
      }))
    );

    // Also add any manually added projects not in the candidate list
    const manualProjectIds = projectIds.filter(
      (id) => !confirmedCandidates.some((c) => c.projectId === id)
    );
    if (manualProjectIds.length > 0) {
      await taskProjectAccessor.createMany(
        manualProjectIds.map((projectId) => ({
          taskId,
          projectId,
          selectionSource: 'MANUAL' as const,
          confidenceScore: 0,
          reasonSummary: 'Manually added by user',
        }))
      );
    }

    // Create task repos for confirmed projects
    await taskRepoAccessor.deleteByTaskId(taskId);
    await taskRepoAccessor.createMany(
      projectIds.map((projectId) => ({
        taskId,
        projectId,
      }))
    );

    await taskAccessor.update(taskId, {
      status: TaskStatus.CONFIRMED,
      confirmedAt: new Date(),
    });

    logger.info('Task projects confirmed', {
      taskId,
      confirmedCount: projectIds.length,
      manualCount: manualProjectIds.length,
    });

    return { confirmedCount: projectIds.length };
  }

  getTask(taskId: string) {
    return taskAccessor.findById(taskId);
  }

  listTasks(filters?: { status?: TaskStatus; limit?: number; offset?: number }) {
    return taskAccessor.list(filters);
  }

  private assertTransition(current: TaskStatus, target: TaskStatus): void {
    const allowed = VALID_TRANSITIONS[current];
    if (!allowed?.includes(target)) {
      throw new Error(`Invalid task status transition: ${current} -> ${target}`);
    }
  }
}

export const taskLifecycleService = new TaskLifecycleService();
