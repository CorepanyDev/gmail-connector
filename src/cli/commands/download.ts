/**
 * Download attachment command
 * Downloads attachments from emails to local filesystem
 */

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
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
 * Format file size for display
 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Extract attachments from message parts
 */
function extractAttachments(
  payload: gmail_v1.Schema$MessagePart | undefined
): AttachmentInfo[] {
  const attachments: AttachmentInfo[] = [];

  function traverse(part: gmail_v1.Schema$MessagePart): void {
    if (part.filename && part.body?.attachmentId) {
      attachments.push({
        filename: part.filename,
        mimeType: part.mimeType ?? 'application/octet-stream',
        size: part.body.size ?? 0,
        attachmentId: part.body.attachmentId,
      });
    }

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
 * Decode base64url encoded data to Buffer
 */
function decodeBase64UrlToBuffer(encoded: string): Buffer {
  let base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  return Buffer.from(base64, 'base64');
}

/**
 * Create the download command
 */
export function createDownloadCommand(): Command {
  const download = new Command('download')
    .description('Download attachments from an email')
    .argument('<message-id>', 'The ID of the message')
    .option('-o, --output <path>', 'Output directory (default: current directory)')
    .option('-a, --attachment <name>', 'Download specific attachment by filename')
    .option('-i, --index <number>', 'Download specific attachment by index (0-based)')
    .option('--all', 'Download all attachments')
    .option('--list', 'List attachments without downloading')
    .action(
      async (
        messageId: string,
        options: {
          output?: string;
          attachment?: string;
          index?: string;
          all?: boolean;
          list?: boolean;
        },
        cmd: Command
      ) => {
        const globalOpts = cmd.optsWithGlobals<GlobalOptions>();

        if (globalOpts.verbose) {
          console.log('Download options:', { messageId, ...options, config: globalOpts.config });
        }

        try {
          const gmail = getGmailService({
            credentialsPath: globalOpts.config,
            verbose: globalOpts.verbose,
          });

          const isAuthenticated = await gmail.isAuthenticated();
          if (!isAuthenticated) {
            console.error(
              'Error: Not authenticated. Please run: gmail-connector auth login'
            );
            process.exit(EXIT_CODES.AUTHENTICATION_REQUIRED);
          }

          const messages = await gmail.getMessages();

          if (globalOpts.verbose) {
            console.log(`Fetching message ${messageId}...`);
          }

          // Fetch the message to get attachment info
          const response = await messages.get({
            userId: 'me',
            id: messageId,
            format: 'full',
          });

          const message = response.data;
          const attachments = extractAttachments(message.payload);

          if (attachments.length === 0) {
            console.log('No attachments found in this email.');
            process.exit(EXIT_CODES.SUCCESS);
          }

          // List mode - just show attachments
          if (options.list) {
            console.log(`\nAttachments (${attachments.length}):`);
            attachments.forEach((att, idx) => {
              console.log(`  [${idx}] ${att.filename} (${att.mimeType}, ${formatSize(att.size)})`);
            });
            process.exit(EXIT_CODES.SUCCESS);
          }

          // Determine which attachments to download
          let toDownload: AttachmentInfo[] = [];

          if (options.all) {
            toDownload = attachments;
          } else if (options.index !== undefined) {
            const idx = parseInt(options.index, 10);
            if (isNaN(idx) || idx < 0 || idx >= attachments.length) {
              console.error(`Error: Invalid attachment index. Valid range: 0-${attachments.length - 1}`);
              process.exit(EXIT_CODES.ERROR);
            }
            toDownload = [attachments[idx]];
          } else if (options.attachment) {
            const found = attachments.filter((a) =>
              a.filename.toLowerCase().includes(options.attachment!.toLowerCase())
            );
            if (found.length === 0) {
              console.error(`Error: No attachment found matching "${options.attachment}"`);
              console.log('\nAvailable attachments:');
              attachments.forEach((att, idx) => {
                console.log(`  [${idx}] ${att.filename}`);
              });
              process.exit(EXIT_CODES.ERROR);
            }
            toDownload = found;
          } else {
            // Default: download all if only one, otherwise prompt
            if (attachments.length === 1) {
              toDownload = attachments;
            } else {
              console.log(`\nMultiple attachments found (${attachments.length}):`);
              attachments.forEach((att, idx) => {
                console.log(`  [${idx}] ${att.filename} (${formatSize(att.size)})`);
              });
              console.log('\nUse --all to download all, or --index <n> to download specific one.');
              process.exit(EXIT_CODES.SUCCESS);
            }
          }

          // Determine output directory
          const outputDir = options.output || process.cwd();

          // Ensure output directory exists
          if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
          }

          // Download each attachment
          for (const att of toDownload) {
            if (globalOpts.verbose) {
              console.log(`Downloading attachment: ${att.filename}...`);
            }

            // Get attachment data
            const attResponse = await messages.attachments.get({
              userId: 'me',
              messageId: messageId,
              id: att.attachmentId,
            });

            if (!attResponse.data.data) {
              console.error(`Error: Could not download ${att.filename}`);
              continue;
            }

            // Decode and save
            const data = decodeBase64UrlToBuffer(attResponse.data.data);
            const outputPath = path.join(outputDir, att.filename);

            fs.writeFileSync(outputPath, data);
            console.log(`Downloaded: ${outputPath} (${formatSize(data.length)})`);
          }

          process.exit(EXIT_CODES.SUCCESS);
        } catch (err) {
          if (err instanceof GmailServiceError) {
            console.error(`Error: ${err.message}`);
            if (err.code === 'not_authenticated') {
              process.exit(EXIT_CODES.AUTHENTICATION_REQUIRED);
            }
          } else if (err instanceof Error) {
            const apiError = err as Error & { code?: number };
            if (apiError.code === 404) {
              console.error(`Error: Message not found with ID: ${messageId}`);
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

  return download;
}
