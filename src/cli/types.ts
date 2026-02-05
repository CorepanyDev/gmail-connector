/**
 * CLI types and interfaces
 */

/**
 * Global CLI options passed to all commands
 */
export interface GlobalOptions {
  /** Enable verbose output for debugging */
  verbose: boolean;
  /** Path to credentials.json file */
  config: string;
}

/**
 * Command handler function type
 */
export type CommandHandler<T = Record<string, unknown>> = (
  args: T,
  options: GlobalOptions
) => Promise<void>;

/**
 * Exit codes for CLI
 */
export const EXIT_CODES = {
  SUCCESS: 0,
  ERROR: 1,
  INVALID_ARGUMENT: 2,
  AUTHENTICATION_REQUIRED: 3,
} as const;

export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];
