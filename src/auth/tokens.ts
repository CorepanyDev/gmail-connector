/**
 * Token persistence and refresh management
 * Handles saving, loading, and auto-refreshing OAuth tokens
 */

import * as fs from 'fs';
import * as path from 'path';
import { google } from 'googleapis';
import type { OAuthTokens } from './oauth';
import type { ValidatedCredentials } from './types';

const DEFAULT_TOKEN_PATH = './token.json';

export class TokenError extends Error {
  constructor(message: string, public readonly code?: string) {
    super(message);
    this.name = 'TokenError';
  }
}

/**
 * Stored token structure (includes metadata)
 */
export interface StoredTokens extends OAuthTokens {
  created_at?: number;
  last_refresh?: number;
}

/**
 * Set secure file permissions (600 - owner read/write only)
 * No-op on Windows
 */
function setSecurePermissions(filePath: string): void {
  try {
    // 0o600 = owner read/write only
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Ignore errors (e.g., on Windows)
  }
}

/**
 * Check if tokens exist at the given path
 */
export function tokensExist(tokenPath: string = DEFAULT_TOKEN_PATH): boolean {
  return fs.existsSync(tokenPath);
}

/**
 * Load tokens from disk
 * Returns null if file doesn't exist or is invalid
 */
export function loadTokens(tokenPath: string = DEFAULT_TOKEN_PATH): StoredTokens | null {
  if (!tokensExist(tokenPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(tokenPath, 'utf-8');
    const tokens = JSON.parse(content) as StoredTokens;

    // Validate required fields
    if (!tokens.access_token) {
      return null;
    }

    return tokens;
  } catch (err) {
    // File exists but is invalid - log warning but don't throw
    console.warn(`Warning: Could not parse token file at ${tokenPath}`);
    return null;
  }
}

/**
 * Save tokens to disk with secure permissions
 */
export function saveTokens(
  tokens: StoredTokens,
  tokenPath: string = DEFAULT_TOKEN_PATH
): void {
  // Ensure directory exists
  const dir = path.dirname(tokenPath);
  if (dir && dir !== '.' && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Add metadata
  const tokensWithMetadata: StoredTokens = {
    ...tokens,
    created_at: tokens.created_at ?? Date.now(),
    last_refresh: tokens.last_refresh ?? Date.now(),
  };

  // Write file
  fs.writeFileSync(
    tokenPath,
    JSON.stringify(tokensWithMetadata, null, 2),
    'utf-8'
  );

  // Set secure permissions (600)
  setSecurePermissions(tokenPath);
}

/**
 * Delete tokens from disk
 */
export function deleteTokens(tokenPath: string = DEFAULT_TOKEN_PATH): boolean {
  if (!tokensExist(tokenPath)) {
    return false;
  }

  try {
    fs.unlinkSync(tokenPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if tokens are expired or close to expiry
 * @param tokens The tokens to check
 * @param bufferMs Buffer time before actual expiry (default: 5 minutes)
 */
export function isTokenExpired(
  tokens: StoredTokens,
  bufferMs: number = 5 * 60 * 1000
): boolean {
  if (!tokens.expiry_date) {
    // No expiry date means we assume it's valid
    // Google tokens typically expire in 1 hour
    return false;
  }

  const now = Date.now();
  const expiresAt = tokens.expiry_date;

  return now >= (expiresAt - bufferMs);
}

/**
 * Refresh expired tokens using the refresh token
 * @param tokens Existing tokens with refresh_token
 * @param credentials OAuth credentials for client creation
 * @returns New tokens with updated access_token
 * @throws TokenError if refresh fails or no refresh token available
 */
export async function refreshTokens(
  tokens: StoredTokens,
  credentials: ValidatedCredentials
): Promise<StoredTokens> {
  if (!tokens.refresh_token) {
    throw new TokenError(
      'No refresh token available.\n' +
      'Please re-authenticate to get a new refresh token.\n' +
      'You may need to revoke access at https://myaccount.google.com/permissions first.',
      'no_refresh_token'
    );
  }

  const oAuth2Client = new google.auth.OAuth2(
    credentials.clientId,
    credentials.clientSecret,
    credentials.redirectUri
  );

  // Set the refresh token
  oAuth2Client.setCredentials({
    refresh_token: tokens.refresh_token,
  });

  try {
    // Request new access token
    const response = await oAuth2Client.getAccessToken();

    if (!response.token) {
      throw new TokenError('Failed to refresh access token: no token received');
    }

    // Get the full credentials which includes expiry
    const newCredentials = oAuth2Client.credentials;

    const refreshedTokens: StoredTokens = {
      access_token: response.token,
      refresh_token: tokens.refresh_token, // Keep existing refresh token
      scope: tokens.scope,
      token_type: tokens.token_type,
      expiry_date: newCredentials.expiry_date ?? undefined,
      created_at: tokens.created_at,
      last_refresh: Date.now(),
    };

    return refreshedTokens;
  } catch (err) {
    const error = err as Error & { code?: string; response?: { data?: { error?: string } } };

    // Check for specific revocation errors
    if (
      error.message?.includes('invalid_grant') ||
      error.response?.data?.error === 'invalid_grant'
    ) {
      throw new TokenError(
        'Refresh token has been revoked or expired.\n' +
        'Please re-authenticate using: gmail-connector auth login',
        'token_revoked'
      );
    }

    throw new TokenError(
      `Failed to refresh token: ${error.message}`,
      error.code
    );
  }
}

/**
 * Get valid tokens, refreshing if necessary
 * @param tokenPath Path to token file
 * @param credentials OAuth credentials for refresh
 * @param autoSave Whether to save refreshed tokens automatically (default: true)
 * @returns Valid tokens, or null if not available
 */
export async function getValidTokens(
  credentials: ValidatedCredentials,
  tokenPath: string = DEFAULT_TOKEN_PATH,
  autoSave: boolean = true
): Promise<StoredTokens | null> {
  const tokens = loadTokens(tokenPath);

  if (!tokens) {
    return null;
  }

  // Check if tokens need refresh
  if (isTokenExpired(tokens)) {
    try {
      const refreshedTokens = await refreshTokens(tokens, credentials);

      if (autoSave) {
        saveTokens(refreshedTokens, tokenPath);
      }

      return refreshedTokens;
    } catch (err) {
      // If refresh fails due to revocation, delete the invalid tokens
      if (err instanceof TokenError && err.code === 'token_revoked') {
        deleteTokens(tokenPath);
        throw err;
      }
      throw err;
    }
  }

  return tokens;
}

/**
 * Create an authenticated OAuth2 client from tokens
 * @param tokens Valid tokens
 * @param credentials OAuth credentials
 */
export function createAuthenticatedClient(
  tokens: StoredTokens,
  credentials: ValidatedCredentials
): InstanceType<typeof google.auth.OAuth2> {
  const oAuth2Client = new google.auth.OAuth2(
    credentials.clientId,
    credentials.clientSecret,
    credentials.redirectUri
  );

  oAuth2Client.setCredentials({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expiry_date: tokens.expiry_date,
    token_type: tokens.token_type,
    scope: tokens.scope,
  });

  return oAuth2Client;
}
