/**
 * Search emails command
 * Search emails using Gmail query syntax with common shortcuts
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
 * Search command output for JSON format
 */
interface SearchOutput {
  query: string;
  emails: EmailDisplay[];
  count: number;
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

/**
 * Count-only output for JSON format
 */
interface CountOutput {
  query: string;
  count: number;
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
    return dateStr.slice(0, 10);
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
 * Build Gmail search query from user input and filter options
 */
function buildQuery(
  baseQuery: string,
  options: {
    from?: string;
    to?: string;
    subject?: string;
    hasAttachment?: boolean;
  }
): string {
  const queryParts: string[] = [];

  // Add base query if provided (not empty)
  if (baseQuery && baseQuery.trim()) {
    queryParts.push(baseQuery.trim());
  }

  // Add from filter
  if (options.from) {
    queryParts.push(`from:${options.from}`);
  }

  // Add to filter
  if (options.to) {
    queryParts.push(`to:${options.to}`);
  }

  // Add subject filter
  if (options.subject) {
    queryParts.push(`subject:${options.subject}`);
  }

  // Add attachment filter
  if (options.hasAttachment) {
    queryParts.push('has:attachment');
  }

  return queryParts.join(' ');
}

/**
 * Search command options
 */
interface SearchOptions {
  limit: string;
  from?: string;
  to?: string;
  subject?: string;
  hasAttachment?: boolean;
  count?: boolean;
  json?: boolean;
  pageToken?: string;
  all?: boolean;
}

/**
 * Create the search command
 */
export function createSearchCommand(): Command {
  const search = new Command('search')
    .description('Search emails using Gmail query syntax')
    .argument('[query]', 'Gmail search query (e.g., "is:unread", "from:alice")', '')
    .option('-l, --limit <number>', 'Maximum results to return', '20')
    .option('--from <email>', 'Filter by sender email')
    .option('--to <email>', 'Filter by recipient email')
    .option('--subject <text>', 'Filter by subject text')
    .option('--has-attachment', 'Only emails with attachments')
    .option('-c, --count', 'Show only the count of matching emails')
    .option('--json', 'Output as JSON')
    .option('-p, --page-token <token>', 'Pagination token for next page')
    .option('--all', 'Search all emails (default: inbox only)')
    .action(async (query: string, options: SearchOptions, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals<GlobalOptions>();

      if (globalOpts.verbose) {
        console.log('Search options:', { query, ...options, config: globalOpts.config });
      }

      try {
        // Build the final query from base query and shortcut options
        const inboxOnly = !options.all;
        let finalQuery = buildQuery(query, {
          from: options.from,
          to: options.to,
          subject: options.subject,
          hasAttachment: options.hasAttachment,
        });

        // Add inbox filter unless --all is specified
        if (inboxOnly && finalQuery) {
          finalQuery = `in:inbox ${finalQuery}`;
        } else if (inboxOnly) {
          finalQuery = 'in:inbox';
        }

        if (!finalQuery) {
          console.error('Error: No search query provided.');
          console.error('Usage: gmail-connector search <query>');
          console.error('       gmail-connector search --from user@example.com');
          console.error('       gmail-connector search "is:unread from:alice"');
          process.exit(EXIT_CODES.INVALID_ARGUMENT);
        }

        if (globalOpts.verbose) {
          console.log(`Final search query: "${finalQuery}"`);
        }

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
          console.log(`Searching for up to ${limit} messages...`);
        }

        // Search messages
        const searchResponse = await messages.list({
          userId: 'me',
          q: finalQuery,
          maxResults: options.count ? 1 : limit,
          pageToken: options.pageToken,
        });

        const messageList = searchResponse.data.messages ?? [];
        const nextPageToken = searchResponse.data.nextPageToken;
        const resultSizeEstimate = searchResponse.data.resultSizeEstimate ?? 0;

        // Handle count-only mode
        if (options.count) {
          if (options.json) {
            const output: CountOutput = {
              query: finalQuery,
              count: resultSizeEstimate,
              resultSizeEstimate,
            };
            console.log(JSON.stringify(output, null, 2));
          } else {
            console.log(`Found approximately ${resultSizeEstimate} emails matching: "${finalQuery}"`);
          }
          process.exit(EXIT_CODES.SUCCESS);
        }

        // No results
        if (messageList.length === 0) {
          if (options.json) {
            const output: SearchOutput = {
              query: finalQuery,
              emails: [],
              count: 0,
              nextPageToken: nextPageToken ?? undefined,
              resultSizeEstimate,
            };
            console.log(JSON.stringify(output, null, 2));
          } else {
            console.log(`No emails found matching: "${finalQuery}"`);
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
          const output: SearchOutput = {
            query: finalQuery,
            emails: emailDetails,
            count: emailDetails.length,
            nextPageToken: nextPageToken ?? undefined,
            resultSizeEstimate,
          };
          console.log(JSON.stringify(output, null, 2));
        } else {
          // Calculate column widths for table display
          const widths = {
            date: 12,
            from: 30,
            subject: 50,
          };

          // Print search info
          console.log(`Search results for: "${finalQuery}"`);
          console.log('');

          // Print header
          console.log(formatRow('DATE', 'FROM', 'SUBJECT', widths));
          console.log('-'.repeat(widths.date + widths.from + widths.subject + 4));

          // Print emails
          for (const email of emailDetails) {
            console.log(formatRow(email.date, email.from, email.subject, widths));
          }

          // Print pagination info
          console.log('');
          console.log(`Showing ${emailDetails.length} of ~${resultSizeEstimate} emails.`);
          if (nextPageToken) {
            console.log(`Next page token: ${nextPageToken}`);
            console.log(
              `To see more: gmail-connector search "${finalQuery}" --page-token "${nextPageToken}"`
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
    });

  return search;
}
