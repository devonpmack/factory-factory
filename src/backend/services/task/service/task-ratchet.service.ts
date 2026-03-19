import { createLogger } from '@/backend/services/logger.service';
import { taskAccessor } from '../resources/task.accessor';
import { taskProjectAccessor } from '../resources/task-project.accessor';
import { taskRepoPrAccessor } from '../resources/task-repo-pr.accessor';

const logger = createLogger('task-ratchet-service');

export interface TaskRepairInstruction {
  taskId: string;
  primarySessionId: string;
  prompt: string;
}

interface ActionablePr {
  projectSlug: string;
  prUrl: string;
  prNumber: number;
  ratchetState: string;
  repoName: string;
}

function buildPromptParts(actionablePrs: ActionablePr[]): string[] {
  const parts: string[] = [];
  for (const pr of actionablePrs) {
    if (pr.ratchetState === 'CI_FAILED') {
      parts.push(`The PR for \`repos/${pr.projectSlug}\` is failing CI.`);
      parts.push(`PR: ${pr.prUrl}`);
      parts.push(`Investigate and fix the issue in \`repos/${pr.projectSlug}\`.`);
    } else if (pr.ratchetState === 'REVIEW_PENDING') {
      parts.push(`The PR for \`repos/${pr.projectSlug}\` has actionable review comments.`);
      parts.push(`PR: ${pr.prUrl}`);
      parts.push(
        `Focus your changes in \`repos/${pr.projectSlug}\`, but account for any required consistency with other repos in this task root.`
      );
    }
    parts.push('');
  }
  return parts;
}

function resolveSlug(
  projectId: string,
  taskProjects: Array<{ projectId: string; project: { slug: string } }>
): string {
  return taskProjects.find((tp) => tp.projectId === projectId)?.project.slug ?? projectId;
}

function buildCrossRepoHint(
  actionablePrs: ActionablePr[],
  taskRepos: Array<{ projectId: string; mountPath: string | null }>,
  taskProjects: Array<{ projectId: string; project: { slug: string } }>
): string | null {
  if (actionablePrs.length > 1) {
    return 'Multiple repos have issues. Treat these as one cross-repo repair pass — fix the shared root cause once where possible.';
  }

  const actionableSlug = actionablePrs[0]?.projectSlug;
  const otherRepos = taskRepos
    .filter((r) => r.mountPath && resolveSlug(r.projectId, taskProjects) !== actionableSlug)
    .map((r) => `\`repos/${resolveSlug(r.projectId, taskProjects)}\``);

  if (otherRepos.length > 0) {
    return `Before finishing, review whether the same root cause also affects: ${otherRepos.join(', ')}`;
  }
  return null;
}

class TaskRatchetService {
  async buildRepairInstructions(taskId: string): Promise<TaskRepairInstruction | null> {
    const task = await taskAccessor.findById(taskId);
    if (!task?.primarySessionId) {
      return null;
    }

    const taskProjects = await taskProjectAccessor.findByTaskId(taskId);
    const actionablePrs = await this.collectActionablePrs(task.taskRepos, taskProjects);
    if (actionablePrs.length === 0) {
      return null;
    }

    const taskTitle = task.title ?? `task-${taskId}`;
    const parts: string[] = [`Ratchet update for task \`${taskTitle}\`.`, ''];
    parts.push(...buildPromptParts(actionablePrs));

    const hint = buildCrossRepoHint(actionablePrs, task.taskRepos, taskProjects);
    if (hint) {
      parts.push(hint);
    }

    logger.info('Built repair instructions', { taskId, actionablePrCount: actionablePrs.length });

    return {
      taskId,
      primarySessionId: task.primarySessionId,
      prompt: parts.join('\n'),
    };
  }

  private async collectActionablePrs(
    taskRepos: Array<{ id: string; projectId: string }>,
    taskProjects: Array<{ projectId: string; project: { slug: string } }>
  ): Promise<ActionablePr[]> {
    const actionablePrs: ActionablePr[] = [];
    for (const taskRepo of taskRepos) {
      const prs = await taskRepoPrAccessor.findByTaskRepoId(taskRepo.id);
      const slug = resolveSlug(taskRepo.projectId, taskProjects);
      for (const pr of prs) {
        if (pr.ratchetState === 'CI_FAILED' || pr.ratchetState === 'REVIEW_PENDING') {
          actionablePrs.push({
            projectSlug: slug,
            prUrl: pr.prUrl,
            prNumber: pr.prNumber,
            ratchetState: pr.ratchetState,
            repoName: pr.repoName,
          });
        }
      }
    }
    return actionablePrs;
  }
}

export const taskRatchetService = new TaskRatchetService();
