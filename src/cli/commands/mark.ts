/**
 * Mark read/unread command
 * Change the read status of emails
 */

import { Command } from 'commander';
import type { gmail_v1 } from 'googleapis';
import { getGmailService, GmailServiceError } from '../../gmail';
import type { GlobalOptions } from '../types';
import { EXIT_CODES } from '../types';

/**
 * Get message IDs from various input methods
 */
async function getMessageIds(
  options: { id?: string; ids?: string; query?: string },
  messages: gmail_v1.Resource$Users$Messages,
  verbose: boolean
): Promise<string[]> {
  const messageIds: string[] = [];

  // Single message ID
  if (options.id) {
    messageIds.push(options.id);
  }

  // Multiple message IDs (comma-separated)
  if (options.ids) {
    const ids = options.ids.split(',').map((id) => id.trim()).filter(Boolean);
    messageIds.push(...ids);
  }

  // Search query - fetch all matching message IDs
  if (options.query) {
    if (verbose) {
      console.log(`Searching for messages matching: "${options.query}"`);
    }

    let pageToken: string | undefined;
    let fetchedCount = 0;

    do {
      const response = await messages.list({
        userId: 'me',
        q: options.query,
        maxResults: 500,
        pageToken,
      });

      const msgList = response.data.messages ?? [];
      for (const msg of msgList) {
        if (msg.id) {
          messageIds.push(msg.id);
          fetchedCount++;
        }
      }

      pageToken = response.data.nextPageToken ?? undefined;

      if (verbose && pageToken) {
        console.log(`  Fetched ${fetchedCount} message IDs, continuing...`);
      }
    } while (pageToken);

    if (verbose) {
      console.log(`Found ${fetchedCount} messages matching query`);
    }
  }

  return messageIds;
}

/**
 * Mark messages as read by removing the UNREAD label
 */
async function markAsRead(
  messageIds: string[],
  messages: gmail_v1.Resource$Users$Messages,
  verbose: boolean
): Promise<{ success: number; failed: number }> {
  let success = 0;
  let failed = 0;
  const batchSize = 10;
  const unreadLabelId = 'UNREAD';

  for (let i = 0; i < messageIds.length; i += batchSize) {
    const batch = messageIds.slice(i, i + batchSize);

    const promises = batch.map(async (messageId) => {
      try {
        await messages.modify({
          userId: 'me',
          id: messageId,
          requestBody: {
            removeLabelIds: [unreadLabelId],
          },
        });
        return true;
      } catch (err) {
        if (verbose) {
          const errMsg = err instanceof Error ? err.message : 'Unknown error';
          console.error(`  Failed to mark message ${messageId} as read: ${errMsg}`);
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
 * Mark messages as unread by adding the UNREAD label
 */
async function markAsUnread(
  messageIds: string[],
  messages: gmail_v1.Resource$Users$Messages,
  verbose: boolean
): Promise<{ success: number; failed: number }> {
  let success = 0;
  let failed = 0;
  const batchSize = 10;
  const unreadLabelId = 'UNREAD';

  for (let i = 0; i < messageIds.length; i += batchSize) {
    const batch = messageIds.slice(i, i + batchSize);

    const promises = batch.map(async (messageId) => {
      try {
        await messages.modify({
          userId: 'me',
          id: messageId,
          requestBody: {
            addLabelIds: [unreadLabelId],
          },
        });
        return true;
      } catch (err) {
        if (verbose) {
          const errMsg = err instanceof Error ? err.message : 'Unknown error';
          console.error(`  Failed to mark message ${messageId} as unread: ${errMsg}`);
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
 * Mark command options
 */
interface MarkOptions {
  id?: string;
  ids?: string;
  query?: string;
}

/**
 * Create mark read subcommand
 */
function createMarkReadCommand(): Command {
  const read = new Command('read')
    .description('Mark emails as read')
    .option('--id <message-id>', 'Mark a single message as read')
    .option('--ids <id1,id2,...>', 'Mark multiple messages as read (comma-separated)')
    .option('--query <search-query>', 'Mark all messages matching Gmail search query as read')
    .action(async (options: MarkOptions, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals<GlobalOptions>();

      if (globalOpts.verbose) {
        console.log('Mark read options:', { ...options, config: globalOpts.config });
      }

      try {
        // Validate input - must have at least one target
        if (!options.id && !options.ids && !options.query) {
          console.error('Error: Must specify at least one of: --id, --ids, or --query');
          console.error('');
          console.error('Examples:');
          console.error('  gmail-connector mark read --id MESSAGE_ID');
          console.error('  gmail-connector mark read --ids ID1,ID2,ID3');
          console.error('  gmail-connector mark read --query "is:unread from:example@test.com"');
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
        const messages = await gmail.getMessages();

        // Get message IDs
        const messageIds = await getMessageIds(options, messages, globalOpts.verbose);

        if (messageIds.length === 0) {
          console.log('No messages found to mark as read.');
          process.exit(EXIT_CODES.SUCCESS);
        }

        if (globalOpts.verbose) {
          console.log(`Marking ${messageIds.length} message(s) as read...`);
        }

        // Mark as read
        const result = await markAsRead(messageIds, messages, globalOpts.verbose);

        // Report results
        if (result.success > 0) {
          console.log(`Successfully marked ${result.success} message(s) as read.`);
        }
        if (result.failed > 0) {
          console.error(`Failed to mark ${result.failed} message(s) as read.`);
          process.exit(EXIT_CODES.ERROR);
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

  return read;
}

/**
 * Create mark unread subcommand
 */
function createMarkUnreadCommand(): Command {
  const unread = new Command('unread')
    .description('Mark emails as unread')
    .option('--id <message-id>', 'Mark a single message as unread')
    .option('--ids <id1,id2,...>', 'Mark multiple messages as unread (comma-separated)')
    .option('--query <search-query>', 'Mark all messages matching Gmail search query as unread')
    .action(async (options: MarkOptions, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals<GlobalOptions>();

      if (globalOpts.verbose) {
        console.log('Mark unread options:', { ...options, config: globalOpts.config });
      }

      try {
        // Validate input - must have at least one target
        if (!options.id && !options.ids && !options.query) {
          console.error('Error: Must specify at least one of: --id, --ids, or --query');
          console.error('');
          console.error('Examples:');
          console.error('  gmail-connector mark unread --id MESSAGE_ID');
          console.error('  gmail-connector mark unread --ids ID1,ID2,ID3');
          console.error('  gmail-connector mark unread --query "from:important@company.com"');
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
        const messages = await gmail.getMessages();

        // Get message IDs
        const messageIds = await getMessageIds(options, messages, globalOpts.verbose);

        if (messageIds.length === 0) {
          console.log('No messages found to mark as unread.');
          process.exit(EXIT_CODES.SUCCESS);
        }

        if (globalOpts.verbose) {
          console.log(`Marking ${messageIds.length} message(s) as unread...`);
        }

        // Mark as unread
        const result = await markAsUnread(messageIds, messages, globalOpts.verbose);

        // Report results
        if (result.success > 0) {
          console.log(`Successfully marked ${result.success} message(s) as unread.`);
        }
        if (result.failed > 0) {
          console.error(`Failed to mark ${result.failed} message(s) as unread.`);
          process.exit(EXIT_CODES.ERROR);
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

  return unread;
}

/**
 * Create the mark command with read/unread subcommands
 */
export function createMarkCommand(): Command {
  const mark = new Command('mark')
    .description('Mark emails as read or unread');

  mark.addCommand(createMarkReadCommand());
  mark.addCommand(createMarkUnreadCommand());

  return mark;
}
