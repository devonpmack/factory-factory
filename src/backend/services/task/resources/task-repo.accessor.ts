import type { TaskRepo } from '@prisma-gen/client';
import { prisma } from '@/backend/db';
import type { TaskRepoMaterializationMode, TaskRepoStatus } from '@/shared/core';

interface CreateTaskRepoInput {
  taskId: string;
  projectId: string;
  materializationMode?: TaskRepoMaterializationMode;
}

interface UpdateTaskRepoInput {
  mountPath?: string | null;
  branchName?: string | null;
  status?: TaskRepoStatus;
  errorMessage?: string | null;
}

class TaskRepoAccessor {
  create(data: CreateTaskRepoInput): Promise<TaskRepo> {
    return prisma.taskRepo.create({
      data: {
        taskId: data.taskId,
        projectId: data.projectId,
        materializationMode: data.materializationMode ?? 'WORKTREE',
      },
    });
  }

  async createMany(items: CreateTaskRepoInput[]): Promise<void> {
    await prisma.taskRepo.createMany({
      data: items.map((item) => ({
        taskId: item.taskId,
        projectId: item.projectId,
        materializationMode: item.materializationMode ?? 'WORKTREE',
      })),
    });
  }

  findByTaskId(taskId: string) {
    return prisma.taskRepo.findMany({
      where: { taskId },
    });
  }

  update(id: string, data: UpdateTaskRepoInput): Promise<TaskRepo> {
    return prisma.taskRepo.update({
      where: { id },
      data,
    });
  }

  async deleteByTaskId(taskId: string): Promise<void> {
    await prisma.taskRepo.deleteMany({
      where: { taskId },
    });
  }

  findActiveWithPRs() {
    return prisma.taskRepo.findMany({
      where: {
        prUrl: { not: null },
        status: 'READY',
        task: {
          status: { in: ['READY', 'RUNNING'] },
          ratchetEnabled: true,
        },
      },
      include: {
        project: { select: { slug: true, githubOwner: true, githubRepo: true } },
        task: {
          include: {
            workspace: true,
          },
        },
      },
    });
  }
}

export const taskRepoAccessor = new TaskRepoAccessor();

export type ActiveTaskRepo = Awaited<ReturnType<typeof taskRepoAccessor.findActiveWithPRs>>[number];
