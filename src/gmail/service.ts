/**
 * Gmail service singleton
 * Provides a reusable authenticated Gmail API client
 */

import { google, gmail_v1 } from 'googleapis';
import {
  loadCredentials,
  getValidTokens,
  createAuthenticatedClient,
  authenticate,
  saveTokens,
  CredentialsError,
  TokenError,
} from '../auth';
import type { ValidatedCredentials, StoredTokens } from '../auth';

const DEFAULT_CREDENTIALS_PATH = './credentials.json';
const DEFAULT_TOKEN_PATH = './token.json';

export class GmailServiceError extends Error {
  constructor(message: string, public readonly code?: string) {
    super(message);
    this.name = 'GmailServiceError';
  }
}

export interface GmailServiceConfig {
  /** Path to credentials.json (default: ./credentials.json) */
  credentialsPath?: string;
  /** Path to token.json (default: ./token.json) */
  tokenPath?: string;
  /** Verbose output for debugging */
  verbose?: boolean;
}

/**
 * Gmail service singleton class
 * Manages authentication and provides access to Gmail API
 */
class GmailService {
  private static instance: GmailService | null = null;

  private gmailClient: gmail_v1.Gmail | null = null;
  private credentials: ValidatedCredentials | null = null;
  private tokens: StoredTokens | null = null;
  private config: Required<GmailServiceConfig>;
  private initialized: boolean = false;

  private constructor(config: GmailServiceConfig = {}) {
    this.config = {
      credentialsPath: config.credentialsPath ?? DEFAULT_CREDENTIALS_PATH,
      tokenPath: config.tokenPath ?? DEFAULT_TOKEN_PATH,
      verbose: config.verbose ?? false,
    };
  }

  /**
   * Get the singleton instance
   * Creates a new instance if one doesn't exist or if config differs
   */
  public static getInstance(config?: GmailServiceConfig): GmailService {
    if (!GmailService.instance) {
      GmailService.instance = new GmailService(config);
    } else if (config) {
      // Update config if provided
      GmailService.instance.updateConfig(config);
    }
    return GmailService.instance;
  }

  /**
   * Reset the singleton instance
   * Useful for testing or reconfiguration
   */
  public static resetInstance(): void {
    GmailService.instance = null;
  }

  /**
   * Update service configuration
   * Resets initialization if paths change
   */
  private updateConfig(config: GmailServiceConfig): void {
    const pathsChanged =
      (config.credentialsPath !== undefined &&
        config.credentialsPath !== this.config.credentialsPath) ||
      (config.tokenPath !== undefined &&
        config.tokenPath !== this.config.tokenPath);

    this.config = {
      ...this.config,
      ...config,
    };

    // Reset if paths changed
    if (pathsChanged) {
      this.gmailClient = null;
      this.credentials = null;
      this.tokens = null;
      this.initialized = false;
    }
  }

  /**
   * Initialize the service by loading credentials and tokens
   * Does not trigger authentication - call authenticate() for that
   */
  private async initializeIfNeeded(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Load credentials
    try {
      this.credentials = loadCredentials(this.config.credentialsPath);
    } catch (err) {
      if (err instanceof CredentialsError) {
        throw new GmailServiceError(
          `Failed to load credentials: ${err.message}`,
          'credentials_error'
        );
      }
      throw err;
    }

    // Try to load existing tokens
    try {
      this.tokens = await getValidTokens(
        this.credentials,
        this.config.tokenPath
      );
    } catch (err) {
      // Token errors are expected if not authenticated yet
      if (err instanceof TokenError && err.code === 'token_revoked') {
        // Tokens were revoked, need re-authentication
        this.tokens = null;
      } else if (!(err instanceof TokenError)) {
        throw err;
      }
    }

    // Create Gmail client if tokens exist
    if (this.tokens) {
      this.createGmailClient();
    }

    this.initialized = true;
  }

  /**
   * Create the Gmail API client from current tokens
   */
  private createGmailClient(): void {
    if (!this.tokens || !this.credentials) {
      throw new GmailServiceError(
        'Cannot create Gmail client without tokens and credentials',
        'not_initialized'
      );
    }

    const oAuth2Client = createAuthenticatedClient(this.tokens, this.credentials);
    this.gmailClient = google.gmail({ version: 'v1', auth: oAuth2Client });
  }

  /**
   * Check if the service is authenticated
   */
  public async isAuthenticated(): Promise<boolean> {
    await this.initializeIfNeeded();
    return this.tokens !== null && this.gmailClient !== null;
  }

  /**
   * Authenticate the service
   * Opens browser for OAuth consent flow if no valid tokens exist
   */
  public async authenticate(options?: {
    force?: boolean;
    verbose?: boolean;
  }): Promise<void> {
    await this.initializeIfNeeded();

    if (!this.credentials) {
      throw new GmailServiceError(
        'Credentials not loaded. Ensure credentials.json exists.',
        'no_credentials'
      );
    }

    const force = options?.force ?? false;
    const verbose = options?.verbose ?? this.config.verbose;

    // If already authenticated and not forcing, we're done
    if (!force && this.tokens && this.gmailClient) {
      if (verbose) {
        console.log('Already authenticated.');
      }
      return;
    }

    // Run OAuth flow
    if (verbose) {
      console.log('Starting authentication flow...');
    }

    const tokens = await authenticate(this.credentials, { verbose });

    // Save tokens
    saveTokens(tokens, this.config.tokenPath);
    this.tokens = tokens;

    // Create Gmail client
    this.createGmailClient();

    if (verbose) {
      console.log('Authentication successful.');
    }
  }

  /**
   * Get the authenticated Gmail API client
   * Throws if not authenticated
   */
  public async getClient(): Promise<gmail_v1.Gmail> {
    await this.initializeIfNeeded();

    if (!this.gmailClient) {
      throw new GmailServiceError(
        'Not authenticated. Please run authentication first.\n' +
        'Use: gmail-connector auth login',
        'not_authenticated'
      );
    }

    // Refresh tokens if needed before returning client
    if (this.credentials && this.tokens) {
      try {
        const validTokens = await getValidTokens(
          this.credentials,
          this.config.tokenPath
        );
        if (validTokens && validTokens !== this.tokens) {
          this.tokens = validTokens;
          this.createGmailClient();
        }
      } catch {
        // Continue with existing client if refresh fails
      }
    }

    return this.gmailClient;
  }

  /**
   * Get the messages resource from Gmail API
   * Convenience method for accessing gmail.users.messages
   */
  public async getMessages(): Promise<gmail_v1.Resource$Users$Messages> {
    const client = await this.getClient();
    return client.users.messages;
  }

  /**
   * Get the labels resource from Gmail API
   * Convenience method for accessing gmail.users.labels
   */
  public async getLabels(): Promise<gmail_v1.Resource$Users$Labels> {
    const client = await this.getClient();
    return client.users.labels;
  }

  /**
   * Get the threads resource from Gmail API
   * Convenience method for accessing gmail.users.threads
   */
  public async getThreads(): Promise<gmail_v1.Resource$Users$Threads> {
    const client = await this.getClient();
    return client.users.threads;
  }

  /**
   * Get the history resource from Gmail API
   * Convenience method for accessing gmail.users.history
   */
  public async getHistory(): Promise<gmail_v1.Resource$Users$History> {
    const client = await this.getClient();
    return client.users.history;
  }

  /**
   * Get user profile information
   */
  public async getProfile(): Promise<gmail_v1.Schema$Profile> {
    const client = await this.getClient();
    const response = await client.users.getProfile({ userId: 'me' });
    return response.data;
  }

  /**
   * Get current configuration
   */
  public getConfig(): Readonly<Required<GmailServiceConfig>> {
    return { ...this.config };
  }
}

// Export singleton accessor function
export function getGmailService(config?: GmailServiceConfig): GmailService {
  return GmailService.getInstance(config);
}

// Export for testing
export { GmailService };
