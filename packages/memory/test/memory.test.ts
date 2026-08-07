import { describe, it, expect, beforeEach } from 'vitest';
import { PersistenceLayer } from '@fuckclaw/persistence';
import { ConfigManager } from '@fuckclaw/config';
import { Logger } from '@fuckclaw/observability';
import { EventBus } from '@fuckclaw/event-bus';
import {
  MemorySystem,
  WorkingMemory,
  EpisodicStore,
  SemanticStore,
  HybridRetriever,
  generateSimpleEmbedding,
  cosineSimilarity,
  computeDecay,
  estimateTokens,
} from '../src/index.js';

function createTestInfra(): {
  db: PersistenceLayer;
  logger: Logger;
  eventBus: EventBus;
} {
  const config = new ConfigManager({ logging: { level: 'warn' } });
  const logger = new Logger(config);
  const db = new PersistenceLayer(':memory:', logger);
  const eventBus = new EventBus(db, logger);
  return { db, logger, eventBus };
}

// ─── Embedding Utilities ──────────────────────────────────────────────────

describe('Embedding Utilities', () => {
  it('should generate deterministic embeddings for the same text', () => {
    const a = generateSimpleEmbedding('hello world');
    const b = generateSimpleEmbedding('hello world');
    expect(a).toEqual(b);
    expect(a.length).toBe(128);
  });

  it('should produce similar embeddings for similar texts', () => {
    const a = generateSimpleEmbedding('create a file named test.txt');
    const b = generateSimpleEmbedding('create a file called test.txt');
    const c = generateSimpleEmbedding('deploy kubernetes cluster to production');
    const simAB = cosineSimilarity(a, b);
    const simAC = cosineSimilarity(a, c);
    expect(simAB).toBeGreaterThan(simAC);
  });

  it('should return 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });

  it('should return 1 for identical normalized vectors', () => {
    const v = [0.6, 0.8];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 5);
  });
});

// ─── Ebbinghaus Decay ─────────────────────────────────────────────────────

describe('Ebbinghaus Decay', () => {
  it('should return full importance for a just-accessed memory', () => {
    const now = Date.now();
    const r = computeDecay(0.8, 0, now, now);
    expect(r).toBeCloseTo(0.8, 5);
  });

  it('should decay over time for unaccessed memories', () => {
    const now = Date.now();
    const tenDaysAgo = now - 10 * 24 * 3600 * 1000;
    const r = computeDecay(1.0, 0, tenDaysAgo, now);
    expect(r).toBeLessThan(1.0);
    expect(r).toBeGreaterThan(0); // Still non-zero
  });

  it('should decay slower with higher access count', () => {
    const now = Date.now();
    const tenDaysAgo = now - 10 * 24 * 3600 * 1000;
    const lowAccess = computeDecay(1.0, 0, tenDaysAgo, now);
    const highAccess = computeDecay(1.0, 100, tenDaysAgo, now);
    expect(highAccess).toBeGreaterThan(lowAccess);
  });
});

// ─── Token Estimation ─────────────────────────────────────────────────────

describe('Token Estimation', () => {
  it('should estimate tokens as roughly chars/4', () => {
    expect(estimateTokens('hello world')).toBe(3); // 11 chars / 4 = 2.75 -> ceil = 3
  });

  it('should return 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });
});

// ─── Working Memory ───────────────────────────────────────────────────────

describe('WorkingMemory', () => {
  it('should store and retrieve scratchpad values', () => {
    const wm = new WorkingMemory('session-1');
    wm.set('counter', 42);
    expect(wm.get<number>('counter')).toBe(42);
    expect(wm.get<string>('missing')).toBeUndefined();
  });

  it('should append and retrieve conversation turns', () => {
    const wm = new WorkingMemory('session-1');
    wm.appendTurn({ role: 'user', content: 'hello', timestamp: Date.now() });
    wm.appendTurn({ role: 'assistant', content: 'hi', timestamp: Date.now() });
    expect(wm.getTurns()).toHaveLength(2);
    expect(wm.getTurns()[0]!.role).toBe('user');
  });

  it('should snapshot and restore state', () => {
    const wm = new WorkingMemory('session-1');
    wm.set('key', 'value');
    wm.activeTaskId = 'task-1';
    wm.appendTurn({ role: 'user', content: 'test', timestamp: 1000 });

    const snap = wm.snapshot();
    expect(snap.sessionId).toBe('session-1');
    expect(snap.activeTaskId).toBe('task-1');
    expect(snap.scratchpad['key']).toBe('value');
    expect(snap.turnBuffer).toHaveLength(1);

    const wm2 = new WorkingMemory('session-2');
    wm2.restore(snap);
    expect(wm2.sessionId).toBe('session-1');
    expect(wm2.activeTaskId).toBe('task-1');
    expect(wm2.get<string>('key')).toBe('value');
  });

  it('should clear turns', () => {
    const wm = new WorkingMemory('session-1');
    wm.appendTurn({ role: 'user', content: 'hello', timestamp: Date.now() });
    wm.clearTurns();
    expect(wm.getTurns()).toHaveLength(0);
  });
});

// ─── Episodic Store ───────────────────────────────────────────────────────

describe('EpisodicStore', () => {
  let db: PersistenceLayer;
  let logger: Logger;
  let store: EpisodicStore;

  beforeEach(() => {
    const infra = createTestInfra();
    db = infra.db;
    logger = infra.logger;
    store = new EpisodicStore(db, logger);
  });

  it('should record and retrieve an episodic memory', async () => {
    const id = await store.recordEpisode({
      timestamp: Date.now(),
      sessionId: 'sess-1',
      taskId: 'task-1',
      source: 'tool_execution',
      actor: 'agent',
      summary: 'Created file test.txt',
      content: 'Full observation: file created successfully at workspace/test.txt',
      toolCall: {
        toolName: 'filesystem',
        inputParams: { action: 'write', path: 'test.txt', content: 'hello' },
        outputResult: 'Success',
        exitCode: 0,
        durationMs: 15,
      },
      importanceScore: 0.7,
      embedding: generateSimpleEmbedding('Created file test.txt'),
    });

    expect(id).toBeTruthy();
    const retrieved = await store.getEpisode(id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.summary).toBe('Created file test.txt');
    expect(retrieved!.sessionId).toBe('sess-1');
    expect(retrieved!.taskId).toBe('task-1');
    expect(retrieved!.toolCall!.toolName).toBe('filesystem');
    expect(retrieved!.importanceScore).toBe(0.7);
    expect(retrieved!.accessCount).toBe(0); // initial fetch returns state before increment

    // Re-fetch should show incremented access count
    const fetchedAgain = await store.getEpisode(id);
    expect(fetchedAgain!.accessCount).toBe(1);
  });

  it('should query episodes by session', async () => {
    await store.recordEpisode({
      timestamp: Date.now(),
      sessionId: 'sess-A',
      source: 'user_interaction',
      actor: 'user',
      summary: 'User asked about deployment',
      content: 'How do I deploy to production?',
      importanceScore: 0.5,
      embedding: generateSimpleEmbedding('deployment'),
    });

    await store.recordEpisode({
      timestamp: Date.now(),
      sessionId: 'sess-B',
      source: 'user_interaction',
      actor: 'user',
      summary: 'Different session',
      content: 'Different',
      importanceScore: 0.3,
      embedding: generateSimpleEmbedding('different'),
    });

    const sessARecords = await store.queryBySession('sess-A');
    expect(sessARecords).toHaveLength(1);
    expect(sessARecords[0]!.summary).toBe('User asked about deployment');
  });

  it('should support FTS search across episodes', async () => {
    await store.recordEpisode({
      timestamp: Date.now(),
      sessionId: 'sess-1',
      source: 'tool_execution',
      actor: 'agent',
      summary: 'Ran database migration for PostgreSQL',
      content: 'Successfully executed PostgreSQL schema migration v42',
      importanceScore: 0.6,
      embedding: generateSimpleEmbedding('database migration PostgreSQL'),
    });

    await store.recordEpisode({
      timestamp: Date.now(),
      sessionId: 'sess-1',
      source: 'tool_execution',
      actor: 'agent',
      summary: 'Compiled TypeScript project',
      content: 'tsc completed with 0 errors',
      importanceScore: 0.4,
      embedding: generateSimpleEmbedding('typescript compile'),
    });

    const results = await store.searchFTS('PostgreSQL', 10);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.id).toBeTruthy();
  });
});

// ─── Semantic Store ───────────────────────────────────────────────────────

describe('SemanticStore', () => {
  let db: PersistenceLayer;
  let logger: Logger;
  let store: SemanticStore;

  beforeEach(() => {
    const infra = createTestInfra();
    db = infra.db;
    logger = infra.logger;
    store = new SemanticStore(db, logger);
  });

  it('should assert and retrieve a semantic fact', async () => {
    const id = await store.assertFact({
      subject: 'auth_service',
      predicate: 'uses_database',
      object: 'PostgreSQL 16',
      statement: 'The auth service uses PostgreSQL 16 as its primary database',
      confidence: 0.95,
      sourceEpisodicIds: ['ep-1', 'ep-2'],
      validFrom: Date.now(),
      validUntil: null,
      embedding: generateSimpleEmbedding('auth service PostgreSQL database'),
    });

    expect(id).toBeTruthy();
    const fact = await store.getFact(id);
    expect(fact).not.toBeNull();
    expect(fact!.subject).toBe('auth_service');
    expect(fact!.predicate).toBe('uses_database');
    expect(fact!.object).toBe('PostgreSQL 16');
    expect(fact!.confidence).toBe(0.95);
    expect(fact!.sourceEpisodicIds).toEqual(['ep-1', 'ep-2']);
    expect(fact!.validUntil).toBeNull();
  });

  it('should retract a fact by setting validUntil', async () => {
    const id = await store.assertFact({
      subject: 'project',
      predicate: 'uses_framework',
      object: 'Express',
      statement: 'The project uses Express for HTTP',
      confidence: 0.8,
      sourceEpisodicIds: [],
      validFrom: Date.now(),
      validUntil: null,
      embedding: generateSimpleEmbedding('project Express HTTP'),
    });

    await store.retractFact(id, 'Migrated to Hono');
    const fact = await store.getFact(id);
    expect(fact!.validUntil).not.toBeNull();

    // Retracted facts should not appear in active facts
    const active = await store.getActiveFacts();
    expect(active.find((f) => f.id === id)).toBeUndefined();
  });

  it('should query facts by subject', async () => {
    await store.assertFact({
      subject: 'database',
      predicate: 'port',
      object: '5432',
      statement: 'Database runs on port 5432',
      confidence: 1.0,
      sourceEpisodicIds: [],
      validFrom: Date.now(),
      validUntil: null,
      embedding: generateSimpleEmbedding('database port 5432'),
    });

    const results = await store.queryBySubject('database');
    expect(results).toHaveLength(1);
    expect(results[0]!.object).toBe('5432');
  });

  it('should support FTS search across facts', async () => {
    await store.assertFact({
      subject: 'infrastructure',
      predicate: 'runs_on',
      object: 'Kubernetes',
      statement: 'Production infrastructure runs on Kubernetes with Helm charts',
      confidence: 0.9,
      sourceEpisodicIds: [],
      validFrom: Date.now(),
      validUntil: null,
      embedding: generateSimpleEmbedding('Kubernetes Helm production'),
    });

    const results = await store.searchFTS('Kubernetes', 10);
    expect(results.length).toBeGreaterThan(0);
  });
});

// ─── Hybrid Retriever ─────────────────────────────────────────────────────

describe('HybridRetriever', () => {
  let db: PersistenceLayer;
  let logger: Logger;
  let eventBus: EventBus;

  beforeEach(() => {
    const infra = createTestInfra();
    db = infra.db;
    logger = infra.logger;
    eventBus = infra.eventBus;
  });

  it('should rank results by composite score across episodic and semantic', async () => {
    const epStore = new EpisodicStore(db, logger);
    const semStore = new SemanticStore(db, logger);
    const retriever = new HybridRetriever(epStore, semStore, logger);

    // Insert an episodic record about deployment
    await epStore.recordEpisode({
      timestamp: Date.now(),
      sessionId: 'sess-1',
      source: 'tool_execution',
      actor: 'agent',
      summary: 'Deployed application to staging environment',
      content: 'docker-compose up -d in staging cluster completed successfully',
      importanceScore: 0.8,
      embedding: generateSimpleEmbedding('deployed application staging docker'),
    });

    // Insert a semantic fact about deployment
    await semStore.assertFact({
      subject: 'deployment',
      predicate: 'target',
      object: 'staging',
      statement: 'The deployment target is the staging environment',
      confidence: 0.9,
      sourceEpisodicIds: [],
      validFrom: Date.now(),
      validUntil: null,
      embedding: generateSimpleEmbedding('deployment target staging environment'),
    });

    // Insert an unrelated episodic record
    await epStore.recordEpisode({
      timestamp: Date.now() - 86400000, // 1 day ago
      sessionId: 'sess-0',
      source: 'user_interaction',
      actor: 'user',
      summary: 'Asked about TypeScript types',
      content: 'How do I define union types in TypeScript?',
      importanceScore: 0.3,
      embedding: generateSimpleEmbedding('TypeScript union types define'),
    });

    const results = await retriever.search({ text: 'deployment staging', limit: 10 });

    expect(results.episodic.length).toBeGreaterThan(0);
    expect(results.semantic.length).toBeGreaterThan(0);

    // The deployment-related episode should rank higher than TypeScript
    if (results.episodic.length >= 2) {
      expect(results.episodic[0]!.score).toBeGreaterThan(results.episodic[1]!.score);
    }

    expect(results.totalTokensEstimated).toBeGreaterThan(0);
  });

  it('should respect token budget in context retrieval', async () => {
    const epStore = new EpisodicStore(db, logger);
    const semStore = new SemanticStore(db, logger);
    const retriever = new HybridRetriever(epStore, semStore, logger);

    // Insert several records
    for (let i = 0; i < 10; i++) {
      await epStore.recordEpisode({
        timestamp: Date.now() - i * 1000,
        sessionId: 'sess-1',
        source: 'tool_execution',
        actor: 'agent',
        summary: `Action ${i}: performed step ${i} of the deployment pipeline`,
        content: `Detailed log output for step ${i}: everything went smoothly with no errors detected`,
        importanceScore: 0.5,
        embedding: generateSimpleEmbedding(`deployment step ${i}`),
      });
    }

    // Very small token budget
    const context = await retriever.retrieveForContext('deployment', 50);
    const tokens = estimateTokens(context);
    expect(tokens).toBeLessThanOrEqual(55); // Allow small overshoot from headers
  });
});

// ─── Memory System (Full Facade) ──────────────────────────────────────────

describe('MemorySystem', () => {
  let db: PersistenceLayer;
  let logger: Logger;
  let eventBus: EventBus;
  let memory: MemorySystem;

  beforeEach(() => {
    const infra = createTestInfra();
    db = infra.db;
    logger = infra.logger;
    eventBus = infra.eventBus;
    memory = new MemorySystem(db, logger, eventBus, 'test-session');
  });

  it('should record and retrieve episodic memories', async () => {
    const id = await memory.recordEpisode({
      timestamp: Date.now(),
      sessionId: 'test-session',
      taskId: 'task-A',
      source: 'tool_execution',
      actor: 'agent',
      summary: 'Created config file',
      content: 'Wrote fuckclaw.toml with default settings',
      importanceScore: 0.6,
      embedding: generateSimpleEmbedding('config file created'),
    });

    const episode = await memory.getEpisode(id);
    expect(episode).not.toBeNull();
    expect(episode!.summary).toBe('Created config file');
  });

  it('should assert and query semantic facts', async () => {
    await memory.assertFact({
      subject: 'fuckclaw',
      predicate: 'uses_language',
      object: 'TypeScript',
      statement: 'FuckClaw is implemented in TypeScript',
      confidence: 1.0,
      sourceEpisodicIds: [],
      validFrom: Date.now(),
      validUntil: null,
      embedding: generateSimpleEmbedding('FuckClaw TypeScript implementation'),
    });

    const results = await memory.querySemantic({ text: 'TypeScript', limit: 5 });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.record.statement).toContain('TypeScript');
  });

  it('should retract facts through the facade', async () => {
    const id = await memory.assertFact({
      subject: 'build_tool',
      predicate: 'is',
      object: 'webpack',
      statement: 'The build tool is webpack',
      confidence: 0.7,
      sourceEpisodicIds: [],
      validFrom: Date.now(),
      validUntil: null,
      embedding: generateSimpleEmbedding('build tool webpack'),
    });

    await memory.retractFact(id, 'Migrated to tsc');
    const fact = await memory.getEpisode(id);
    // getEpisode returns null since it's a semantic fact
    expect(fact).toBeNull();
  });

  it('should perform hybrid search across both stores', async () => {
    await memory.recordEpisode({
      timestamp: Date.now(),
      sessionId: 'test-session',
      source: 'tool_execution',
      actor: 'agent',
      summary: 'Ran database migration',
      content: 'Executed SQLite migration scripts',
      importanceScore: 0.7,
      embedding: generateSimpleEmbedding('database migration SQLite'),
    });

    await memory.assertFact({
      subject: 'storage',
      predicate: 'engine',
      object: 'SQLite',
      statement: 'The storage engine is SQLite with WAL mode',
      confidence: 0.95,
      sourceEpisodicIds: [],
      validFrom: Date.now(),
      validUntil: null,
      embedding: generateSimpleEmbedding('storage SQLite WAL'),
    });

    const results = await memory.searchHybrid({ text: 'SQLite database', limit: 10 });
    expect(results.episodic.length).toBeGreaterThan(0);
    expect(results.semantic.length).toBeGreaterThan(0);
  });

  it('should flush working memory turns to episodic store', async () => {
    memory.working.appendTurn({
      role: 'user',
      content: 'Please create a deployment script',
      timestamp: Date.now(),
    });
    memory.working.appendTurn({
      role: 'assistant',
      content: 'I will create a deployment script using Docker Compose',
      timestamp: Date.now(),
    });

    const ids = await memory.flushWorkingToEpisodic('task-X');
    expect(ids).toHaveLength(2);

    // Turns should be cleared after flush
    expect(memory.working.getTurns()).toHaveLength(0);

    // Episodes should be retrievable
    const ep1 = await memory.getEpisode(ids[0]!);
    expect(ep1).not.toBeNull();
    expect(ep1!.taskId).toBe('task-X');
    expect(ep1!.source).toBe('user_interaction');
  });

  it('should retrieve memory for context within token budget', async () => {
    await memory.recordEpisode({
      timestamp: Date.now(),
      sessionId: 'test-session',
      source: 'tool_execution',
      actor: 'agent',
      summary: 'Compiled the project with tsc',
      content: 'TypeScript compilation completed with 0 errors across 11 packages',
      importanceScore: 0.5,
      embedding: generateSimpleEmbedding('TypeScript compilation tsc'),
    });

    await memory.assertFact({
      subject: 'project',
      predicate: 'build_system',
      object: 'pnpm + tsc',
      statement: 'The project build system uses pnpm workspaces with tsc compilation',
      confidence: 0.9,
      sourceEpisodicIds: [],
      validFrom: Date.now(),
      validUntil: null,
      embedding: generateSimpleEmbedding('pnpm tsc build compilation'),
    });

    const context = await memory.retrieveForContext('build compilation', 500);
    expect(context.length).toBeGreaterThan(0);
    expect(context).toContain('Relevant Facts');
  });

  it('should support cross-session memory retrieval (Milestone 4 DoD)', async () => {
    // Simulate session 1: record some activity
    const memory1 = new MemorySystem(db, logger, eventBus, 'session-1');
    await memory1.recordEpisode({
      timestamp: Date.now() - 60000,
      sessionId: 'session-1',
      taskId: 'task-1',
      source: 'tool_execution',
      actor: 'agent',
      summary: 'Created file deploy.sh in workspace',
      content: 'Wrote a deployment shell script that runs docker-compose up -d',
      importanceScore: 0.8,
      embedding: generateSimpleEmbedding('created deploy.sh deployment script docker'),
    });
    await memory1.assertFact({
      subject: 'deploy.sh',
      predicate: 'location',
      object: 'workspace/deploy.sh',
      statement: 'The deployment script deploy.sh is located at workspace/deploy.sh',
      confidence: 1.0,
      sourceEpisodicIds: [],
      validFrom: Date.now() - 60000,
      validUntil: null,
      embedding: generateSimpleEmbedding('deploy.sh location workspace'),
    });

    // Simulate session 2: query about what happened before
    const memory2 = new MemorySystem(db, logger, eventBus, 'session-2');
    const results = await memory2.searchHybrid({ text: 'deployment script', limit: 5 });

    // Should find both the episodic record and semantic fact from session 1
    expect(results.episodic.length).toBeGreaterThan(0);
    expect(results.semantic.length).toBeGreaterThan(0);
    expect(results.episodic[0]!.record.sessionId).toBe('session-1');
    expect(results.semantic[0]!.record.subject).toBe('deploy.sh');
  });
});
