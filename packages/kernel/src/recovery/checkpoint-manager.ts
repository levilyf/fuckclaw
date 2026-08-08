import { IPersistenceLayer } from '@fuckclaw/persistence';
import { IObservability } from '@fuckclaw/observability';
import { ulid } from 'ulidx';
import crypto from 'node:crypto';
import { Task } from '../types.js';

export class CheckpointManager {
  constructor(
    private persistence: IPersistenceLayer,
    private logger?: IObservability
  ) {}

  createCheckpoint(task: Task): string {
    const snapshot = JSON.stringify({
      id: task.id,
      description: task.description,
      state: task.state,
      budget: task.budget,
      results: task.results,
    });

    const hash = crypto.createHash('sha256').update(snapshot).digest('hex');
    const checkpointId = ulid();

    this.persistence.execute(
      'INSERT INTO checkpoints (id, task_id, state, snapshot_json, hash, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [checkpointId, task.id, task.state, snapshot, hash, Date.now()]
    );

    this.logger?.log({
      level: 'debug',
      module: 'kernel',
      message: `Checkpoint ${checkpointId} created for task ${task.id}`,
      taskId: task.id,
    });

    return checkpointId;
  }
}
