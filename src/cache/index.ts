/**
 * Cache module - SQLite-based email caching
 *
 * Exports:
 * - CacheDatabase: Database connection and migration management
 * - getCacheDatabase: Convenience function to get database instance
 * - getDefaultDbPath: Get the default database path
 * - MessageRepository: CRUD operations for cached messages
 * - LabelRepository: CRUD operations for cached labels
 * - SyncStateRepository: Sync state management
 * - Types: CachedMessage, CachedLabel, SyncState, etc.
 */

// Database management
export {
  CacheDatabase,
  getCacheDatabase,
  getDefaultDbPath,
} from './database';

// Repository classes
export {
  MessageRepository,
  LabelRepository,
  SyncStateRepository,
} from './repository';

// Types
export {
  CachedMessage,
  MessageInput,
  CachedLabel,
  LabelInput,
  SyncState,
  Migration,
  CacheConfig,
  CacheError,
  CacheErrorCode,
} from './types';

// Migrations (for advanced use)
export { migrations } from './migrations';
