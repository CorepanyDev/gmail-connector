/**
 * Authentication module for Gmail Connector
 */

export { loadCredentials, credentialsExist, CredentialsError } from './credentials';
export {
  authenticate,
  createOAuthClient,
  OAuthError,
  GMAIL_SCOPES,
} from './oauth';
export {
  loadTokens,
  saveTokens,
  deleteTokens,
  tokensExist,
  isTokenExpired,
  refreshTokens,
  getValidTokens,
  createAuthenticatedClient,
  TokenError,
} from './tokens';
export type { GoogleCredentials, InstalledCredentials, ValidatedCredentials } from './types';
export type { OAuthTokens, OAuthClient, AuthenticateOptions, GmailScope } from './oauth';
export type { StoredTokens } from './tokens';
