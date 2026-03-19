import { prisma } from '@/backend/db';

interface CreateTaskWorkspaceInput {
  taskId: string;
  workspaceId: string;
  taskRoot: string;
}

class TaskWorkspaceAccessor {
  create(data: CreateTaskWorkspaceInput) {
    return prisma.taskWorkspace.create({ data });
  }

  findByTaskId(taskId: string) {
    return prisma.taskWorkspace.findUnique({ where: { taskId } });
  }

  findByWorkspaceId(workspaceId: string) {
    return prisma.taskWorkspace.findUnique({ where: { workspaceId } });
  }
}

export const taskWorkspaceAccessor = new TaskWorkspaceAccessor();
