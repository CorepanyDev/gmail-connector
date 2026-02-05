/**
 * Get email details command
 * Shows full details of a specific email including headers, body, and attachments
 */

import { Command } from 'commander';
import type { gmail_v1 } from 'googleapis';
import { getGmailService, GmailServiceError } from '../../gmail';
import type { GlobalOptions } from '../types';
import { EXIT_CODES } from '../types';

/**
 * Attachment information structure
 */
interface AttachmentInfo {
  filename: string;
  mimeType: string;
  size: number;
  attachmentId: string;
}

/**
 * Email details output structure
 */
interface EmailDetails {
  id: string;
  threadId: string;
  from: string;
  to: string[];
  cc: string[];
  bcc: string[];
  replyTo: string;
  date: string;
  subject: string;
  snippet: string;
  labels: string[];
  body: string;
  bodyHtml?: string;
  attachments: AttachmentInfo[];
  sizeEstimate: number;
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
 * Parse comma-separated email addresses into array
 */
function parseAddresses(addressStr: string): string[] {
  if (!addressStr) return [];
  // Split by comma, but be careful with "Name, Jr <email>" format
  // Use a regex that handles quoted names properly
  const addresses: string[] = [];
  let current = '';
  let inQuotes = false;
  let angleBracketDepth = 0;

  for (const char of addressStr) {
    if (char === '"') {
      inQuotes = !inQuotes;
      current += char;
    } else if (char === '<') {
      angleBracketDepth++;
      current += char;
    } else if (char === '>') {
      angleBracketDepth--;
      current += char;
    } else if (char === ',' && !inQuotes && angleBracketDepth === 0) {
      const trimmed = current.trim();
      if (trimmed) addresses.push(trimmed);
      current = '';
    } else {
      current += char;
    }
  }
  const trimmed = current.trim();
  if (trimmed) addresses.push(trimmed);

  return addresses;
}

/**
 * Format date for display
 */
function formatDate(dateStr: string): string {
  if (!dateStr) return 'Unknown';
  try {
    const date = new Date(dateStr);
    return date.toLocaleString('en-US', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
    });
  } catch {
    return dateStr;
  }
}

/**
 * Format file size for display
 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Decode base64url encoded string
 */
function decodeBase64Url(encoded: string): string {
  // Convert base64url to base64
  let base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  // Add padding if needed
  while (base64.length % 4) {
    base64 += '=';
  }
  return Buffer.from(base64, 'base64').toString('utf-8');
}

/**
 * Extract body text from message parts recursively
 */
function extractBody(
  payload: gmail_v1.Schema$MessagePart | undefined,
  preferHtml: boolean = false
): { text: string; html?: string } {
  if (!payload) return { text: '' };

  const result: { text: string; html?: string } = { text: '' };

  // Check if this part has body data directly
  if (payload.body?.data) {
    const decoded = decodeBase64Url(payload.body.data);
    if (payload.mimeType === 'text/html') {
      result.html = decoded;
    } else if (payload.mimeType === 'text/plain') {
      result.text = decoded;
    }
    return result;
  }

  // Recursively search parts for text/plain and text/html
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        result.text = decodeBase64Url(part.body.data);
      } else if (part.mimeType === 'text/html' && part.body?.data) {
        result.html = decodeBase64Url(part.body.data);
      } else if (part.mimeType?.startsWith('multipart/')) {
        // Nested multipart - recurse
        const nested = extractBody(part, preferHtml);
        if (nested.text && !result.text) result.text = nested.text;
        if (nested.html && !result.html) result.html = nested.html;
      }
    }
  }

  return result;
}

/**
 * Extract attachments from message parts
 */
function extractAttachments(
  payload: gmail_v1.Schema$MessagePart | undefined
): AttachmentInfo[] {
  const attachments: AttachmentInfo[] = [];

  function traverse(part: gmail_v1.Schema$MessagePart): void {
    // Check if this part is an attachment
    if (part.filename && part.body?.attachmentId) {
      attachments.push({
        filename: part.filename,
        mimeType: part.mimeType ?? 'application/octet-stream',
        size: part.body.size ?? 0,
        attachmentId: part.body.attachmentId,
      });
    }

    // Recurse into child parts
    if (part.parts) {
      for (const child of part.parts) {
        traverse(child);
      }
    }
  }

  if (payload) {
    traverse(payload);
  }

  return attachments;
}

/**
 * Strip HTML tags for plain text display
 */
function stripHtml(html: string): string {
  // Basic HTML to text conversion
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n\s*\n\s*\n/g, '\n\n')
    .trim();
}

/**
 * Create the get command
 */
export function createGetCommand(): Command {
  const get = new Command('get')
    .description('Get details of a specific email')
    .argument('<message-id>', 'The ID of the message to retrieve')
    .option('--full', 'Show complete body instead of preview')
    .option('--json', 'Output as JSON')
    .action(
      async (
        messageId: string,
        options: { full?: boolean; json?: boolean },
        cmd: Command
      ) => {
        const globalOpts = cmd.optsWithGlobals<GlobalOptions>();

        if (globalOpts.verbose) {
          console.log('Get options:', { messageId, ...options, config: globalOpts.config });
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

          if (globalOpts.verbose) {
            console.log(`Fetching message ${messageId}...`);
          }

          // Fetch the full message
          const response = await messages.get({
            userId: 'me',
            id: messageId,
            format: 'full',
          });

          const message = response.data;
          const headers = message.payload?.headers;

          // Extract headers
          const from = getHeader(headers, 'From');
          const to = parseAddresses(getHeader(headers, 'To'));
          const cc = parseAddresses(getHeader(headers, 'Cc'));
          const bcc = parseAddresses(getHeader(headers, 'Bcc'));
          const replyTo = getHeader(headers, 'Reply-To');
          const dateStr = getHeader(headers, 'Date');
          const subject = getHeader(headers, 'Subject') || '(no subject)';

          // Extract body
          const bodyContent = extractBody(message.payload);
          let bodyText = bodyContent.text;
          if (!bodyText && bodyContent.html) {
            // Convert HTML to plain text if no text/plain part exists
            bodyText = stripHtml(bodyContent.html);
          }

          // Extract attachments
          const attachments = extractAttachments(message.payload);

          // Build email details object
          const emailDetails: EmailDetails = {
            id: message.id ?? '',
            threadId: message.threadId ?? '',
            from,
            to,
            cc,
            bcc,
            replyTo,
            date: dateStr,
            subject,
            snippet: message.snippet ?? '',
            labels: message.labelIds ?? [],
            body: bodyText,
            bodyHtml: bodyContent.html,
            attachments,
            sizeEstimate: message.sizeEstimate ?? 0,
          };

          // Output based on format
          if (options.json) {
            // For JSON, include body based on --full flag
            const output = {
              ...emailDetails,
              body: options.full ? emailDetails.body : emailDetails.body.slice(0, 500),
            };
            console.log(JSON.stringify(output, null, 2));
          } else {
            // Human-readable output
            console.log('');
            console.log('═'.repeat(70));
            console.log('');

            // Headers
            console.log(`Subject:  ${subject}`);
            console.log(`From:     ${from}`);
            console.log(`To:       ${to.join(', ') || '(none)'}`);
            if (cc.length > 0) {
              console.log(`Cc:       ${cc.join(', ')}`);
            }
            if (bcc.length > 0) {
              console.log(`Bcc:      ${bcc.join(', ')}`);
            }
            if (replyTo) {
              console.log(`Reply-To: ${replyTo}`);
            }
            console.log(`Date:     ${formatDate(dateStr)}`);
            console.log(`Size:     ${formatSize(emailDetails.sizeEstimate)}`);
            console.log(`Labels:   ${emailDetails.labels.join(', ') || '(none)'}`);
            console.log(`ID:       ${emailDetails.id}`);
            console.log(`Thread:   ${emailDetails.threadId}`);

            // Attachments
            if (attachments.length > 0) {
              console.log('');
              console.log('─'.repeat(70));
              console.log('Attachments:');
              for (const att of attachments) {
                console.log(`  • ${att.filename} (${att.mimeType}, ${formatSize(att.size)})`);
              }
            }

            // Body
            console.log('');
            console.log('─'.repeat(70));
            console.log('Body:');
            console.log('');

            if (bodyText) {
              if (options.full) {
                console.log(bodyText);
              } else {
                // Show preview (first 500 chars)
                const preview = bodyText.slice(0, 500);
                console.log(preview);
                if (bodyText.length > 500) {
                  console.log('');
                  console.log(`... (${bodyText.length - 500} more characters)`);
                  console.log('Use --full to see the complete body.');
                }
              }
            } else {
              console.log('(no body content)');
            }

            console.log('');
            console.log('═'.repeat(70));
          }

          process.exit(EXIT_CODES.SUCCESS);
        } catch (err) {
          if (err instanceof GmailServiceError) {
            console.error(`Error: ${err.message}`);
            if (err.code === 'not_authenticated') {
              process.exit(EXIT_CODES.AUTHENTICATION_REQUIRED);
            }
          } else if (err instanceof Error) {
            // Handle Gmail API errors
            const apiError = err as Error & { code?: number; errors?: unknown[] };
            if (apiError.code === 404) {
              console.error(`Error: Message not found with ID: ${messageId}`);
              console.error('Make sure the message ID is correct. You can find message IDs using the "list" command.');
            } else {
              console.error(`Error: ${err.message}`);
              if (globalOpts.verbose && err.stack) {
                console.error(err.stack);
              }
            }
          } else {
            console.error('An unknown error occurred');
          }
          process.exit(EXIT_CODES.ERROR);
        }
      }
    );

  return get;
}
