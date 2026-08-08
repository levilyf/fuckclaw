export enum EventPriority {
  CRITICAL = 0,
  HIGH = 10,
  NORMAL = 20,
  LOW = 30,
  DEBUG = 40,
}

export interface SystemEvent {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  source?: string;
  correlationId?: string;
  causationId?: string;
  priority?: EventPriority | number;
  timestamp: string;
}

export interface EventQuery {
  type?: string;
  source?: string;
  correlationId?: string;
  fromTimestamp?: string;
  toTimestamp?: string;
  limit?: number;
}

export interface DeadLetterEntry {
  event: SystemEvent;
  error: string;
  failedAt: number;
}

export type EventHandler = (event: SystemEvent) => Promise<void> | void;

export interface IEventBus {
  emit(
    type: string,
    payload: Record<string, unknown>,
    options?: {
      source?: string;
      correlationId?: string;
      causationId?: string;
      priority?: EventPriority | number;
    }
  ): Promise<string>;
  subscribe(pattern: string, handler: EventHandler): () => void;
  query(filter?: EventQuery): Promise<SystemEvent[]>;
  replay(fromTimestampOrId: string, handler: EventHandler): Promise<number>;
  getDLQ(): DeadLetterEntry[];
}
