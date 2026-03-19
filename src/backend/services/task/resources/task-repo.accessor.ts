import type { Prisma, TaskRepo } from '@prisma-gen/client';
import { prisma } from '@/backend/db';
import type { CIStatus, PRState } from '@/shared/core';

export interface CreateTaskRepoInput {
  taskId: string;
  projectId: string;
  inferenceScore?: number;
}

export interface UpdateTaskRepoInput {
  worktreePath?: string | null;
  branchName?: string | null;
  status?: TaskRepo['status'];
  prUrl?: string | null;
  prNumber?: number | null;
  prState?: PRState;
  prCiStatus?: CIStatus;
  prUpdatedAt?: Date | null;
}

export type TaskRepoWithProject = Prisma.TaskRepoGetPayload<{
  include: { project: true };
}>;

export type ActiveTaskRepo = Prisma.TaskRepoGetPayload<{
  include: { project: true; task: { include: { workspace: true } } };
}>;

class TaskRepoAccessor {
  create(data: CreateTaskRepoInput): Promise<TaskRepo> {
    return prisma.taskRepo.create({
      data: {
        taskId: data.taskId,
        projectId: data.projectId,
        inferenceScore: data.inferenceScore ?? 0,
      },
    });
  }

  createMany(inputs: CreateTaskRepoInput[]): Promise<{ count: number }> {
    return prisma.taskRepo.createMany({ data: inputs });
  }

  findById(id: string): Promise<TaskRepo | null> {
    return prisma.taskRepo.findUnique({ where: { id } });
  }

  findByTaskId(taskId: string): Promise<TaskRepoWithProject[]> {
    return prisma.taskRepo.findMany({
      where: { taskId },
      include: { project: true },
    });
  }

  update(id: string, data: UpdateTaskRepoInput): Promise<TaskRepo> {
    return prisma.taskRepo.update({ where: { id }, data });
  }

  /** Returns all TaskRepos that have a PR URL and are not merged — used by ratchet. */
  findActiveWithPRs(): Promise<ActiveTaskRepo[]> {
    return prisma.taskRepo.findMany({
      where: {
        prUrl: { not: null },
        prState: { notIn: ['MERGED', 'CLOSED', 'NONE'] },
      },
      include: {
        project: true,
        task: { include: { workspace: true } },
      },
    });
  }
}

export const taskRepoAccessor = new TaskRepoAccessor();
