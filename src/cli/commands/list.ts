/**
 * List emails command (placeholder)
 */

import { Command } from 'commander';
import type { GlobalOptions } from '../types';

/**
 * Create the list command
 */
export function createListCommand(): Command {
  const list = new Command('list')
    .description('List inbox emails')
    .option('-l, --limit <number>', 'Number of emails to show', '20')
    .option('-p, --page-token <token>', 'Pagination token for next page')
    .option('--json', 'Output as JSON')
    .action((options: { limit: string; pageToken?: string; json?: boolean }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals<GlobalOptions>();

      if (globalOpts.verbose) {
        console.log('List options:', { ...options, config: globalOpts.config });
      }

      // Placeholder - will be implemented in PRD item #7
      console.log('List command not yet implemented.');
      console.log('This will show inbox emails with pagination.');
      process.exit(0);
    });

  return list;
}
