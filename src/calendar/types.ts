/**
 * Type definitions for Google Calendar
 */

export interface CalendarDisplay {
  id: string;
  summary: string;
  description?: string;
  timeZone?: string;
  primary?: boolean;
}

export interface EventDisplay {
  id: string;
  summary: string;
  description?: string;
  start: string;
  end: string;
  location?: string;
  status: string;
  htmlLink?: string;
  reminders?: {
    useDefault: boolean;
    overrides?: Array<{ method: string; minutes: number }>;
  };
}
