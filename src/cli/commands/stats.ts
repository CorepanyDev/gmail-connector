/**
 * Stats command
 * Show inbox health metrics and summary
 */

import { Command } from 'commander';
import type { gmail_v1 } from 'googleapis';
import { getGmailService, GmailServiceError } from '../../gmail';
import type { GlobalOptions } from '../types';
import { EXIT_CODES } from '../types';

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
 * Format number with locale separators
 */
function formatNumber(num: number): string {
  return num.toLocaleString();
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
    return match[1].toLowerCase();
  }
  return from.toLowerCase().trim();
}

/**
 * Age bucket definitions
 */
interface AgeBucket {
  label: string;
  count: number;
  size: number;
}

/**
 * Sender stats for top senders
 */
interface SenderStats {
  email: string;
  count: number;
  size: number;
}

/**
 * Stats command options
 */
interface StatsOptions {
  json?: boolean;
}

/**
 * Create the stats command
 */
export function createStatsCommand(): Command {
  const stats = new Command('stats')
    .description('Show inbox health metrics and summary')
    .option('--json', 'Output as JSON')
    .action(async (options: StatsOptions, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals<GlobalOptions>();

      if (globalOpts.verbose) {
        console.log('Stats options:', { ...options, config: globalOpts.config });
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

        if (!options.json) {
          console.log('Gathering inbox statistics...');
        }

        // Get Gmail API resources
        const messagesApi = await gmail.getMessages();
        const labelsApi = await gmail.getLabels();

        // Get inbox count
        const inboxLabel = await labelsApi.get({
          userId: 'me',
          id: 'INBOX',
        });
        const inboxCount = inboxLabel.data.messagesTotal ?? 0;
        const inboxUnread = inboxLabel.data.messagesUnread ?? 0;

        // Get total email count from SENT + INBOX + other labels
        // Use all mail label for total count
        let totalEmails = 0;
        try {
          const allMailResponse = await messagesApi.list({
            userId: 'me',
            maxResults: 1,
            includeSpamTrash: true,
          });
          totalEmails = allMailResponse.data.resultSizeEstimate ?? 0;
        } catch {
          // Fallback: estimate from profile
          totalEmails = inboxCount;
        }

        // Note: Gmail API doesn't directly provide storage quota
        // We'll estimate storage from sampled email sizes

        // Get unread count from UNREAD label
        let totalUnread = 0;
        try {
          const unreadLabel = await labelsApi.get({
            userId: 'me',
            id: 'UNREAD',
          });
          totalUnread = unreadLabel.data.messagesTotal ?? 0;
        } catch {
          totalUnread = inboxUnread;
        }

        // Get spam and trash counts
        let spamCount = 0;
        let trashCount = 0;
        try {
          const spamLabel = await labelsApi.get({
            userId: 'me',
            id: 'SPAM',
          });
          spamCount = spamLabel.data.messagesTotal ?? 0;
        } catch { /* ignore */ }

        try {
          const trashLabel = await labelsApi.get({
            userId: 'me',
            id: 'TRASH',
          });
          trashCount = trashLabel.data.messagesTotal ?? 0;
        } catch { /* ignore */ }

        if (globalOpts.verbose && !options.json) {
          console.log('  Fetching email age distribution...');
        }

        // Calculate age buckets by analyzing recent emails
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

        const ageBuckets: AgeBucket[] = [
          { label: 'Today', count: 0, size: 0 },
          { label: 'This Week', count: 0, size: 0 },
          { label: 'This Month', count: 0, size: 0 },
          { label: 'Older', count: 0, size: 0 },
        ];

        // Track top senders
        const senderMap = new Map<string, SenderStats>();

        // Track newsletter count (emails with List-Unsubscribe header)
        let newsletterCount = 0;
        let totalSize = 0;

        // Sample emails to calculate stats (analyze first 1000 emails for performance)
        const sampleSize = 1000;
        let sampledCount = 0;
        let pageToken: string | undefined;
        const batchSize = 10;

        do {
          const listResponse = await messagesApi.list({
            userId: 'me',
            maxResults: Math.min(500, sampleSize - sampledCount),
            pageToken,
          });

          const messages = listResponse.data.messages ?? [];
          pageToken = listResponse.data.nextPageToken ?? undefined;

          if (messages.length === 0) {
            break;
          }

          // Fetch message details in batches
          for (let i = 0; i < messages.length && sampledCount < sampleSize; i += batchSize) {
            const batch = messages.slice(i, Math.min(i + batchSize, messages.length));

            const promises = batch.map(async (msg) => {
              if (!msg.id) return null;

              try {
                const response = await messagesApi.get({
                  userId: 'me',
                  id: msg.id,
                  format: 'metadata',
                  metadataHeaders: ['From', 'Date', 'List-Unsubscribe'],
                });

                return response.data;
              } catch {
                return null;
              }
            });

            const results = await Promise.all(promises);

            for (const msgData of results) {
              if (!msgData) continue;

              sampledCount++;
              const headers = msgData.payload?.headers;
              const fromRaw = getHeader(headers, 'From');
              const dateStr = getHeader(headers, 'Date');
              const listUnsubscribe = getHeader(headers, 'List-Unsubscribe');
              const size = msgData.sizeEstimate ?? 0;

              totalSize += size;

              // Check for newsletter
              if (listUnsubscribe) {
                newsletterCount++;
              }

              // Parse date for age bucket
              const date = new Date(dateStr);
              if (!isNaN(date.getTime())) {
                if (date >= todayStart) {
                  ageBuckets[0].count++;
                  ageBuckets[0].size += size;
                } else if (date >= weekAgo) {
                  ageBuckets[1].count++;
                  ageBuckets[1].size += size;
                } else if (date >= monthAgo) {
                  ageBuckets[2].count++;
                  ageBuckets[2].size += size;
                } else {
                  ageBuckets[3].count++;
                  ageBuckets[3].size += size;
                }
              }

              // Track sender
              if (fromRaw) {
                const email = extractEmail(fromRaw);
                const existing = senderMap.get(email);
                if (existing) {
                  existing.count++;
                  existing.size += size;
                } else {
                  senderMap.set(email, { email, count: 1, size });
                }
              }
            }
          }
        } while (pageToken && sampledCount < sampleSize);

        // Get top 5 senders by count
        const topSenders = Array.from(senderMap.values())
          .sort((a, b) => b.count - a.count)
          .slice(0, 5);

        // Calculate average email size
        const avgSize = sampledCount > 0 ? Math.round(totalSize / sampledCount) : 0;
        const estimatedTotalSize = avgSize * totalEmails;

        // Output results
        if (options.json) {
          const jsonOutput = {
            overview: {
              totalEmails,
              unreadCount: totalUnread,
              inboxCount,
              inboxUnread,
              spamCount,
              trashCount,
            },
            storage: {
              estimatedUsed: estimatedTotalSize,
              estimatedUsedFormatted: formatSize(estimatedTotalSize),
              averageEmailSize: avgSize,
              averageEmailSizeFormatted: formatSize(avgSize),
              note: 'Storage is estimated from sampled emails',
            },
            topSenders: topSenders.map((s) => ({
              email: s.email,
              count: s.count,
              totalSize: s.size,
              totalSizeFormatted: formatSize(s.size),
            })),
            ageDistribution: ageBuckets.map((b) => ({
              bucket: b.label,
              count: b.count,
              size: b.size,
              sizeFormatted: formatSize(b.size),
              percentage: sampledCount > 0 ? ((b.count / sampledCount) * 100).toFixed(1) : '0',
            })),
            newsletters: {
              count: newsletterCount,
              percentage: sampledCount > 0 ? ((newsletterCount / sampledCount) * 100).toFixed(1) : '0',
            },
            sampleInfo: {
              emailsSampled: sampledCount,
              note: `Statistics based on ${sampledCount} most recent emails`,
            },
          };
          console.log(JSON.stringify(jsonOutput, null, 2));
          process.exit(EXIT_CODES.SUCCESS);
        }

        // Display formatted output
        console.log('');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('                      INBOX HEALTH REPORT                   ');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('');

        // Overview section
        console.log('  OVERVIEW');
        console.log('  ────────────────────────────────────────────────────────');
        console.log(`  Total Emails:        ${formatNumber(totalEmails)}`);
        console.log(`  Unread Emails:       ${formatNumber(totalUnread)}`);
        console.log(`  Inbox Count:         ${formatNumber(inboxCount)}`);
        console.log(`  Inbox Unread:        ${formatNumber(inboxUnread)}`);
        if (spamCount > 0) {
          console.log(`  Spam:                ${formatNumber(spamCount)}`);
        }
        if (trashCount > 0) {
          console.log(`  Trash:               ${formatNumber(trashCount)}`);
        }
        console.log('');

        // Storage section
        console.log('  STORAGE (estimated)');
        console.log('  ────────────────────────────────────────────────────────');
        console.log(`  Estimated Usage:     ${formatSize(estimatedTotalSize)}`);
        console.log(`  Avg Email Size:      ${formatSize(avgSize)}`);
        console.log('');

        // Top senders section
        console.log('  TOP 5 SENDERS (by volume)');
        console.log('  ────────────────────────────────────────────────────────');
        for (let i = 0; i < topSenders.length; i++) {
          const sender = topSenders[i];
          const truncatedEmail = sender.email.length > 40
            ? sender.email.slice(0, 37) + '...'
            : sender.email;
          console.log(`  ${i + 1}. ${truncatedEmail.padEnd(42)} ${formatNumber(sender.count).padStart(6)} emails`);
        }
        console.log('');

        // Age distribution section
        console.log('  EMAIL AGE DISTRIBUTION');
        console.log('  ────────────────────────────────────────────────────────');
        const maxBarLength = 30;
        const maxCount = Math.max(...ageBuckets.map((b) => b.count));
        for (const bucket of ageBuckets) {
          const percentage = sampledCount > 0 ? (bucket.count / sampledCount) * 100 : 0;
          const barLength = maxCount > 0 ? Math.round((bucket.count / maxCount) * maxBarLength) : 0;
          const bar = '█'.repeat(barLength) + '░'.repeat(maxBarLength - barLength);
          console.log(`  ${bucket.label.padEnd(12)} ${bar} ${formatNumber(bucket.count).padStart(6)} (${percentage.toFixed(1)}%)`);
        }
        console.log('');

        // Newsletter section
        console.log('  NEWSLETTER SUBSCRIPTIONS');
        console.log('  ────────────────────────────────────────────────────────');
        const newsletterPercentage = sampledCount > 0 ? (newsletterCount / sampledCount) * 100 : 0;
        console.log(`  Newsletter Emails:   ${formatNumber(newsletterCount)} (${newsletterPercentage.toFixed(1)}% of sampled)`);
        console.log('');
        console.log('  Tip: Run "gmail-connector analyze newsletters" for detailed breakdown');
        console.log('');

        console.log('═══════════════════════════════════════════════════════════');
        console.log(`  Based on ${formatNumber(sampledCount)} most recent emails`);
        console.log('═══════════════════════════════════════════════════════════');

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

  return stats;
}
