/**
 * Google Calendar service singleton
 * Provides a reusable authenticated Calendar API client
 */

import { google, calendar_v3 } from 'googleapis';
import {
  loadCredentials,
  getValidTokens,
  createAuthenticatedClient,
  CredentialsError,
  TokenError,
} from '../auth';
import type { ValidatedCredentials, StoredTokens } from '../auth';
import type { CalendarDisplay, EventDisplay } from './types';

const DEFAULT_CREDENTIALS_PATH = './credentials.json';
const DEFAULT_TOKEN_PATH = './token.json';

export class CalendarServiceError extends Error {
  constructor(message: string, public readonly code?: string) {
    super(message);
    this.name = 'CalendarServiceError';
  }
}

export interface CalendarServiceConfig {
  credentialsPath?: string;
  tokenPath?: string;
  verbose?: boolean;
}

export interface GetEventsOptions {
  timeMin?: string;
  timeMax?: string;
  maxResults?: number;
  query?: string;
}

export interface CreateEventOptions {
  summary: string;
  description?: string;
  start: string;
  end: string;
  allDay?: boolean;
  location?: string;
  reminders?: { minutes: number };
}

export interface UpdateEventOptions {
  summary?: string;
  description?: string;
  start?: string;
  end?: string;
  location?: string;
}

class CalendarService {
  private static instance: CalendarService | null = null;

  private calendarClient: calendar_v3.Calendar | null = null;
  private credentials: ValidatedCredentials | null = null;
  private tokens: StoredTokens | null = null;
  private config: Required<CalendarServiceConfig>;
  private initialized: boolean = false;

  private constructor(config: CalendarServiceConfig = {}) {
    this.config = {
      credentialsPath: config.credentialsPath ?? DEFAULT_CREDENTIALS_PATH,
      tokenPath: config.tokenPath ?? DEFAULT_TOKEN_PATH,
      verbose: config.verbose ?? false,
    };
  }

  public static getInstance(config?: CalendarServiceConfig): CalendarService {
    if (!CalendarService.instance) {
      CalendarService.instance = new CalendarService(config);
    } else if (config) {
      CalendarService.instance.updateConfig(config);
    }
    return CalendarService.instance;
  }

  public static resetInstance(): void {
    CalendarService.instance = null;
  }

  private updateConfig(config: CalendarServiceConfig): void {
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
      this.calendarClient = null;
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
        throw new CalendarServiceError(
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
      this.createCalendarClient();
    }

    this.initialized = true;
  }

  private createCalendarClient(): void {
    if (!this.tokens || !this.credentials) {
      throw new CalendarServiceError(
        'Cannot create Calendar client without tokens and credentials',
        'not_initialized'
      );
    }

    const oAuth2Client = createAuthenticatedClient(this.tokens, this.credentials);
    this.calendarClient = google.calendar({ version: 'v3', auth: oAuth2Client });
  }

  public async isAuthenticated(): Promise<boolean> {
    await this.initializeIfNeeded();
    return this.tokens !== null && this.calendarClient !== null;
  }

  private async getClient(): Promise<calendar_v3.Calendar> {
    await this.initializeIfNeeded();

    if (!this.calendarClient) {
      throw new CalendarServiceError(
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
          this.createCalendarClient();
        }
      } catch {
        // Continue with existing client if refresh fails
      }
    }

    return this.calendarClient;
  }

  public async getCalendars(): Promise<CalendarDisplay[]> {
    const client = await this.getClient();
    const response = await client.calendarList.list({ maxResults: 250 });
    const items = response.data.items ?? [];

    return items.map((item) => ({
      id: item.id ?? '',
      summary: item.summary ?? '(untitled)',
      description: item.description ?? undefined,
      timeZone: item.timeZone ?? undefined,
      primary: item.primary ?? false,
    }));
  }

  public async getEvents(
    calendarId: string = 'primary',
    options: GetEventsOptions = {}
  ): Promise<EventDisplay[]> {
    const client = await this.getClient();
    const response = await client.events.list({
      calendarId,
      timeMin: options.timeMin ?? new Date().toISOString(),
      timeMax: options.timeMax,
      maxResults: options.maxResults ?? 25,
      singleEvents: true,
      orderBy: 'startTime',
      q: options.query,
    });
    const items = response.data.items ?? [];

    return items.map((item) => ({
      id: item.id ?? '',
      summary: item.summary ?? '(no title)',
      description: item.description ?? undefined,
      start: item.start?.dateTime ?? item.start?.date ?? '',
      end: item.end?.dateTime ?? item.end?.date ?? '',
      location: item.location ?? undefined,
      status: item.status ?? 'confirmed',
      htmlLink: item.htmlLink ?? undefined,
      reminders: item.reminders
        ? {
            useDefault: item.reminders.useDefault ?? true,
            overrides: item.reminders.overrides?.map((o) => ({
              method: o.method ?? 'popup',
              minutes: o.minutes ?? 10,
            })),
          }
        : undefined,
    }));
  }

  public async createEvent(
    calendarId: string = 'primary',
    options: CreateEventOptions
  ): Promise<EventDisplay> {
    const client = await this.getClient();

    const requestBody: calendar_v3.Schema$Event = {
      summary: options.summary,
    };

    if (options.description) {
      requestBody.description = options.description;
    }
    if (options.location) {
      requestBody.location = options.location;
    }

    if (options.allDay) {
      requestBody.start = { date: options.start };
      requestBody.end = { date: options.end };
    } else {
      requestBody.start = { dateTime: options.start };
      requestBody.end = { dateTime: options.end };
    }

    if (options.reminders) {
      requestBody.reminders = {
        useDefault: false,
        overrides: [{ method: 'popup', minutes: options.reminders.minutes }],
      };
    }

    const response = await client.events.insert({
      calendarId,
      requestBody,
    });

    const item = response.data;
    return {
      id: item.id ?? '',
      summary: item.summary ?? '(no title)',
      description: item.description ?? undefined,
      start: item.start?.dateTime ?? item.start?.date ?? '',
      end: item.end?.dateTime ?? item.end?.date ?? '',
      location: item.location ?? undefined,
      status: item.status ?? 'confirmed',
      htmlLink: item.htmlLink ?? undefined,
    };
  }

  public async updateEvent(
    calendarId: string = 'primary',
    eventId: string,
    updates: UpdateEventOptions
  ): Promise<EventDisplay> {
    const client = await this.getClient();

    const requestBody: calendar_v3.Schema$Event = {};

    if (updates.summary !== undefined) requestBody.summary = updates.summary;
    if (updates.description !== undefined) requestBody.description = updates.description;
    if (updates.location !== undefined) requestBody.location = updates.location;
    if (updates.start !== undefined) requestBody.start = { dateTime: updates.start };
    if (updates.end !== undefined) requestBody.end = { dateTime: updates.end };

    const response = await client.events.patch({
      calendarId,
      eventId,
      requestBody,
    });

    const item = response.data;
    return {
      id: item.id ?? '',
      summary: item.summary ?? '(no title)',
      description: item.description ?? undefined,
      start: item.start?.dateTime ?? item.start?.date ?? '',
      end: item.end?.dateTime ?? item.end?.date ?? '',
      location: item.location ?? undefined,
      status: item.status ?? 'confirmed',
      htmlLink: item.htmlLink ?? undefined,
    };
  }

  public async deleteEvent(
    calendarId: string = 'primary',
    eventId: string
  ): Promise<void> {
    const client = await this.getClient();
    await client.events.delete({
      calendarId,
      eventId,
    });
  }
}

export function getCalendarService(config?: CalendarServiceConfig): CalendarService {
  return CalendarService.getInstance(config);
}

export { CalendarService };
