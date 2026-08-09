import { IPersistenceLayer } from '@fuckclaw/persistence';
import { IObservability } from '@fuckclaw/observability';
import { ulid } from 'ulidx';
import { SemanticMemoryRecord, SemanticFactInput } from '../types.js';

interface SemanticRow {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  statement: string;
  confidence: number;
  source_episodic_ids_json: string | null;
  valid_from: number;
  valid_until: number | null;
  superseded_by: string | null;
  context_json: string | null;
  last_verified_at: number;
  access_count: number;
  embedding_json: string | null;
  created_at: number;
}

export class SemanticStore {
  constructor(
    private db: IPersistenceLayer,
    private logger: IObservability
  ) {}

  async assertFact(input: SemanticFactInput): Promise<string> {
    const id = ulid();
    const now = Date.now();

    this.db.execute(
      `INSERT INTO semantic_memories
        (id, subject, predicate, object, statement, confidence,
         source_episodic_ids_json, valid_from, valid_until, superseded_by,
         context_json, last_verified_at, access_count, embedding_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      [
        id,
        input.subject,
        input.predicate,
        input.object,
        input.statement,
        input.confidence,
        JSON.stringify(input.sourceEpisodicIds),
        input.validFrom,
        input.validUntil ?? null,
        input.supersededBy ?? null,
        input.contextConditions ? JSON.stringify(input.contextConditions) : null,
        now,
        JSON.stringify(input.embedding),
        now,
      ]
    );

    // Insert into FTS index
    this.db.execute(
      `INSERT INTO semantic_fts (id, statement, subject, object) VALUES (?, ?, ?, ?)`,
      [id, input.statement, input.subject, input.object]
    );

    this.logger.log({
      level: 'debug',
      message: `Semantic fact asserted: ${id}`,
      metadata: { subject: input.subject, predicate: input.predicate, object: input.object },
    });

    return id;
  }

  async getFact(id: string): Promise<SemanticMemoryRecord | null> {
    const rows = this.db.query<SemanticRow>(
      `SELECT * FROM semantic_memories WHERE id = ?`,
      [id]
    );
    if (rows.length === 0) return null;

    // Update access tracking
    this.db.execute(
      `UPDATE semantic_memories SET access_count = access_count + 1, last_verified_at = ? WHERE id = ?`,
      [Date.now(), id]
    );

    return this.rowToRecord(rows[0]!);
  }

  async retractFact(factId: string, _reason: string): Promise<void> {
    this.db.execute(
      `UPDATE semantic_memories SET valid_until = ? WHERE id = ? AND valid_until IS NULL`,
      [Date.now(), factId]
    );
    this.logger.log({
      level: 'info',
      message: `Semantic fact retracted: ${factId}`,
    });
  }

  async getActiveFacts(limit: number = 100): Promise<SemanticMemoryRecord[]> {
    const rows = this.db.query<SemanticRow>(
      `SELECT * FROM semantic_memories WHERE valid_until IS NULL ORDER BY confidence DESC, created_at DESC LIMIT ?`,
      [limit]
    );
    return rows.map((r) => this.rowToRecord(r));
  }

  async getAllActive(limit: number = 100): Promise<SemanticMemoryRecord[]> {
    return this.getActiveFacts(limit);
  }

  async queryBySubject(subject: string): Promise<SemanticMemoryRecord[]> {
    const rows = this.db.query<SemanticRow>(
      `SELECT * FROM semantic_memories WHERE subject = ? AND valid_until IS NULL ORDER BY confidence DESC`,
      [subject]
    );
    return rows.map((r) => this.rowToRecord(r));
  }

  async searchFTS(queryText: string, limit: number = 20): Promise<Array<{ id: string; rank: number }>> {
    const rows = this.db.query<{ id: string; rank: number }>(
      `SELECT id, rank FROM semantic_fts WHERE semantic_fts MATCH ? ORDER BY rank LIMIT ?`,
      [queryText, limit]
    );
    return rows;
  }

  async getAll(limit: number = 200): Promise<SemanticMemoryRecord[]> {
    const rows = this.db.query<SemanticRow>(
      `SELECT * FROM semantic_memories ORDER BY created_at DESC LIMIT ?`,
      [limit]
    );
    return rows.map((r) => this.rowToRecord(r));
  }

  private rowToRecord(row: SemanticRow): SemanticMemoryRecord {
    return {
      id: row.id,
      subject: row.subject,
      predicate: row.predicate,
      object: row.object,
      statement: row.statement,
      confidence: row.confidence,
      sourceEpisodicIds: row.source_episodic_ids_json
        ? JSON.parse(row.source_episodic_ids_json)
        : [],
      validFrom: row.valid_from,
      validUntil: row.valid_until,
      supersededBy: row.superseded_by ?? undefined,
      contextConditions: row.context_json ? JSON.parse(row.context_json) : undefined,
      lastVerifiedAt: row.last_verified_at,
      accessCount: row.access_count,
      embedding: row.embedding_json ? JSON.parse(row.embedding_json) : [],
    };
  }
}
