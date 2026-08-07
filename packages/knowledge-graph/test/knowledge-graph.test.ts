import { describe, it, expect, beforeEach } from 'vitest';
import { PersistenceLayer } from '@fuckclaw/persistence';
import { KnowledgeGraph } from '../src/knowledge-graph.js';
import { KnowledgeGraphError } from '../src/types.js';

describe('Knowledge Graph Subsystem (§8)', () => {
  let persistence: PersistenceLayer;
  let kg: KnowledgeGraph;

  beforeEach(() => {
    persistence = new PersistenceLayer(':memory:');
    kg = new KnowledgeGraph(persistence);
  });

  describe('Entity Management', () => {
    it('creates and retrieves entities', async () => {
      const entity = await kg.createEntity({
        type: 'person',
        name: 'Alice',
        aliases: ['@alice', 'alice@acme.com'],
        description: 'Lead engineer at Acme Corp',
        properties: { role: 'tech_lead', team: 'auth' },
        confidence: 0.95,
      });

      expect(entity.id).toBeDefined();
      expect(entity.name).toBe('Alice');
      expect(entity.aliases).toContain('@alice');
      expect(entity.properties.role).toBe('tech_lead');

      const fetched = await kg.getEntity(entity.id);
      expect(fetched).not.toBeNull();
      expect(fetched?.name).toBe('Alice');
      expect(fetched?.aliases).toEqual(['@alice', 'alice@acme.com']);
    });

    it('resolves entity by alias and handles merges cleanly', async () => {
      const canonical = await kg.createEntity({
        type: 'project',
        name: 'auth-service',
        aliases: ['authentication-microservice'],
        description: 'Core OAuth2 provider',
        properties: { port: 8080 },
      });

      // Resolve by alias
      const resolved = await kg.resolveEntity({
        name: 'authentication-microservice',
        type: 'project',
      });
      expect(resolved?.id).toBe(canonical.id);

      // Create duplicate candidate to merge
      const duplicate = await kg.createEntity({
        type: 'project',
        name: 'auth-svc',
        aliases: ['auth-service-v1'],
        description: 'Old auth repo',
        properties: { deprecated: true },
      });

      const merged = await kg.mergeEntities(duplicate.id, canonical.id, 'Duplicate repo merged');
      expect(merged.id).toBe(canonical.id);
      expect(merged.aliases).toContain('auth-svc');
      expect(merged.aliases).toContain('auth-service-v1');
      expect(merged.properties.deprecated).toBe(true);

      // Duplicate should be deleted from active entities
      const oldEntity = await kg.getEntity(duplicate.id);
      expect(oldEntity).toBeNull();
    });

    it('performs search and similarity filtering', async () => {
      await kg.createEntity({
        type: 'concept',
        name: 'PostgreSQL Database',
        description: 'Relational ACID storage engine',
        embedding: [1.0, 0.0, 0.0],
      });

      await kg.createEntity({
        type: 'concept',
        name: 'Redis Cache',
        description: 'In-memory key-value store',
        embedding: [0.0, 1.0, 0.0],
      });

      const searchResults = await kg.searchEntities('PostgreSQL');
      expect(searchResults.length).toBeGreaterThan(0);
      expect(searchResults[0]?.name).toBe('PostgreSQL Database');

      const similar = await kg.findSimilarEntities([0.9, 0.1, 0.0], 0.8);
      expect(similar.length).toBe(1);
      expect(similar[0]?.name).toBe('PostgreSQL Database');
    });
  });

  describe('Relationship Management & Adjacency', () => {
    it('creates relationships between entities with referential integrity', async () => {
      const alice = await kg.createEntity({ type: 'person', name: 'Alice' });
      const acme = await kg.createEntity({ type: 'organization', name: 'Acme Corp' });

      const rel = await kg.createRelationship({
        fromId: alice.id,
        toId: acme.id,
        type: 'WORKS_AT',
        weight: 0.9,
      });

      expect(rel.id).toBeDefined();
      expect(rel.fromId).toBe(alice.id);
      expect(rel.toId).toBe(acme.id);
      expect(rel.type).toBe('WORKS_AT');

      // Attempting to create relationship with non-existent entity throws
      await expect(
        kg.createRelationship({
          fromId: alice.id,
          toId: 'non-existent-id',
          type: 'WORKS_AT',
        })
      ).rejects.toThrow(KnowledgeGraphError);
    });

    it('ends and updates relationships with temporal validity', async () => {
      const bob = await kg.createEntity({ type: 'person', name: 'Bob' });
      const proj = await kg.createEntity({ type: 'project', name: 'billing-service' });

      const rel = await kg.createRelationship({
        fromId: bob.id,
        toId: proj.id,
        type: 'WORKS_ON',
      });

      expect(rel.validUntil).toBeNull();

      await kg.endRelationship(rel.id);
      const updated = await kg.getRelationship(rel.id);
      expect(updated?.validUntil).not.toBeNull();
    });
  });

  describe('Graph Traversal & Recursive Queries (§8.5)', () => {
    it('executes N-hop neighborhood queries via recursive CTE', async () => {
      // Setup graph:
      // Alice -> WORKS_AT -> Acme
      // Alice -> WORKS_ON -> auth-service
      // auth-service -> DEPENDS_ON -> user-db
      // user-db -> USES -> Postgres
      const alice = await kg.createEntity({ type: 'person', name: 'Alice' });
      const acme = await kg.createEntity({ type: 'organization', name: 'Acme Corp' });
      const auth = await kg.createEntity({ type: 'project', name: 'auth-service' });
      const userDb = await kg.createEntity({ type: 'project', name: 'user-db' });
      const pg = await kg.createEntity({ type: 'concept', name: 'PostgreSQL' });

      await kg.createRelationship({ fromId: alice.id, toId: acme.id, type: 'WORKS_AT' });
      await kg.createRelationship({ fromId: alice.id, toId: auth.id, type: 'WORKS_ON' });
      await kg.createRelationship({ fromId: auth.id, toId: userDb.id, type: 'DEPENDS_ON' });
      await kg.createRelationship({ fromId: userDb.id, toId: pg.id, type: 'USES' });

      // 1-hop from Alice: should find Acme and auth-service
      const hop1 = await kg.getNeighbors(alice.id, 1);
      const hop1Names = hop1.entities.map((e) => e.name);
      expect(hop1Names).toContain('Acme Corp');
      expect(hop1Names).toContain('auth-service');
      expect(hop1Names).not.toContain('user-db');

      // 2-hop from Alice: should find user-db as well
      const hop2 = await kg.getNeighbors(alice.id, 2);
      const hop2Names = hop2.entities.map((e) => e.name);
      expect(hop2Names).toContain('Acme Corp');
      expect(hop2Names).toContain('auth-service');
      expect(hop2Names).toContain('user-db');
      expect(hop2Names).not.toContain('PostgreSQL');

      // 3-hop from Alice: reaches PostgreSQL
      const hop3 = await kg.getNeighbors(alice.id, 3);
      const hop3Names = hop3.entities.map((e) => e.name);
      expect(hop3Names).toContain('PostgreSQL');
    });

    it('finds path between disconnected or multi-hop entities', async () => {
      const a = await kg.createEntity({ type: 'service', name: 'Service A' });
      const b = await kg.createEntity({ type: 'service', name: 'Service B' });
      const c = await kg.createEntity({ type: 'service', name: 'Service C' });
      const d = await kg.createEntity({ type: 'service', name: 'Service D' });

      await kg.createRelationship({ fromId: a.id, toId: b.id, type: 'DEPENDS_ON', weight: 1.0 });
      await kg.createRelationship({ fromId: b.id, toId: c.id, type: 'DEPENDS_ON', weight: 1.0 });
      await kg.createRelationship({ fromId: c.id, toId: d.id, type: 'DEPENDS_ON', weight: 1.0 });

      const path = await kg.findPath(a.id, d.id, 5);
      expect(path).not.toBeNull();
      expect(path?.entities.map((e) => e.name)).toEqual([
        'Service A',
        'Service B',
        'Service C',
        'Service D',
      ]);
      expect(path?.relationships.length).toBe(3);
    });

    it('reconstructs historical entity states via entity_history', async () => {
      const entity = await kg.createEntity({
        type: 'decision',
        name: 'Database Architecture Decision',
        properties: { database: 'PostgreSQL', status: 'proposed' },
        createdAt: 1000,
        updatedAt: 1000,
        lastReferencedAt: 1000,
      });

      const t0 = 1500;

      // Update entity state later
      const updated = await kg.updateEntity(
        entity.id,
        {
          properties: { database: 'SQLite', status: 'approved' },
          updatedAt: 2000,
        },
        'Switched to SQLite'
      );
      expect(updated.properties.database).toBe('SQLite');

      // Query state at t0
      const historical = await kg.getEntityAtTime(entity.id, t0);
      expect(historical).not.toBeNull();
      expect(historical?.properties.database).toBe('PostgreSQL');
    });

    it('computes accurate graph statistics', async () => {
      const p1 = await kg.createEntity({ type: 'person', name: 'Dev 1' });
      const p2 = await kg.createEntity({ type: 'person', name: 'Dev 2' });
      const proj = await kg.createEntity({ type: 'project', name: 'Hub' });

      await kg.createRelationship({ fromId: p1.id, toId: proj.id, type: 'WORKS_ON' });
      await kg.createRelationship({ fromId: p2.id, toId: proj.id, type: 'WORKS_ON' });

      const stats = await kg.stats();
      expect(stats.entityCount).toBe(3);
      expect(stats.relationshipCount).toBe(2);
      expect(stats.entityCountByType['person']).toBe(2);
      expect(stats.entityCountByType['project']).toBe(1);
      expect(stats.mostConnectedEntities[0]?.entity.name).toBe('Hub');
    });
  });
});
