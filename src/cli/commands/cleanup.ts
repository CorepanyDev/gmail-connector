/**
 * Cleanup commands
 * Find large emails and old emails for inbox cleanup
 */

import { Command } from 'commander';
import * as readline from 'readline';
import type { gmail_v1 } from 'googleapis';
import { getGmailService, GmailServiceError } from '../../gmail';
import type { GlobalOptions } from '../types';
import { EXIT_CODES } from '../types';

/**
 * Parse size string to bytes
 * Supports: B, KB, MB, GB (case insensitive)
 */
function parseSize(sizeStr: string): number {
  const match = sizeStr.toUpperCase().match(/^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB)?$/);
  if (!match) {
    throw new Error(`Invalid size format: ${sizeStr}. Use format like "5MB", "10KB", or "1GB"`);
  }

  const value = parseFloat(match[1]);
  const unit = match[2] || 'B';

  const multipliers: Record<string, number> = {
    B: 1,
    KB: 1024,
    MB: 1024 * 1024,
    GB: 1024 * 1024 * 1024,
  };

  return Math.floor(value * multipliers[unit]);
}

/**
 * Format bytes to human-readable size
 */
function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  } else if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  } else if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(2)} KB`;
  }
  return `${bytes} B`;
}

/**
 * Format date for display
 */
function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const emailDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (emailDate.getTime() === today.getTime()) {
    // Today - show time
    return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  } else if (emailDate.getFullYear() === now.getFullYear()) {
    // This year - show month and day
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } else {
    // Different year - show full date
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }
}

/**
 * Truncate string to specified length
 */
function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) {
    return str;
  }
  return str.slice(0, maxLength - 3) + '...';
}

/**
 * Get header value from message headers
 */
function getHeader(headers: gmail_v1.Schema$MessagePartHeader[] | undefined, name: string): string {
  if (!headers) return '';
  const header = headers.find((h) => h.name?.toLowerCase() === name.toLowerCase());
  return header?.value ?? '';
}

/**
 * Extract email address from "Name <email>" format
 */
function extractEmail(from: string): string {
  const match = from.match(/<([^>]+)>/);
  if (match) {
    return match[1];
  }
  return from;
}

/**
 * Ask for user confirmation via readline
 */
async function askConfirmation(prompt: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${prompt} (y/N): `, (answer) => {
      rl.close();
      const normalized = answer.trim().toLowerCase();
      resolve(normalized === 'y' || normalized === 'yes');
    });
  });
}

/**
 * Trash messages with batch processing
 */
async function trashMessages(
  messageIds: string[],
  messages: gmail_v1.Resource$Users$Messages,
  verbose: boolean
): Promise<{ success: number; failed: number }> {
  let success = 0;
  let failed = 0;
  const batchSize = 10;

  for (let i = 0; i < messageIds.length; i += batchSize) {
    const batch = messageIds.slice(i, i + batchSize);

    const promises = batch.map(async (messageId) => {
      try {
        await messages.trash({
          userId: 'me',
          id: messageId,
        });
        return true;
      } catch (err) {
        if (verbose) {
          const errMsg = err instanceof Error ? err.message : 'Unknown error';
          console.error(`  Failed to trash message ${messageId}: ${errMsg}`);
        }
        return false;
      }
    });

    const results = await Promise.all(promises);
    success += results.filter(Boolean).length;
    failed += results.filter((r) => !r).length;

    // Show progress for large operations
    if (messageIds.length > 20 && (i + batchSize) % 50 === 0) {
      const progress = Math.min(i + batchSize, messageIds.length);
      console.log(`  Progress: ${progress}/${messageIds.length} messages processed`);
    }
  }

  return { success, failed };
}

/**
 * Message details for display
 */
interface MessageDetails {
  id: string;
  from: string;
  subject: string;
  date: string;
  size: number;
}

/**
 * Cleanup large command options
 */
interface CleanupLargeOptions {
  largerThan: string;
  limit?: string;
  delete?: boolean;
  yes?: boolean;
}

/**
 * Create the cleanup command with subcommands
 */
export function createCleanupCommand(): Command {
  const cleanup = new Command('cleanup')
    .description('Find and clean up emails (large, old, etc.)');

  // Cleanup large subcommand
  cleanup
    .command('large')
    .description('Find large emails for cleanup')
    .option('--larger-than <size>', 'Minimum size (e.g., 5MB, 10MB, 1GB)', '5MB')
    .option('--limit <count>', 'Maximum number of results to show', '50')
    .option('--delete', 'Trash found emails (with confirmation)')
    .option('-y, --yes', 'Skip confirmation when using --delete')
    .action(async (options: CleanupLargeOptions, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals<GlobalOptions>();

      if (globalOpts.verbose) {
        console.log('Cleanup large options:', { ...options, config: globalOpts.config });
      }

      try {
        // Parse size threshold
        let sizeThreshold: number;
        try {
          sizeThreshold = parseSize(options.largerThan);
        } catch (err) {
          console.error(`Error: ${err instanceof Error ? err.message : 'Invalid size'}`);
          console.error('');
          console.error('Examples of valid sizes:');
          console.error('  --larger-than 5MB');
          console.error('  --larger-than 10MB');
          console.error('  --larger-than 1GB');
          console.error('  --larger-than 500KB');
          process.exit(EXIT_CODES.INVALID_ARGUMENT);
        }

        // Parse limit
        const limit = parseInt(options.limit ?? '50', 10);
        if (isNaN(limit) || limit < 1) {
          console.error('Error: --limit must be a positive integer');
          process.exit(EXIT_CODES.INVALID_ARGUMENT);
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

        // Get messages resource
        const messagesApi = await gmail.getMessages();

        // Search for large emails using Gmail size operator
        const sizeQuery = `larger:${sizeThreshold}`;
        if (globalOpts.verbose) {
          console.log(`Searching with query: "${sizeQuery}"`);
          console.log(`Size threshold: ${formatSize(sizeThreshold)}`);
        }

        console.log(`Finding emails larger than ${formatSize(sizeThreshold)}...`);

        // Fetch message IDs matching size criteria
        let pageToken: string | undefined;
        const messageIds: string[] = [];
        const maxToFetch = limit * 2; // Fetch extra in case some fail to get details

        do {
          const response = await messagesApi.list({
            userId: 'me',
            q: sizeQuery,
            maxResults: Math.min(500, maxToFetch - messageIds.length),
            pageToken,
          });

          const msgList = response.data.messages ?? [];
          for (const msg of msgList) {
            if (msg.id) {
              messageIds.push(msg.id);
            }
          }

          pageToken = response.data.nextPageToken ?? undefined;

          if (globalOpts.verbose && pageToken) {
            console.log(`  Fetched ${messageIds.length} message IDs, continuing...`);
          }
        } while (pageToken && messageIds.length < maxToFetch);

        if (messageIds.length === 0) {
          console.log(`No emails found larger than ${formatSize(sizeThreshold)}.`);
          process.exit(EXIT_CODES.SUCCESS);
        }

        if (globalOpts.verbose) {
          console.log(`Found ${messageIds.length} candidate messages, fetching details...`);
        }

        // Fetch message details in batches
        const messageDetails: MessageDetails[] = [];
        const batchSize = 10;

        for (let i = 0; i < Math.min(messageIds.length, maxToFetch); i += batchSize) {
          const batch = messageIds.slice(i, i + batchSize);

          const promises = batch.map(async (messageId) => {
            try {
              const response = await messagesApi.get({
                userId: 'me',
                id: messageId,
                format: 'metadata',
                metadataHeaders: ['From', 'Subject', 'Date'],
              });

              const msg = response.data;
              const headers = msg.payload?.headers;
              const size = msg.sizeEstimate ?? 0;

              // Double check size threshold (Gmail size: can be approximate)
              if (size < sizeThreshold) {
                return null;
              }

              return {
                id: messageId,
                from: extractEmail(getHeader(headers, 'From')),
                subject: getHeader(headers, 'Subject') || '(no subject)',
                date: getHeader(headers, 'Date'),
                size,
              };
            } catch {
              return null;
            }
          });

          const results = await Promise.all(promises);
          for (const result of results) {
            if (result) {
              messageDetails.push(result);
            }
          }

          if (globalOpts.verbose && i > 0 && i % 50 === 0) {
            console.log(`  Processed ${i}/${messageIds.length} messages...`);
          }
        }

        // Sort by size descending
        messageDetails.sort((a, b) => b.size - a.size);

        // Take only up to limit
        const displayMessages = messageDetails.slice(0, limit);

        if (displayMessages.length === 0) {
          console.log(`No emails found larger than ${formatSize(sizeThreshold)}.`);
          process.exit(EXIT_CODES.SUCCESS);
        }

        // Display results
        console.log('');
        console.log(`Found ${displayMessages.length} large email(s):`);
        console.log('');

        // Table header
        const colWidths = { from: 30, subject: 40, date: 12, size: 12 };
        const headerLine = [
          'FROM'.padEnd(colWidths.from),
          'SUBJECT'.padEnd(colWidths.subject),
          'DATE'.padEnd(colWidths.date),
          'SIZE'.padStart(colWidths.size),
        ].join('  ');

        console.log(headerLine);
        console.log('─'.repeat(headerLine.length));

        // Table rows
        for (const msg of displayMessages) {
          const row = [
            truncate(msg.from, colWidths.from).padEnd(colWidths.from),
            truncate(msg.subject, colWidths.subject).padEnd(colWidths.subject),
            formatDate(msg.date).padEnd(colWidths.date),
            formatSize(msg.size).padStart(colWidths.size),
          ].join('  ');
          console.log(row);
        }

        console.log('');

        // Calculate total size
        const totalSize = displayMessages.reduce((sum, msg) => sum + msg.size, 0);
        console.log(`Total size: ${formatSize(totalSize)}`);

        // Handle --delete flag
        if (options.delete) {
          console.log('');

          // Confirmation (unless --yes)
          if (!options.yes && displayMessages.length > 1) {
            const confirmed = await askConfirmation(
              `Are you sure you want to trash ${displayMessages.length} email(s)?`
            );
            if (!confirmed) {
              console.log('Operation cancelled.');
              process.exit(EXIT_CODES.SUCCESS);
            }
          }

          console.log(`Trashing ${displayMessages.length} email(s)...`);

          const idsToTrash = displayMessages.map((msg) => msg.id);
          const result = await trashMessages(idsToTrash, messagesApi, globalOpts.verbose);

          if (result.success > 0) {
            console.log(`Successfully trashed ${result.success} email(s).`);
          }
          if (result.failed > 0) {
            console.error(`Failed to trash ${result.failed} email(s).`);
            process.exit(EXIT_CODES.ERROR);
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

  return cleanup;
}
