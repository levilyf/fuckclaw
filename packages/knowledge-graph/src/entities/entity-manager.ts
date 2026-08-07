import { IPersistenceLayer } from '@fuckclaw/persistence';
import { IObservability } from '@fuckclaw/observability';
import { IEventBus } from '@fuckclaw/event-bus';
import { ulid } from 'ulidx';
import {
  Entity,
  EntityType,
  EntityCandidate,
  EntityHistoryRecord,
  KnowledgeGraphError,
} from '../types.js';

interface EntityRow {
  id: string;
  type: string;
  name: string;
  aliases_json: string;
  description: string;
  properties_json: string;
  source_memory_ids_json: string;
  confidence: number;
  embedding_json: string | null;
  created_at: number;
  updated_at: number;
  last_referenced_at: number;
}

export class EntityManager {
  constructor(
    private persistence: IPersistenceLayer,
    private observability?: IObservability,
    private eventBus?: IEventBus
  ) {}

  public async createEntity(
    candidate: Omit<Entity, 'id' | 'createdAt' | 'updatedAt' | 'lastReferencedAt'> &
      Partial<Pick<Entity, 'id' | 'createdAt' | 'updatedAt' | 'lastReferencedAt'>>
  ): Promise<Entity> {
    const id = candidate.id || ulid();
    const now = Date.now();
    const createdAt = candidate.createdAt || now;
    const updatedAt = candidate.updatedAt || now;
    const lastReferencedAt = candidate.lastReferencedAt || now;

    const entity: Entity = {
      id,
      type: candidate.type,
      name: candidate.name.trim(),
      aliases: candidate.aliases || [],
      description: candidate.description || '',
      properties: candidate.properties || {},
      sourceMemoryIds: candidate.sourceMemoryIds || [],
      confidence: typeof candidate.confidence === 'number' ? candidate.confidence : 1.0,
      embedding: candidate.embedding,
      createdAt,
      updatedAt,
      lastReferencedAt,
    };

    this.persistence.execute(
      `INSERT INTO entities (
        id, type, name, aliases_json, description, properties_json,
        source_memory_ids_json, confidence, embedding_json,
        created_at, updated_at, last_referenced_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entity.id,
        entity.type,
        entity.name,
        JSON.stringify(entity.aliases),
        entity.description,
        JSON.stringify(entity.properties),
        JSON.stringify(entity.sourceMemoryIds),
        entity.confidence,
        entity.embedding ? JSON.stringify(entity.embedding) : null,
        entity.createdAt,
        entity.updatedAt,
        entity.lastReferencedAt,
      ]
    );

    // Sync FTS
    this.syncFTS(entity);

    // Record in entity_history
    this.recordHistory({
      id: ulid(),
      entityId: entity.id,
      changedAt: now,
      changeType: 'created',
      previousStateJson: null,
      changeDescription: `Created entity ${entity.name} (${entity.type})`,
    });

    this.observability?.log({
      level: 'debug',
      module: 'knowledge-graph',
      message: `Created entity "${entity.name}" [${entity.type}] (${entity.id})`,
      metadata: { entityId: entity.id, type: entity.type, name: entity.name },
    });

    await this.eventBus?.emit('kg.entity.created', {
      entityId: entity.id,
      type: entity.type,
      name: entity.name,
    }, { source: 'knowledge-graph' });

    return entity;
  }

  public async getEntity(id: string): Promise<Entity | null> {
    const row = this.persistence.query<EntityRow>(
      'SELECT * FROM entities WHERE id = ?',
      [id]
    )[0];

    if (!row) return null;
    return this.rowToEntity(row);
  }

  public async getEntityByName(name: string, type?: EntityType): Promise<Entity | null> {
    const query = type
      ? 'SELECT * FROM entities WHERE LOWER(name) = LOWER(?) AND type = ? LIMIT 1'
      : 'SELECT * FROM entities WHERE LOWER(name) = LOWER(?) LIMIT 1';
    const params = type ? [name.trim(), type] : [name.trim()];

    const row = this.persistence.query<EntityRow>(query, params)[0];
    if (!row) return null;
    return this.rowToEntity(row);
  }

  public async updateEntity(
    id: string,
    updates: Partial<Entity>,
    reason?: string
  ): Promise<Entity> {
    const current = await this.getEntity(id);
    if (!current) {
      throw new KnowledgeGraphError('FC_KG_NOT_FOUND', `Entity with id ${id} not found`);
    }

    const now = Date.now();
    const updated: Entity = {
      ...current,
      ...updates,
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: now,
      lastReferencedAt: updates.lastReferencedAt || now,
    };

    this.persistence.execute(
      `UPDATE entities SET
        type = ?,
        name = ?,
        aliases_json = ?,
        description = ?,
        properties_json = ?,
        source_memory_ids_json = ?,
        confidence = ?,
        embedding_json = ?,
        updated_at = ?,
        last_referenced_at = ?
      WHERE id = ?`,
      [
        updated.type,
        updated.name,
        JSON.stringify(updated.aliases),
        updated.description,
        JSON.stringify(updated.properties),
        JSON.stringify(updated.sourceMemoryIds),
        updated.confidence,
        updated.embedding ? JSON.stringify(updated.embedding) : null,
        updated.updatedAt,
        updated.lastReferencedAt,
        id,
      ]
    );

    this.syncFTS(updated);

    this.recordHistory({
      id: ulid(),
      entityId: id,
      changedAt: now,
      changeType: 'updated',
      previousStateJson: JSON.stringify(current),
      changeDescription: reason || 'Updated entity properties',
    });

    await this.eventBus?.emit('kg.entity.updated', {
      entityId: id,
      name: updated.name,
      type: updated.type,
    }, { source: 'knowledge-graph' });

    return updated;
  }

  public async deleteEntity(id: string, reason?: string): Promise<void> {
    const current = await this.getEntity(id);
    if (!current) return;

    const now = Date.now();
    this.recordHistory({
      id: ulid(),
      entityId: id,
      changedAt: now,
      changeType: 'deleted',
      previousStateJson: JSON.stringify(current),
      changeDescription: reason || 'Deleted entity',
    });

    try {
      this.persistence.execute('DELETE FROM entities_fts WHERE id = ?', [id]);
    } catch {}

    this.persistence.execute('DELETE FROM entities WHERE id = ?', [id]);

    await this.eventBus?.emit('kg.entity.deleted', {
      entityId: id,
      name: current.name,
    }, { source: 'knowledge-graph' });
  }

  public async mergeEntities(
    sourceId: string,
    targetId: string,
    reason?: string
  ): Promise<Entity> {
    if (sourceId === targetId) {
      const e = await this.getEntity(targetId);
      if (!e) throw new KnowledgeGraphError('FC_KG_NOT_FOUND', `Entity ${targetId} not found`);
      return e;
    }

    const source = await this.getEntity(sourceId);
    const target = await this.getEntity(targetId);

    if (!source) throw new KnowledgeGraphError('FC_KG_NOT_FOUND', `Source entity ${sourceId} not found`);
    if (!target) throw new KnowledgeGraphError('FC_KG_NOT_FOUND', `Target entity ${targetId} not found`);

    const now = Date.now();

    // 1. Re-point relationships
    this.persistence.execute(
      'UPDATE relationships SET from_id = ? WHERE from_id = ?',
      [target.id, source.id]
    );
    this.persistence.execute(
      'UPDATE relationships SET to_id = ? WHERE to_id = ?',
      [target.id, source.id]
    );

    // 2. Merge aliases and properties
    const mergedAliases = Array.from(
      new Set([...target.aliases, source.name, ...source.aliases])
    ).filter((a) => a.toLowerCase() !== target.name.toLowerCase());

    const mergedProperties = { ...source.properties, ...target.properties };
    const mergedSourceMemoryIds = Array.from(
      new Set([...target.sourceMemoryIds, ...source.sourceMemoryIds])
    );

    // 3. Update target entity
    const updatedTarget = await this.updateEntity(
      target.id,
      {
        aliases: mergedAliases,
        properties: mergedProperties,
        sourceMemoryIds: mergedSourceMemoryIds,
      },
      reason || `Merged entity ${source.name} (${source.id}) into ${target.name} (${target.id})`
    );

    // 4. Record merge history for source and delete source entity
    this.recordHistory({
      id: ulid(),
      entityId: source.id,
      changedAt: now,
      changeType: 'merged',
      previousStateJson: JSON.stringify(source),
      changeDescription: `Merged into ${target.name} (${target.id})`,
    });

    try {
      this.persistence.execute('DELETE FROM entities_fts WHERE id = ?', [source.id]);
    } catch {}

    this.persistence.execute('DELETE FROM entities WHERE id = ?', [source.id]);

    await this.eventBus?.emit('kg.entity.merged', {
      sourceId,
      targetId,
      canonicalName: target.name,
    }, { source: 'knowledge-graph' });

    return updatedTarget;
  }

  public async searchEntities(
    query: string,
    types?: EntityType[],
    limit: number = 20
  ): Promise<Entity[]> {
    const cleanQuery = query.trim().replace(/['"]/g, '');
    if (!cleanQuery) return [];

    let rows: EntityRow[] = [];

    // Attempt FTS first
    try {
      let ftsSql = `
        SELECT e.* FROM entities e
        JOIN entities_fts fts ON fts.id = e.id
        WHERE entities_fts MATCH ?
      `;
      const params: unknown[] = [`${cleanQuery}*`];

      if (types && types.length > 0) {
        ftsSql += ` AND e.type IN (${types.map(() => '?').join(',')})`;
        params.push(...types);
      }

      ftsSql += ` ORDER BY e.updated_at DESC LIMIT ?`;
      params.push(limit);

      rows = this.persistence.query<EntityRow>(ftsSql, params);
    } catch {
      // Fallback to LIKE matching
    }

    if (rows.length === 0) {
      let likeSql = `
        SELECT * FROM entities
        WHERE (LOWER(name) LIKE ? OR LOWER(description) LIKE ? OR LOWER(aliases_json) LIKE ?)
      `;
      const pattern = `%${cleanQuery.toLowerCase()}%`;
      const params: unknown[] = [pattern, pattern, pattern];

      if (types && types.length > 0) {
        likeSql += ` AND type IN (${types.map(() => '?').join(',')})`;
        params.push(...types);
      }

      likeSql += ` ORDER BY updated_at DESC LIMIT ?`;
      params.push(limit);

      rows = this.persistence.query<EntityRow>(likeSql, params);
    }

    return rows.map((r) => this.rowToEntity(r));
  }

  public async findSimilarEntities(
    embedding: number[],
    threshold: number = 0.8,
    limit: number = 10
  ): Promise<Entity[]> {
    const allRows = this.persistence.query<EntityRow>(
      'SELECT * FROM entities WHERE embedding_json IS NOT NULL'
    );

    const scored: Array<{ entity: Entity; score: number }> = [];

    for (const row of allRows) {
      if (!row.embedding_json) continue;
      try {
        const rowEmbedding = JSON.parse(row.embedding_json) as number[];
        const score = this.cosineSimilarity(embedding, rowEmbedding);
        if (score >= threshold) {
          scored.push({ entity: this.rowToEntity(row), score });
        }
      } catch {}
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((s) => s.entity);
  }

  public async resolveEntity(candidate: EntityCandidate): Promise<Entity | null> {
    const candidateName = candidate.name.trim().toLowerCase();

    // 1. Exact name match
    const exact = await this.getEntityByName(candidateName, candidate.type);
    if (exact) return exact;

    // 2. Alias match
    const allRows = this.persistence.query<EntityRow>(
      candidate.type
        ? 'SELECT * FROM entities WHERE type = ?'
        : 'SELECT * FROM entities',
      candidate.type ? [candidate.type] : []
    );

    for (const row of allRows) {
      if (row.name.toLowerCase() === candidateName) {
        return this.rowToEntity(row);
      }
      try {
        const aliases = JSON.parse(row.aliases_json) as string[];
        if (aliases.some((a) => a.toLowerCase() === candidateName)) {
          return this.rowToEntity(row);
        }
        if (candidate.aliases) {
          for (const candAlias of candidate.aliases) {
            if (
              row.name.toLowerCase() === candAlias.toLowerCase() ||
              aliases.some((a) => a.toLowerCase() === candAlias.toLowerCase())
            ) {
              return this.rowToEntity(row);
            }
          }
        }
      } catch {}
    }

    return null;
  }

  private rowToEntity(row: EntityRow): Entity {
    return {
      id: row.id,
      type: row.type as EntityType,
      name: row.name,
      aliases: JSON.parse(row.aliases_json || '[]'),
      description: row.description || '',
      properties: JSON.parse(row.properties_json || '{}'),
      sourceMemoryIds: JSON.parse(row.source_memory_ids_json || '[]'),
      confidence: row.confidence,
      embedding: row.embedding_json ? JSON.parse(row.embedding_json) : undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastReferencedAt: row.last_referenced_at,
    };
  }

  private syncFTS(entity: Entity): void {
    try {
      this.persistence.execute('DELETE FROM entities_fts WHERE id = ?', [entity.id]);
      this.persistence.execute(
        'INSERT INTO entities_fts (id, name, description, aliases_text) VALUES (?, ?, ?, ?)',
        [
          entity.id,
          entity.name,
          entity.description,
          entity.aliases.join(' '),
        ]
      );
    } catch {}
  }

  private recordHistory(record: EntityHistoryRecord): void {
    this.persistence.execute(
      `INSERT INTO entity_history (
        id, entity_id, changed_at, change_type, previous_state_json,
        change_description, source_memory_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        record.id,
        record.entityId,
        record.changedAt,
        record.changeType,
        record.previousStateJson,
        record.changeDescription || null,
        record.sourceMemoryId || null,
      ]
    );
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i]! * b[i]!;
      normA += a[i]! * a[i]!;
      normB += b[i]! * b[i]!;
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}
