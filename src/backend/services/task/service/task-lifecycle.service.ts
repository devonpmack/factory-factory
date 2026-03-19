import type { Task } from '@prisma-gen/client';
import { projectAccessor } from '@/backend/services/workspace';
import { type TaskWithRepos, taskAccessor } from '../resources/task.accessor';
import { taskRepoAccessor } from '../resources/task-repo.accessor';
import { type ProjectScore, taskInferenceService } from './task-inference.service';

export interface CreateTaskResult {
  task: Task;
  inferredProjects: ProjectScore[];
}

export interface ConfirmTaskInput {
  taskId: string;
  confirmedProjectIds: string[];
}

class TaskLifecycleService {
  async createTask(input: { name: string; prompt: string }): Promise<CreateTaskResult> {
    const task = await taskAccessor.create({ name: input.name, prompt: input.prompt });

    // Score all non-archived, non-system projects
    const projects = await projectAccessor.list({ isArchived: false, isSystem: false });

    const inferredProjects = taskInferenceService.scoreProjectsForPrompt(input.prompt, projects);

    return { task, inferredProjects };
  }

  async confirmTask(input: ConfirmTaskInput): Promise<Task> {
    const task = await taskAccessor.findById(input.taskId);
    if (!task) {
      throw new Error(`Task not found: ${input.taskId}`);
    }
    if (task.status !== 'PENDING_CONFIRMATION') {
      throw new Error(`Task is not in PENDING_CONFIRMATION state: ${task.status}`);
    }

    // Validate all project IDs exist
    const allProjects = await projectAccessor.list({ isArchived: false, isSystem: false });
    const projects = allProjects.filter((p) => input.confirmedProjectIds.includes(p.id));
    if (projects.length !== input.confirmedProjectIds.length) {
      throw new Error('One or more project IDs are invalid or archived');
    }

    // Transition to PROVISIONING
    const updated = await taskAccessor.transitionStatus(
      input.taskId,
      'PENDING_CONFIRMATION',
      'PROVISIONING'
    );
    if (!updated) {
      throw new Error('Failed to transition task to PROVISIONING');
    }

    // Create TaskRepo rows for each confirmed project
    const scoreMap = new Map<string, number>();
    // Attempt to re-score for accurate stored scores
    const scored = taskInferenceService.scoreProjectsForPrompt(task.prompt, projects);
    for (const s of scored) {
      scoreMap.set(s.projectId, s.score);
    }

    await taskRepoAccessor.createMany(
      input.confirmedProjectIds.map((projectId) => ({
        taskId: input.taskId,
        projectId,
        inferenceScore: scoreMap.get(projectId) ?? 0,
      }))
    );

    return updated;
  }

  async archiveTask(taskId: string): Promise<Task> {
    const task = await taskAccessor.findById(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    return taskAccessor.update(taskId, { status: 'ARCHIVED' });
  }

  list(statusFilter?: Task['status']): Promise<Task[]> {
    return taskAccessor.list(statusFilter);
  }

  getTaskDetails(taskId: string): Promise<TaskWithRepos | null> {
    return taskAccessor.findWithRepos(taskId);
  }
}

export const taskLifecycleService = new TaskLifecycleService();
