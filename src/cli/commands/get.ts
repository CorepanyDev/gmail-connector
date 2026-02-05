/**
 * Get email details command (placeholder)
 */

import { Command } from 'commander';
import type { GlobalOptions } from '../types';

/**
 * Create the get command
 */
export function createGetCommand(): Command {
  const get = new Command('get')
    .description('Get details of a specific email')
    .argument('<message-id>', 'The ID of the message to retrieve')
    .option('--full', 'Show complete body instead of preview')
    .option('--json', 'Output as JSON')
    .action((messageId: string, options: { full?: boolean; json?: boolean }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals<GlobalOptions>();

      if (globalOpts.verbose) {
        console.log('Get options:', { messageId, ...options, config: globalOpts.config });
      }

      // Placeholder - will be implemented in PRD item #8
      console.log('Get command not yet implemented.');
      console.log(`Would retrieve message: ${messageId}`);
      process.exit(0);
    });

  return get;
}
