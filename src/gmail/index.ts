/**
 * Gmail module for Gmail Connector
 * Provides singleton access to authenticated Gmail API client
 */

export {
  GmailService,
  GmailServiceError,
  getGmailService,
} from './service';

export type { GmailServiceConfig } from './service';
