import { IPersistenceLayer } from '@fuckclaw/persistence';
import { EntityManager } from '../entities/entity-manager.js';
import { RelationshipManager } from '../relationships/relationship-manager.js';
import {
  Entity,
  Relationship,
  RelationshipType,
  GraphNeighborhood,
  GraphPath,
  Subgraph,
  GraphStats,
  KnowledgeGraphError,
} from '../types.js';

interface TraversalRow {
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
  depth: number;
  path: string;
}

interface PathFinderRow {
  depth: number;
  path_ids: string;
  total_weight: number;
}

interface EntityHistoryRow {
  id: string;
  entity_id: string;
  changed_at: number;
  change_type: string;
  previous_state_json: string | null;
  change_description: string | null;
  source_memory_id: string | null;
}

export class GraphTraversal {
  constructor(
    private persistence: IPersistenceLayer,
    private entityManager: EntityManager,
    private relationshipManager: RelationshipManager
  ) {}

  public async getNeighbors(
    entityId: string,
    depth: number = 1,
    types?: RelationshipType[]
  ): Promise<GraphNeighborhood> {
    const center = await this.entityManager.getEntity(entityId);
    if (!center) {
      throw new KnowledgeGraphError(
        'FC_KG_NOT_FOUND',
        `Entity ${entityId} not found for neighborhood query`
      );
    }

    if (depth <= 0) {
      return {
        center,
        entities: [center],
        relationships: [],
        depth: 0,
      };
    }

    const maxDepth = Math.min(depth, 10);
    const now = Date.now();

    let typeFilterClause = '';
    const typeParams: unknown[] = [];
    if (types && types.length > 0) {
      typeFilterClause = `AND r.type IN (${types.map(() => '?').join(',')})`;
      typeParams.push(...types);
    }

    // Recursive CTE for N-hop neighborhood
    const cteSql = `
      WITH RECURSIVE reachable(entity_id, depth, path) AS (
        SELECT ?, 0, ?
        UNION ALL
        SELECT 
          CASE 
            WHEN r.from_id = reachable.entity_id THEN r.to_id
            ELSE r.from_id
          END,
          reachable.depth + 1,
          reachable.path || ' -> ' || CASE 
            WHEN r.from_id = reachable.entity_id THEN r.to_id
            ELSE r.from_id
          END
        FROM reachable
        JOIN relationships r ON (
          r.from_id = reachable.entity_id OR r.to_id = reachable.entity_id
        )
        WHERE reachable.depth < ?
          AND (r.valid_until IS NULL OR r.valid_until > ?)
          ${typeFilterClause}
          AND instr(reachable.path, CASE 
            WHEN r.from_id = reachable.entity_id THEN r.to_id
            ELSE r.from_id
          END) = 0
      )
      SELECT DISTINCT e.*, reachable.depth, reachable.path
      FROM reachable
      JOIN entities e ON e.id = reachable.entity_id
      ORDER BY reachable.depth ASC, e.type ASC;
    `;

    const params: unknown[] = [entityId, entityId, maxDepth, now, ...typeParams];
    const rows = this.persistence.query<TraversalRow>(cteSql, params);

    const visitedEntityIds = new Set<string>(rows.map((r) => r.id));
    visitedEntityIds.add(entityId);

    const entities: Entity[] = [];
    for (const row of rows) {
      const e = await this.entityManager.getEntity(row.id);
      if (e) entities.push(e);
    }

    // Fetch all active relationships between all visited entities
    const entityIdList = Array.from(visitedEntityIds);
    let rels: Relationship[] = [];
    if (entityIdList.length > 0) {
      const placeholders = entityIdList.map(() => '?').join(',');
      const relSql = `
        SELECT * FROM relationships
        WHERE from_id IN (${placeholders})
          AND to_id IN (${placeholders})
          AND (valid_until IS NULL OR valid_until > ?)
          ${types && types.length > 0 ? `AND type IN (${types.map(() => '?').join(',')})` : ''}
      `;
      const relParams: unknown[] = [...entityIdList, ...entityIdList, now];
      if (types && types.length > 0) {
        relParams.push(...types);
      }
      const relRows = this.persistence.query<any>(relSql, relParams);
      rels = relRows.map((r) => this.relationshipManager.rowToRelationship(r));
    }

    return {
      center,
      entities,
      relationships: rels,
      depth: maxDepth,
    };
  }

  public async findPath(
    fromId: string,
    toId: string,
    maxDepth: number = 5
  ): Promise<GraphPath | null> {
    if (fromId === toId) {
      const entity = await this.entityManager.getEntity(fromId);
      if (!entity) return null;
      return {
        entities: [entity],
        relationships: [],
        totalWeight: 0,
      };
    }

    const fromEntity = await this.entityManager.getEntity(fromId);
    const toEntity = await this.entityManager.getEntity(toId);
    if (!fromEntity || !toEntity) return null;

    const depthLimit = Math.min(maxDepth, 10);
    const now = Date.now();

    const pathSql = `
      WITH RECURSIVE path_finder(current_id, target_id, depth, path_ids, total_weight) AS (
        SELECT ?, ?, 0, ? || ',', 0.0
        UNION ALL
        SELECT 
          CASE 
            WHEN r.from_id = pf.current_id THEN r.to_id
            ELSE r.from_id
          END,
          pf.target_id,
          pf.depth + 1,
          pf.path_ids || (CASE WHEN r.from_id = pf.current_id THEN r.to_id ELSE r.from_id END) || ',',
          pf.total_weight + r.weight
        FROM path_finder pf
        JOIN relationships r ON (r.from_id = pf.current_id OR r.to_id = pf.current_id)
        WHERE pf.depth < ?
          AND pf.current_id != pf.target_id
          AND (r.valid_until IS NULL OR r.valid_until > ?)
          AND instr(pf.path_ids, (CASE WHEN r.from_id = pf.current_id THEN r.to_id ELSE r.from_id END) || ',') = 0
      )
      SELECT depth, path_ids, total_weight
      FROM path_finder
      WHERE current_id = target_id
      ORDER BY depth ASC, total_weight ASC
      LIMIT 1;
    `;

    const row = this.persistence.query<PathFinderRow>(pathSql, [
      fromId,
      toId,
      fromId,
      depthLimit,
      now,
    ])[0];

    if (!row) return null;

    const idList = row.path_ids
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    const entities: Entity[] = [];
    for (const id of idList) {
      const e = await this.entityManager.getEntity(id);
      if (e) entities.push(e);
    }

    const relationships: Relationship[] = [];
    for (let i = 0; i < idList.length - 1; i++) {
      const curr = idList[i]!;
      const next = idList[i + 1]!;
      const edge = this.persistence.query<any>(
        `SELECT * FROM relationships
         WHERE ((from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?))
           AND (valid_until IS NULL OR valid_until > ?)
         ORDER BY weight ASC LIMIT 1`,
        [curr, next, next, curr, now]
      )[0];
      if (edge) {
        relationships.push(this.relationshipManager.rowToRelationship(edge));
      }
    }

    return {
      entities,
      relationships,
      totalWeight: row.total_weight,
    };
  }

  public async getSubgraph(entityIds: string[]): Promise<Subgraph> {
    if (entityIds.length === 0) {
      return { entities: [], relationships: [] };
    }

    const entities: Entity[] = [];
    for (const id of entityIds) {
      const e = await this.entityManager.getEntity(id);
      if (e) entities.push(e);
    }

    const placeholders = entityIds.map(() => '?').join(',');
    const now = Date.now();
    const relRows = this.persistence.query<any>(
      `SELECT * FROM relationships
       WHERE from_id IN (${placeholders})
         AND to_id IN (${placeholders})
         AND (valid_until IS NULL OR valid_until > ?)`,
      [...entityIds, ...entityIds, now]
    );

    const relationships = relRows.map((r) =>
      this.relationshipManager.rowToRelationship(r)
    );

    return {
      entities,
      relationships,
    };
  }

  public async getEntityAtTime(
    entityId: string,
    timestamp: number
  ): Promise<Entity | null> {
    const current = await this.entityManager.getEntity(entityId);
    if (!current) return null;

    if (current.createdAt > timestamp) {
      // Entity did not exist at timestamp
      return null;
    }

    // Get all changes after the requested timestamp in reverse order
    const changes = this.persistence.query<EntityHistoryRow>(
      `SELECT * FROM entity_history
       WHERE entity_id = ? AND changed_at > ?
       ORDER BY changed_at DESC`,
      [entityId, timestamp]
    );

    let state = current;
    for (const change of changes) {
      if (change.previous_state_json) {
        try {
          state = JSON.parse(change.previous_state_json) as Entity;
        } catch {}
      }
    }

    return state;
  }

  public async getRelationshipsAtTime(
    entityId: string,
    timestamp: number
  ): Promise<Relationship[]> {
    const rows = this.persistence.query<any>(
      `SELECT * FROM relationships
       WHERE (from_id = ? OR to_id = ?)
         AND valid_from <= ?
         AND (valid_until IS NULL OR valid_until > ?)`,
      [entityId, entityId, timestamp, timestamp]
    );

    return rows.map((r) => this.relationshipManager.rowToRelationship(r));
  }

  public async stats(): Promise<GraphStats> {
    const entityCountRow = this.persistence.query<{ count: number }>(
      'SELECT COUNT(*) as count FROM entities'
    )[0];
    const entityCount = entityCountRow ? entityCountRow.count : 0;

    const relCountRow = this.persistence.query<{ count: number }>(
      'SELECT COUNT(*) as count FROM relationships'
    )[0];
    const relationshipCount = relCountRow ? relCountRow.count : 0;

    const entityTypeRows = this.persistence.query<{ type: string; count: number }>(
      'SELECT type, COUNT(*) as count FROM entities GROUP BY type'
    );
    const entityCountByType: Record<string, number> = {};
    for (const r of entityTypeRows) {
      entityCountByType[r.type] = r.count;
    }

    const relTypeRows = this.persistence.query<{ type: string; count: number }>(
      'SELECT type, COUNT(*) as count FROM relationships GROUP BY type'
    );
    const relationshipCountByType: Record<string, number> = {};
    for (const r of relTypeRows) {
      relationshipCountByType[r.type] = r.count;
    }

    const averageDegree =
      entityCount > 0 ? (relationshipCount * 2) / entityCount : 0;

    const degreeRows = this.persistence.query<{ id: string; degree: number }>(
      `SELECT entity_id as id, COUNT(*) as degree FROM (
        SELECT from_id as entity_id FROM relationships
        UNION ALL
        SELECT to_id as entity_id FROM relationships
      ) GROUP BY entity_id ORDER BY degree DESC LIMIT 5`
    );

    const mostConnectedEntities: Array<{ entity: Entity; degree: number }> = [];
    for (const row of degreeRows) {
      const entity = await this.entityManager.getEntity(row.id);
      if (entity) {
        mostConnectedEntities.push({ entity, degree: row.degree });
      }
    }

    return {
      entityCount,
      relationshipCount,
      entityCountByType,
      relationshipCountByType,
      averageDegree,
      mostConnectedEntities,
    };
  }
}
