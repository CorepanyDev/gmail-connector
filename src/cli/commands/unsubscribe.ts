/**
 * Unsubscribe command
 * Generate and display unsubscribe links for newsletter senders
 */

import { Command } from 'commander';
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import type { gmail_v1 } from 'googleapis';
import { getGmailService, GmailServiceError } from '../../gmail';
import type { GlobalOptions } from '../types';
import { EXIT_CODES } from '../types';

/**
 * Path to unsubscribed senders tracking file
 */
function getUnsubscribedTrackingPath(): string {
  return join(homedir(), '.gmail-connector', 'unsubscribed.json');
}

/**
 * Interface for tracked unsubscribed senders
 */
interface UnsubscribedSender {
  sender: string;
  unsubscribedAt: string;
  method: 'link' | 'email' | 'manual';
  url?: string;
  email?: string;
}

interface UnsubscribedTracking {
  senders: UnsubscribedSender[];
}

/**
 * Load unsubscribed senders tracking
 */
function loadUnsubscribedTracking(): UnsubscribedTracking {
  const trackingPath = getUnsubscribedTrackingPath();

  if (!existsSync(trackingPath)) {
    return { senders: [] };
  }

  try {
    const content = readFileSync(trackingPath, 'utf-8');
    return JSON.parse(content) as UnsubscribedTracking;
  } catch {
    return { senders: [] };
  }
}

/**
 * Save unsubscribed senders tracking
 */
function saveUnsubscribedTracking(tracking: UnsubscribedTracking): void {
  const trackingPath = getUnsubscribedTrackingPath();
  const dir = dirname(trackingPath);

  // Ensure directory exists
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  writeFileSync(trackingPath, JSON.stringify(tracking, null, 2), 'utf-8');

  // Set secure permissions
  try {
    chmodSync(trackingPath, 0o600);
  } catch {
    // Ignore permission errors (e.g., on Windows)
  }
}

/**
 * Check if sender is already tracked as unsubscribed
 */
function isAlreadyUnsubscribed(sender: string): UnsubscribedSender | undefined {
  const tracking = loadUnsubscribedTracking();
  return tracking.senders.find(
    (s) => s.sender.toLowerCase() === sender.toLowerCase()
  );
}

/**
 * Add sender to unsubscribed tracking
 */
function trackUnsubscribedSender(
  sender: string,
  method: 'link' | 'email' | 'manual',
  url?: string,
  email?: string
): void {
  const tracking = loadUnsubscribedTracking();

  // Remove existing entry if present (to update)
  tracking.senders = tracking.senders.filter(
    (s) => s.sender.toLowerCase() !== sender.toLowerCase()
  );

  // Add new entry
  tracking.senders.push({
    sender,
    unsubscribedAt: new Date().toISOString(),
    method,
    url,
    email,
  });

  saveUnsubscribedTracking(tracking);
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
 * Parse List-Unsubscribe header value
 * Can contain mailto: and/or http(s): URLs
 */
function parseUnsubscribeHeader(header: string): { url?: string; email?: string } {
  const result: { url?: string; email?: string } = {};

  // Find http/https URL - handle both with and without angle brackets
  const urlMatch = header.match(/<?(https?:\/\/[^>,\s<]+)>?/);
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
 * Unsubscribe command options
 */
interface UnsubscribeOptions {
  open?: boolean;
  track?: boolean;
  json?: boolean;
  showTracked?: boolean;
}

/**
 * Create the unsubscribe command
 */
export function createUnsubscribeCommand(): Command {
  const unsubscribe = new Command('unsubscribe')
    .description('Get unsubscribe links for newsletter senders')
    .argument('[sender]', 'Sender email address or domain to unsubscribe from')
    .option('--open', 'Open unsubscribe link in browser')
    .option('--track', 'Mark sender as unsubscribed in local tracking', true)
    .option('--json', 'Output as JSON')
    .option('--show-tracked', 'Show list of tracked unsubscribed senders')
    .action(async (sender: string | undefined, options: UnsubscribeOptions, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals<GlobalOptions>();

      if (globalOpts.verbose) {
        console.log('Unsubscribe options:', { sender, ...options, config: globalOpts.config });
      }

      try {
        // Handle --show-tracked flag
        if (options.showTracked) {
          const tracking = loadUnsubscribedTracking();

          if (options.json) {
            console.log(JSON.stringify(tracking, null, 2));
            process.exit(EXIT_CODES.SUCCESS);
          }

          if (tracking.senders.length === 0) {
            console.log('No tracked unsubscribed senders.');
            process.exit(EXIT_CODES.SUCCESS);
          }

          console.log(`Tracked Unsubscribed Senders (${tracking.senders.length}):`);
          console.log('');

          // Table header
          const colWidths = { sender: 40, method: 10, date: 20 };
          const headerLine = [
            'SENDER'.padEnd(colWidths.sender),
            'METHOD'.padEnd(colWidths.method),
            'DATE'.padEnd(colWidths.date),
          ].join('  ');

          console.log(headerLine);
          console.log('─'.repeat(headerLine.length));

          // Sort by date (newest first)
          const sorted = [...tracking.senders].sort(
            (a, b) => new Date(b.unsubscribedAt).getTime() - new Date(a.unsubscribedAt).getTime()
          );

          for (const entry of sorted) {
            const date = new Date(entry.unsubscribedAt);
            const row = [
              entry.sender.slice(0, colWidths.sender).padEnd(colWidths.sender),
              entry.method.padEnd(colWidths.method),
              date.toLocaleDateString().padEnd(colWidths.date),
            ].join('  ');
            console.log(row);
          }

          process.exit(EXIT_CODES.SUCCESS);
        }

        // Sender is required if not showing tracked
        if (!sender) {
          console.error('Error: Sender email address or domain is required');
          console.error('');
          console.error('Usage: gmail-connector unsubscribe <sender>');
          console.error('');
          console.error('Examples:');
          console.error('  gmail-connector unsubscribe newsletter@example.com');
          console.error('  gmail-connector unsubscribe example.com');
          console.error('  gmail-connector unsubscribe --show-tracked');
          process.exit(EXIT_CODES.INVALID_ARGUMENT);
        }

        // Check if already unsubscribed
        const alreadyUnsubscribed = isAlreadyUnsubscribed(sender);
        if (alreadyUnsubscribed) {
          console.log(`Note: "${sender}" was already marked as unsubscribed on ${new Date(alreadyUnsubscribed.unsubscribedAt).toLocaleDateString()}`);
          console.log('');
        }

        // Get Gmail service
        const gmail = getGmailService({
          credentialsPath: globalOpts.config,
          verbose: globalOpts.verbose,
        });

        // Check authentication
        const isAuthenticated = await gmail.isAuthenticated();
        if (!isAuthenticated) {
          console.error('Error: Not authenticated. Please run: gmail-connector auth login');
          process.exit(EXIT_CODES.AUTHENTICATION_REQUIRED);
        }

        // Get messages resource
        const messagesApi = await gmail.getMessages();

        // Build search query - search for sender email or domain
        const isEmail = sender.includes('@');
        const query = isEmail ? `from:${sender}` : `from:@${sender}`;

        if (globalOpts.verbose) {
          console.log(`Searching for emails from: ${sender}`);
          console.log(`Query: ${query}`);
        }

        console.log(`Searching for unsubscribe links from "${sender}"...`);

        // Fetch recent messages from this sender
        const listResponse = await messagesApi.list({
          userId: 'me',
          maxResults: 50, // Check recent 50 emails from this sender
          q: query,
        });

        const messages = listResponse.data.messages ?? [];

        if (messages.length === 0) {
          console.log(`No emails found from "${sender}"`);
          console.log('');
          console.log('Tips:');
          console.log('  - Try using the full email address (e.g., newsletter@example.com)');
          console.log('  - Or use the domain (e.g., example.com)');
          console.log('  - Run "gmail-connector analyze newsletters" to see all newsletter senders');
          process.exit(EXIT_CODES.SUCCESS);
        }

        // Fetch message details to find List-Unsubscribe header
        let unsubscribeUrl: string | undefined;
        let unsubscribeEmail: string | undefined;
        let foundSender: string | undefined;
        const batchSize = 10;

        for (let i = 0; i < messages.length && !unsubscribeUrl && !unsubscribeEmail; i += batchSize) {
          const batch = messages.slice(i, i + batchSize);

          const promises = batch.map(async (msg) => {
            if (!msg.id) return null;

            try {
              const response = await messagesApi.get({
                userId: 'me',
                id: msg.id,
                format: 'metadata',
                metadataHeaders: ['From', 'List-Unsubscribe', 'List-Unsubscribe-Post'],
              });

              const msgData = response.data;
              const headers = msgData.payload?.headers;
              const fromRaw = getHeader(headers, 'From');
              const listUnsubscribe = getHeader(headers, 'List-Unsubscribe');

              if (!listUnsubscribe) return null;

              return {
                from: fromRaw,
                email: extractEmail(fromRaw),
                listUnsubscribe,
              };
            } catch {
              return null;
            }
          });

          const results = await Promise.all(promises);

          for (const result of results) {
            if (!result) continue;

            const parsed = parseUnsubscribeHeader(result.listUnsubscribe);
            if (parsed.url || parsed.email) {
              unsubscribeUrl = parsed.url;
              unsubscribeEmail = parsed.email;
              foundSender = result.email;
              break;
            }
          }
        }

        if (!unsubscribeUrl && !unsubscribeEmail) {
          console.log(`No unsubscribe link found for "${sender}"`);
          console.log('');
          console.log('This sender may not include List-Unsubscribe headers in their emails.');
          console.log('You may need to manually find the unsubscribe link in one of their emails,');
          console.log('or look for "unsubscribe" at the bottom of the email.');

          // Option to track as manually unsubscribed
          if (options.track !== false) {
            console.log('');
            console.log('Tip: You can manually track this sender as unsubscribed:');
            console.log(`  gmail-connector unsubscribe "${sender}" --track`);
          }

          process.exit(EXIT_CODES.SUCCESS);
        }

        // Output results
        if (options.json) {
          const jsonOutput = {
            sender: foundSender ?? sender,
            hasUnsubscribeLink: !!unsubscribeUrl,
            hasUnsubscribeEmail: !!unsubscribeEmail,
            unsubscribeUrl: unsubscribeUrl ?? null,
            unsubscribeEmail: unsubscribeEmail ?? null,
            alreadyTracked: !!alreadyUnsubscribed,
          };
          console.log(JSON.stringify(jsonOutput, null, 2));

          // Track if option enabled
          if (options.track !== false && (unsubscribeUrl || unsubscribeEmail)) {
            trackUnsubscribedSender(
              foundSender ?? sender,
              unsubscribeUrl ? 'link' : 'email',
              unsubscribeUrl,
              unsubscribeEmail
            );
          }

          process.exit(EXIT_CODES.SUCCESS);
        }

        console.log('');
        console.log(`Unsubscribe options for: ${foundSender ?? sender}`);
        console.log('═'.repeat(60));

        if (unsubscribeUrl) {
          console.log('');
          console.log('📎 Unsubscribe Link:');
          console.log(`   ${unsubscribeUrl}`);
          console.log('');
          console.log('   Click the link above or copy it to your browser.');
        }

        if (unsubscribeEmail) {
          console.log('');
          console.log('📧 Unsubscribe Email:');
          console.log(`   mailto:${unsubscribeEmail}`);
          console.log('');
          console.log('   Send an email to this address to unsubscribe.');
        }

        console.log('');

        // Open in browser if requested
        if (options.open && unsubscribeUrl) {
          console.log('Opening unsubscribe link in browser...');

          // Dynamic import for 'open' package
          const openModule = await import('open');
          const open = openModule.default;

          await open(unsubscribeUrl);
          console.log('✓ Browser opened');
        }

        // Track unsubscribed sender
        if (options.track !== false) {
          trackUnsubscribedSender(
            foundSender ?? sender,
            unsubscribeUrl ? 'link' : 'email',
            unsubscribeUrl,
            unsubscribeEmail
          );

          console.log(`✓ Sender "${foundSender ?? sender}" tracked as unsubscribed`);
          console.log('  View tracked senders with: gmail-connector unsubscribe --show-tracked');
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

  return unsubscribe;
}
