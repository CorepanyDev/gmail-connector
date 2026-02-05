/**
 * OAuth 2.0 authentication flow for Gmail API
 * Handles browser-based authorization and token exchange
 */

import { google } from 'googleapis';
import * as http from 'http';
import * as url from 'url';
import * as readline from 'readline';
import open from 'open';
import type { ValidatedCredentials } from './types';

/**
 * Gmail API scopes for email management
 */
export const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.labels',
  'https://www.googleapis.com/auth/tasks',
  'https://www.googleapis.com/auth/calendar',
] as const;

export type GmailScope = typeof GMAIL_SCOPES[number];

export class OAuthError extends Error {
  constructor(message: string, public readonly code?: string) {
    super(message);
    this.name = 'OAuthError';
  }
}

export interface OAuthTokens {
  access_token: string;
  refresh_token?: string;
  scope: string;
  token_type: string;
  expiry_date?: number;
}

export interface OAuthClient {
  oAuth2Client: InstanceType<typeof google.auth.OAuth2>;
  getAuthUrl: () => string;
  exchangeCode: (code: string) => Promise<OAuthTokens>;
}

/**
 * Create an OAuth2 client from validated credentials
 */
export function createOAuthClient(credentials: ValidatedCredentials): OAuthClient {
  const { clientId, clientSecret, redirectUri } = credentials;

  const oAuth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    redirectUri
  );

  return {
    oAuth2Client,

    /**
     * Generate the authorization URL for user consent
     */
    getAuthUrl(): string {
      return oAuth2Client.generateAuthUrl({
        access_type: 'offline', // Request refresh token
        scope: [...GMAIL_SCOPES],
        prompt: 'consent', // Force consent screen to ensure refresh token
      });
    },

    /**
     * Exchange authorization code for tokens
     */
    async exchangeCode(code: string): Promise<OAuthTokens> {
      try {
        const { tokens } = await oAuth2Client.getToken(code);

        if (!tokens.access_token) {
          throw new OAuthError('No access token received from Google');
        }

        return {
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token ?? undefined,
          scope: tokens.scope ?? GMAIL_SCOPES.join(' '),
          token_type: tokens.token_type ?? 'Bearer',
          expiry_date: tokens.expiry_date ?? undefined,
        };
      } catch (err) {
        const error = err as Error & { code?: string };

        if (error.message?.includes('invalid_grant')) {
          throw new OAuthError(
            'Authorization code has expired or already been used.\n' +
            'Please run the authentication again.',
            'invalid_grant'
          );
        }

        if (error.message?.includes('invalid_client')) {
          throw new OAuthError(
            'Invalid client credentials.\n' +
            'Please verify your credentials.json file is correct.',
            'invalid_client'
          );
        }

        throw new OAuthError(
          `Failed to exchange authorization code: ${error.message}`,
          error.code
        );
      }
    },
  };
}

/**
 * Extract port from redirect URI
 */
function extractPortFromUri(redirectUri: string): number {
  try {
    const parsed = new url.URL(redirectUri);
    return parseInt(parsed.port, 10) || 80;
  } catch {
    return 8080; // Default fallback port
  }
}

/**
 * Check if redirect URI is localhost-based
 */
function isLocalhostRedirect(redirectUri: string): boolean {
  return redirectUri.includes('localhost') || redirectUri.includes('127.0.0.1');
}

/**
 * Start a local HTTP server to receive the OAuth callback
 */
function startCallbackServer(port: number, timeoutMs: number = 120000): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const parsedUrl = url.parse(req.url ?? '', true);
      const query = parsedUrl.query;

      if (query.error) {
        const errorMessage = String(query.error_description || query.error);
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>Authorization Failed</title></head>
            <body style="font-family: system-ui; padding: 40px; text-align: center;">
              <h1 style="color: #d32f2f;">Authorization Failed</h1>
              <p>${errorMessage}</p>
              <p>You can close this window.</p>
            </body>
          </html>
        `);
        server.close();
        reject(new OAuthError(`Authorization denied: ${errorMessage}`, String(query.error)));
        return;
      }

      if (query.code) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>Authorization Successful</title></head>
            <body style="font-family: system-ui; padding: 40px; text-align: center;">
              <h1 style="color: #2e7d32;">✅ Authorization Successful!</h1>
              <p>You can close this window and return to the terminal.</p>
            </body>
          </html>
        `);
        server.close();
        resolve(String(query.code));
        return;
      }

      // Unknown request
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
    });

    // Set up timeout
    const timeout = setTimeout(() => {
      server.close();
      reject(new OAuthError(
        'Authorization timed out.\n' +
        'Please run the authentication again and complete it within 2 minutes.',
        'timeout'
      ));
    }, timeoutMs);

    server.on('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timeout);
      if (err.code === 'EADDRINUSE') {
        reject(new OAuthError(
          `Port ${port} is already in use.\n` +
          'Please close the application using this port or use manual code entry.',
          'port_in_use'
        ));
      } else {
        reject(new OAuthError(`Server error: ${err.message}`, err.code));
      }
    });

    server.on('close', () => {
      clearTimeout(timeout);
    });

    server.listen(port, () => {
      // Server started successfully
    });
  });
}

/**
 * Prompt user to enter authorization code manually
 */
async function promptForCode(authUrl: string): Promise<string> {
  console.log('\nPlease visit this URL to authorize the application:');
  console.log('\n' + authUrl + '\n');
  console.log('After authorizing, copy the code from the URL and paste it below.');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve, reject) => {
    rl.question('Enter the authorization code: ', (code) => {
      rl.close();
      const trimmedCode = code.trim();

      if (!trimmedCode) {
        reject(new OAuthError('No authorization code provided'));
        return;
      }

      resolve(trimmedCode);
    });

    rl.on('error', (err: Error) => {
      rl.close();
      reject(new OAuthError(`Failed to read input: ${err.message}`));
    });
  });
}

export interface AuthenticateOptions {
  /** Whether to open browser automatically (default: true) */
  openBrowser?: boolean;
  /** Force manual code entry instead of callback server */
  manualEntry?: boolean;
  /** Timeout in milliseconds for callback server (default: 120000) */
  timeout?: number;
  /** Verbose output for debugging */
  verbose?: boolean;
}

/**
 * Run the complete OAuth authentication flow
 * Opens browser for user consent and handles the callback
 */
export async function authenticate(
  credentials: ValidatedCredentials,
  options: AuthenticateOptions = {}
): Promise<OAuthTokens> {
  const {
    openBrowser = true,
    manualEntry = false,
    timeout = 120000,
    verbose = false,
  } = options;

  const client = createOAuthClient(credentials);
  const authUrl = client.getAuthUrl();
  const useLocalServer = isLocalhostRedirect(credentials.redirectUri) && !manualEntry;

  if (verbose) {
    console.log('OAuth Configuration:');
    console.log(`  Client ID: ${credentials.clientId.substring(0, 20)}...`);
    console.log(`  Redirect URI: ${credentials.redirectUri}`);
    console.log(`  Scopes: ${GMAIL_SCOPES.join(', ')}`);
    console.log(`  Mode: ${useLocalServer ? 'Local callback server' : 'Manual code entry'}`);
    console.log('');
  }

  let code: string;

  if (useLocalServer) {
    // Start callback server and open browser
    const port = extractPortFromUri(credentials.redirectUri);

    console.log('Starting authorization...');
    console.log('A browser window will open for you to authorize the application.\n');

    // Start server first
    const codePromise = startCallbackServer(port, timeout);

    // Open browser
    if (openBrowser) {
      try {
        await open(authUrl);
        if (verbose) {
          console.log('Browser opened successfully.');
        }
      } catch (err) {
        console.log('Could not open browser automatically.');
        console.log('Please visit this URL manually:');
        console.log('\n' + authUrl + '\n');
      }
    } else {
      console.log('Please visit this URL to authorize:');
      console.log('\n' + authUrl + '\n');
    }

    console.log('Waiting for authorization...');

    try {
      code = await codePromise;
      console.log('\nAuthorization code received!');
    } catch (err) {
      // If callback server fails, fall back to manual entry
      if (err instanceof OAuthError && err.code === 'port_in_use') {
        console.log('\nFalling back to manual code entry...');
        code = await promptForCode(authUrl);
      } else {
        throw err;
      }
    }
  } else {
    // Manual code entry mode
    code = await promptForCode(authUrl);
  }

  // Exchange code for tokens
  if (verbose) {
    console.log('\nExchanging authorization code for tokens...');
  }

  const tokens = await client.exchangeCode(code);

  if (verbose) {
    console.log('Tokens received:');
    console.log(`  Access token: ${tokens.access_token.substring(0, 20)}...`);
    console.log(`  Refresh token: ${tokens.refresh_token ? 'Yes' : 'No'}`);
    console.log(`  Expires: ${tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : 'Unknown'}`);
  }

  if (!tokens.refresh_token) {
    console.log('\n⚠️  Warning: No refresh token received.');
    console.log('This may happen if you have previously authorized this app.');
    console.log('To get a refresh token, revoke access at https://myaccount.google.com/permissions');
    console.log('and run authentication again.\n');
  }

  return tokens;
}
