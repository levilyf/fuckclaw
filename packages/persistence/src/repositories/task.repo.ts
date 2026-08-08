import Database from 'better-sqlite3';

export class TaskRepository {
  constructor(private db: Database.Database) {}

  findById(id: string): Record<string, unknown> | null {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
    return (row as Record<string, unknown>) || null;
  }

  save(task: Record<string, unknown>): void {
    const stmt = this.db.prepare(`
      INSERT INTO tasks (id, description, source_json, priority, state, parent_id, budget_json, output, error_json, tags_json, created_at, started_at, completed_at)
      VALUES (@id, @description, @source_json, @priority, @state, @parent_id, @budget_json, @output, @error_json, @tags_json, @created_at, @started_at, @completed_at)
      ON CONFLICT(id) DO UPDATE SET
        state = excluded.state,
        output = excluded.output,
        error_json = excluded.error_json,
        started_at = excluded.started_at,
        completed_at = excluded.completed_at
    `);
    stmt.run(task);
  }
}
