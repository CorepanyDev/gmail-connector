/**
 * List emails command
 * Lists inbox emails with pagination and formatting options
 */

import { Command } from 'commander';
import type { gmail_v1 } from 'googleapis';
import { getGmailService, GmailServiceError } from '../../gmail';
import type { GlobalOptions } from '../types';
import { EXIT_CODES } from '../types';

/**
 * Email display data structure
 */
interface EmailDisplay {
  id: string;
  date: string;
  from: string;
  subject: string;
}

/**
 * List command output for JSON format
 */
interface ListOutput {
  emails: EmailDisplay[];
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

/**
 * Extract header value from message headers
 */
function getHeader(
  headers: gmail_v1.Schema$MessagePartHeader[] | undefined,
  name: string
): string {
  if (!headers) return '';
  const header = headers.find((h) => h.name?.toLowerCase() === name.toLowerCase());
  return header?.value ?? '';
}

/**
 * Parse email address from header value (extracts just the email if formatted as "Name <email>")
 */
function parseFromAddress(from: string): string {
  // Handle "Name <email>" format
  const match = from.match(/<([^>]+)>/);
  if (match) {
    return match[1];
  }
  return from;
}

/**
 * Format date for display
 */
function formatDate(dateStr: string): string {
  if (!dateStr) return 'Unknown';
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    const isThisYear = date.getFullYear() === now.getFullYear();

    if (isToday) {
      return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    } else if (isThisYear) {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } else {
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    }
  } catch {
    return dateStr.slice(0, 10); // Fallback to first 10 chars
  }
}

/**
 * Truncate string to specified length
 */
function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}

/**
 * Format a table row with fixed column widths
 */
function formatRow(
  date: string,
  from: string,
  subject: string,
  widths: { date: number; from: number; subject: number }
): string {
  const paddedDate = date.padEnd(widths.date);
  const paddedFrom = truncate(from, widths.from).padEnd(widths.from);
  const truncatedSubject = truncate(subject, widths.subject);
  return `${paddedDate}  ${paddedFrom}  ${truncatedSubject}`;
}

/**
 * Extract display data from a Gmail message
 */
function extractEmailDisplay(message: gmail_v1.Schema$Message): EmailDisplay {
  const headers = message.payload?.headers;
  const dateStr = getHeader(headers, 'Date');
  const fromRaw = getHeader(headers, 'From');
  const subject = getHeader(headers, 'Subject') || '(no subject)';

  return {
    id: message.id ?? '',
    date: formatDate(dateStr),
    from: parseFromAddress(fromRaw),
    subject,
  };
}

/**
 * Create the list command
 */
export function createListCommand(): Command {
  const list = new Command('list')
    .description('List inbox emails')
    .option('-l, --limit <number>', 'Number of emails to show', '20')
    .option('-p, --page-token <token>', 'Pagination token for next page')
    .option('--json', 'Output as JSON')
    .action(
      async (
        options: { limit: string; pageToken?: string; json?: boolean },
        cmd: Command
      ) => {
        const globalOpts = cmd.optsWithGlobals<GlobalOptions>();

        if (globalOpts.verbose) {
          console.log('List options:', { ...options, config: globalOpts.config });
        }

        try {
          // Get Gmail service
          const gmail = getGmailService({
            credentialsPath: globalOpts.config,
            verbose: globalOpts.verbose,
          });

          // Check authentication
          const isAuthenticated = await gmail.isAuthenticated();
          if (!isAuthenticated) {
            console.error(
              'Error: Not authenticated. Please run: gmail-connector auth login'
            );
            process.exit(EXIT_CODES.AUTHENTICATION_REQUIRED);
          }

          // Parse limit
          const limit = parseInt(options.limit, 10);
          if (isNaN(limit) || limit < 1 || limit > 500) {
            console.error('Error: --limit must be a number between 1 and 500');
            process.exit(EXIT_CODES.INVALID_ARGUMENT);
          }

          // Get messages resource
          const messages = await gmail.getMessages();

          if (globalOpts.verbose) {
            console.log(`Fetching up to ${limit} messages from inbox...`);
          }

          // List messages in inbox
          const listResponse = await messages.list({
            userId: 'me',
            labelIds: ['INBOX'],
            maxResults: limit,
            pageToken: options.pageToken,
          });

          const messageList = listResponse.data.messages ?? [];
          const nextPageToken = listResponse.data.nextPageToken;
          const resultSizeEstimate = listResponse.data.resultSizeEstimate;

          if (messageList.length === 0) {
            if (options.json) {
              console.log(
                JSON.stringify({ emails: [], nextPageToken, resultSizeEstimate }, null, 2)
              );
            } else {
              console.log('No emails found in inbox.');
            }
            process.exit(EXIT_CODES.SUCCESS);
          }

          if (globalOpts.verbose) {
            console.log(`Found ${messageList.length} messages, fetching details...`);
          }

          // Fetch full details for each message (in parallel with batching)
          const emailDetails: EmailDisplay[] = [];
          const batchSize = 10;

          for (let i = 0; i < messageList.length; i += batchSize) {
            const batch = messageList.slice(i, i + batchSize);
            const detailPromises = batch.map(async (msg) => {
              if (!msg.id) return null;
              const detail = await messages.get({
                userId: 'me',
                id: msg.id,
                format: 'metadata',
                metadataHeaders: ['Date', 'From', 'Subject'],
              });
              return extractEmailDisplay(detail.data);
            });

            const batchResults = await Promise.all(detailPromises);
            emailDetails.push(
              ...batchResults.filter((e): e is EmailDisplay => e !== null)
            );
          }

          // Output based on format
          if (options.json) {
            const output: ListOutput = {
              emails: emailDetails,
              nextPageToken: nextPageToken ?? undefined,
              resultSizeEstimate: resultSizeEstimate ?? undefined,
            };
            console.log(JSON.stringify(output, null, 2));
          } else {
            // Calculate column widths for table display
            const widths = {
              date: 12,
              from: 30,
              subject: 50,
            };

            // Print header
            console.log(formatRow('DATE', 'FROM', 'SUBJECT', widths));
            console.log('-'.repeat(widths.date + widths.from + widths.subject + 4));

            // Print emails
            for (const email of emailDetails) {
              console.log(formatRow(email.date, email.from, email.subject, widths));
            }

            // Print pagination info
            console.log('');
            console.log(`Showing ${emailDetails.length} emails.`);
            if (nextPageToken) {
              console.log(`Next page token: ${nextPageToken}`);
              console.log(
                `To see more: gmail-connector list --page-token "${nextPageToken}"`
              );
            }
          }

          process.exit(EXIT_CODES.SUCCESS);
        } catch (err) {
          if (err instanceof GmailServiceError) {
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
      }
    );

  return list;
}
