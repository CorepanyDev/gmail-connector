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

  // Create progress bar for bulk operations
  const progress = createProgressBar({ verbose, threshold: 20, showEta: true });
  progress.start(messageIds.length, 'Trashing messages');

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

    progress.update(Math.min(i + batchSize, messageIds.length));
  }

  progress.stop();

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
 * Empty trash command options
 */
interface EmptyTrashOptions {
  confirm?: boolean;
}

/**
 * Get count of messages in trash
 */
async function getTrashCount(
  messages: gmail_v1.Resource$Users$Messages
): Promise<number> {
  const response = await messages.list({
    userId: 'me',
    q: 'in:trash',
    maxResults: 1,
  });
  return response.data.resultSizeEstimate ?? 0;
}

/**
 * Get all message IDs in trash
 */
async function getTrashMessageIds(
  messages: gmail_v1.Resource$Users$Messages,
  verbose: boolean
): Promise<string[]> {
  const messageIds: string[] = [];
  let pageToken: string | undefined;

  do {
    const response = await messages.list({
      userId: 'me',
      q: 'in:trash',
      maxResults: 500,
      pageToken,
    });

    const msgList = response.data.messages ?? [];
    for (const msg of msgList) {
      if (msg.id) {
        messageIds.push(msg.id);
      }
    }

    pageToken = response.data.nextPageToken ?? undefined;

    if (verbose && pageToken) {
      console.log(`  Fetched ${messageIds.length} message IDs, continuing...`);
    }
  } while (pageToken);

  return messageIds;
}

/**
 * Permanently delete messages
 */
async function deleteMessagesPermanently(
  messageIds: string[],
  messages: gmail_v1.Resource$Users$Messages,
  verbose: boolean
): Promise<{ success: number; failed: number }> {
  let success = 0;
  let failed = 0;
  const batchSize = 10;

  // Create progress bar for bulk operations
  const progress = createProgressBar({ verbose, threshold: 20, showEta: true });
  progress.start(messageIds.length, 'Deleting messages');

  for (let i = 0; i < messageIds.length; i += batchSize) {
    const batch = messageIds.slice(i, i + batchSize);

    const promises = batch.map(async (messageId) => {
      try {
        await messages.delete({
          userId: 'me',
          id: messageId,
        });
        return true;
      } catch (err) {
        if (verbose) {
          const errMsg = err instanceof Error ? err.message : 'Unknown error';
          console.error(`  Failed to delete message ${messageId}: ${errMsg}`);
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
 * Create the trash command
 */
export function createTrashCommand(): Command {
  const trash = new Command('trash')
    .description('Move emails to trash or empty trash');

  // Empty trash subcommand
  trash
    .command('empty')
    .description('Permanently delete all emails in trash')
    .option('--confirm', 'Confirm permanent deletion (required)')
    .action(async (options: EmptyTrashOptions, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals<GlobalOptions>();

      if (globalOpts.verbose) {
        console.log('Empty trash options:', { ...options, config: globalOpts.config });
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

        // Get messages resource
        const messages = await gmail.getMessages();

        // Get count of emails in trash
        const trashCount = await getTrashCount(messages);

        if (trashCount === 0) {
          console.log('Trash is empty. Nothing to delete.');
          process.exit(EXIT_CODES.SUCCESS);
        }

        console.log(`Found approximately ${trashCount} email(s) in trash.`);

        // Require explicit --confirm flag
        if (!options.confirm) {
          console.error('');
          console.error('⚠️  WARNING: This action is PERMANENT and IRREVERSIBLE!');
          console.error('');
          console.error('To proceed, run with --confirm flag:');
          console.error('  gmail-connector trash empty --confirm');
          process.exit(EXIT_CODES.INVALID_ARGUMENT);
        }

        // Double confirmation for >100 emails
        if (trashCount > 100) {
          console.log('');
          console.log('⚠️  WARNING: You are about to permanently delete over 100 emails!');
          console.log('   This action CANNOT be undone.');
          console.log('');

          const confirmed = await askConfirmation(
            `Type "yes" to permanently delete ~${trashCount} emails`
          );
          if (!confirmed) {
            console.log('Operation cancelled.');
            process.exit(EXIT_CODES.SUCCESS);
          }

          // Second confirmation
          const doubleConfirmed = await askConfirmation(
            'Are you ABSOLUTELY sure? This is your last chance to cancel'
          );
          if (!doubleConfirmed) {
            console.log('Operation cancelled.');
            process.exit(EXIT_CODES.SUCCESS);
          }
        }

        // Fetch all message IDs from trash
        if (globalOpts.verbose) {
          console.log('Fetching all message IDs from trash...');
        }
        const messageIds = await getTrashMessageIds(messages, globalOpts.verbose);

        if (messageIds.length === 0) {
          console.log('No messages found in trash.');
          process.exit(EXIT_CODES.SUCCESS);
        }

        console.log(`Permanently deleting ${messageIds.length} email(s)...`);

        // Delete messages permanently
        const result = await deleteMessagesPermanently(messageIds, messages, globalOpts.verbose);

        // Report results
        if (result.success > 0) {
          console.log(`✓ Permanently deleted ${result.success} email(s).`);
        }
        if (result.failed > 0) {
          console.error(`✗ Failed to delete ${result.failed} email(s).`);
          process.exit(EXIT_CODES.ERROR);
        }

        console.log('Trash has been emptied.');
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

  // Main trash action (move to trash) - must be default command
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
