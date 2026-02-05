/**
 * Gmail API credentials loader
 * Loads and validates OAuth credentials from a JSON file
 */

import * as fs from 'fs';
import * as path from 'path';
import type { GoogleCredentials, InstalledCredentials, ValidatedCredentials } from './types';

export class CredentialsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CredentialsError';
  }
}

const DEFAULT_CREDENTIALS_PATH = './credentials.json';

/**
 * Load raw credentials from a JSON file
 */
function loadCredentialsFile(filePath: string): GoogleCredentials {
  const absolutePath = path.resolve(filePath);

  if (!fs.existsSync(absolutePath)) {
    throw new CredentialsError(
      `Credentials file not found: ${absolutePath}\n` +
      'Please download your OAuth 2.0 credentials from Google Cloud Console:\n' +
      '1. Go to https://console.cloud.google.com/apis/credentials\n' +
      '2. Create or select an OAuth 2.0 Client ID (Desktop app type)\n' +
      '3. Download the JSON file and save it as "credentials.json"'
    );
  }

  let fileContent: string;
  try {
    fileContent = fs.readFileSync(absolutePath, 'utf-8');
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    throw new CredentialsError(
      `Failed to read credentials file: ${absolutePath}\n` +
      `Error: ${error.message}`
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fileContent);
  } catch {
    throw new CredentialsError(
      `Credentials file is not valid JSON: ${absolutePath}\n` +
      'Please ensure the file contains valid JSON from Google Cloud Console.'
    );
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new CredentialsError(
      `Credentials file has invalid format: ${absolutePath}\n` +
      'Expected a JSON object with "installed" or "web" property.'
    );
  }

  return parsed as GoogleCredentials;
}

/**
 * Validate that required fields are present in the credentials
 */
function validateInstalledCredentials(creds: InstalledCredentials, source: string): void {
  const requiredFields: (keyof InstalledCredentials)[] = [
    'client_id',
    'client_secret',
    'redirect_uris'
  ];

  const missingFields = requiredFields.filter(field => {
    const value = creds[field];
    if (field === 'redirect_uris') {
      return !Array.isArray(value) || value.length === 0;
    }
    return !value || typeof value !== 'string';
  });

  if (missingFields.length > 0) {
    throw new CredentialsError(
      `Credentials file is missing required fields: ${missingFields.join(', ')}\n` +
      `Source: ${source}\n` +
      'Please download fresh credentials from Google Cloud Console.'
    );
  }
}

/**
 * Load and validate Gmail API credentials from a JSON file
 *
 * @param credentialsPath - Path to the credentials.json file (default: ./credentials.json)
 * @returns Validated credentials ready for OAuth flow
 */
export function loadCredentials(credentialsPath: string = DEFAULT_CREDENTIALS_PATH): ValidatedCredentials {
  const credentials = loadCredentialsFile(credentialsPath);

  // Check for installed (desktop) or web credentials
  const installedCreds = credentials.installed ?? credentials.web;

  if (!installedCreds) {
    throw new CredentialsError(
      `Credentials file has invalid structure.\n` +
      'Expected "installed" or "web" property containing OAuth credentials.\n' +
      'Please download the correct credentials type from Google Cloud Console:\n' +
      '- For CLI tools: Use "Desktop app" OAuth client type'
    );
  }

  validateInstalledCredentials(installedCreds, credentialsPath);

  // Use localhost redirect URI if available, otherwise use first one
  const redirectUri = installedCreds.redirect_uris.find(uri =>
    uri.includes('localhost') || uri.includes('127.0.0.1')
  ) ?? installedCreds.redirect_uris[0];

  return {
    clientId: installedCreds.client_id,
    clientSecret: installedCreds.client_secret,
    redirectUri,
    projectId: installedCreds.project_id
  };
}

/**
 * Check if credentials file exists at the given path
 */
export function credentialsExist(credentialsPath: string = DEFAULT_CREDENTIALS_PATH): boolean {
  const absolutePath = path.resolve(credentialsPath);
  return fs.existsSync(absolutePath);
}

// Re-export types for consumers
export type { GoogleCredentials, InstalledCredentials, ValidatedCredentials } from './types';
