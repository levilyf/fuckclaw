import { IPersistenceLayer } from '@fuckclaw/persistence';
import { IObservability } from '@fuckclaw/observability';
import { IEventBus } from '@fuckclaw/event-bus';
import { EntityManager } from './entities/entity-manager.js';
import { RelationshipManager } from './relationships/relationship-manager.js';
import { GraphTraversal } from './queries/graph-traversal.js';
import {
  Entity,
  EntityType,
  EntityCandidate,
  Relationship,
  RelationshipType,
  GraphNeighborhood,
  GraphPath,
  Subgraph,
  GraphStats,
  IKnowledgeGraph,
} from './types.js';

export class KnowledgeGraph implements IKnowledgeGraph {
  private entityManager: EntityManager;
  private relationshipManager: RelationshipManager;
  private traversal: GraphTraversal;

  constructor(
    persistence: IPersistenceLayer,
    observability?: IObservability,
    eventBus?: IEventBus
  ) {
    this.entityManager = new EntityManager(persistence, observability, eventBus);
    this.relationshipManager = new RelationshipManager(persistence, observability, eventBus);
    this.traversal = new GraphTraversal(persistence, this.entityManager, this.relationshipManager);
  }

  // --- Entity Operations ---

  public async createEntity(
    candidate: Omit<Entity, 'id' | 'createdAt' | 'updatedAt' | 'lastReferencedAt'> &
      Partial<Pick<Entity, 'id' | 'createdAt' | 'updatedAt' | 'lastReferencedAt'>>
  ): Promise<Entity> {
    return this.entityManager.createEntity(candidate);
  }

  public async getEntity(id: string): Promise<Entity | null> {
    return this.entityManager.getEntity(id);
  }

  public async getEntityByName(name: string, type?: EntityType): Promise<Entity | null> {
    return this.entityManager.getEntityByName(name, type);
  }

  public async updateEntity(
    id: string,
    updates: Partial<Entity>,
    reason?: string
  ): Promise<Entity> {
    return this.entityManager.updateEntity(id, updates, reason);
  }

  public async deleteEntity(id: string, reason?: string): Promise<void> {
    return this.entityManager.deleteEntity(id, reason);
  }

  public async mergeEntities(
    sourceId: string,
    targetId: string,
    reason?: string
  ): Promise<Entity> {
    return this.entityManager.mergeEntities(sourceId, targetId, reason);
  }

  public async searchEntities(
    query: string,
    types?: EntityType[],
    limit?: number
  ): Promise<Entity[]> {
    return this.entityManager.searchEntities(query, types, limit);
  }

  public async findSimilarEntities(
    embedding: number[],
    threshold?: number,
    limit?: number
  ): Promise<Entity[]> {
    return this.entityManager.findSimilarEntities(embedding, threshold, limit);
  }

  public async resolveEntity(candidate: EntityCandidate): Promise<Entity | null> {
    return this.entityManager.resolveEntity(candidate);
  }

  // --- Relationship Operations ---

  public async createRelationship(
    candidate: Omit<Relationship, 'id' | 'createdAt' | 'updatedAt'> &
      Partial<Pick<Relationship, 'id' | 'createdAt' | 'updatedAt'>>
  ): Promise<Relationship> {
    return this.relationshipManager.createRelationship(candidate);
  }

  public async getRelationship(id: string): Promise<Relationship | null> {
    return this.relationshipManager.getRelationship(id);
  }

  public async updateRelationship(
    id: string,
    updates: Partial<Relationship>
  ): Promise<Relationship> {
    return this.relationshipManager.updateRelationship(id, updates);
  }

  public async endRelationship(id: string): Promise<void> {
    return this.relationshipManager.endRelationship(id);
  }

  public async deleteRelationship(id: string): Promise<void> {
    return this.relationshipManager.deleteRelationship(id);
  }

  // --- Graph Queries & Traversals ---

  public async getNeighbors(
    entityId: string,
    depth: number = 1,
    types?: RelationshipType[]
  ): Promise<GraphNeighborhood> {
    return this.traversal.getNeighbors(entityId, depth, types);
  }

  public async findPath(
    fromId: string,
    toId: string,
    maxDepth: number = 5
  ): Promise<GraphPath | null> {
    return this.traversal.findPath(fromId, toId, maxDepth);
  }

  public async getSubgraph(entityIds: string[]): Promise<Subgraph> {
    return this.traversal.getSubgraph(entityIds);
  }

  public async getEntityAtTime(
    entityId: string,
    timestamp: number
  ): Promise<Entity | null> {
    return this.traversal.getEntityAtTime(entityId, timestamp);
  }

  public async getRelationshipsAtTime(
    entityId: string,
    timestamp: number
  ): Promise<Relationship[]> {
    return this.traversal.getRelationshipsAtTime(entityId, timestamp);
  }

  // --- Bulk Operations ---

  public async upsertEntities(
    candidates: Array<Partial<Entity> & { name: string; type: EntityType }>
  ): Promise<Entity[]> {
    const results: Entity[] = [];
    for (const cand of candidates) {
      const existing = await this.resolveEntity({
        name: cand.name,
        type: cand.type,
        aliases: cand.aliases,
      });

      if (existing) {
        const updated = await this.updateEntity(
          existing.id,
          {
            ...cand,
            properties: { ...existing.properties, ...(cand.properties || {}) },
            aliases: Array.from(new Set([...existing.aliases, ...(cand.aliases || [])])),
            sourceMemoryIds: Array.from(
              new Set([...existing.sourceMemoryIds, ...(cand.sourceMemoryIds || [])])
            ),
          },
          'Upsert merged properties'
        );
        results.push(updated);
      } else {
        const created = await this.createEntity({
          name: cand.name,
          type: cand.type,
          aliases: cand.aliases || [],
          description: cand.description || '',
          properties: cand.properties || {},
          sourceMemoryIds: cand.sourceMemoryIds || [],
          confidence: cand.confidence ?? 1.0,
          embedding: cand.embedding,
        });
        results.push(created);
      }
    }
    return results;
  }

  public async upsertRelationships(
    rels: Array<Partial<Relationship> & { fromId: string; toId: string; type: RelationshipType }>
  ): Promise<Relationship[]> {
    const results: Relationship[] = [];
    for (const rel of rels) {
      const existing = await this.relationshipManager.findRelationships({
        fromId: rel.fromId,
        toId: rel.toId,
        type: rel.type,
        activeOnly: true,
      });

      if (existing.length > 0 && existing[0]) {
        const updated = await this.updateRelationship(existing[0].id, {
          weight: rel.weight ?? existing[0].weight,
          properties: { ...existing[0].properties, ...(rel.properties || {}) },
          sourceMemoryIds: Array.from(
            new Set([...existing[0].sourceMemoryIds, ...(rel.sourceMemoryIds || [])])
          ),
          confidence: rel.confidence ?? existing[0].confidence,
        });
        results.push(updated);
      } else {
        const created = await this.createRelationship({
          fromId: rel.fromId,
          toId: rel.toId,
          type: rel.type,
          weight: rel.weight ?? 1.0,
          properties: rel.properties || {},
          validFrom: rel.validFrom ?? Date.now(),
          validUntil: rel.validUntil ?? null,
          sourceMemoryIds: rel.sourceMemoryIds || [],
          confidence: rel.confidence ?? 1.0,
        });
        results.push(created);
      }
    }
    return results;
  }

  // --- Statistics ---

  public async stats(): Promise<GraphStats> {
    return this.traversal.stats();
  }
}
