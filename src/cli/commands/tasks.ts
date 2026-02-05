/**
 * Tasks commands
 * Manage Google Tasks — list, create, complete, and delete tasks
 */

import { Command } from 'commander';
import { getTasksService, TasksServiceError } from '../../tasks';
import type { TaskDisplay, TaskListDisplay } from '../../tasks';
import type { GlobalOptions } from '../types';
import { EXIT_CODES } from '../types';

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return dateStr.slice(0, 10);
  }
}

function formatTaskRow(
  status: string,
  title: string,
  due: string,
  id: string
): string {
  const statusCol = status.padEnd(4);
  const titleCol = truncate(title, 50).padEnd(50);
  const dueCol = (due || '').padEnd(14);
  return `${statusCol}  ${titleCol}  ${dueCol}  ${id}`;
}

export function createTasksCommand(): Command {
  const tasks = new Command('tasks')
    .description('Manage Google Tasks');

  // --- tasks lists ---
  tasks
    .command('lists')
    .description('List all task lists')
    .option('--json', 'Output as JSON')
    .action(async (options: { json?: boolean }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals<GlobalOptions>();

      try {
        const service = getTasksService({
          credentialsPath: globalOpts.config,
          verbose: globalOpts.verbose,
        });

        const isAuthenticated = await service.isAuthenticated();
        if (!isAuthenticated) {
          console.error('Error: Not authenticated. Please run: gmail-connector auth login');
          process.exit(EXIT_CODES.AUTHENTICATION_REQUIRED);
        }

        const taskLists = await service.getTaskLists();

        if (options.json) {
          console.log(JSON.stringify(taskLists, null, 2));
        } else {
          if (taskLists.length === 0) {
            console.log('No task lists found.');
            process.exit(EXIT_CODES.SUCCESS);
          }

          console.log('TITLE'.padEnd(30) + '  ' + 'ID');
          console.log('-'.repeat(80));
          for (const list of taskLists) {
            console.log(truncate(list.title, 30).padEnd(30) + '  ' + list.id);
          }
          console.log(`\n${taskLists.length} task list(s) found.`);
        }

        process.exit(EXIT_CODES.SUCCESS);
      } catch (err) {
        handleError(err, globalOpts);
      }
    });

  // --- tasks list ---
  tasks
    .command('list [listId]')
    .description('List tasks in a task list (default: primary list)')
    .option('--show-completed', 'Include completed tasks')
    .option('--due-before <date>', 'Show tasks due before this date')
    .option('--json', 'Output as JSON')
    .action(
      async (
        listId: string | undefined,
        options: { showCompleted?: boolean; dueBefore?: string; json?: boolean },
        cmd: Command
      ) => {
        const globalOpts = cmd.optsWithGlobals<GlobalOptions>();

        try {
          const service = getTasksService({
            credentialsPath: globalOpts.config,
            verbose: globalOpts.verbose,
          });

          const isAuthenticated = await service.isAuthenticated();
          if (!isAuthenticated) {
            console.error('Error: Not authenticated. Please run: gmail-connector auth login');
            process.exit(EXIT_CODES.AUTHENTICATION_REQUIRED);
          }

          const taskListId = listId ?? '@default';
          const taskItems = await service.getTasks(taskListId, {
            showCompleted: options.showCompleted,
            dueMax: options.dueBefore
              ? new Date(options.dueBefore).toISOString()
              : undefined,
          });

          if (options.json) {
            console.log(JSON.stringify(taskItems, null, 2));
          } else {
            if (taskItems.length === 0) {
              console.log('No tasks found.');
              process.exit(EXIT_CODES.SUCCESS);
            }

            console.log(formatTaskRow('', 'TITLE', 'DUE', 'ID'));
            console.log('-'.repeat(90));
            for (const task of taskItems) {
              const statusIcon = task.status === 'completed' ? '[x]' : '[ ]';
              const dueStr = task.due ? formatDate(task.due) : '';
              console.log(formatTaskRow(statusIcon, task.title, dueStr, task.id));
            }
            console.log(`\n${taskItems.length} task(s) found.`);
          }

          process.exit(EXIT_CODES.SUCCESS);
        } catch (err) {
          handleError(err, globalOpts);
        }
      }
    );

  // --- tasks add ---
  tasks
    .command('add <title>')
    .description('Create a new task')
    .option('--notes <text>', 'Add notes to the task')
    .option('--due <date>', 'Set due date (e.g. 2025-12-31)')
    .option('--list <listId>', 'Task list ID (default: primary list)')
    .option('--json', 'Output as JSON')
    .action(
      async (
        title: string,
        options: { notes?: string; due?: string; list?: string; json?: boolean },
        cmd: Command
      ) => {
        const globalOpts = cmd.optsWithGlobals<GlobalOptions>();

        try {
          const service = getTasksService({
            credentialsPath: globalOpts.config,
            verbose: globalOpts.verbose,
          });

          const isAuthenticated = await service.isAuthenticated();
          if (!isAuthenticated) {
            console.error('Error: Not authenticated. Please run: gmail-connector auth login');
            process.exit(EXIT_CODES.AUTHENTICATION_REQUIRED);
          }

          const taskListId = options.list ?? '@default';
          const task = await service.createTask(taskListId, title, {
            notes: options.notes,
            due: options.due,
          });

          if (options.json) {
            console.log(JSON.stringify(task, null, 2));
          } else {
            console.log(`Task created: ${task.title}`);
            console.log(`  ID: ${task.id}`);
            if (task.notes) console.log(`  Notes: ${task.notes}`);
            if (task.due) console.log(`  Due: ${formatDate(task.due)}`);
          }

          process.exit(EXIT_CODES.SUCCESS);
        } catch (err) {
          handleError(err, globalOpts);
        }
      }
    );

  // --- tasks complete ---
  tasks
    .command('complete <taskId>')
    .description('Mark a task as completed')
    .option('--list <listId>', 'Task list ID (default: primary list)')
    .option('--json', 'Output as JSON')
    .action(
      async (
        taskId: string,
        options: { list?: string; json?: boolean },
        cmd: Command
      ) => {
        const globalOpts = cmd.optsWithGlobals<GlobalOptions>();

        try {
          const service = getTasksService({
            credentialsPath: globalOpts.config,
            verbose: globalOpts.verbose,
          });

          const isAuthenticated = await service.isAuthenticated();
          if (!isAuthenticated) {
            console.error('Error: Not authenticated. Please run: gmail-connector auth login');
            process.exit(EXIT_CODES.AUTHENTICATION_REQUIRED);
          }

          const taskListId = options.list ?? '@default';
          const task = await service.completeTask(taskListId, taskId);

          if (options.json) {
            console.log(JSON.stringify(task, null, 2));
          } else {
            console.log(`Task completed: ${task.title}`);
          }

          process.exit(EXIT_CODES.SUCCESS);
        } catch (err) {
          handleError(err, globalOpts);
        }
      }
    );

  // --- tasks update ---
  tasks
    .command('update <taskId>')
    .description('Update an existing task')
    .option('--title <text>', 'New title')
    .option('--notes <text>', 'New notes')
    .option('--due <date>', 'New due date (e.g. 2025-12-31)')
    .option('--list <listId>', 'Task list ID (default: primary list)')
    .option('--json', 'Output as JSON')
    .action(
      async (
        taskId: string,
        options: { title?: string; notes?: string; due?: string; list?: string; json?: boolean },
        cmd: Command
      ) => {
        const globalOpts = cmd.optsWithGlobals<GlobalOptions>();

        try {
          const service = getTasksService({
            credentialsPath: globalOpts.config,
            verbose: globalOpts.verbose,
          });

          const isAuthenticated = await service.isAuthenticated();
          if (!isAuthenticated) {
            console.error('Error: Not authenticated. Please run: gmail-connector auth login');
            process.exit(EXIT_CODES.AUTHENTICATION_REQUIRED);
          }

          if (!options.title && !options.notes && !options.due) {
            console.error('Error: Provide at least one of --title, --notes, or --due');
            process.exit(EXIT_CODES.INVALID_ARGUMENT);
          }

          const taskListId = options.list ?? '@default';
          const task = await service.updateTask(taskListId, taskId, {
            title: options.title,
            notes: options.notes,
            due: options.due,
          });

          if (options.json) {
            console.log(JSON.stringify(task, null, 2));
          } else {
            console.log(`Task updated: ${task.title}`);
            console.log(`  ID: ${task.id}`);
            if (task.notes) console.log(`  Notes: ${task.notes}`);
            if (task.due) console.log(`  Due: ${formatDate(task.due)}`);
          }

          process.exit(EXIT_CODES.SUCCESS);
        } catch (err) {
          handleError(err, globalOpts);
        }
      }
    );

  // --- tasks delete ---
  tasks
    .command('delete <taskId>')
    .description('Delete a task')
    .option('--list <listId>', 'Task list ID (default: primary list)')
    .action(
      async (
        taskId: string,
        options: { list?: string },
        cmd: Command
      ) => {
        const globalOpts = cmd.optsWithGlobals<GlobalOptions>();

        try {
          const service = getTasksService({
            credentialsPath: globalOpts.config,
            verbose: globalOpts.verbose,
          });

          const isAuthenticated = await service.isAuthenticated();
          if (!isAuthenticated) {
            console.error('Error: Not authenticated. Please run: gmail-connector auth login');
            process.exit(EXIT_CODES.AUTHENTICATION_REQUIRED);
          }

          const taskListId = options.list ?? '@default';
          await service.deleteTask(taskListId, taskId);
          console.log(`Task ${taskId} deleted.`);

          process.exit(EXIT_CODES.SUCCESS);
        } catch (err) {
          handleError(err, globalOpts);
        }
      }
    );

  return tasks;
}

function handleError(err: unknown, globalOpts: GlobalOptions): never {
  if (err instanceof TasksServiceError) {
    console.error(`Error: ${err.message}`);
    if (err.code === 'not_authenticated') {
      process.exit(EXIT_CODES.AUTHENTICATION_REQUIRED);
    }
  } else if (err instanceof Error) {
    console.error(`Error: ${err.message}`);
    if (globalOpts.verbose && err.stack) {
      console.error(err.stack);
    }
  } else {
    console.error('An unknown error occurred');
  }
  process.exit(EXIT_CODES.ERROR);
}
