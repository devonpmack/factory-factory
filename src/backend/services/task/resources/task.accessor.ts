import type { Task } from '@prisma-gen/client';
import { prisma } from '@/backend/db';
import type { TaskRoutingStatus, TaskStatus } from '@/shared/core';

interface CreateTaskInput {
  prompt: string;
  title?: string;
}

interface UpdateTaskInput {
  title?: string;
  status?: TaskStatus;
  routingStatus?: TaskRoutingStatus;
  routingSummary?: string | null;
  planningNotes?: string | null;
  confirmedAt?: Date | null;
  rootPath?: string | null;
  primarySessionId?: string | null;
}

type TaskWithRelations = Task & {
  taskProjects: Array<{
    id: string;
    projectId: string;
    selectionSource: string;
    confidenceScore: number | null;
    reasonSummary: string | null;
    project: {
      id: string;
      name: string;
      slug: string;
      repoPath: string;
      githubOwner: string | null;
      githubRepo: string | null;
      aiDescription: string | null;
    };
  }>;
  taskRepos: Array<{
    id: string;
    projectId: string;
    mountPath: string | null;
    branchName: string | null;
    materializationMode: string;
    status: string;
    errorMessage: string | null;
    prNumber: number | null;
    prUrl: string | null;
    prState: string;
    prCiStatus: string;
  }>;
};

class TaskAccessor {
  create(data: CreateTaskInput): Promise<Task> {
    return prisma.task.create({
      data: {
        prompt: data.prompt,
        title: data.title ?? null,
      },
    });
  }

  findById(id: string): Promise<TaskWithRelations | null> {
    return prisma.task.findUnique({
      where: { id },
      include: {
        taskProjects: {
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
              },
            },
          },
        },
        taskRepos: true,
      },
    });
  }

  list(filters?: { status?: TaskStatus; limit?: number; offset?: number }) {
    return prisma.task.findMany({
      where: filters?.status ? { status: filters.status } : undefined,
      take: filters?.limit,
      skip: filters?.offset,
      orderBy: { createdAt: 'desc' },
      include: {
        taskProjects: {
          include: {
            project: {
              select: {
                id: true,
                name: true,
                slug: true,
                githubOwner: true,
                githubRepo: true,
              },
            },
          },
        },
        taskRepos: true,
      },
    });
  }

  update(id: string, data: UpdateTaskInput): Promise<Task> {
    return prisma.task.update({
      where: { id },
      data,
    });
  }

  delete(id: string): Promise<Task> {
    return prisma.task.delete({
      where: { id },
    });
  }
}

export const taskAccessor = new TaskAccessor();
