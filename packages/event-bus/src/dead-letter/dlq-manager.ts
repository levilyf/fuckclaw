import { DeadLetterEntry, SystemEvent } from '../types.js';

export class DLQManager {
  private dlq: DeadLetterEntry[] = [];

  record(event: SystemEvent, error: string): void {
    this.dlq.push({
      event,
      error,
      failedAt: Date.now(),
    });
  }

  getEntries(): DeadLetterEntry[] {
    return [...this.dlq];
  }

  clear(): void {
    this.dlq = [];
  }
}
