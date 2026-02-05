/**
 * Calendar commands
 * Manage Google Calendar — list calendars, list/create/update/delete events
 */

import { Command } from 'commander';
import { getCalendarService, CalendarServiceError } from '../../calendar';
import type { GlobalOptions } from '../types';
import { EXIT_CODES } from '../types';

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}

function formatDateTime(dateStr: string): string {
  if (!dateStr) return '';
  try {
    // All-day events come as date-only (YYYY-MM-DD)
    if (dateStr.length === 10) {
      const date = new Date(dateStr + 'T00:00:00');
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    }
    const date = new Date(dateStr);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return dateStr.slice(0, 19);
  }
}

export function createCalendarCommand(): Command {
  const calendar = new Command('calendar')
    .description('Manage Google Calendar');

  // --- calendar list ---
  calendar
    .command('list')
    .description('List all calendars')
    .option('--json', 'Output as JSON')
    .action(async (options: { json?: boolean }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals<GlobalOptions>();

      try {
        const service = getCalendarService({
          credentialsPath: globalOpts.config,
          verbose: globalOpts.verbose,
        });

        const isAuthenticated = await service.isAuthenticated();
        if (!isAuthenticated) {
          console.error('Error: Not authenticated. Please run: gmail-connector auth login');
          process.exit(EXIT_CODES.AUTHENTICATION_REQUIRED);
        }

        const calendars = await service.getCalendars();

        if (options.json) {
          console.log(JSON.stringify(calendars, null, 2));
        } else {
          if (calendars.length === 0) {
            console.log('No calendars found.');
            process.exit(EXIT_CODES.SUCCESS);
          }

          console.log(
            'CALENDAR'.padEnd(40) + '  ' +
            'TIME ZONE'.padEnd(25) + '  ' +
            'ID'
          );
          console.log('-'.repeat(110));
          for (const cal of calendars) {
            const name = cal.primary
              ? `${truncate(cal.summary, 37)} (*)`
              : truncate(cal.summary, 40);
            console.log(
              name.padEnd(40) + '  ' +
              (cal.timeZone ?? '').padEnd(25) + '  ' +
              cal.id
            );
          }
          console.log(`\n${calendars.length} calendar(s) found.`);
        }

        process.exit(EXIT_CODES.SUCCESS);
      } catch (err) {
        handleError(err, globalOpts);
      }
    });

  // --- calendar events ---
  calendar
    .command('events [calendarId]')
    .description('List upcoming events (default: primary calendar)')
    .option('--from <date>', 'Start date (ISO format, e.g. 2026-03-01)')
    .option('--to <date>', 'End date (ISO format)')
    .option('--limit <n>', 'Maximum number of events', '25')
    .option('--query <text>', 'Search query for events')
    .option('--json', 'Output as JSON')
    .action(
      async (
        calendarId: string | undefined,
        options: {
          from?: string;
          to?: string;
          limit?: string;
          query?: string;
          json?: boolean;
        },
        cmd: Command
      ) => {
        const globalOpts = cmd.optsWithGlobals<GlobalOptions>();

        try {
          const service = getCalendarService({
            credentialsPath: globalOpts.config,
            verbose: globalOpts.verbose,
          });

          const isAuthenticated = await service.isAuthenticated();
          if (!isAuthenticated) {
            console.error('Error: Not authenticated. Please run: gmail-connector auth login');
            process.exit(EXIT_CODES.AUTHENTICATION_REQUIRED);
          }

          const id = calendarId ?? 'primary';
          const events = await service.getEvents(id, {
            timeMin: options.from ? new Date(options.from).toISOString() : undefined,
            timeMax: options.to ? new Date(options.to).toISOString() : undefined,
            maxResults: parseInt(options.limit ?? '25', 10),
            query: options.query,
          });

          if (options.json) {
            console.log(JSON.stringify(events, null, 2));
          } else {
            if (events.length === 0) {
              console.log('No upcoming events found.');
              process.exit(EXIT_CODES.SUCCESS);
            }

            console.log(
              'WHEN'.padEnd(24) + '  ' +
              'SUMMARY'.padEnd(40) + '  ' +
              'ID'
            );
            console.log('-'.repeat(100));
            for (const event of events) {
              const when = formatDateTime(event.start);
              console.log(
                when.padEnd(24) + '  ' +
                truncate(event.summary, 40).padEnd(40) + '  ' +
                event.id
              );
            }
            console.log(`\n${events.length} event(s) found.`);
          }

          process.exit(EXIT_CODES.SUCCESS);
        } catch (err) {
          handleError(err, globalOpts);
        }
      }
    );

  // --- calendar add ---
  calendar
    .command('add <summary>')
    .description('Create a new calendar event')
    .option('--start <datetime>', 'Start date/time (ISO, e.g. 2026-03-01T14:00:00)')
    .option('--end <datetime>', 'End date/time (ISO)')
    .option('--date <date>', 'All-day event date (e.g. 2026-03-01)')
    .option('--location <text>', 'Event location')
    .option('--description <text>', 'Event description')
    .option('--calendar <id>', 'Calendar ID (default: primary)')
    .option('--reminder <minutes>', 'Reminder in minutes before event')
    .option('--json', 'Output as JSON')
    .action(
      async (
        summary: string,
        options: {
          start?: string;
          end?: string;
          date?: string;
          location?: string;
          description?: string;
          calendar?: string;
          reminder?: string;
          json?: boolean;
        },
        cmd: Command
      ) => {
        const globalOpts = cmd.optsWithGlobals<GlobalOptions>();

        try {
          const service = getCalendarService({
            credentialsPath: globalOpts.config,
            verbose: globalOpts.verbose,
          });

          const isAuthenticated = await service.isAuthenticated();
          if (!isAuthenticated) {
            console.error('Error: Not authenticated. Please run: gmail-connector auth login');
            process.exit(EXIT_CODES.AUTHENTICATION_REQUIRED);
          }

          // Validate: either --start or --date is required
          if (!options.start && !options.date) {
            console.error('Error: Provide either --start (with optional --end) or --date for an all-day event');
            process.exit(EXIT_CODES.INVALID_ARGUMENT);
          }

          const calendarId = options.calendar ?? 'primary';
          let startStr: string;
          let endStr: string;
          let allDay = false;

          if (options.date) {
            // All-day event
            allDay = true;
            startStr = options.date;
            // All-day end date is exclusive in Google Calendar API
            const endDate = new Date(options.date);
            endDate.setDate(endDate.getDate() + 1);
            endStr = endDate.toISOString().split('T')[0];
          } else {
            startStr = options.start!;
            if (options.end) {
              endStr = options.end;
            } else {
              // Default: 1 hour after start
              const startDate = new Date(options.start!);
              startDate.setHours(startDate.getHours() + 1);
              endStr = startDate.toISOString();
            }
          }

          const event = await service.createEvent(calendarId, {
            summary,
            description: options.description,
            start: startStr,
            end: endStr,
            allDay,
            location: options.location,
            reminders: options.reminder
              ? { minutes: parseInt(options.reminder, 10) }
              : undefined,
          });

          if (options.json) {
            console.log(JSON.stringify(event, null, 2));
          } else {
            console.log(`Event created: ${event.summary}`);
            console.log(`  ID: ${event.id}`);
            console.log(`  When: ${formatDateTime(event.start)} - ${formatDateTime(event.end)}`);
            if (event.location) console.log(`  Location: ${event.location}`);
            if (event.htmlLink) console.log(`  Link: ${event.htmlLink}`);
          }

          process.exit(EXIT_CODES.SUCCESS);
        } catch (err) {
          handleError(err, globalOpts);
        }
      }
    );

  // --- calendar update ---
  calendar
    .command('update <eventId>')
    .description('Update an existing calendar event')
    .option('--summary <text>', 'New summary/title')
    .option('--start <datetime>', 'New start date/time (ISO)')
    .option('--end <datetime>', 'New end date/time (ISO)')
    .option('--location <text>', 'New location')
    .option('--description <text>', 'New description')
    .option('--calendar <id>', 'Calendar ID (default: primary)')
    .option('--json', 'Output as JSON')
    .action(
      async (
        eventId: string,
        options: {
          summary?: string;
          start?: string;
          end?: string;
          location?: string;
          description?: string;
          calendar?: string;
          json?: boolean;
        },
        cmd: Command
      ) => {
        const globalOpts = cmd.optsWithGlobals<GlobalOptions>();

        try {
          const service = getCalendarService({
            credentialsPath: globalOpts.config,
            verbose: globalOpts.verbose,
          });

          const isAuthenticated = await service.isAuthenticated();
          if (!isAuthenticated) {
            console.error('Error: Not authenticated. Please run: gmail-connector auth login');
            process.exit(EXIT_CODES.AUTHENTICATION_REQUIRED);
          }

          if (
            !options.summary &&
            !options.start &&
            !options.end &&
            !options.location &&
            !options.description
          ) {
            console.error(
              'Error: Provide at least one of --summary, --start, --end, --location, or --description'
            );
            process.exit(EXIT_CODES.INVALID_ARGUMENT);
          }

          const calendarId = options.calendar ?? 'primary';
          const event = await service.updateEvent(calendarId, eventId, {
            summary: options.summary,
            start: options.start,
            end: options.end,
            location: options.location,
            description: options.description,
          });

          if (options.json) {
            console.log(JSON.stringify(event, null, 2));
          } else {
            console.log(`Event updated: ${event.summary}`);
            console.log(`  ID: ${event.id}`);
            console.log(`  When: ${formatDateTime(event.start)} - ${formatDateTime(event.end)}`);
            if (event.location) console.log(`  Location: ${event.location}`);
          }

          process.exit(EXIT_CODES.SUCCESS);
        } catch (err) {
          handleError(err, globalOpts);
        }
      }
    );

  // --- calendar delete ---
  calendar
    .command('delete <eventId>')
    .description('Delete a calendar event')
    .option('--calendar <id>', 'Calendar ID (default: primary)')
    .action(
      async (
        eventId: string,
        options: { calendar?: string },
        cmd: Command
      ) => {
        const globalOpts = cmd.optsWithGlobals<GlobalOptions>();

        try {
          const service = getCalendarService({
            credentialsPath: globalOpts.config,
            verbose: globalOpts.verbose,
          });

          const isAuthenticated = await service.isAuthenticated();
          if (!isAuthenticated) {
            console.error('Error: Not authenticated. Please run: gmail-connector auth login');
            process.exit(EXIT_CODES.AUTHENTICATION_REQUIRED);
          }

          const calendarId = options.calendar ?? 'primary';
          await service.deleteEvent(calendarId, eventId);
          console.log(`Event ${eventId} deleted.`);

          process.exit(EXIT_CODES.SUCCESS);
        } catch (err) {
          handleError(err, globalOpts);
        }
      }
    );

  return calendar;
}

function handleError(err: unknown, globalOpts: GlobalOptions): never {
  if (err instanceof CalendarServiceError) {
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
