/**
 * Google Tasks service singleton
 * Provides a reusable authenticated Tasks API client
 */

import { google, tasks_v1 } from 'googleapis';
import {
  loadCredentials,
  getValidTokens,
  createAuthenticatedClient,
  CredentialsError,
  TokenError,
} from '../auth';
import type { ValidatedCredentials, StoredTokens } from '../auth';
import type { TaskDisplay, TaskListDisplay } from './types';

const DEFAULT_CREDENTIALS_PATH = './credentials.json';
const DEFAULT_TOKEN_PATH = './token.json';

export class TasksServiceError extends Error {
  constructor(message: string, public readonly code?: string) {
    super(message);
    this.name = 'TasksServiceError';
  }
}

export interface TasksServiceConfig {
  credentialsPath?: string;
  tokenPath?: string;
  verbose?: boolean;
}

class TasksService {
  private static instance: TasksService | null = null;

  private tasksClient: tasks_v1.Tasks | null = null;
  private credentials: ValidatedCredentials | null = null;
  private tokens: StoredTokens | null = null;
  private config: Required<TasksServiceConfig>;
  private initialized: boolean = false;

  private constructor(config: TasksServiceConfig = {}) {
    this.config = {
      credentialsPath: config.credentialsPath ?? DEFAULT_CREDENTIALS_PATH,
      tokenPath: config.tokenPath ?? DEFAULT_TOKEN_PATH,
      verbose: config.verbose ?? false,
    };
  }

  public static getInstance(config?: TasksServiceConfig): TasksService {
    if (!TasksService.instance) {
      TasksService.instance = new TasksService(config);
    } else if (config) {
      TasksService.instance.updateConfig(config);
    }
    return TasksService.instance;
  }

  public static resetInstance(): void {
    TasksService.instance = null;
  }

  private updateConfig(config: TasksServiceConfig): void {
    const pathsChanged =
      (config.credentialsPath !== undefined &&
        config.credentialsPath !== this.config.credentialsPath) ||
      (config.tokenPath !== undefined &&
        config.tokenPath !== this.config.tokenPath);

    this.config = {
      ...this.config,
      ...config,
    };

    if (pathsChanged) {
      this.tasksClient = null;
      this.credentials = null;
      this.tokens = null;
      this.initialized = false;
    }
  }

  private async initializeIfNeeded(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      this.credentials = loadCredentials(this.config.credentialsPath);
    } catch (err) {
      if (err instanceof CredentialsError) {
        throw new TasksServiceError(
          `Failed to load credentials: ${err.message}`,
          'credentials_error'
        );
      }
      throw err;
    }

    try {
      this.tokens = await getValidTokens(
        this.credentials,
        this.config.tokenPath
      );
    } catch (err) {
      if (err instanceof TokenError && err.code === 'token_revoked') {
        this.tokens = null;
      } else if (!(err instanceof TokenError)) {
        throw err;
      }
    }

    if (this.tokens) {
      this.createTasksClient();
    }

    this.initialized = true;
  }

  private createTasksClient(): void {
    if (!this.tokens || !this.credentials) {
      throw new TasksServiceError(
        'Cannot create Tasks client without tokens and credentials',
        'not_initialized'
      );
    }

    const oAuth2Client = createAuthenticatedClient(this.tokens, this.credentials);
    this.tasksClient = google.tasks({ version: 'v1', auth: oAuth2Client });
  }

  public async isAuthenticated(): Promise<boolean> {
    await this.initializeIfNeeded();
    return this.tokens !== null && this.tasksClient !== null;
  }

  private async getClient(): Promise<tasks_v1.Tasks> {
    await this.initializeIfNeeded();

    if (!this.tasksClient) {
      throw new TasksServiceError(
        'Not authenticated. Please run authentication first.\n' +
        'Use: gmail-connector auth login',
        'not_authenticated'
      );
    }

    if (this.credentials && this.tokens) {
      try {
        const validTokens = await getValidTokens(
          this.credentials,
          this.config.tokenPath
        );
        if (validTokens && validTokens !== this.tokens) {
          this.tokens = validTokens;
          this.createTasksClient();
        }
      } catch {
        // Continue with existing client if refresh fails
      }
    }

    return this.tasksClient;
  }

  public async getTaskLists(): Promise<TaskListDisplay[]> {
    const client = await this.getClient();
    const response = await client.tasklists.list({ maxResults: 100 });
    const items = response.data.items ?? [];

    return items.map((item) => ({
      id: item.id ?? '',
      title: item.title ?? '(untitled)',
      updated: item.updated ?? '',
    }));
  }

  public async getTasks(
    taskListId: string = '@default',
    options: { showCompleted?: boolean; dueMax?: string } = {}
  ): Promise<TaskDisplay[]> {
    const client = await this.getClient();
    const response = await client.tasks.list({
      tasklist: taskListId,
      maxResults: 100,
      showCompleted: options.showCompleted ?? false,
      showHidden: options.showCompleted ?? false,
      dueMax: options.dueMax,
    });
    const items = response.data.items ?? [];

    return items.map((item) => ({
      id: item.id ?? '',
      title: item.title ?? '(untitled)',
      notes: item.notes ?? undefined,
      status: (item.status as 'needsAction' | 'completed') ?? 'needsAction',
      due: item.due ?? undefined,
      completed: item.completed ?? undefined,
      updated: item.updated ?? '',
      parent: item.parent ?? undefined,
      position: item.position ?? '0',
    }));
  }

  public async createTask(
    taskListId: string = '@default',
    title: string,
    options: { notes?: string; due?: string } = {}
  ): Promise<TaskDisplay> {
    const client = await this.getClient();
    const requestBody: tasks_v1.Schema$Task = { title };

    if (options.notes) {
      requestBody.notes = options.notes;
    }
    if (options.due) {
      requestBody.due = new Date(options.due).toISOString();
    }

    const response = await client.tasks.insert({
      tasklist: taskListId,
      requestBody,
    });

    const item = response.data;
    return {
      id: item.id ?? '',
      title: item.title ?? '(untitled)',
      notes: item.notes ?? undefined,
      status: (item.status as 'needsAction' | 'completed') ?? 'needsAction',
      due: item.due ?? undefined,
      completed: item.completed ?? undefined,
      updated: item.updated ?? '',
      parent: item.parent ?? undefined,
      position: item.position ?? '0',
    };
  }

  public async completeTask(
    taskListId: string = '@default',
    taskId: string
  ): Promise<TaskDisplay> {
    const client = await this.getClient();
    const response = await client.tasks.patch({
      tasklist: taskListId,
      task: taskId,
      requestBody: {
        status: 'completed',
      },
    });

    const item = response.data;
    return {
      id: item.id ?? '',
      title: item.title ?? '(untitled)',
      notes: item.notes ?? undefined,
      status: (item.status as 'needsAction' | 'completed') ?? 'completed',
      due: item.due ?? undefined,
      completed: item.completed ?? undefined,
      updated: item.updated ?? '',
      parent: item.parent ?? undefined,
      position: item.position ?? '0',
    };
  }

  public async deleteTask(
    taskListId: string = '@default',
    taskId: string
  ): Promise<void> {
    const client = await this.getClient();
    await client.tasks.delete({
      tasklist: taskListId,
      task: taskId,
    });
  }

  public async updateTask(
    taskListId: string = '@default',
    taskId: string,
    updates: { title?: string; notes?: string; due?: string; status?: string }
  ): Promise<TaskDisplay> {
    const client = await this.getClient();
    const requestBody: tasks_v1.Schema$Task = {};

    if (updates.title !== undefined) requestBody.title = updates.title;
    if (updates.notes !== undefined) requestBody.notes = updates.notes;
    if (updates.due !== undefined) requestBody.due = new Date(updates.due).toISOString();
    if (updates.status !== undefined) requestBody.status = updates.status;

    const response = await client.tasks.patch({
      tasklist: taskListId,
      task: taskId,
      requestBody,
    });

    const item = response.data;
    return {
      id: item.id ?? '',
      title: item.title ?? '(untitled)',
      notes: item.notes ?? undefined,
      status: (item.status as 'needsAction' | 'completed') ?? 'needsAction',
      due: item.due ?? undefined,
      completed: item.completed ?? undefined,
      updated: item.updated ?? '',
      parent: item.parent ?? undefined,
      position: item.position ?? '0',
    };
  }
}

export function getTasksService(config?: TasksServiceConfig): TasksService {
  return TasksService.getInstance(config);
}

export { TasksService };
