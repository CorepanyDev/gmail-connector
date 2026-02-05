/**
 * Type definitions for Gmail API OAuth credentials
 */

/**
 * OAuth 2.0 credentials for installed applications
 * This matches the structure of Google Cloud Console OAuth client credentials JSON
 */
export interface InstalledCredentials {
  client_id: string;
  project_id: string;
  auth_uri: string;
  token_uri: string;
  auth_provider_x509_cert_url: string;
  client_secret: string;
  redirect_uris: string[];
}

/**
 * Root structure of the credentials.json file from Google Cloud Console
 */
export interface GoogleCredentials {
  installed?: InstalledCredentials;
  web?: InstalledCredentials;
}

/**
 * Validated credentials ready for use with OAuth
 */
export interface ValidatedCredentials {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  projectId?: string;
}
