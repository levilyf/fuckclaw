import { IObservability } from '@fuckclaw/observability';
import { SystemEvent, EventHandler } from '../types.js';
import { PatternMatcher } from '../matchers/pattern-matcher.js';
import { DLQManager } from '../dead-letter/dlq-manager.js';

export class EventDispatcher {
  private handlers: Map<string, Set<EventHandler>> = new Map();

  constructor(
    private dlq: DLQManager,
    private logger?: IObservability
  ) {}

  subscribe(pattern: string, handler: EventHandler): () => void {
    if (!this.handlers.has(pattern)) {
      this.handlers.set(pattern, new Set());
    }
    this.handlers.get(pattern)!.add(handler);

    return () => {
      this.handlers.get(pattern)?.delete(handler);
    };
  }

  async dispatch(event: SystemEvent): Promise<void> {
    const matchingHandlers = PatternMatcher.findMatchingHandlers(this.handlers, event.type);
    const dispatchPromises = matchingHandlers.map(async (handler) => {
      try {
        await handler(event);
      } catch (err) {
        const errorMsg = String(err);
        this.dlq.record(event, errorMsg);
        this.logger?.log({
          level: 'error',
          module: 'event-bus',
          message: `Event handler failure on event "${event.type}"`,
          metadata: { error: errorMsg, eventId: event.id },
        });
      }
    });

    await Promise.allSettled(dispatchPromises);
  }
}
