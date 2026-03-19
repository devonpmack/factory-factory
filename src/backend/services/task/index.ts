// Domain: task
// Public API for the task domain module.
// Consumers should import from '@/backend/services/task' only.

export { type CreateTaskInput, type TaskWithRepos, taskAccessor } from './resources/task.accessor';
export {
  type ActiveTaskRepo,
  type CreateTaskRepoInput,
  type TaskRepoWithProject,
  taskRepoAccessor,
} from './resources/task-repo.accessor';
export { taskWorkspaceAccessor } from './resources/task-workspace.accessor';
export * from './service';
