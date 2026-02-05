/**
 * Sync emails command
 * Syncs emails from Gmail to local SQLite cache with full and incremental sync
 */

import { Command } from 'commander';
import type { gmail_v1 } from 'googleapis';
import { getGmailService, GmailServiceError } from '../../gmail';
import {
  getCacheDatabase,
  MessageRepository,
  LabelRepository,
  SyncStateRepository,
  CacheError,
} from '../../cache';
import type { MessageInput, LabelInput } from '../../cache';
import type { GlobalOptions } from '../types';
import { EXIT_CODES } from '../types';

/**
 * Progress display interface
 */
interface ProgressDisplay {
  update(current: number, total: number, message?: string): void;
  finish(message: string): void;
}

/**
 * Create a simple progress display
 */
function createProgressDisplay(verbose: boolean): ProgressDisplay {
  let lastPercent = -1;

  return {
    update(current: number, total: number, message?: string): void {
      if (total === 0) return;
      const percent = Math.floor((current / total) * 100);

      // Only update every 5% or if verbose mode
      if (percent !== lastPercent && (percent % 5 === 0 || verbose)) {
        lastPercent = percent;
        const bar = '='.repeat(Math.floor(percent / 5)) + ' '.repeat(20 - Math.floor(percent / 5));
        const msg = message ? ` - ${message}` : '';
        process.stdout.write(`\r[${bar}] ${percent}% (${current}/${total})${msg}      `);
      }
    },
    finish(message: string): void {
      process.stdout.write('\r' + ' '.repeat(80) + '\r'); // Clear line
      console.log(message);
    },
  };
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
 * Check if a message has attachments
 */
function hasAttachments(message: gmail_v1.Schema$Message): boolean {
  const parts = message.payload?.parts;
  if (!parts) return false;

  return parts.some((part) => {
    // Check for attachment disposition or filename
    if (part.filename && part.filename.length > 0) {
      return true;
    }
    // Recursively check nested parts
    if (part.parts) {
      return part.parts.some((p) => p.filename && p.filename.length > 0);
    }
    return false;
  });
}

/**
 * Convert Gmail message to MessageInput for caching
 */
function messageToInput(message: gmail_v1.Schema$Message): MessageInput {
  const headers = message.payload?.headers;
  const dateStr = getHeader(headers, 'Date');

  // Parse date to ISO string
  let isoDate = '';
  try {
    isoDate = new Date(dateStr).toISOString();
  } catch {
    isoDate = new Date().toISOString(); // Fallback to now
  }

  return {
    id: message.id ?? '',
    threadId: message.threadId ?? '',
    from: getHeader(headers, 'From'),
    to: getHeader(headers, 'To'),
    subject: getHeader(headers, 'Subject') || '(no subject)',
    date: isoDate,
    labels: message.labelIds ?? [],
    sizeEstimate: message.sizeEstimate ?? 0,
    snippet: message.snippet ?? '',
    hasAttachments: hasAttachments(message),
  };
}

/**
 * Convert Gmail label to LabelInput for caching
 */
function labelToInput(label: gmail_v1.Schema$Label): LabelInput {
  return {
    id: label.id ?? '',
    name: label.name ?? '',
    type: label.type === 'system' ? 'system' : 'user',
    messageCount: label.messagesTotal ?? 0,
  };
}

/**
 * Perform full sync - fetch all messages from Gmail
 */
async function performFullSync(
  messages: gmail_v1.Resource$Users$Messages,
  messageRepo: MessageRepository,
  progress: ProgressDisplay,
  verbose: boolean
): Promise<{ synced: number; historyId: string | null }> {
  let pageToken: string | undefined;
  let totalFetched = 0;
  let historyId: string | null = null;
  let estimatedTotal = 0;

  // First, get an estimate of total messages
  const initialList = await messages.list({
    userId: 'me',
    maxResults: 1,
  });
  estimatedTotal = initialList.data.resultSizeEstimate ?? 0;

  if (verbose) {
    console.log(`Estimated total messages: ${estimatedTotal}`);
  }

  // Fetch all message IDs first (more efficient)
  const allMessageIds: string[] = [];

  do {
    const listResponse = await messages.list({
      userId: 'me',
      maxResults: 500, // Max allowed
      pageToken,
    });

    const messageList = listResponse.data.messages ?? [];
    allMessageIds.push(...messageList.map((m) => m.id!).filter(Boolean));

    pageToken = listResponse.data.nextPageToken ?? undefined;
    progress.update(allMessageIds.length, estimatedTotal, 'Listing messages');

  } while (pageToken);

  progress.finish(`Found ${allMessageIds.length} messages to sync`);

  // Now fetch full details in batches
  const batchSize = 50;
  const messageBatches: MessageInput[][] = [];

  for (let i = 0; i < allMessageIds.length; i += batchSize) {
    const batch = allMessageIds.slice(i, i + batchSize);

    progress.update(i, allMessageIds.length, 'Fetching details');

    const detailPromises = batch.map(async (id) => {
      try {
        const detail = await messages.get({
          userId: 'me',
          id,
          format: 'metadata',
          metadataHeaders: ['Date', 'From', 'To', 'Subject'],
        });

        // Capture the history ID from the first message
        if (!historyId && detail.data.historyId) {
          historyId = detail.data.historyId;
        }

        return messageToInput(detail.data);
      } catch (err) {
        if (verbose) {
          const errMsg = err instanceof Error ? err.message : String(err);
          console.error(`\nFailed to fetch message ${id}: ${errMsg}`);
        }
        return null;
      }
    });

    const batchResults = await Promise.all(detailPromises);
    const validMessages = batchResults.filter((m): m is MessageInput => m !== null);

    if (validMessages.length > 0) {
      messageBatches.push(validMessages);
      totalFetched += validMessages.length;
    }
  }

  progress.finish(`Fetched ${totalFetched} messages`);

  // Save all messages to cache
  console.log('Saving to cache...');
  for (const batch of messageBatches) {
    messageRepo.upsertMany(batch);
  }

  return { synced: totalFetched, historyId };
}

/**
 * Perform incremental sync using Gmail History API
 */
async function performIncrementalSync(
  history: gmail_v1.Resource$Users$History,
  messages: gmail_v1.Resource$Users$Messages,
  messageRepo: MessageRepository,
  startHistoryId: string,
  progress: ProgressDisplay,
  verbose: boolean
): Promise<{ added: number; deleted: number; historyId: string | null }> {
  let pageToken: string | undefined;
  let added = 0;
  let deleted = 0;
  let latestHistoryId: string | null = null;

  const messagesToAdd: string[] = [];
  const messagesToDelete: string[] = [];

  // Fetch history changes
  try {
    do {
      const historyResponse = await history.list({
        userId: 'me',
        startHistoryId,
        maxResults: 500,
        pageToken,
      });

      latestHistoryId = historyResponse.data.historyId ?? null;
      const historyRecords = historyResponse.data.history ?? [];

      for (const record of historyRecords) {
        // Handle added messages
        if (record.messagesAdded) {
          for (const addedMsg of record.messagesAdded) {
            if (addedMsg.message?.id) {
              messagesToAdd.push(addedMsg.message.id);
            }
          }
        }

        // Handle deleted messages
        if (record.messagesDeleted) {
          for (const deletedMsg of record.messagesDeleted) {
            if (deletedMsg.message?.id) {
              messagesToDelete.push(deletedMsg.message.id);
            }
          }
        }

        // Handle label changes (treat as update)
        if (record.labelsAdded || record.labelsRemoved) {
          const msgs = [
            ...(record.labelsAdded ?? []),
            ...(record.labelsRemoved ?? []),
          ];
          for (const labelChange of msgs) {
            if (labelChange.message?.id) {
              messagesToAdd.push(labelChange.message.id);
            }
          }
        }
      }

      pageToken = historyResponse.data.nextPageToken ?? undefined;
    } while (pageToken);
  } catch (err) {
    // History ID might be too old (>7 days), need full sync
    const error = err as { code?: number; message?: string };
    if (error.code === 404 || (error.message && error.message.includes('Start history id'))) {
      throw new Error('History expired - full sync required');
    }
    throw err;
  }

  // Deduplicate message IDs
  const uniqueToAdd = [...new Set(messagesToAdd)];
  const uniqueToDelete = [...new Set(messagesToDelete)];

  if (verbose) {
    console.log(`Changes: ${uniqueToAdd.length} to add/update, ${uniqueToDelete.length} to delete`);
  }

  // Delete messages
  if (uniqueToDelete.length > 0) {
    deleted = messageRepo.deleteMany(uniqueToDelete);
    progress.update(deleted, uniqueToDelete.length, 'Deleting');
  }

  // Fetch and add/update messages
  const batchSize = 50;
  for (let i = 0; i < uniqueToAdd.length; i += batchSize) {
    const batch = uniqueToAdd.slice(i, i + batchSize);
    progress.update(i, uniqueToAdd.length, 'Syncing changes');

    const detailPromises = batch.map(async (id) => {
      try {
        const detail = await messages.get({
          userId: 'me',
          id,
          format: 'metadata',
          metadataHeaders: ['Date', 'From', 'To', 'Subject'],
        });
        return messageToInput(detail.data);
      } catch (err) {
        // Message might have been deleted since
        const error = err as { code?: number };
        if (error.code === 404) {
          messagesToDelete.push(id);
          return null;
        }
        if (verbose) {
          const errMsg = err instanceof Error ? err.message : String(err);
          console.error(`\nFailed to fetch message ${id}: ${errMsg}`);
        }
        return null;
      }
    });

    const batchResults = await Promise.all(detailPromises);
    const validMessages = batchResults.filter((m): m is MessageInput => m !== null);

    if (validMessages.length > 0) {
      messageRepo.upsertMany(validMessages);
      added += validMessages.length;
    }
  }

  // Delete any messages that were not found (404)
  if (messagesToDelete.length > uniqueToDelete.length) {
    const additionalDeletes = messagesToDelete.slice(uniqueToDelete.length);
    messageRepo.deleteMany(additionalDeletes);
    deleted += additionalDeletes.length;
  }

  progress.finish(`Synced ${added} changes, deleted ${deleted} messages`);

  return { added, deleted, historyId: latestHistoryId };
}

/**
 * Sync labels from Gmail
 */
async function syncLabels(
  labels: gmail_v1.Resource$Users$Labels,
  labelRepo: LabelRepository,
  verbose: boolean
): Promise<number> {
  const listResponse = await labels.list({
    userId: 'me',
  });

  const labelList = listResponse.data.labels ?? [];

  if (verbose) {
    console.log(`Found ${labelList.length} labels`);
  }

  // Get full details for each label (to get message counts)
  const labelDetails: LabelInput[] = [];

  for (const label of labelList) {
    if (!label.id) continue;

    try {
      const detail = await labels.get({
        userId: 'me',
        id: label.id,
      });
      labelDetails.push(labelToInput(detail.data));
    } catch {
      // Use partial info if full details fail
      labelDetails.push(labelToInput(label));
    }
  }

  if (labelDetails.length > 0) {
    labelRepo.upsertMany(labelDetails);
  }

  return labelDetails.length;
}

/**
 * Create the sync command
 */
export function createSyncCommand(): Command {
  const sync = new Command('sync')
    .description('Sync emails from Gmail to local cache')
    .option('--full', 'Force full sync (ignore incremental state)', false)
    .action(
      async (
        options: { full: boolean },
        cmd: Command
      ) => {
        const globalOpts = cmd.optsWithGlobals<GlobalOptions>();
        const verbose = globalOpts.verbose;

        if (verbose) {
          console.log('Sync options:', { full: options.full, config: globalOpts.config });
        }

        try {
          // Get Gmail service
          const gmail = getGmailService({
            credentialsPath: globalOpts.config,
            verbose,
          });

          // Check authentication
          const isAuthenticated = await gmail.isAuthenticated();
          if (!isAuthenticated) {
            console.error(
              'Error: Not authenticated. Please run: gmail-connector auth login'
            );
            process.exit(EXIT_CODES.AUTHENTICATION_REQUIRED);
          }

          // Initialize cache database
          const cacheDb = getCacheDatabase({ verbose });
          cacheDb.initialize();

          const messageRepo = new MessageRepository(cacheDb);
          const labelRepo = new LabelRepository(cacheDb);
          const syncStateRepo = new SyncStateRepository(cacheDb);

          // Get current sync state
          const syncState = syncStateRepo.get();
          const hasBeenSynced = syncStateRepo.hasBeenSynced();

          if (verbose) {
            console.log('Current sync state:', {
              lastHistoryId: syncState.last_history_id,
              lastFullSync: syncState.last_full_sync,
              lastIncrementalSync: syncState.last_incremental_sync,
              totalMessages: syncState.total_messages,
            });
          }

          // Get Gmail API resources
          const messagesApi = await gmail.getMessages();
          const labelsApi = await gmail.getLabels();
          const historyApi = await gmail.getHistory();

          // Create progress display
          const progress = createProgressDisplay(verbose);

          // Sync labels first
          console.log('Syncing labels...');
          const labelCount = await syncLabels(labelsApi, labelRepo, verbose);
          console.log(`Synced ${labelCount} labels`);

          // Determine sync type
          const shouldFullSync = options.full || !hasBeenSynced || !syncState.last_history_id;

          if (shouldFullSync) {
            console.log('Starting full sync...');

            if (options.full && hasBeenSynced) {
              // Clear existing cache for forced full sync
              console.log('Clearing existing cache...');
              cacheDb.clearCache();
              syncStateRepo.reset();
            }

            const { synced, historyId } = await performFullSync(
              messagesApi,
              messageRepo,
              progress,
              verbose
            );

            // Update sync state
            syncStateRepo.markFullSync(synced);
            if (historyId) {
              syncStateRepo.updateHistoryId(historyId);
            }

            console.log(`\nFull sync complete: ${synced} messages synced`);
          } else {
            console.log('Starting incremental sync...');

            try {
              const { added, deleted, historyId } = await performIncrementalSync(
                historyApi,
                messagesApi,
                messageRepo,
                syncState.last_history_id!,
                progress,
                verbose
              );

              // Update sync state
              if (historyId) {
                syncStateRepo.updateHistoryId(historyId);
              }
              syncStateRepo.updateMessageCount(messageRepo.count());

              console.log(`\nIncremental sync complete: ${added} added/updated, ${deleted} deleted`);
            } catch (err) {
              if (err instanceof Error && err.message === 'History expired - full sync required') {
                console.log('History expired, performing full sync...');

                const { synced, historyId } = await performFullSync(
                  messagesApi,
                  messageRepo,
                  progress,
                  verbose
                );

                syncStateRepo.markFullSync(synced);
                if (historyId) {
                  syncStateRepo.updateHistoryId(historyId);
                }

                console.log(`\nFull sync complete: ${synced} messages synced`);
              } else {
                throw err;
              }
            }
          }

          // Show final stats
          const stats = cacheDb.getStats();
          console.log(`\nCache stats:`);
          console.log(`  Messages: ${stats.messageCount}`);
          console.log(`  Labels: ${stats.labelCount}`);
          console.log(`  Database size: ${(stats.sizeBytes / 1024 / 1024).toFixed(2)} MB`);

          process.exit(EXIT_CODES.SUCCESS);
        } catch (err) {
          if (err instanceof GmailServiceError) {
            console.error(`Error: ${err.message}`);
            if (err.code === 'not_authenticated') {
              process.exit(EXIT_CODES.AUTHENTICATION_REQUIRED);
            }
          } else if (err instanceof CacheError) {
            console.error(`Cache error: ${err.message}`);
          } else if (err instanceof Error) {
            console.error(`Error: ${err.message}`);
            if (verbose && err.stack) {
              console.error(err.stack);
            }
          } else {
            console.error('An unknown error occurred');
          }
          process.exit(EXIT_CODES.ERROR);
        }
      }
    );

  return sync;
}
