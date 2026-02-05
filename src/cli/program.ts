/**
 * Main CLI program definition
 */

import { Command } from 'commander';
import { version, description } from '../../package.json';
import {
  createAuthCommand,
  createListCommand,
  createGetCommand,
  createSearchCommand,
  createSyncCommand,
  createLabelsCommand,
  createLabelCommand,
} from './commands';
import { EXIT_CODES } from './types';

const DEFAULT_CREDENTIALS_PATH = './credentials.json';

/**
 * Create and configure the main CLI program
 */
export function createProgram(): Command {
  const program = new Command();

  program
    .name('gmail-connector')
    .description(description)
    .version(version, '-v, --version', 'Display version number')
    .option('-V, --verbose', 'Enable verbose output for debugging', false)
    .option(
      '-c, --config <path>',
      'Path to credentials.json file',
      DEFAULT_CREDENTIALS_PATH
    )
    .configureHelp({
      sortSubcommands: true,
      sortOptions: true,
    });

  // Add subcommands
  program.addCommand(createAuthCommand());
  program.addCommand(createListCommand());
  program.addCommand(createGetCommand());
  program.addCommand(createSearchCommand());
  program.addCommand(createSyncCommand());
  program.addCommand(createLabelsCommand());
  program.addCommand(createLabelCommand());

  // Handle unknown commands
  program.on('command:*', (operands: string[]) => {
    console.error(`Unknown command: ${operands[0]}`);
    console.error('');
    program.outputHelp();
    process.exit(EXIT_CODES.INVALID_ARGUMENT);
  });

  return program;
}

/**
 * Run the CLI program
 */
export async function run(argv: string[] = process.argv): Promise<void> {
  const program = createProgram();

  try {
    await program.parseAsync(argv);
  } catch (err) {
    if (err instanceof Error) {
      console.error(`Error: ${err.message}`);
      if (process.env.DEBUG) {
        console.error(err.stack);
      }
    } else {
      console.error('An unexpected error occurred');
    }
    process.exit(EXIT_CODES.ERROR);
  }
}
