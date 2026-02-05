/**
 * Database migrations for the SQLite cache
 *
 * Each migration has a unique name and up/down SQL statements.
 * Migrations are applied in order and tracked in the migrations table.
 */

export interface MigrationDefinition {
  name: string;
  up: string;
  down: string;
}

/**
 * All database migrations in order
 */
export const migrations: MigrationDefinition[] = [
  {
    name: '001_create_migrations_table',
    up: `
      CREATE TABLE IF NOT EXISTS migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `,
    down: `
      DROP TABLE IF EXISTS migrations;
    `,
  },
  {
    name: '002_create_messages_table',
    up: `
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        from_address TEXT NOT NULL DEFAULT '',
        to_addresses TEXT NOT NULL DEFAULT '',
        subject TEXT NOT NULL DEFAULT '',
        date TEXT NOT NULL,
        labels TEXT NOT NULL DEFAULT '[]',
        size_estimate INTEGER NOT NULL DEFAULT 0,
        snippet TEXT NOT NULL DEFAULT '',
        has_attachments INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_messages_thread_id ON messages(thread_id);
      CREATE INDEX IF NOT EXISTS idx_messages_date ON messages(date);
      CREATE INDEX IF NOT EXISTS idx_messages_from ON messages(from_address);
    `,
    down: `
      DROP INDEX IF EXISTS idx_messages_from;
      DROP INDEX IF EXISTS idx_messages_date;
      DROP INDEX IF EXISTS idx_messages_thread_id;
      DROP TABLE IF EXISTS messages;
    `,
  },
  {
    name: '003_create_labels_table',
    up: `
      CREATE TABLE IF NOT EXISTS labels (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('system', 'user')),
        message_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_labels_type ON labels(type);
      CREATE INDEX IF NOT EXISTS idx_labels_name ON labels(name);
    `,
    down: `
      DROP INDEX IF EXISTS idx_labels_name;
      DROP INDEX IF EXISTS idx_labels_type;
      DROP TABLE IF EXISTS labels;
    `,
  },
  {
    name: '004_create_sync_state_table',
    up: `
      CREATE TABLE IF NOT EXISTS sync_state (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        last_history_id TEXT,
        last_full_sync TEXT,
        last_incremental_sync TEXT,
        total_messages INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Insert default row (only one row allowed)
      INSERT OR IGNORE INTO sync_state (id) VALUES (1);
    `,
    down: `
      DROP TABLE IF EXISTS sync_state;
    `,
  },
];

/**
 * Get migration SQL for creating the migrations tracking table
 * This is used before applying any migrations
 */
export function getBootstrapSQL(): string {
  return `
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `;
}
