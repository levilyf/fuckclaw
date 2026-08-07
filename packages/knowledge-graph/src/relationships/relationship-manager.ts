import { IPersistenceLayer } from '@fuckclaw/persistence';
import { IObservability } from '@fuckclaw/observability';
import { IEventBus } from '@fuckclaw/event-bus';
import { ulid } from 'ulidx';
import {
  Relationship,
  RelationshipType,
  KnowledgeGraphError,
} from '../types.js';

interface RelationshipRow {
  id: string;
  from_id: string;
  to_id: string;
  type: string;
  weight: number;
  properties_json: string;
  valid_from: number;
  valid_until: number | null;
  source_memory_ids_json: string;
  confidence: number;
  created_at: number;
  updated_at: number;
}

export class RelationshipManager {
  constructor(
    private persistence: IPersistenceLayer,
    private observability?: IObservability,
    private eventBus?: IEventBus
  ) {}

  public async createRelationship(
    candidate: Omit<Relationship, 'id' | 'createdAt' | 'updatedAt'> &
      Partial<Pick<Relationship, 'id' | 'createdAt' | 'updatedAt'>>
  ): Promise<Relationship> {
    // Verify source and target entities exist
    const fromExists = this.persistence.query<{ id: string }>(
      'SELECT id FROM entities WHERE id = ?',
      [candidate.fromId]
    )[0];
    if (!fromExists) {
      throw new KnowledgeGraphError(
        'FC_KG_NOT_FOUND',
        `Source entity ${candidate.fromId} does not exist`
      );
    }

    const toExists = this.persistence.query<{ id: string }>(
      'SELECT id FROM entities WHERE id = ?',
      [candidate.toId]
    )[0];
    if (!toExists) {
      throw new KnowledgeGraphError(
        'FC_KG_NOT_FOUND',
        `Target entity ${candidate.toId} does not exist`
      );
    }

    const id = candidate.id || ulid();
    const now = Date.now();
    const createdAt = candidate.createdAt || now;
    const updatedAt = candidate.updatedAt || now;

    const rel: Relationship = {
      id,
      fromId: candidate.fromId,
      toId: candidate.toId,
      type: candidate.type,
      weight: typeof candidate.weight === 'number' ? candidate.weight : 1.0,
      properties: candidate.properties || {},
      validFrom: typeof candidate.validFrom === 'number' ? candidate.validFrom : now,
      validUntil: typeof candidate.validUntil === 'number' ? candidate.validUntil : null,
      sourceMemoryIds: candidate.sourceMemoryIds || [],
      confidence: typeof candidate.confidence === 'number' ? candidate.confidence : 1.0,
      createdAt,
      updatedAt,
    };

    this.persistence.execute(
      `INSERT INTO relationships (
        id, from_id, to_id, type, weight, properties_json,
        valid_from, valid_until, source_memory_ids_json, confidence,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        rel.id,
        rel.fromId,
        rel.toId,
        rel.type,
        rel.weight,
        JSON.stringify(rel.properties),
        rel.validFrom,
        rel.validUntil,
        JSON.stringify(rel.sourceMemoryIds),
        rel.confidence,
        rel.createdAt,
        rel.updatedAt,
      ]
    );

    this.observability?.log({
      level: 'debug',
      module: 'knowledge-graph',
      message: `Created relationship ${rel.fromId} --[${rel.type}]--> ${rel.toId}`,
      metadata: { relId: rel.id, fromId: rel.fromId, toId: rel.toId, type: rel.type },
    });

    await this.eventBus?.emit('kg.relationship.created', {
      id: rel.id,
      fromId: rel.fromId,
      toId: rel.toId,
      type: rel.type,
    }, { source: 'knowledge-graph' });

    return rel;
  }

  public async getRelationship(id: string): Promise<Relationship | null> {
    const row = this.persistence.query<RelationshipRow>(
      'SELECT * FROM relationships WHERE id = ?',
      [id]
    )[0];

    if (!row) return null;
    return this.rowToRelationship(row);
  }

  public async updateRelationship(
    id: string,
    updates: Partial<Relationship>
  ): Promise<Relationship> {
    const current = await this.getRelationship(id);
    if (!current) {
      throw new KnowledgeGraphError(
        'FC_KG_NOT_FOUND',
        `Relationship ${id} not found`
      );
    }

    const now = Date.now();
    const updated: Relationship = {
      ...current,
      ...updates,
      id: current.id,
      fromId: updates.fromId || current.fromId,
      toId: updates.toId || current.toId,
      createdAt: current.createdAt,
      updatedAt: now,
    };

    this.persistence.execute(
      `UPDATE relationships SET
        from_id = ?,
        to_id = ?,
        type = ?,
        weight = ?,
        properties_json = ?,
        valid_from = ?,
        valid_until = ?,
        source_memory_ids_json = ?,
        confidence = ?,
        updated_at = ?
      WHERE id = ?`,
      [
        updated.fromId,
        updated.toId,
        updated.type,
        updated.weight,
        JSON.stringify(updated.properties),
        updated.validFrom,
        updated.validUntil,
        JSON.stringify(updated.sourceMemoryIds),
        updated.confidence,
        updated.updatedAt,
        id,
      ]
    );

    return updated;
  }

  public async endRelationship(id: string): Promise<void> {
    const now = Date.now();
    this.persistence.execute(
      'UPDATE relationships SET valid_until = ?, updated_at = ? WHERE id = ?',
      [now, now, id]
    );

    await this.eventBus?.emit('kg.relationship.ended', {
      id,
      endedAt: now,
    }, { source: 'knowledge-graph' });
  }

  public async deleteRelationship(id: string): Promise<void> {
    this.persistence.execute('DELETE FROM relationships WHERE id = ?', [id]);

    await this.eventBus?.emit('kg.relationship.deleted', {
      id,
    }, { source: 'knowledge-graph' });
  }

  public async findRelationships(filter?: {
    fromId?: string;
    toId?: string;
    type?: RelationshipType;
    activeOnly?: boolean;
  }): Promise<Relationship[]> {
    let sql = 'SELECT * FROM relationships WHERE 1=1';
    const params: unknown[] = [];

    if (filter?.fromId) {
      sql += ' AND from_id = ?';
      params.push(filter.fromId);
    }
    if (filter?.toId) {
      sql += ' AND to_id = ?';
      params.push(filter.toId);
    }
    if (filter?.type) {
      sql += ' AND type = ?';
      params.push(filter.type);
    }
    if (filter?.activeOnly) {
      const now = Date.now();
      sql += ' AND (valid_until IS NULL OR valid_until > ?)';
      params.push(now);
    }

    sql += ' ORDER BY created_at DESC';

    const rows = this.persistence.query<RelationshipRow>(sql, params);
    return rows.map((r) => this.rowToRelationship(r));
  }

  public rowToRelationship(row: RelationshipRow): Relationship {
    return {
      id: row.id,
      fromId: row.from_id,
      toId: row.to_id,
      type: row.type as RelationshipType,
      weight: row.weight,
      properties: JSON.parse(row.properties_json || '{}'),
      validFrom: row.valid_from,
      validUntil: row.valid_until,
      sourceMemoryIds: JSON.parse(row.source_memory_ids_json || '[]'),
      confidence: row.confidence,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
