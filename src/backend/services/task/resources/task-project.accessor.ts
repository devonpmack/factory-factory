import type { TaskProject } from '@prisma-gen/client';
import { prisma } from '@/backend/db';
import type { TaskProjectSelectionSource } from '@/shared/core';

interface CreateTaskProjectInput {
  taskId: string;
  projectId: string;
  selectionSource?: TaskProjectSelectionSource;
  confidenceScore?: number;
  reasonSummary?: string;
}

class TaskProjectAccessor {
  create(data: CreateTaskProjectInput): Promise<TaskProject> {
    return prisma.taskProject.create({
      data: {
        taskId: data.taskId,
        projectId: data.projectId,
        selectionSource: data.selectionSource ?? 'AUTO',
        confidenceScore: data.confidenceScore ?? null,
        reasonSummary: data.reasonSummary ?? null,
      },
    });
  }

  async createMany(items: CreateTaskProjectInput[]): Promise<void> {
    await prisma.taskProject.createMany({
      data: items.map((item) => ({
        taskId: item.taskId,
        projectId: item.projectId,
        selectionSource: item.selectionSource ?? 'AUTO',
        confidenceScore: item.confidenceScore ?? null,
        reasonSummary: item.reasonSummary ?? null,
      })),
    });
  }

  findByTaskId(taskId: string) {
    return prisma.taskProject.findMany({
      where: { taskId },
      include: {
        project: {
          select: {
            id: true,
            name: true,
            slug: true,
            repoPath: true,
            githubOwner: true,
            githubRepo: true,
            aiDescription: true,
            defaultBranch: true,
            worktreeBasePath: true,
          },
        },
      },
      orderBy: { confidenceScore: 'desc' },
    });
  }

  async deleteByTaskId(taskId: string): Promise<void> {
    await prisma.taskProject.deleteMany({
      where: { taskId },
    });
  }

  async deleteByTaskAndProject(taskId: string, projectId: string): Promise<void> {
    await prisma.taskProject.deleteMany({
      where: { taskId, projectId },
    });
  }
}

export const taskProjectAccessor = new TaskProjectAccessor();
