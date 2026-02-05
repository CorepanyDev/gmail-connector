/**
 * Label command
 * Apply or remove labels from emails (single or bulk)
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
 * Find or create a label by name
 */
async function findOrCreateLabel(
  labelName: string,
  labels: gmail_v1.Resource$Users$Labels,
  createIfMissing: boolean,
  verbose: boolean
): Promise<{ id: string; name: string; created: boolean } | null> {
  // List existing labels
  const listResponse = await labels.list({ userId: 'me' });
  const existingLabels = listResponse.data.labels ?? [];

  // Find existing label (case-insensitive comparison)
  const existingLabel = existingLabels.find(
    (l) => l.name?.toLowerCase() === labelName.toLowerCase()
  );

  if (existingLabel && existingLabel.id) {
    return {
      id: existingLabel.id,
      name: existingLabel.name ?? labelName,
      created: false,
    };
  }

  // Label doesn't exist
  if (!createIfMissing) {
    return null;
  }

  // Create the label
  if (verbose) {
    console.log(`Label "${labelName}" not found, creating...`);
  }

  const createResponse = await labels.create({
    userId: 'me',
    requestBody: {
      name: labelName,
      labelListVisibility: 'labelShow',
      messageListVisibility: 'show',
    },
  });

  const newLabel = createResponse.data;
  return {
    id: newLabel.id ?? '',
    name: newLabel.name ?? labelName,
    created: true,
  };
}

/**
 * Apply a label to a list of messages
 */
async function applyLabelToMessages(
  messageIds: string[],
  labelId: string,
  messages: gmail_v1.Resource$Users$Messages,
  verbose: boolean
): Promise<{ success: number; failed: number }> {
  let success = 0;
  let failed = 0;
  const batchSize = 10;

  // Create progress bar for bulk operations
  const progress = createProgressBar({ verbose, threshold: 20, showEta: true });
  progress.start(messageIds.length, 'Adding label');

  for (let i = 0; i < messageIds.length; i += batchSize) {
    const batch = messageIds.slice(i, i + batchSize);

    const promises = batch.map(async (messageId) => {
      try {
        await messages.modify({
          userId: 'me',
          id: messageId,
          requestBody: {
            addLabelIds: [labelId],
          },
        });
        return true;
      } catch (err) {
        if (verbose) {
          const errMsg = err instanceof Error ? err.message : 'Unknown error';
          console.error(`  Failed to modify message ${messageId}: ${errMsg}`);
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
 * Remove a label from a list of messages
 */
async function removeLabelFromMessages(
  messageIds: string[],
  labelId: string,
  messages: gmail_v1.Resource$Users$Messages,
  verbose: boolean
): Promise<{ success: number; failed: number }> {
  let success = 0;
  let failed = 0;
  const batchSize = 10;

  // Create progress bar for bulk operations
  const progress = createProgressBar({ verbose, threshold: 20, showEta: true });
  progress.start(messageIds.length, 'Removing label');

  for (let i = 0; i < messageIds.length; i += batchSize) {
    const batch = messageIds.slice(i, i + batchSize);

    const promises = batch.map(async (messageId) => {
      try {
        await messages.modify({
          userId: 'me',
          id: messageId,
          requestBody: {
            removeLabelIds: [labelId],
          },
        });
        return true;
      } catch (err) {
        if (verbose) {
          const errMsg = err instanceof Error ? err.message : 'Unknown error';
          console.error(`  Failed to modify message ${messageId}: ${errMsg}`);
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
 * Add label command options
 */
interface AddLabelOptions {
  id?: string;
  ids?: string;
  query?: string;
  create?: boolean;
}

/**
 * Remove label command options
 */
interface RemoveLabelOptions {
  id?: string;
  ids?: string;
  query?: string;
}

/**
 * Create the label command with add/remove subcommands
 */
export function createLabelCommand(): Command {
  const label = new Command('label').description('Apply or remove labels from emails');

  // Label add subcommand
  label
    .command('add')
    .description('Add a label to emails')
    .argument('<label>', 'Name of the label to add')
    .option('--id <message-id>', 'Apply to a single message')
    .option('--ids <id1,id2,...>', 'Apply to multiple messages (comma-separated)')
    .option('--query <search-query>', 'Apply to all messages matching Gmail search query')
    .option('--create', 'Create the label if it does not exist')
    .action(async (labelName: string, options: AddLabelOptions, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals<GlobalOptions>();

      if (globalOpts.verbose) {
        console.log('Label add options:', { labelName, ...options, config: globalOpts.config });
      }

      try {
        // Validate input - must have at least one target
        if (!options.id && !options.ids && !options.query) {
          console.error('Error: Must specify at least one of: --id, --ids, or --query');
          console.error('');
          console.error('Examples:');
          console.error('  gmail-connector label add "Important" --id MESSAGE_ID');
          console.error('  gmail-connector label add "Important" --ids ID1,ID2,ID3');
          console.error('  gmail-connector label add "Important" --query "from:newsletter@example.com"');
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

        // Get resources
        const messages = await gmail.getMessages();
        const labels = await gmail.getLabels();

        // Find or create the label
        const labelResult = await findOrCreateLabel(
          labelName,
          labels,
          options.create ?? false,
          globalOpts.verbose
        );

        if (!labelResult) {
          console.error(`Error: Label "${labelName}" does not exist.`);
          console.error('Use --create flag to create the label automatically.');
          process.exit(EXIT_CODES.ERROR);
        }

        if (labelResult.created) {
          console.log(`Created new label: "${labelResult.name}" (ID: ${labelResult.id})`);
        }

        // Get message IDs
        const messageIds = await getMessageIds(options, messages, globalOpts.verbose);

        if (messageIds.length === 0) {
          console.log('No messages found to label.');
          process.exit(EXIT_CODES.SUCCESS);
        }

        if (globalOpts.verbose) {
          console.log(`Applying label "${labelResult.name}" to ${messageIds.length} message(s)...`);
        }

        // Apply the label
        const result = await applyLabelToMessages(
          messageIds,
          labelResult.id,
          messages,
          globalOpts.verbose
        );

        // Report results
        if (result.success > 0) {
          console.log(`Successfully added label "${labelResult.name}" to ${result.success} message(s).`);
        }
        if (result.failed > 0) {
          console.error(`Failed to modify ${result.failed} message(s).`);
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

  // Label remove subcommand
  label
    .command('remove')
    .description('Remove a label from emails')
    .argument('<label>', 'Name of the label to remove')
    .option('--id <message-id>', 'Remove from a single message')
    .option('--ids <id1,id2,...>', 'Remove from multiple messages (comma-separated)')
    .option('--query <search-query>', 'Remove from all messages matching Gmail search query')
    .action(async (labelName: string, options: RemoveLabelOptions, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals<GlobalOptions>();

      if (globalOpts.verbose) {
        console.log('Label remove options:', { labelName, ...options, config: globalOpts.config });
      }

      try {
        // Validate input - must have at least one target
        if (!options.id && !options.ids && !options.query) {
          console.error('Error: Must specify at least one of: --id, --ids, or --query');
          console.error('');
          console.error('Examples:');
          console.error('  gmail-connector label remove "Important" --id MESSAGE_ID');
          console.error('  gmail-connector label remove "Important" --ids ID1,ID2,ID3');
          console.error('  gmail-connector label remove "Important" --query "from:newsletter@example.com"');
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

        // Get resources
        const messages = await gmail.getMessages();
        const labels = await gmail.getLabels();

        // Find the label (don't create it)
        const labelResult = await findOrCreateLabel(
          labelName,
          labels,
          false, // Don't create for remove operation
          globalOpts.verbose
        );

        if (!labelResult) {
          console.error(`Error: Label "${labelName}" does not exist.`);
          process.exit(EXIT_CODES.ERROR);
        }

        // Get message IDs
        const messageIds = await getMessageIds(options, messages, globalOpts.verbose);

        if (messageIds.length === 0) {
          console.log('No messages found to unlabel.');
          process.exit(EXIT_CODES.SUCCESS);
        }

        if (globalOpts.verbose) {
          console.log(`Removing label "${labelResult.name}" from ${messageIds.length} message(s)...`);
        }

        // Remove the label
        const result = await removeLabelFromMessages(
          messageIds,
          labelResult.id,
          messages,
          globalOpts.verbose
        );

        // Report results
        if (result.success > 0) {
          console.log(`Successfully removed label "${labelResult.name}" from ${result.success} message(s).`);
        }
        if (result.failed > 0) {
          console.error(`Failed to modify ${result.failed} message(s).`);
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

  return label;
}
