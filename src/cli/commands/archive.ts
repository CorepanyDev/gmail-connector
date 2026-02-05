/**
 * Archive command
 * Archive emails by removing the INBOX label
 */

import { Command } from 'commander';
import type { gmail_v1 } from 'googleapis';
import { getGmailService, GmailServiceError } from '../../gmail';
import type { GlobalOptions } from '../types';
import { EXIT_CODES } from '../types';
import { createProgressBar } from '../utils';

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
 * Archive messages by removing the INBOX label
 */
async function archiveMessages(
  messageIds: string[],
  messages: gmail_v1.Resource$Users$Messages,
  verbose: boolean
): Promise<{ success: number; failed: number }> {
  let success = 0;
  let failed = 0;
  const batchSize = 10;
  const inboxLabelId = 'INBOX';

  // Create progress bar for bulk operations
  const progress = createProgressBar({ verbose, threshold: 20, showEta: true });
  progress.start(messageIds.length, 'Archiving messages');

  for (let i = 0; i < messageIds.length; i += batchSize) {
    const batch = messageIds.slice(i, i + batchSize);

    const promises = batch.map(async (messageId) => {
      try {
        await messages.modify({
          userId: 'me',
          id: messageId,
          requestBody: {
            removeLabelIds: [inboxLabelId],
          },
        });
        return true;
      } catch (err) {
        if (verbose) {
          const errMsg = err instanceof Error ? err.message : 'Unknown error';
          console.error(`  Failed to archive message ${messageId}: ${errMsg}`);
        }
        return false;
      }
    });

    const results = await Promise.all(promises);
    success += results.filter(Boolean).length;
    failed += results.filter((r) => !r).length;

    progress.update(Math.min(i + batchSize, messageIds.length));
  }

  progress.stop();

  return { success, failed };
}

/**
 * Archive command options
 */
interface ArchiveOptions {
  id?: string;
  ids?: string;
  query?: string;
  dryRun?: boolean;
}

/**
 * Create the archive command
 */
export function createArchiveCommand(): Command {
  const archive = new Command('archive')
    .description('Archive emails by removing them from inbox')
    .option('--id <message-id>', 'Archive a single message')
    .option('--ids <id1,id2,...>', 'Archive multiple messages (comma-separated)')
    .option('--query <search-query>', 'Archive all messages matching Gmail search query')
    .option('--dry-run', 'Preview without making changes')
    .action(async (options: ArchiveOptions, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals<GlobalOptions>();

      if (globalOpts.verbose) {
        console.log('Archive options:', { ...options, config: globalOpts.config });
      }

      try {
        // Validate input - must have at least one target
        if (!options.id && !options.ids && !options.query) {
          console.error('Error: Must specify at least one of: --id, --ids, or --query');
          console.error('');
          console.error('Examples:');
          console.error('  gmail-connector archive --id MESSAGE_ID');
          console.error('  gmail-connector archive --ids ID1,ID2,ID3');
          console.error('  gmail-connector archive --query "from:newsletter@example.com"');
          console.error('');
          console.error('Use --dry-run to preview without making changes.');
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
          console.log('No messages found to archive.');
          process.exit(EXIT_CODES.SUCCESS);
        }

        // Dry run mode - just preview
        if (options.dryRun) {
          console.log(`Dry run: Would archive ${messageIds.length} message(s)`);
          if (globalOpts.verbose) {
            console.log('Message IDs:');
            messageIds.forEach((id) => console.log(`  - ${id}`));
          }
          process.exit(EXIT_CODES.SUCCESS);
        }

        if (globalOpts.verbose) {
          console.log(`Archiving ${messageIds.length} message(s)...`);
        }

        // Archive the messages
        const result = await archiveMessages(messageIds, messages, globalOpts.verbose);

        // Report results
        if (result.success > 0) {
          console.log(`Successfully archived ${result.success} message(s).`);
        }
        if (result.failed > 0) {
          console.error(`Failed to archive ${result.failed} message(s).`);
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

  return archive;
}
