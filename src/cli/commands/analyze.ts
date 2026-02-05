/**
 * Analyze commands
 * Analyze inbox by senders, newsletters, etc.
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
 * Format date for display
 */
function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();

  if (date.getFullYear() === now.getFullYear()) {
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
    return match[1].toLowerCase();
  }
  // If no angle brackets, treat the whole string as email and lowercase
  return from.toLowerCase().trim();
}

/**
 * Extract domain from email address
 */
function extractDomain(email: string): string {
  const atIndex = email.lastIndexOf('@');
  if (atIndex === -1) {
    return email;
  }
  return email.slice(atIndex + 1);
}

/**
 * Sender statistics
 */
interface SenderStats {
  email: string;
  domain: string;
  count: number;
  totalSize: number;
  oldest: Date;
  newest: Date;
}

/**
 * Analyze senders command options
 */
interface AnalyzeSendersOptions {
  limit?: string;
  sort?: 'count' | 'size';
  domain?: boolean;
  json?: boolean;
  all?: boolean;
}

/**
 * Analyze newsletters command options
 */
interface AnalyzeNewslettersOptions {
  since?: string;
  limit?: string;
  json?: boolean;
  all?: boolean;
}

/**
 * Newsletter sender statistics
 */
interface NewsletterStats {
  sender: string;
  domain: string;
  count: number;
  hasUnsubscribe: boolean;
  unsubscribeUrl?: string;
  unsubscribeEmail?: string;
  oldest: Date;
  newest: Date;
}

/**
 * Parse --since option into Date
 * Supports: 30d, 6m, 1y, or ISO date string
 */
function parseSince(since: string): Date {
  const now = new Date();

  // Try parsing as relative time
  const match = since.match(/^(\d+)([dwmy])$/i);
  if (match) {
    const value = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();

    switch (unit) {
      case 'd':
        return new Date(now.getTime() - value * 24 * 60 * 60 * 1000);
      case 'w':
        return new Date(now.getTime() - value * 7 * 24 * 60 * 60 * 1000);
      case 'm':
        return new Date(now.getFullYear(), now.getMonth() - value, now.getDate());
      case 'y':
        return new Date(now.getFullYear() - value, now.getMonth(), now.getDate());
    }
  }

  // Try parsing as ISO date string
  const parsed = new Date(since);
  if (!isNaN(parsed.getTime())) {
    return parsed;
  }

  throw new Error(`Invalid --since format: ${since}. Use format like: 30d, 6m, 1y, or ISO date string`);
}

/**
 * Parse List-Unsubscribe header value
 * Can contain mailto: and/or http(s): URLs
 */
function parseUnsubscribeHeader(header: string): { url?: string; email?: string } {
  const result: { url?: string; email?: string } = {};

  // Find http/https URL
  const urlMatch = header.match(/<(https?:\/\/[^>]+)>/);
  if (urlMatch) {
    result.url = urlMatch[1];
  }

  // Find mailto URL
  const mailtoMatch = header.match(/<mailto:([^>]+)>/);
  if (mailtoMatch) {
    result.email = mailtoMatch[1];
  }

  return result;
}

/**
 * Create the analyze command with subcommands
 */
export function createAnalyzeCommand(): Command {
  const analyze = new Command('analyze')
    .description('Analyze inbox for insights (senders, newsletters, etc.)');

  // Analyze senders subcommand
  analyze
    .command('senders')
    .description('Group emails by sender volume')
    .option('--limit <count>', 'Show top N senders', '20')
    .option('--sort <by>', 'Sort by "count" (default) or "size"', 'count')
    .option('--domain', 'Group by domain instead of email address')
    .option('--json', 'Output as JSON')
    .option('--all', 'Analyze all emails (default: inbox only)')
    .action(async (options: AnalyzeSendersOptions, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals<GlobalOptions>();

      if (globalOpts.verbose) {
        console.log('Analyze senders options:', { ...options, config: globalOpts.config });
      }

      try {
        // Validate and parse limit
        const limit = parseInt(options.limit ?? '20', 10);
        if (isNaN(limit) || limit < 1) {
          console.error('Error: --limit must be a positive integer');
          process.exit(EXIT_CODES.INVALID_ARGUMENT);
        }

        // Validate sort option
        const sortBy = options.sort ?? 'count';
        if (sortBy !== 'count' && sortBy !== 'size') {
          console.error('Error: --sort must be "count" or "size"');
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

        const inboxOnly = !options.all;
        const labelIds = inboxOnly ? ['INBOX'] : undefined;

        console.log(`Analyzing ${inboxOnly ? 'inbox' : 'all'} senders...`);
        if (globalOpts.verbose) {
          console.log(`  Scope: ${inboxOnly ? 'inbox only' : 'all emails'}`);
          console.log(`  Grouping by: ${options.domain ? 'domain' : 'email address'}`);
          console.log(`  Sorting by: ${sortBy}`);
          console.log(`  Limit: top ${limit}`);
        }

        // Map to track sender statistics
        const senderMap = new Map<string, SenderStats>();

        // Fetch all messages with pagination
        let pageToken: string | undefined;
        let totalProcessed = 0;
        const batchSize = 10;

        do {
          // List messages
          const listResponse = await messagesApi.list({
            userId: 'me',
            maxResults: 500,
            pageToken,
            labelIds,
          });

          const messages = listResponse.data.messages ?? [];
          pageToken = listResponse.data.nextPageToken ?? undefined;

          if (messages.length === 0) {
            break;
          }

          // Fetch message details in batches
          for (let i = 0; i < messages.length; i += batchSize) {
            const batch = messages.slice(i, i + batchSize);

            const promises = batch.map(async (msg) => {
              if (!msg.id) return null;

              try {
                const response = await messagesApi.get({
                  userId: 'me',
                  id: msg.id,
                  format: 'metadata',
                  metadataHeaders: ['From', 'Date'],
                });

                const msgData = response.data;
                const headers = msgData.payload?.headers;
                const fromRaw = getHeader(headers, 'From');
                const dateStr = getHeader(headers, 'Date');
                const size = msgData.sizeEstimate ?? 0;

                if (!fromRaw) return null;

                const email = extractEmail(fromRaw);
                const domain = extractDomain(email);
                const date = new Date(dateStr);

                return {
                  email,
                  domain,
                  size,
                  date: isNaN(date.getTime()) ? new Date() : date,
                };
              } catch {
                return null;
              }
            });

            const results = await Promise.all(promises);

            for (const result of results) {
              if (!result) continue;

              const key = options.domain ? result.domain : result.email;
              const existing = senderMap.get(key);

              if (existing) {
                existing.count++;
                existing.totalSize += result.size;
                if (result.date < existing.oldest) {
                  existing.oldest = result.date;
                }
                if (result.date > existing.newest) {
                  existing.newest = result.date;
                }
              } else {
                senderMap.set(key, {
                  email: result.email,
                  domain: result.domain,
                  count: 1,
                  totalSize: result.size,
                  oldest: result.date,
                  newest: result.date,
                });
              }
            }
          }

          totalProcessed += messages.length;

          // Progress update every 500 messages
          if (globalOpts.verbose || totalProcessed % 500 === 0) {
            console.log(`  Processed ${totalProcessed} emails...`);
          }
        } while (pageToken);

        if (senderMap.size === 0) {
          console.log('No emails found.');
          process.exit(EXIT_CODES.SUCCESS);
        }

        // Convert to array and sort
        const sendersArray = Array.from(senderMap.entries()).map(([key, stats]) => ({
          key,
          ...stats,
        }));

        if (sortBy === 'size') {
          sendersArray.sort((a, b) => b.totalSize - a.totalSize);
        } else {
          sendersArray.sort((a, b) => b.count - a.count);
        }

        // Take top N
        const topSenders = sendersArray.slice(0, limit);

        // Output results
        if (options.json) {
          const jsonOutput = {
            groupedBy: options.domain ? 'domain' : 'email',
            sortedBy: sortBy,
            totalSenders: senderMap.size,
            totalEmails: totalProcessed,
            topSenders: topSenders.map((s) => ({
              sender: s.key,
              email: s.email,
              domain: s.domain,
              count: s.count,
              totalSize: s.totalSize,
              totalSizeFormatted: formatSize(s.totalSize),
              oldest: s.oldest.toISOString(),
              newest: s.newest.toISOString(),
            })),
          };
          console.log(JSON.stringify(jsonOutput, null, 2));
          process.exit(EXIT_CODES.SUCCESS);
        }

        // Display table
        console.log('');
        console.log(`Top ${topSenders.length} senders (grouped by ${options.domain ? 'domain' : 'email'}, sorted by ${sortBy}):`);
        console.log(`Total unique senders: ${senderMap.size.toLocaleString()}`);
        console.log(`Total emails analyzed: ${totalProcessed.toLocaleString()}`);
        console.log('');

        // Table header
        const colWidths = {
          sender: options.domain ? 30 : 40,
          count: 8,
          size: 12,
          oldest: 12,
          newest: 12,
        };

        const headerLine = [
          (options.domain ? 'DOMAIN' : 'SENDER').padEnd(colWidths.sender),
          'COUNT'.padStart(colWidths.count),
          'TOTAL SIZE'.padStart(colWidths.size),
          'OLDEST'.padEnd(colWidths.oldest),
          'NEWEST'.padEnd(colWidths.newest),
        ].join('  ');

        console.log(headerLine);
        console.log('─'.repeat(headerLine.length));

        // Table rows
        for (const sender of topSenders) {
          const row = [
            truncate(sender.key, colWidths.sender).padEnd(colWidths.sender),
            sender.count.toLocaleString().padStart(colWidths.count),
            formatSize(sender.totalSize).padStart(colWidths.size),
            formatDate(sender.oldest.toISOString()).padEnd(colWidths.oldest),
            formatDate(sender.newest.toISOString()).padEnd(colWidths.newest),
          ].join('  ');
          console.log(row);
        }

        console.log('');

        // Summary
        const topSendersTotal = topSenders.reduce((sum, s) => sum + s.count, 0);
        const topSendersSizeTotal = topSenders.reduce((sum, s) => sum + s.totalSize, 0);
        console.log(`Top ${topSenders.length} senders account for ${topSendersTotal.toLocaleString()} emails (${((topSendersTotal / totalProcessed) * 100).toFixed(1)}%) and ${formatSize(topSendersSizeTotal)}`);

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

  // Analyze newsletters subcommand
  analyze
    .command('newsletters')
    .description('Detect newsletter subscriptions (emails with List-Unsubscribe header)')
    .option('--since <time>', 'Only analyze emails from this time period (e.g., 30d, 6m, 1y)')
    .option('--limit <count>', 'Show top N senders', '50')
    .option('--json', 'Output as JSON')
    .option('--all', 'Analyze all emails (default: inbox only)')
    .action(async (options: AnalyzeNewslettersOptions, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals<GlobalOptions>();

      if (globalOpts.verbose) {
        console.log('Analyze newsletters options:', { ...options, config: globalOpts.config });
      }

      try {
        // Validate and parse limit
        const limit = parseInt(options.limit ?? '50', 10);
        if (isNaN(limit) || limit < 1) {
          console.error('Error: --limit must be a positive integer');
          process.exit(EXIT_CODES.INVALID_ARGUMENT);
        }

        // Parse since option if provided
        let sinceDate: Date | undefined;
        let gmailQuery = '';
        if (options.since) {
          sinceDate = parseSince(options.since);
          // Gmail query uses YYYY/MM/DD format
          const year = sinceDate.getFullYear();
          const month = (sinceDate.getMonth() + 1).toString().padStart(2, '0');
          const day = sinceDate.getDate().toString().padStart(2, '0');
          gmailQuery = `after:${year}/${month}/${day}`;

          if (globalOpts.verbose) {
            console.log(`  Filtering emails after: ${sinceDate.toLocaleDateString()}`);
          }
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

        const inboxOnly = !options.all;
        const labelIds = inboxOnly ? ['INBOX'] : undefined;

        console.log(`Analyzing ${inboxOnly ? 'inbox' : 'all'} newsletters and subscriptions...`);
        if (globalOpts.verbose) {
          console.log(`  Scope: ${inboxOnly ? 'inbox only' : 'all emails'}`);
          if (sinceDate) {
            console.log(`  Time range: since ${sinceDate.toLocaleDateString()}`);
          }
        }

        // Map to track newsletter statistics
        const newsletterMap = new Map<string, NewsletterStats>();

        // Fetch all messages with pagination
        let pageToken: string | undefined;
        let totalProcessed = 0;
        let newsletterCount = 0;
        const batchSize = 10;

        do {
          // List messages
          const listResponse = await messagesApi.list({
            userId: 'me',
            maxResults: 500,
            pageToken,
            labelIds,
            q: gmailQuery || undefined,
          });

          const messages = listResponse.data.messages ?? [];
          pageToken = listResponse.data.nextPageToken ?? undefined;

          if (messages.length === 0) {
            break;
          }

          // Fetch message details in batches
          for (let i = 0; i < messages.length; i += batchSize) {
            const batch = messages.slice(i, i + batchSize);

            const promises = batch.map(async (msg) => {
              if (!msg.id) return null;

              try {
                const response = await messagesApi.get({
                  userId: 'me',
                  id: msg.id,
                  format: 'metadata',
                  metadataHeaders: ['From', 'Date', 'List-Unsubscribe', 'List-Unsubscribe-Post'],
                });

                const msgData = response.data;
                const headers = msgData.payload?.headers;
                const fromRaw = getHeader(headers, 'From');
                const dateStr = getHeader(headers, 'Date');
                const listUnsubscribe = getHeader(headers, 'List-Unsubscribe');

                if (!fromRaw) return null;

                const email = extractEmail(fromRaw);
                const domain = extractDomain(email);
                const date = new Date(dateStr);

                return {
                  from: fromRaw,
                  email,
                  domain,
                  date: isNaN(date.getTime()) ? new Date() : date,
                  listUnsubscribe,
                  hasUnsubscribe: !!listUnsubscribe,
                };
              } catch {
                return null;
              }
            });

            const results = await Promise.all(promises);

            for (const result of results) {
              if (!result) continue;

              // Only track emails with List-Unsubscribe header
              if (!result.hasUnsubscribe) continue;

              newsletterCount++;
              const key = result.email;
              const existing = newsletterMap.get(key);

              // Parse unsubscribe header
              const unsubscribeInfo = result.listUnsubscribe
                ? parseUnsubscribeHeader(result.listUnsubscribe)
                : {};

              if (existing) {
                existing.count++;
                if (result.date < existing.oldest) {
                  existing.oldest = result.date;
                }
                if (result.date > existing.newest) {
                  existing.newest = result.date;
                }
                // Update unsubscribe info if not already set
                if (!existing.unsubscribeUrl && unsubscribeInfo.url) {
                  existing.unsubscribeUrl = unsubscribeInfo.url;
                }
                if (!existing.unsubscribeEmail && unsubscribeInfo.email) {
                  existing.unsubscribeEmail = unsubscribeInfo.email;
                }
              } else {
                newsletterMap.set(key, {
                  sender: result.email,
                  domain: result.domain,
                  count: 1,
                  hasUnsubscribe: true,
                  unsubscribeUrl: unsubscribeInfo.url,
                  unsubscribeEmail: unsubscribeInfo.email,
                  oldest: result.date,
                  newest: result.date,
                });
              }
            }
          }

          totalProcessed += messages.length;

          // Progress update every 500 messages
          if (globalOpts.verbose || totalProcessed % 500 === 0) {
            console.log(`  Processed ${totalProcessed} emails, found ${newsletterCount} newsletter emails...`);
          }
        } while (pageToken);

        if (newsletterMap.size === 0) {
          console.log('No newsletter subscriptions detected.');
          console.log(`  Scanned ${totalProcessed.toLocaleString()} emails`);
          process.exit(EXIT_CODES.SUCCESS);
        }

        // Convert to array and sort by count
        const newslettersArray = Array.from(newsletterMap.values());
        newslettersArray.sort((a, b) => b.count - a.count);

        // Take top N
        const topNewsletters = newslettersArray.slice(0, limit);

        // Output results
        if (options.json) {
          const jsonOutput = {
            totalEmailsScanned: totalProcessed,
            totalNewsletterEmails: newsletterCount,
            uniqueSenders: newsletterMap.size,
            timeRange: sinceDate
              ? {
                  since: sinceDate.toISOString(),
                  sinceFriendly: options.since,
                }
              : null,
            newsletters: topNewsletters.map((n) => ({
              sender: n.sender,
              domain: n.domain,
              count: n.count,
              hasUnsubscribeLink: !!n.unsubscribeUrl,
              hasUnsubscribeEmail: !!n.unsubscribeEmail,
              unsubscribeUrl: n.unsubscribeUrl ?? null,
              unsubscribeEmail: n.unsubscribeEmail ?? null,
              oldest: n.oldest.toISOString(),
              newest: n.newest.toISOString(),
            })),
          };
          console.log(JSON.stringify(jsonOutput, null, 2));
          process.exit(EXIT_CODES.SUCCESS);
        }

        // Display table
        console.log('');
        console.log(`Newsletter Subscriptions (${newsletterMap.size.toLocaleString()} unique senders found)`);
        console.log(`Total emails scanned: ${totalProcessed.toLocaleString()}`);
        console.log(`Total newsletter emails: ${newsletterCount.toLocaleString()}`);
        if (sinceDate) {
          console.log(`Time range: since ${sinceDate.toLocaleDateString()}`);
        }
        console.log('');

        // Table header
        const colWidths = {
          sender: 40,
          count: 8,
          unsubscribe: 12,
          newest: 12,
        };

        const headerLine = [
          'SENDER'.padEnd(colWidths.sender),
          'COUNT'.padStart(colWidths.count),
          'UNSUBSCRIBE'.padEnd(colWidths.unsubscribe),
          'LAST EMAIL'.padEnd(colWidths.newest),
        ].join('  ');

        console.log(headerLine);
        console.log('─'.repeat(headerLine.length));

        // Table rows
        for (const newsletter of topNewsletters) {
          const unsubStatus = newsletter.unsubscribeUrl
            ? '✓ Link'
            : newsletter.unsubscribeEmail
            ? '✓ Email'
            : '?';

          const row = [
            truncate(newsletter.sender, colWidths.sender).padEnd(colWidths.sender),
            newsletter.count.toLocaleString().padStart(colWidths.count),
            unsubStatus.padEnd(colWidths.unsubscribe),
            formatDate(newsletter.newest.toISOString()).padEnd(colWidths.newest),
          ].join('  ');
          console.log(row);
        }

        console.log('');
        console.log('Tip: Use "gmail-connector unsubscribe <sender>" to get unsubscribe links');

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

  return analyze;
}
