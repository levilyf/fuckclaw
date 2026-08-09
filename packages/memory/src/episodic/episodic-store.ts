import { IPersistenceLayer } from '@fuckclaw/persistence';
import { IObservability } from '@fuckclaw/observability';
import { ulid } from 'ulidx';
import { EpisodicMemoryRecord, EpisodicRecordInput } from '../types.js';

interface EpisodicRow {
  id: string;
  session_id: string;
  task_id: string | null;
  timestamp: number;
  source: string;
  actor: string;
  summary: string;
  content: string;
  tool_call_json: string | null;
  importance_score: number;
  access_count: number;
  last_accessed_at: number;
  consolidated: number;
  decay_factor: number;
  embedding_json: string | null;
  created_at: number;
}

export class EpisodicStore {
  constructor(
    private db: IPersistenceLayer,
    private logger: IObservability
  ) {}

  async recordEpisode(input: EpisodicRecordInput): Promise<string> {
    const id = ulid();
    const now = Date.now();

    this.db.execute(
      `INSERT INTO episodic_memories
        (id, session_id, task_id, timestamp, source, actor, summary, content,
         tool_call_json, importance_score, access_count, last_accessed_at,
         consolidated, decay_factor, embedding_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0, 1.0, ?, ?)`,
      [
        id,
        input.sessionId,
        input.taskId ?? null,
        input.timestamp,
        input.source,
        input.actor,
        input.summary,
        input.content,
        input.toolCall ? JSON.stringify(input.toolCall) : null,
        input.importanceScore,
        now,
        JSON.stringify(input.embedding),
        now,
      ]
    );

    // Insert into FTS index
    this.db.execute(
      `INSERT INTO episodic_fts (id, summary, content) VALUES (?, ?, ?)`,
      [id, input.summary, input.content]
    );

    this.logger.log({
      level: 'debug',
      message: `Episodic memory recorded: ${id}`,
      metadata: { source: input.source, actor: input.actor },
    });

    return id;
  }

  async getEpisode(id: string): Promise<EpisodicMemoryRecord | null> {
    const rows = this.db.query<EpisodicRow>(
      `SELECT * FROM episodic_memories WHERE id = ?`,
      [id]
    );
    if (rows.length === 0) return null;

    // Update access tracking
    this.db.execute(
      `UPDATE episodic_memories SET access_count = access_count + 1, last_accessed_at = ? WHERE id = ?`,
      [Date.now(), id]
    );

    return this.rowToRecord(rows[0]!);
  }

  async queryByTime(from: number, to: number, limit: number = 50): Promise<EpisodicMemoryRecord[]> {
    const rows = this.db.query<EpisodicRow>(
      `SELECT * FROM episodic_memories WHERE timestamp >= ? AND timestamp <= ? ORDER BY timestamp DESC LIMIT ?`,
      [from, to, limit]
    );
    return rows.map((r) => this.rowToRecord(r));
  }

  async queryBySession(sessionId: string, limit: number = 50): Promise<EpisodicMemoryRecord[]> {
    const rows = this.db.query<EpisodicRow>(
      `SELECT * FROM episodic_memories WHERE session_id = ? ORDER BY timestamp DESC LIMIT ?`,
      [sessionId, limit]
    );
    return rows.map((r) => this.rowToRecord(r));
  }

  async queryByTask(taskId: string): Promise<EpisodicMemoryRecord[]> {
    const rows = this.db.query<EpisodicRow>(
      `SELECT * FROM episodic_memories WHERE task_id = ? ORDER BY timestamp ASC`,
      [taskId]
    );
    return rows.map((r) => this.rowToRecord(r));
  }

  async searchFTS(queryText: string, limit: number = 20): Promise<Array<{ id: string; rank: number }>> {
    const rows = this.db.query<{ id: string; rank: number }>(
      `SELECT id, rank FROM episodic_fts WHERE episodic_fts MATCH ? ORDER BY rank LIMIT ?`,
      [queryText, limit]
    );
    return rows;
  }

  async getUnconsolidated(limit: number = 50): Promise<EpisodicMemoryRecord[]> {
    const rows = this.db.query<EpisodicRow>(
      `SELECT * FROM episodic_memories WHERE consolidated = 0 ORDER BY timestamp ASC LIMIT ?`,
      [limit]
    );
    return rows.map((r) => this.rowToRecord(r));
  }

  async markConsolidated(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(',');
    this.db.execute(
      `UPDATE episodic_memories SET consolidated = 1 WHERE id IN (${placeholders})`,
      ids
    );
  }

  async getAll(limit: number = 200): Promise<EpisodicMemoryRecord[]> {
    const rows = this.db.query<EpisodicRow>(
      `SELECT * FROM episodic_memories ORDER BY timestamp DESC LIMIT ?`,
      [limit]
    );
    return rows.map((r) => this.rowToRecord(r));
  }

  private rowToRecord(row: EpisodicRow): EpisodicMemoryRecord {
    return {
      id: row.id,
      timestamp: row.timestamp,
      sessionId: row.session_id,
      taskId: row.task_id ?? undefined,
      source: row.source as EpisodicMemoryRecord['source'],
      actor: row.actor as EpisodicMemoryRecord['actor'],
      summary: row.summary,
      content: row.content,
      toolCall: row.tool_call_json ? JSON.parse(row.tool_call_json) : undefined,
      importanceScore: row.importance_score,
      accessCount: row.access_count,
      lastAccessedAt: row.last_accessed_at,
      consolidated: row.consolidated === 1,
      decayFactor: row.decay_factor,
      embedding: row.embedding_json ? JSON.parse(row.embedding_json) : [],
    };
  }
}
