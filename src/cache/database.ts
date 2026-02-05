/**
 * SQLite database management for email caching
 *
 * Creates and manages the cache database at ~/.gmail-connector/cache.db
 * Handles schema migrations and provides the database connection.
 */

import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  CacheConfig,
  CacheError,
  CacheErrorCode,
  Migration,
} from './types';
import { migrations, getBootstrapSQL } from './migrations';

/**
 * Default database path: ~/.gmail-connector/cache.db
 */
export function getDefaultDbPath(): string {
  return path.join(os.homedir(), '.gmail-connector', 'cache.db');
}

/**
 * Ensure the directory for the database exists
 */
function ensureDbDirectory(dbPath: string): void {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

/**
 * Database manager singleton
 *
 * Handles database connection, migrations, and provides access to the db.
 */
export class CacheDatabase {
  private static instance: CacheDatabase | null = null;
  private db: Database.Database | null = null;
  private dbPath: string;
  private verbose: boolean;

  private constructor(config: CacheConfig = {}) {
    this.dbPath = config.dbPath || getDefaultDbPath();
    this.verbose = config.verbose || false;
  }

  /**
   * Get the singleton instance
   */
  static getInstance(config?: CacheConfig): CacheDatabase {
    if (!CacheDatabase.instance) {
      CacheDatabase.instance = new CacheDatabase(config);
    }
    return CacheDatabase.instance;
  }

  /**
   * Reset the singleton instance (for testing)
   */
  static resetInstance(): void {
    if (CacheDatabase.instance) {
      CacheDatabase.instance.close();
      CacheDatabase.instance = null;
    }
  }

  /**
   * Initialize the database connection and run migrations
   */
  initialize(): void {
    if (this.db) {
      return; // Already initialized
    }

    try {
      // Ensure directory exists
      ensureDbDirectory(this.dbPath);

      // Open database
      this.db = new Database(this.dbPath, {
        verbose: this.verbose ? console.log : undefined,
      });

      // Enable foreign keys and WAL mode for better performance
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('foreign_keys = ON');

      // Run migrations
      this.runMigrations();

      if (this.verbose) {
        console.log(`Cache database initialized at: ${this.dbPath}`);
      }
    } catch (error) {
      throw new CacheError(
        `Failed to initialize database: ${error instanceof Error ? error.message : String(error)}`,
        CacheErrorCode.DATABASE_ERROR,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Get the database connection
   * @throws CacheError if database not initialized
   */
  getDb(): Database.Database {
    if (!this.db) {
      throw new CacheError(
        'Database not initialized. Call initialize() first.',
        CacheErrorCode.DATABASE_ERROR
      );
    }
    return this.db;
  }

  /**
   * Check if database is initialized
   */
  isInitialized(): boolean {
    return this.db !== null;
  }

  /**
   * Get the database file path
   */
  getPath(): string {
    return this.dbPath;
  }

  /**
   * Close the database connection
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  /**
   * Run all pending migrations
   */
  private runMigrations(): void {
    if (!this.db) {
      throw new CacheError(
        'Database not open',
        CacheErrorCode.DATABASE_ERROR
      );
    }

    try {
      // Bootstrap migrations table
      this.db.exec(getBootstrapSQL());

      // Get applied migrations
      const applied = this.getAppliedMigrations();
      const appliedNames = new Set(applied.map((m) => m.name));

      // Apply pending migrations
      for (const migration of migrations) {
        if (!appliedNames.has(migration.name)) {
          this.applyMigration(migration.name, migration.up);
        }
      }
    } catch (error) {
      throw new CacheError(
        `Migration failed: ${error instanceof Error ? error.message : String(error)}`,
        CacheErrorCode.MIGRATION_ERROR,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Get list of applied migrations
   */
  private getAppliedMigrations(): Migration[] {
    if (!this.db) {
      return [];
    }

    try {
      const stmt = this.db.prepare(
        'SELECT id, name, applied_at FROM migrations ORDER BY id'
      );
      return stmt.all() as Migration[];
    } catch {
      // Table might not exist yet
      return [];
    }
  }

  /**
   * Apply a single migration
   */
  private applyMigration(name: string, sql: string): void {
    if (!this.db) {
      throw new CacheError(
        'Database not open',
        CacheErrorCode.DATABASE_ERROR
      );
    }

    if (this.verbose) {
      console.log(`Applying migration: ${name}`);
    }

    // Use a transaction for the migration
    const transaction = this.db.transaction(() => {
      // Execute migration SQL
      this.db!.exec(sql);

      // Record migration (skip for bootstrap migration)
      if (name !== '001_create_migrations_table') {
        const stmt = this.db!.prepare(
          'INSERT INTO migrations (name) VALUES (?)'
        );
        stmt.run(name);
      }
    });

    transaction();

    if (this.verbose) {
      console.log(`Migration applied: ${name}`);
    }
  }

  /**
   * Get the current schema version (number of applied migrations)
   */
  getSchemaVersion(): number {
    const applied = this.getAppliedMigrations();
    return applied.length;
  }

  /**
   * Check if the database has all migrations applied
   */
  isUpToDate(): boolean {
    const applied = this.getAppliedMigrations();
    return applied.length >= migrations.length - 1; // -1 for bootstrap
  }

  /**
   * Get database statistics
   */
  getStats(): {
    path: string;
    sizeBytes: number;
    messageCount: number;
    labelCount: number;
    schemaVersion: number;
  } {
    const db = this.getDb();

    const messageCount =
      (db.prepare('SELECT COUNT(*) as count FROM messages').get() as { count: number })
        ?.count || 0;
    const labelCount =
      (db.prepare('SELECT COUNT(*) as count FROM labels').get() as { count: number })
        ?.count || 0;

    let sizeBytes = 0;
    try {
      const stats = fs.statSync(this.dbPath);
      sizeBytes = stats.size;
    } catch {
      // File might not exist yet
    }

    return {
      path: this.dbPath,
      sizeBytes,
      messageCount,
      labelCount,
      schemaVersion: this.getSchemaVersion(),
    };
  }

  /**
   * Delete all cached data (but keep schema)
   */
  clearCache(): void {
    const db = this.getDb();

    const transaction = db.transaction(() => {
      db.exec('DELETE FROM messages');
      db.exec('DELETE FROM labels');
      db.exec('UPDATE sync_state SET last_history_id = NULL, last_full_sync = NULL, last_incremental_sync = NULL, total_messages = 0, updated_at = datetime("now") WHERE id = 1');
    });

    transaction();

    // Reclaim space
    db.exec('VACUUM');
  }

  /**
   * Delete the database file completely
   */
  deleteDatabase(): void {
    this.close();

    if (fs.existsSync(this.dbPath)) {
      fs.unlinkSync(this.dbPath);
    }

    // Also delete WAL and SHM files if they exist
    const walPath = `${this.dbPath}-wal`;
    const shmPath = `${this.dbPath}-shm`;

    if (fs.existsSync(walPath)) {
      fs.unlinkSync(walPath);
    }
    if (fs.existsSync(shmPath)) {
      fs.unlinkSync(shmPath);
    }
  }
}

/**
 * Convenience function to get the cache database instance
 */
export function getCacheDatabase(config?: CacheConfig): CacheDatabase {
  return CacheDatabase.getInstance(config);
}
