import { describe, it, expect } from 'vitest';
import { PersistenceLayer } from '../src/index.js';

describe('PersistenceLayer RFC 20 Compliance', () => {
  it('should run all versioned migrations and record schema_migrations', () => {
    const db = new PersistenceLayer(':memory:');

    const migrations = db.query<{ version: number; name: string }>(
      'SELECT version, name FROM schema_migrations ORDER BY version ASC'
    );

    expect(migrations.length).toBe(7);
    expect(migrations[0]!.name).toBe('create_events_schema');
    expect(migrations[1]!.name).toBe('create_tasks_and_checkpoints_schema');
    expect(migrations[2]!.name).toBe('create_memory_schema');
    expect(migrations[3]!.name).toBe('create_planner_and_scheduler_schema');
    expect(migrations[4]!.name).toBe('create_knowledge_graph_schema');
    expect(migrations[5]!.name).toBe('create_self_improvement_and_delegation_schema');
    expect(migrations[6]!.name).toBe('create_procedural_memory_schema');

    const integrity = db.integrityCheck();
    expect(integrity.ok).toBe(true);

    db.close();
  });

  it('should perform ACID transactions and persist across all migrated tables', () => {
    const db = new PersistenceLayer(':memory:');

    db.transaction((database) => {
      database
        .prepare('INSERT INTO tasks (id, description, source_json, state, budget_json, tags_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run('task-1', 'Test task', '{}', 'completed', '{}', '[]', Date.now());

      database
        .prepare('INSERT INTO checkpoints (id, task_id, state, snapshot_json, hash, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run('ckpt-1', 'task-1', 'executing', '{"progress": 50}', 'sha256-hash', Date.now());
    });

    const tasks = db.query<{ id: string }>('SELECT id FROM tasks WHERE id = ?', ['task-1']);
    const checkpoints = db.query<{ id: string }>('SELECT id FROM checkpoints WHERE task_id = ?', ['task-1']);

    expect(tasks.length).toBe(1);
    expect(checkpoints.length).toBe(1);

    db.close();
  });
});
