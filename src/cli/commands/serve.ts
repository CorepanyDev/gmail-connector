import { Command } from 'commander';
import { getGmailService } from '../../gmail';
import { getCalendarService } from '../../calendar';
import { getTasksService } from '../../tasks';
import { startServer } from '../../api';
import type { GlobalOptions } from '../types';
import { EXIT_CODES } from '../types';

export function createServeCommand(): Command {
  const serve = new Command('serve')
    .description('Start the REST API server')
    .option('-p, --port <number>', 'Port to listen on', '3000')
    .option('--api-key <key>', 'API key for authentication (or set API_KEY env var)')
    .action(async (options: { port: string; apiKey?: string }, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals<GlobalOptions>();
      const apiKey = options.apiKey ?? process.env.API_KEY;

      if (!apiKey) {
        console.error('Error: API key is required.');
        console.error('Provide via --api-key flag or API_KEY environment variable.');
        console.error('');
        console.error('Generate one with:');
        console.error('  export API_KEY=$(node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))")');
        process.exit(EXIT_CODES.INVALID_ARGUMENT);
      }

      const port = parseInt(options.port, 10);
      if (isNaN(port) || port < 1 || port > 65535) {
        console.error('Error: --port must be a number between 1 and 65535');
        process.exit(EXIT_CODES.INVALID_ARGUMENT);
      }

      // Initialize services with the configured credentials path
      const serviceConfig = {
        credentialsPath: globalOpts.config,
        verbose: globalOpts.verbose,
      };

      getGmailService(serviceConfig);
      getCalendarService(serviceConfig);
      getTasksService(serviceConfig);

      // Verify Google OAuth is set up
      const gmail = getGmailService();
      const authenticated = await gmail.isAuthenticated();
      if (!authenticated) {
        console.error('Warning: Google OAuth not authenticated.');
        console.error('Run "gmail-connector auth login" first to set up OAuth.');
        console.error('The server will start but API calls requiring auth will fail.');
      }

      startServer({
        port,
        apiKey,
        credentialsPath: globalOpts.config,
        tokenPath: './token.json',
        verbose: globalOpts.verbose,
      });
    });

  return serve;
}
