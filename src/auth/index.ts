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
export type { GoogleCredentials, InstalledCredentials, ValidatedCredentials } from './types';
export type { OAuthTokens, OAuthClient, AuthenticateOptions, GmailScope } from './oauth';
