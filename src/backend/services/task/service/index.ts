// Domain: task
// Service layer for the task domain.

export { type ProjectScore, taskInferenceService } from './task-inference.service';
export {
  type ConfirmTaskInput,
  type CreateTaskResult,
  taskLifecycleService,
} from './task-lifecycle.service';
