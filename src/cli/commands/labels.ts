/**
 * Labels command
 * List and manage Gmail labels (system and user-created)
 */

import { Command } from 'commander';
import type { gmail_v1 } from 'googleapis';
import { getGmailService, GmailServiceError } from '../../gmail';
import type { GlobalOptions } from '../types';
import { EXIT_CODES } from '../types';

/**
 * Label display data structure
 */
interface LabelDisplay {
  id: string;
  name: string;
  type: 'system' | 'user';
  messageCount: number;
  threadsTotal?: number;
  color?: {
    textColor?: string;
    backgroundColor?: string;
  };
}

/**
 * Labels list output for JSON format
 */
interface LabelsListOutput {
  labels: LabelDisplay[];
  systemCount: number;
  userCount: number;
  totalCount: number;
}

/**
 * Extract display data from a Gmail label
 */
function extractLabelDisplay(label: gmail_v1.Schema$Label): LabelDisplay {
  return {
    id: label.id ?? '',
    name: label.name ?? '',
    type: label.type === 'user' ? 'user' : 'system',
    messageCount: label.messagesTotal ?? 0,
    threadsTotal: label.threadsTotal ?? undefined,
    color: label.color
      ? {
          textColor: label.color.textColor ?? undefined,
          backgroundColor: label.color.backgroundColor ?? undefined,
        }
      : undefined,
  };
}

/**
 * Sort labels: by type (system first), then alphabetically by name
 */
function sortLabels(labels: LabelDisplay[]): LabelDisplay[] {
  return [...labels].sort((a, b) => {
    // System labels first
    if (a.type !== b.type) {
      return a.type === 'system' ? -1 : 1;
    }
    // Then alphabetically by name
    return a.name.localeCompare(b.name);
  });
}

/**
 * Format a table row for label display
 */
function formatLabelRow(
  name: string,
  type: string,
  count: string,
  widths: { name: number; type: number; count: number }
): string {
  const paddedName = name.padEnd(widths.name);
  const paddedType = type.padEnd(widths.type);
  const paddedCount = count.padStart(widths.count);
  return `${paddedName}  ${paddedType}  ${paddedCount}`;
}

/**
 * Truncate string to specified length
 */
function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}

/**
 * Create the labels command with subcommands
 */
export function createLabelsCommand(): Command {
  const labels = new Command('labels').description('Manage Gmail labels');

  // Labels list subcommand
  labels
    .command('list')
    .description('List all Gmail labels (system and user-created)')
    .option('--json', 'Output as JSON')
    .action(async (options: { json?: boolean }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals<GlobalOptions>();

      if (globalOpts.verbose) {
        console.log('Labels list options:', { ...options, config: globalOpts.config });
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

        // Get labels resource
        const labelsResource = await gmail.getLabels();

        if (globalOpts.verbose) {
          console.log('Fetching labels...');
        }

        // List all labels
        const listResponse = await labelsResource.list({
          userId: 'me',
        });

        const labelList = listResponse.data.labels ?? [];

        if (labelList.length === 0) {
          if (options.json) {
            console.log(
              JSON.stringify({ labels: [], systemCount: 0, userCount: 0, totalCount: 0 }, null, 2)
            );
          } else {
            console.log('No labels found.');
          }
          process.exit(EXIT_CODES.SUCCESS);
        }

        if (globalOpts.verbose) {
          console.log(`Found ${labelList.length} labels, fetching details...`);
        }

        // Fetch detailed info for each label (to get message counts)
        const labelDetails: LabelDisplay[] = [];
        const batchSize = 10;

        for (let i = 0; i < labelList.length; i += batchSize) {
          const batch = labelList.slice(i, i + batchSize);
          const detailPromises = batch.map(async (lbl) => {
            if (!lbl.id) return null;
            try {
              const detail = await labelsResource.get({
                userId: 'me',
                id: lbl.id,
              });
              return extractLabelDisplay(detail.data);
            } catch {
              // If we can't get details, use basic info
              return extractLabelDisplay(lbl);
            }
          });

          const batchResults = await Promise.all(detailPromises);
          labelDetails.push(
            ...batchResults.filter((l): l is LabelDisplay => l !== null)
          );
        }

        // Sort labels by type, then name
        const sortedLabels = sortLabels(labelDetails);

        // Group by type
        const systemLabels = sortedLabels.filter((l) => l.type === 'system');
        const userLabels = sortedLabels.filter((l) => l.type === 'user');

        // Output based on format
        if (options.json) {
          const output: LabelsListOutput = {
            labels: sortedLabels,
            systemCount: systemLabels.length,
            userCount: userLabels.length,
            totalCount: sortedLabels.length,
          };
          console.log(JSON.stringify(output, null, 2));
        } else {
          // Calculate column widths for table display
          const widths = {
            name: 35,
            type: 8,
            count: 10,
          };

          // Print system labels section
          if (systemLabels.length > 0) {
            console.log('');
            console.log('SYSTEM LABELS');
            console.log('═'.repeat(widths.name + widths.type + widths.count + 4));
            console.log(formatLabelRow('NAME', 'TYPE', 'MESSAGES', widths));
            console.log('─'.repeat(widths.name + widths.type + widths.count + 4));

            for (const label of systemLabels) {
              console.log(
                formatLabelRow(
                  truncate(label.name, widths.name),
                  label.type,
                  label.messageCount.toLocaleString(),
                  widths
                )
              );
            }
          }

          // Print user labels section
          if (userLabels.length > 0) {
            console.log('');
            console.log('USER LABELS');
            console.log('═'.repeat(widths.name + widths.type + widths.count + 4));
            console.log(formatLabelRow('NAME', 'TYPE', 'MESSAGES', widths));
            console.log('─'.repeat(widths.name + widths.type + widths.count + 4));

            for (const label of userLabels) {
              console.log(
                formatLabelRow(
                  truncate(label.name, widths.name),
                  label.type,
                  label.messageCount.toLocaleString(),
                  widths
                )
              );
            }
          }

          // Print summary
          console.log('');
          console.log(
            `Total: ${sortedLabels.length} labels (${systemLabels.length} system, ${userLabels.length} user)`
          );
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

  return labels;
}
