/**
 * Repository layer for cached email data
 *
 * Provides CRUD operations for messages, labels, and sync state.
 */

import {
  CachedMessage,
  MessageInput,
  CachedLabel,
  LabelInput,
  SyncState,
  CacheError,
  CacheErrorCode,
} from './types';
import { CacheDatabase } from './database';

/**
 * Message repository for cached emails
 */
export class MessageRepository {
  constructor(private db: CacheDatabase) {}

  /**
   * Insert or update a message
   */
  upsert(message: MessageInput): void {
    const db = this.db.getDb();
    const stmt = db.prepare(`
      INSERT INTO messages (id, thread_id, from_address, to_addresses, subject, date, labels, size_estimate, snippet, has_attachments, updated_at)
      VALUES (@id, @threadId, @from, @to, @subject, @date, @labels, @sizeEstimate, @snippet, @hasAttachments, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        thread_id = @threadId,
        from_address = @from,
        to_addresses = @to,
        subject = @subject,
        date = @date,
        labels = @labels,
        size_estimate = @sizeEstimate,
        snippet = @snippet,
        has_attachments = @hasAttachments,
        updated_at = datetime('now')
    `);

    stmt.run({
      id: message.id,
      threadId: message.threadId,
      from: message.from,
      to: message.to,
      subject: message.subject,
      date: message.date,
      labels: JSON.stringify(message.labels),
      sizeEstimate: message.sizeEstimate,
      snippet: message.snippet,
      hasAttachments: message.hasAttachments ? 1 : 0,
    });
  }

  /**
   * Insert or update multiple messages in a transaction
   */
  upsertMany(messages: MessageInput[]): void {
    const db = this.db.getDb();
    const stmt = db.prepare(`
      INSERT INTO messages (id, thread_id, from_address, to_addresses, subject, date, labels, size_estimate, snippet, has_attachments, updated_at)
      VALUES (@id, @threadId, @from, @to, @subject, @date, @labels, @sizeEstimate, @snippet, @hasAttachments, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        thread_id = @threadId,
        from_address = @from,
        to_addresses = @to,
        subject = @subject,
        date = @date,
        labels = @labels,
        size_estimate = @sizeEstimate,
        snippet = @snippet,
        has_attachments = @hasAttachments,
        updated_at = datetime('now')
    `);

    const transaction = db.transaction(() => {
      for (const message of messages) {
        stmt.run({
          id: message.id,
          threadId: message.threadId,
          from: message.from,
          to: message.to,
          subject: message.subject,
          date: message.date,
          labels: JSON.stringify(message.labels),
          sizeEstimate: message.sizeEstimate,
          snippet: message.snippet,
          hasAttachments: message.hasAttachments ? 1 : 0,
        });
      }
    });

    transaction();
  }

  /**
   * Get a message by ID
   */
  getById(id: string): CachedMessage | null {
    const db = this.db.getDb();
    const stmt = db.prepare('SELECT * FROM messages WHERE id = ?');
    const row = stmt.get(id) as CachedMessage | undefined;
    return row || null;
  }

  /**
   * Get messages by thread ID
   */
  getByThreadId(threadId: string): CachedMessage[] {
    const db = this.db.getDb();
    const stmt = db.prepare('SELECT * FROM messages WHERE thread_id = ? ORDER BY date DESC');
    return stmt.all(threadId) as CachedMessage[];
  }

  /**
   * Get messages with pagination
   */
  list(options: {
    limit?: number;
    offset?: number;
    orderBy?: 'date' | 'from_address' | 'subject';
    orderDir?: 'ASC' | 'DESC';
  } = {}): CachedMessage[] {
    const {
      limit = 20,
      offset = 0,
      orderBy = 'date',
      orderDir = 'DESC',
    } = options;

    const db = this.db.getDb();
    const stmt = db.prepare(
      `SELECT * FROM messages ORDER BY ${orderBy} ${orderDir} LIMIT ? OFFSET ?`
    );
    return stmt.all(limit, offset) as CachedMessage[];
  }

  /**
   * Search messages by from address, subject, or snippet
   */
  search(query: string, limit = 50): CachedMessage[] {
    const db = this.db.getDb();
    const searchTerm = `%${query}%`;
    const stmt = db.prepare(`
      SELECT * FROM messages
      WHERE from_address LIKE ? OR subject LIKE ? OR snippet LIKE ?
      ORDER BY date DESC
      LIMIT ?
    `);
    return stmt.all(searchTerm, searchTerm, searchTerm, limit) as CachedMessage[];
  }

  /**
   * Delete a message by ID
   */
  delete(id: string): boolean {
    const db = this.db.getDb();
    const stmt = db.prepare('DELETE FROM messages WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }

  /**
   * Delete multiple messages by ID
   */
  deleteMany(ids: string[]): number {
    if (ids.length === 0) return 0;

    const db = this.db.getDb();
    const placeholders = ids.map(() => '?').join(',');
    const stmt = db.prepare(`DELETE FROM messages WHERE id IN (${placeholders})`);
    const result = stmt.run(...ids);
    return result.changes;
  }

  /**
   * Get total message count
   */
  count(): number {
    const db = this.db.getDb();
    const row = db.prepare('SELECT COUNT(*) as count FROM messages').get() as { count: number };
    return row.count;
  }

  /**
   * Get all unique message IDs
   */
  getAllIds(): string[] {
    const db = this.db.getDb();
    const rows = db.prepare('SELECT id FROM messages').all() as { id: string }[];
    return rows.map((r) => r.id);
  }
}

/**
 * Label repository for cached labels
 */
export class LabelRepository {
  constructor(private db: CacheDatabase) {}

  /**
   * Insert or update a label
   */
  upsert(label: LabelInput): void {
    const db = this.db.getDb();
    const stmt = db.prepare(`
      INSERT INTO labels (id, name, type, message_count, updated_at)
      VALUES (@id, @name, @type, @messageCount, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        name = @name,
        type = @type,
        message_count = @messageCount,
        updated_at = datetime('now')
    `);

    stmt.run({
      id: label.id,
      name: label.name,
      type: label.type,
      messageCount: label.messageCount,
    });
  }

  /**
   * Insert or update multiple labels in a transaction
   */
  upsertMany(labels: LabelInput[]): void {
    const db = this.db.getDb();
    const stmt = db.prepare(`
      INSERT INTO labels (id, name, type, message_count, updated_at)
      VALUES (@id, @name, @type, @messageCount, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        name = @name,
        type = @type,
        message_count = @messageCount,
        updated_at = datetime('now')
    `);

    const transaction = db.transaction(() => {
      for (const label of labels) {
        stmt.run({
          id: label.id,
          name: label.name,
          type: label.type,
          messageCount: label.messageCount,
        });
      }
    });

    transaction();
  }

  /**
   * Get a label by ID
   */
  getById(id: string): CachedLabel | null {
    const db = this.db.getDb();
    const stmt = db.prepare('SELECT * FROM labels WHERE id = ?');
    const row = stmt.get(id) as CachedLabel | undefined;
    return row || null;
  }

  /**
   * Get a label by name
   */
  getByName(name: string): CachedLabel | null {
    const db = this.db.getDb();
    const stmt = db.prepare('SELECT * FROM labels WHERE name = ?');
    const row = stmt.get(name) as CachedLabel | undefined;
    return row || null;
  }

  /**
   * Get all labels
   */
  list(type?: 'system' | 'user'): CachedLabel[] {
    const db = this.db.getDb();
    if (type) {
      const stmt = db.prepare('SELECT * FROM labels WHERE type = ? ORDER BY name');
      return stmt.all(type) as CachedLabel[];
    }
    const stmt = db.prepare('SELECT * FROM labels ORDER BY type, name');
    return stmt.all() as CachedLabel[];
  }

  /**
   * Delete a label by ID
   */
  delete(id: string): boolean {
    const db = this.db.getDb();
    const stmt = db.prepare('DELETE FROM labels WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }

  /**
   * Delete all labels
   */
  deleteAll(): number {
    const db = this.db.getDb();
    const result = db.prepare('DELETE FROM labels').run();
    return result.changes;
  }

  /**
   * Get total label count
   */
  count(): number {
    const db = this.db.getDb();
    const row = db.prepare('SELECT COUNT(*) as count FROM labels').get() as { count: number };
    return row.count;
  }
}

/**
 * Sync state repository for tracking sync progress
 */
export class SyncStateRepository {
  constructor(private db: CacheDatabase) {}

  /**
   * Get the current sync state
   */
  get(): SyncState {
    const db = this.db.getDb();
    const stmt = db.prepare('SELECT * FROM sync_state WHERE id = 1');
    const row = stmt.get() as SyncState | undefined;

    if (!row) {
      throw new CacheError(
        'Sync state not found - database may be corrupted',
        CacheErrorCode.NOT_FOUND
      );
    }

    return row;
  }

  /**
   * Update the last history ID (for incremental sync)
   */
  updateHistoryId(historyId: string): void {
    const db = this.db.getDb();
    const stmt = db.prepare(`
      UPDATE sync_state
      SET last_history_id = ?, last_incremental_sync = datetime('now'), updated_at = datetime('now')
      WHERE id = 1
    `);
    stmt.run(historyId);
  }

  /**
   * Mark a full sync as completed
   */
  markFullSync(totalMessages: number): void {
    const db = this.db.getDb();
    const stmt = db.prepare(`
      UPDATE sync_state
      SET last_full_sync = datetime('now'), total_messages = ?, updated_at = datetime('now')
      WHERE id = 1
    `);
    stmt.run(totalMessages);
  }

  /**
   * Update total message count
   */
  updateMessageCount(count: number): void {
    const db = this.db.getDb();
    const stmt = db.prepare(`
      UPDATE sync_state
      SET total_messages = ?, updated_at = datetime('now')
      WHERE id = 1
    `);
    stmt.run(count);
  }

  /**
   * Reset sync state (for full resync)
   */
  reset(): void {
    const db = this.db.getDb();
    const stmt = db.prepare(`
      UPDATE sync_state
      SET last_history_id = NULL, last_full_sync = NULL, last_incremental_sync = NULL, total_messages = 0, updated_at = datetime('now')
      WHERE id = 1
    `);
    stmt.run();
  }

  /**
   * Check if any sync has been performed
   */
  hasBeenSynced(): boolean {
    const state = this.get();
    return state.last_full_sync !== null || state.last_history_id !== null;
  }
}
