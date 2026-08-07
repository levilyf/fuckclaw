import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../src/index.js';
import { PersistenceLayer } from '@fuckclaw/persistence';
import { Logger } from '@fuckclaw/observability';
import { ConfigManager } from '@fuckclaw/config';

describe('EventBus', () => {
  it('should emit, persist, and dispatch events', async () => {
    const config = new ConfigManager();
    const logger = new Logger(config);
    const db = new PersistenceLayer(':memory:', logger);
    const bus = new EventBus(db, logger);

    const handler = vi.fn();
    bus.subscribe('test.event', handler);

    const eventId = await bus.emit('test.event', { foo: 'bar' });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({
      id: eventId,
      type: 'test.event',
      payload: { foo: 'bar' }
    }));

    const rows = db.query<{ id: string, type: string }>('SELECT * FROM events WHERE id = ?', [eventId]);
    expect(rows.length).toBe(1);
    expect(rows[0].type).toBe('test.event');
  });
});
