import { Task } from '../types.js';

export class AgingCalculator {
  static getEffectivePriority(task: Task): number {
    const ageSeconds = (Date.now() - task.createdAt) / 1000;
    // Add 1 priority point per 60 seconds of waiting
    const ageBonus = Math.floor(ageSeconds / 60);
    return task.priority + ageBonus;
  }
}
