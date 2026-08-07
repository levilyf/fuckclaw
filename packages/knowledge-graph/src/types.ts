import { FuckClawError } from '@fuckclaw/core';

export type EntityType =
  | 'person'
  | 'organization'
  | 'project'
  | 'repository'
  | 'file'
  | 'conversation'
  | 'goal'
  | 'task'
  | 'event'
  | 'decision'
  | 'concept'
  | 'tool'
  | 'skill'
  | 'service'
  | 'environment'
  | 'artifact'
  | string;

export type RelationshipType =
  | 'WORKS_AT'
  | 'WORKS_ON'
  | 'OWNS'
  | 'MEMBER_OF'
  | 'DEPENDS_ON'
  | 'DEPLOYED_TO'
  | 'PART_OF'
  | 'AUTHORED'
  | 'DECIDED'
  | 'AFFECTS'
  | 'RELATED_TO'
  | 'LEARNED_FROM'
  | 'BLOCKED_BY'
  | 'CAUSED'
  | 'SUPERSEDES'
  | 'USES'
  | 'ACHIEVES'
  | 'CONTEXT_FOR'
  | string;

export interface Entity {
  id: string;
  type: EntityType;
  name: string;
  aliases: string[];
  description: string;
  properties: Record<string, unknown>;
  sourceMemoryIds: string[];
  confidence: number;
  createdAt: number;
  updatedAt: number;
  lastReferencedAt: number;
  embedding?: number[];
}

export interface Relationship {
  id: string;
  fromId: string;
  toId: string;
  type: RelationshipType;
  weight: number;
  properties: Record<string, unknown>;
  validFrom: number;
  validUntil: number | null;
  sourceMemoryIds: string[];
  confidence: number;
  createdAt: number;
  updatedAt: number;
}

export interface EntityHistoryRecord {
  id: string;
  entityId: string;
  changedAt: number;
  changeType: 'created' | 'updated' | 'merged' | 'deleted';
  previousStateJson: string | null;
  changeDescription?: string;
  sourceMemoryId?: string;
}

export interface GraphNeighborhood {
  center: Entity;
  entities: Entity[];
  relationships: Relationship[];
  depth: number;
}

export interface GraphPath {
  entities: Entity[];
  relationships: Relationship[];
  totalWeight: number;
}

export interface Subgraph {
  entities: Entity[];
  relationships: Relationship[];
}

export interface GraphStats {
  entityCount: number;
  relationshipCount: number;
  entityCountByType: Record<string, number>;
  relationshipCountByType: Record<string, number>;
  averageDegree: number;
  mostConnectedEntities: Array<{ entity: Entity; degree: number }>;
}

export interface EntityCandidate {
  name: string;
  type?: EntityType;
  aliases?: string[];
  description?: string;
  properties?: Record<string, unknown>;
}

export interface IKnowledgeGraph {
  createEntity(entity: Omit<Entity, 'id' | 'createdAt' | 'updatedAt' | 'lastReferencedAt'> & Partial<Pick<Entity, 'id' | 'createdAt' | 'updatedAt' | 'lastReferencedAt'>>): Promise<Entity>;
  getEntity(id: string): Promise<Entity | null>;
  getEntityByName(name: string, type?: EntityType): Promise<Entity | null>;
  updateEntity(id: string, updates: Partial<Entity>, reason?: string): Promise<Entity>;
  deleteEntity(id: string, reason?: string): Promise<void>;
  mergeEntities(sourceId: string, targetId: string, reason?: string): Promise<Entity>;
  
  searchEntities(query: string, types?: EntityType[], limit?: number): Promise<Entity[]>;
  findSimilarEntities(embedding: number[], threshold?: number, limit?: number): Promise<Entity[]>;
  resolveEntity(candidate: EntityCandidate): Promise<Entity | null>;

  createRelationship(rel: Omit<Relationship, 'id' | 'createdAt' | 'updatedAt'> & Partial<Pick<Relationship, 'id' | 'createdAt' | 'updatedAt'>>): Promise<Relationship>;
  getRelationship(id: string): Promise<Relationship | null>;
  updateRelationship(id: string, updates: Partial<Relationship>): Promise<Relationship>;
  endRelationship(id: string): Promise<void>;
  deleteRelationship(id: string): Promise<void>;

  getNeighbors(entityId: string, depth?: number, types?: RelationshipType[]): Promise<GraphNeighborhood>;
  findPath(fromId: string, toId: string, maxDepth?: number): Promise<GraphPath | null>;
  getSubgraph(entityIds: string[]): Promise<Subgraph>;

  getEntityAtTime(entityId: string, timestamp: number): Promise<Entity | null>;
  getRelationshipsAtTime(entityId: string, timestamp: number): Promise<Relationship[]>;

  upsertEntities(entities: Array<Partial<Entity> & { name: string; type: EntityType }>): Promise<Entity[]>;
  upsertRelationships(rels: Array<Partial<Relationship> & { fromId: string; toId: string; type: RelationshipType }>): Promise<Relationship[]>;

  stats(): Promise<GraphStats>;
}

export class KnowledgeGraphError extends FuckClawError {
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(code, message, details);
    this.name = 'KnowledgeGraphError';
  }
}
