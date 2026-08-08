import { IEventBus } from '@fuckclaw/event-bus';
import { IPersistenceLayer } from '@fuckclaw/persistence';
import { Task, TaskState } from '../types.js';

export class TaskStateMachine {
  constructor(
    private persistence: IPersistenceLayer,
    private eventBus: IEventBus
  ) {}

  updateState(task: Task, newState: TaskState): void {
    const oldState = task.state;
    task.state = newState;
    this.persistTask(task);
    this.eventBus.emit('kernel.task.state_changed', {
      taskId: task.id,
      from: oldState,
      to: newState,
    });
  }

  persistTask(task: Task): void {
    try {
      this.persistence.execute(
        `INSERT INTO tasks (id, description, source_json, priority, state, budget_json, output, error_json, tags_json, created_at, started_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           state = excluded.state,
           budget_json = excluded.budget_json,
           output = excluded.output,
           error_json = excluded.error_json,
           started_at = excluded.started_at,
           completed_at = excluded.completed_at`,
        [
          task.id,
          task.description,
          JSON.stringify(task.source),
          task.priority,
          task.state,
          JSON.stringify(task.budget),
          task.output ?? null,
          task.error ? JSON.stringify(task.error) : null,
          JSON.stringify(task.tags),
          task.createdAt,
          task.startedAt ?? null,
          task.completedAt ?? null,
        ]
      );
    } catch {}
  }
}
