import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PersistenceLayer } from '../src/index.js';

describe('PersistenceLayer', () => {
  let db: PersistenceLayer;

  beforeEach(() => {
    db = new PersistenceLayer(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('should initialize and run migrations', () => {
    const tables = db.query<{ name: string }>('SELECT name FROM sqlite_master WHERE type=\'table\'');
    expect(tables.map(t => t.name)).toContain('events');
  });

  it('should execute and query data', () => {
    db.execute('INSERT INTO events (id, timestamp, type, payload) VALUES (?, ?, ?, ?)', [
      '1', '2024-01-01', 'test.event', '{}'
    ]);
    const events = db.query<{ id: string }>('SELECT id FROM events');
    expect(events.length).toBe(1);
    expect(events[0].id).toBe('1');
  });
});
