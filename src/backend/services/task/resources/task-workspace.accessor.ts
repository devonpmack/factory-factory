import type { TaskWorkspace } from '@prisma-gen/client';
import { prisma } from '@/backend/db';

export interface CreateTaskWorkspaceInput {
  taskId: string;
  workspaceId: string;
  taskRoot: string;
}

class TaskWorkspaceAccessor {
  create(data: CreateTaskWorkspaceInput): Promise<TaskWorkspace> {
    return prisma.taskWorkspace.create({ data });
  }

  findByTaskId(taskId: string): Promise<TaskWorkspace | null> {
    return prisma.taskWorkspace.findUnique({ where: { taskId } });
  }

  /** Used by the session bridge to resolve taskRoot from a sentinel workspaceId. */
  findByWorkspaceId(workspaceId: string): Promise<TaskWorkspace | null> {
    return prisma.taskWorkspace.findUnique({ where: { workspaceId } });
  }
}

export const taskWorkspaceAccessor = new TaskWorkspaceAccessor();
