import { SystemEvent } from '../types.js';

export class EventPriorityQueue {
  private queue: SystemEvent[] = [];

  enqueue(event: SystemEvent): void {
    const priority = event.priority ?? 20;
    const index = this.queue.findIndex((e) => (e.priority ?? 20) > priority);
    if (index === -1) {
      this.queue.push(event);
    } else {
      this.queue.splice(index, 0, event);
    }
  }

  dequeue(): SystemEvent | undefined {
    return this.queue.shift();
  }

  size(): number {
    return this.queue.length;
  }
}
