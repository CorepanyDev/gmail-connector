/**
 * Authentication commands
 */

import { Command } from 'commander';
import { getGmailService, GmailServiceError } from '../../gmail';
import { tokensExist, deleteTokens } from '../../auth';
import type { GlobalOptions } from '../types';

/**
 * Create the auth command with subcommands
 */
export function createAuthCommand(): Command {
  const auth = new Command('auth')
    .description('Manage authentication with Gmail API');

  // auth login
  auth
    .command('login')
    .description('Authenticate with Gmail (opens browser for OAuth)')
    .option('-f, --force', 'Force re-authentication even if already logged in')
    .action(async (options: { force?: boolean }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals<GlobalOptions>();
      const service = getGmailService({
        credentialsPath: globalOpts.config,
        verbose: globalOpts.verbose,
      });

      try {
        await service.authenticate({
          force: options.force,
          verbose: globalOpts.verbose,
        });

        const profile = await service.getProfile();
        console.log(`Successfully authenticated as: ${profile.emailAddress}`);
      } catch (err) {
        if (err instanceof GmailServiceError) {
          console.error(`Authentication failed: ${err.message}`);
          process.exit(1);
        }
        throw err;
      }
    });

  // auth status
  auth
    .command('status')
    .description('Check current authentication status')
    .action(async (_options: Record<string, unknown>, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals<GlobalOptions>();
      const service = getGmailService({
        credentialsPath: globalOpts.config,
        verbose: globalOpts.verbose,
      });

      try {
        const isAuth = await service.isAuthenticated();

        if (isAuth) {
          const profile = await service.getProfile();
          console.log('Status: Authenticated');
          console.log(`Email: ${profile.emailAddress}`);
          if (profile.messagesTotal) {
            console.log(`Total messages: ${profile.messagesTotal.toLocaleString()}`);
          }
          if (profile.threadsTotal) {
            console.log(`Total threads: ${profile.threadsTotal.toLocaleString()}`);
          }
        } else {
          console.log('Status: Not authenticated');
          console.log('Run "gmail-connector auth login" to authenticate.');
          process.exit(1);
        }
      } catch (err) {
        if (err instanceof GmailServiceError) {
          console.log('Status: Not authenticated');
          console.log(`Reason: ${err.message}`);
          process.exit(1);
        }
        throw err;
      }
    });

  // auth logout
  auth
    .command('logout')
    .description('Remove stored authentication tokens')
    .action((_options: Record<string, unknown>, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals<GlobalOptions>();
      const tokenPath = globalOpts.config.replace('credentials.json', 'token.json');

      if (tokensExist(tokenPath)) {
        deleteTokens(tokenPath);
        console.log('Successfully logged out. Authentication tokens removed.');
      } else {
        console.log('No authentication tokens found. Already logged out.');
      }
    });

  return auth;
}
