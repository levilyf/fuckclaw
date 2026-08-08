import Database from 'better-sqlite3';

export class GraphRepository {
  constructor(private db: Database.Database) {}

  findEntityById(id: string): Record<string, unknown> | null {
    const row = this.db.prepare('SELECT * FROM entities WHERE id = ?').get(id);
    return (row as Record<string, unknown>) || null;
  }

  saveEntity(entity: Record<string, unknown>): void {
    const stmt = this.db.prepare(`
      INSERT INTO entities (
        id, type, name, aliases_json, description, properties_json,
        source_memory_ids_json, confidence, embedding_json, created_at, updated_at, last_referenced_at
      ) VALUES (
        @id, @type, @name, @aliases_json, @description, @properties_json,
        @source_memory_ids_json, @confidence, @embedding_json, @created_at, @updated_at, @last_referenced_at
      ) ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        aliases_json = excluded.aliases_json,
        description = excluded.description,
        properties_json = excluded.properties_json,
        confidence = excluded.confidence,
        updated_at = excluded.updated_at,
        last_referenced_at = excluded.last_referenced_at
    `);
    stmt.run(entity);
  }
}
