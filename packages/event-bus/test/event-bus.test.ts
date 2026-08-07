import { describe, it, expect } from 'vitest';
import { EventBus } from '../src/index.js';
import { PersistenceLayer } from '@fuckclaw/persistence';
import { Logger } from '@fuckclaw/observability';
import { ConfigManager } from '@fuckclaw/config';

describe('EventBus RFC 14 Compliance', () => {
  it('should support wildcard subscriptions, query filtering, and event replay', async () => {
    const config = new ConfigManager();
    const logger = new Logger(config);
    const db = new PersistenceLayer(':memory:', logger);
    const bus = new EventBus(db, logger);

    const toolEvents: string[] = [];
    const errorEvents: string[] = [];

    // Wildcard prefix subscription
    bus.subscribe('tool.*', (event) => {
      toolEvents.push(event.type);
    });

    // Suffix wildcard subscription
    bus.subscribe('*.error', (event) => {
      errorEvents.push(event.type);
    });

    const id1 = await bus.emit('tool.execution.started', { tool: 'shell' }, { source: 'tool-runtime' });
    const id2 = await bus.emit('tool.execution.completed', { tool: 'shell', success: true });
    const id3 = await bus.emit('kernel.task.error', { taskId: 't1', error: 'boom' });
    const id4 = await bus.emit('memory.fact.asserted', { fact: 'User likes TypeScript' });

    expect(toolEvents).toEqual(['tool.execution.started', 'tool.execution.completed']);
    expect(errorEvents).toEqual(['kernel.task.error']);

    // Query persisted events
    const queried = await bus.query({ source: 'tool-runtime' });
    expect(queried.length).toBe(1);
    expect(queried[0]!.type).toBe('tool.execution.started');

    // Replay events
    const replayedEvents: string[] = [];
    const count = await bus.replay(id1, (e) => {
      replayedEvents.push(e.type);
    });

    expect(count).toBe(4);
    expect(replayedEvents).toEqual([
      'tool.execution.started',
      'tool.execution.completed',
      'kernel.task.error',
      'memory.fact.asserted',
    ]);

    db.close();
  });
});
