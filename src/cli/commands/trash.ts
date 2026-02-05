/**
 * Trash command
 * Move emails to trash with safety confirmations
 */

import { Command } from 'commander';
import * as readline from 'readline';
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
 * Move messages to trash
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
 * Trash command options
 */
interface TrashOptions {
  id?: string;
  ids?: string;
  query?: string;
  dryRun?: boolean;
  yes?: boolean;
}

/**
 * Create the trash command
 */
export function createTrashCommand(): Command {
  const trash = new Command('trash')
    .description('Move emails to trash');

  // Main trash action (move to trash)
  trash
    .option('--id <message-id>', 'Trash a single message')
    .option('--ids <id1,id2,...>', 'Trash multiple messages (comma-separated)')
    .option('--query <search-query>', 'Trash all messages matching Gmail search query')
    .option('--dry-run', 'Preview without making changes')
    .option('-y, --yes', 'Skip confirmation prompts')
    .action(async (options: TrashOptions, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals<GlobalOptions>();

      if (globalOpts.verbose) {
        console.log('Trash options:', { ...options, config: globalOpts.config });
      }

      try {
        // Validate input - must have at least one target
        if (!options.id && !options.ids && !options.query) {
          console.error('Error: Must specify at least one of: --id, --ids, or --query');
          console.error('');
          console.error('Examples:');
          console.error('  gmail-connector trash --id MESSAGE_ID');
          console.error('  gmail-connector trash --ids ID1,ID2,ID3');
          console.error('  gmail-connector trash --query "from:spam@example.com"');
          console.error('');
          console.error('Use --dry-run to preview without making changes.');
          console.error('Use --yes to skip confirmation prompts.');
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
          console.log('No messages found to trash.');
          process.exit(EXIT_CODES.SUCCESS);
        }

        // Dry run mode - just preview
        if (options.dryRun) {
          console.log(`Dry run: Would trash ${messageIds.length} message(s)`);
          if (globalOpts.verbose) {
            console.log('Message IDs:');
            messageIds.forEach((id) => console.log(`  - ${id}`));
          }
          process.exit(EXIT_CODES.SUCCESS);
        }

        // Confirmation for bulk operations (>10 emails)
        if (messageIds.length > 10 && !options.yes) {
          console.log(`\nWarning: You are about to trash ${messageIds.length} message(s).`);
          console.log('Trashed messages can be recovered from the Trash folder for 30 days.');

          const confirmed = await askConfirmation('Do you want to proceed?');
          if (!confirmed) {
            console.log('Operation cancelled.');
            process.exit(EXIT_CODES.SUCCESS);
          }
        }

        if (globalOpts.verbose) {
          console.log(`Trashing ${messageIds.length} message(s)...`);
        }

        // Trash the messages
        const result = await trashMessages(messageIds, messages, globalOpts.verbose);

        // Report results
        if (result.success > 0) {
          console.log(`Successfully trashed ${result.success} message(s).`);
        }
        if (result.failed > 0) {
          console.error(`Failed to trash ${result.failed} message(s).`);
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

  return trash;
}
