import { prisma } from '@/backend/db';
import type { CIStatus, PRState, RatchetState } from '@/shared/core';

interface CreateTaskRepoPrInput {
  taskRepoId: string;
  provider?: string;
  repoOwner: string;
  repoName: string;
  prNumber: number;
  prUrl: string;
}

interface UpdateTaskRepoPrInput {
  prState?: PRState;
  prCiStatus?: CIStatus;
  prReviewState?: string | null;
  lastReviewCommentId?: string | null;
  lastCiRunId?: string | null;
  ratchetState?: RatchetState;
  ratchetLastCheckedAt?: Date | null;
}

class TaskRepoPrAccessor {
  create(data: CreateTaskRepoPrInput) {
    return prisma.taskRepoPullRequest.create({
      data: {
        taskRepoId: data.taskRepoId,
        provider: data.provider ?? 'github',
        repoOwner: data.repoOwner,
        repoName: data.repoName,
        prNumber: data.prNumber,
        prUrl: data.prUrl,
      },
    });
  }

  findByTaskRepoId(taskRepoId: string) {
    return prisma.taskRepoPullRequest.findMany({
      where: { taskRepoId },
      orderBy: { createdAt: 'desc' },
    });
  }

  findActionable() {
    return prisma.taskRepoPullRequest.findMany({
      where: {
        ratchetState: { in: ['CI_FAILED', 'REVIEW_PENDING'] },
      },
      include: {
        taskRepo: {
          include: {
            task: true,
          },
        },
      },
    });
  }

  update(id: string, data: UpdateTaskRepoPrInput) {
    return prisma.taskRepoPullRequest.update({
      where: { id },
      data,
    });
  }
}

export const taskRepoPrAccessor = new TaskRepoPrAccessor();
