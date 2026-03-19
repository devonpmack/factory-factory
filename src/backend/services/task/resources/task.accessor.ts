import type { Prisma, Task } from '@prisma-gen/client';
import { prisma } from '@/backend/db';
import type { RatchetState } from '@/shared/core';

export interface CreateTaskInput {
  name: string;
  prompt: string;
  ratchetEnabled?: boolean;
}

export interface UpdateTaskInput {
  name?: string;
  status?: Task['status'];
  errorMessage?: string | null;
  ratchetEnabled?: boolean;
  ratchetState?: RatchetState;
  ratchetActiveSessionId?: string | null;
}

export type TaskWithRepos = Prisma.TaskGetPayload<{
  include: { repos: { include: { project: true } }; workspace: true };
}>;

class TaskAccessor {
  create(data: CreateTaskInput): Promise<Task> {
    return prisma.task.create({
      data: {
        name: data.name,
        prompt: data.prompt,
        ratchetEnabled: data.ratchetEnabled ?? false,
      },
    });
  }

  findById(id: string): Promise<Task | null> {
    return prisma.task.findUnique({ where: { id } });
  }

  findWithRepos(id: string): Promise<TaskWithRepos | null> {
    return prisma.task.findUnique({
      where: { id },
      include: {
        repos: { include: { project: true } },
        workspace: true,
      },
    });
  }

  update(id: string, data: UpdateTaskInput): Promise<Task> {
    return prisma.task.update({ where: { id }, data });
  }

  list(statusFilter?: Task['status']): Promise<Task[]> {
    return prisma.task.findMany({
      where: statusFilter ? { status: statusFilter } : undefined,
      orderBy: { createdAt: 'desc' },
    });
  }

  transitionStatus(id: string, from: Task['status'], to: Task['status']): Promise<Task | null> {
    return prisma.task
      .update({
        where: { id, status: from },
        data: { status: to },
      })
      .catch(() => null);
  }
}

export const taskAccessor = new TaskAccessor();
