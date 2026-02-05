/**
 * Tasks module for Gmail Connector
 * Provides singleton access to authenticated Google Tasks API client
 */

export {
  TasksService,
  TasksServiceError,
  getTasksService,
} from './service';

export type { TasksServiceConfig } from './service';
export type { TaskDisplay, TaskListDisplay } from './types';
