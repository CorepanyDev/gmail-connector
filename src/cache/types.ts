/**
 * Type definitions for the SQLite cache module
 */

/**
 * Cached email message record
 */
export interface CachedMessage {
  id: string;
  thread_id: string;
  from_address: string;
  to_addresses: string;
  subject: string;
  date: string; // ISO date string
  labels: string; // JSON array string
  size_estimate: number;
  snippet: string;
  has_attachments: number; // 0 or 1 (SQLite boolean)
  created_at: string;
  updated_at: string;
}

/**
 * Input for inserting/updating a message
 */
export interface MessageInput {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  labels: string[];
  sizeEstimate: number;
  snippet: string;
  hasAttachments: boolean;
}

/**
 * Cached label record
 */
export interface CachedLabel {
  id: string;
  name: string;
  type: 'system' | 'user';
  message_count: number;
  created_at: string;
  updated_at: string;
}

/**
 * Input for inserting/updating a label
 */
export interface LabelInput {
  id: string;
  name: string;
  type: 'system' | 'user';
  messageCount: number;
}

/**
 * Sync state record for tracking incremental sync
 */
export interface SyncState {
  id: number;
  last_history_id: string | null;
  last_full_sync: string | null;
  last_incremental_sync: string | null;
  total_messages: number;
  created_at: string;
  updated_at: string;
}

/**
 * Migration record
 */
export interface Migration {
  id: number;
  name: string;
  applied_at: string;
}

/**
 * Database configuration options
 */
export interface CacheConfig {
  /** Path to the database file (default: ~/.gmail-connector/cache.db) */
  dbPath?: string;
  /** Enable verbose logging */
  verbose?: boolean;
}

/**
 * Cache error codes
 */
export enum CacheErrorCode {
  DATABASE_ERROR = 'DATABASE_ERROR',
  MIGRATION_ERROR = 'MIGRATION_ERROR',
  NOT_FOUND = 'NOT_FOUND',
  INVALID_DATA = 'INVALID_DATA',
}

/**
 * Custom error class for cache operations
 */
export class CacheError extends Error {
  constructor(
    message: string,
    public code: CacheErrorCode,
    public cause?: Error
  ) {
    super(message);
    this.name = 'CacheError';
  }
}
