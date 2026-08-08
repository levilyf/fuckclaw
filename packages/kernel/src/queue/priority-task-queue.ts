import { Task } from '../types.js';

export class PriorityTaskQueue {
  private queue: Task[] = [];

  enqueue(task: Task): void {
    this.queue.push(task);
    this.queue.sort((a, b) => b.priority - a.priority);
  }

  dequeue(): Task | undefined {
    return this.queue.shift();
  }

  remove(task: Task): boolean {
    const idx = this.queue.indexOf(task);
    if (idx !== -1) {
      this.queue.splice(idx, 1);
      return true;
    }
    return false;
  }

  list(): Task[] {
    return [...this.queue];
  }

  size(): number {
    return this.queue.length;
  }
}
