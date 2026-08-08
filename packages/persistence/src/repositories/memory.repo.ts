import Database from 'better-sqlite3';

export class MemoryRepository {
  constructor(private db: Database.Database) {}

  saveEpisodic(memory: Record<string, unknown>): void {
    const stmt = this.db.prepare(`
      INSERT INTO episodic_memories (
        id, session_id, task_id, timestamp, source, actor, summary, content,
        tool_call_json, importance_score, access_count, last_accessed_at,
        consolidated, decay_factor, embedding_json, created_at
      ) VALUES (
        @id, @session_id, @task_id, @timestamp, @source, @actor, @summary, @content,
        @tool_call_json, @importance_score, @access_count, @last_accessed_at,
        @consolidated, @decay_factor, @embedding_json, @created_at
      )
    `);
    stmt.run(memory);
  }

  saveSemantic(memory: Record<string, unknown>): void {
    const stmt = this.db.prepare(`
      INSERT INTO semantic_memories (
        id, subject, predicate, object, statement, confidence, source_episodic_ids_json,
        valid_from, valid_until, superseded_by, context_json, last_verified_at,
        access_count, embedding_json, created_at
      ) VALUES (
        @id, @subject, @predicate, @object, @statement, @confidence, @source_episodic_ids_json,
        @valid_from, @valid_until, @superseded_by, @context_json, @last_verified_at,
        @access_count, @embedding_json, @created_at
      )
    `);
    stmt.run(memory);
  }
}
