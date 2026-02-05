/**
 * Type definitions for Google Tasks
 */

export interface TaskListDisplay {
  id: string;
  title: string;
  updated: string;
}

export interface TaskDisplay {
  id: string;
  title: string;
  notes?: string;
  status: 'needsAction' | 'completed';
  due?: string;
  completed?: string;
  updated: string;
  parent?: string;
  position: string;
}
