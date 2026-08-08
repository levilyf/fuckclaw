import { IPersistenceLayer } from '@fuckclaw/persistence';
import { IObservability } from '@fuckclaw/observability';
import { ulid } from 'ulidx';
import {
  IEventBus,
  SystemEvent,
  EventPriority,
  EventQuery,
  EventHandler,
  DeadLetterEntry,
} from './types.js';
import { DLQManager } from './dead-letter/dlq-manager.js';
import { EventJournal } from './persistence/event-journal.js';
import { EventDispatcher } from './dispatcher/event-dispatcher.js';

export class EventBus implements IEventBus {
  private dlqManager = new DLQManager();
  private journal: EventJournal;
  private dispatcher: EventDispatcher;

  constructor(
    db: IPersistenceLayer,
    private logger: IObservability
  ) {
    this.journal = new EventJournal(db, logger);
    this.dispatcher = new EventDispatcher(this.dlqManager, logger);
  }

  async emit(
    type: string,
    payload: Record<string, unknown>,
    options: {
      source?: string;
      correlationId?: string;
      causationId?: string;
      priority?: EventPriority | number;
    } = {}
  ): Promise<string> {
    const id = ulid();
    const event: SystemEvent = {
      id,
      timestamp: new Date().toISOString(),
      type,
      payload,
      source: options.source ?? 'system',
      correlationId: options.correlationId,
      causationId: options.causationId,
      priority: options.priority ?? EventPriority.NORMAL,
    };

    // 1. Persist to journal
    this.journal.persist(event);

    this.logger.log({
      level: 'debug',
      module: 'event-bus',
      message: `Event emitted: ${type}`,
      metadata: { id: event.id, type: event.type, source: event.source },
    });

    // 2. Dispatch to matching subscribers
    await this.dispatcher.dispatch(event);
    return id;
  }

  subscribe(pattern: string, handler: EventHandler): () => void {
    return this.dispatcher.subscribe(pattern, handler);
  }

  async query(filter: EventQuery = {}): Promise<SystemEvent[]> {
    return this.journal.query(filter);
  }

  async replay(fromTimestampOrId: string, handler: EventHandler): Promise<number> {
    return this.journal.replay(fromTimestampOrId, handler);
  }

  getDLQ(): DeadLetterEntry[] {
    return this.dlqManager.getEntries();
  }
}
