/**
 * Calendar module for Gmail Connector
 * Provides singleton access to authenticated Google Calendar API client
 */

export {
  CalendarService,
  CalendarServiceError,
  getCalendarService,
} from './service';

export type { CalendarServiceConfig } from './service';
export type { CalendarDisplay, EventDisplay } from './types';
