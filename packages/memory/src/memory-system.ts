import { IPersistenceLayer } from '@fuckclaw/persistence';
import { IObservability } from '@fuckclaw/observability';
import { IEventBus } from '@fuckclaw/event-bus';
import { ulid } from 'ulidx';
import {
  IMemorySystem,
  EpisodicRecordInput,
  SemanticFactInput,
  MemoryQuery,
  ScoredMemoryRecord,
  EpisodicMemoryRecord,
  SemanticMemoryRecord,
  UnifiedMemorySearchResult,
} from './types.js';
import { WorkingMemory } from './working/working-memory.js';
import { EpisodicStore } from './episodic/episodic-store.js';
import { SemanticStore } from './semantic/semantic-store.js';
import { HybridRetriever } from './retrieval/hybrid-retriever.js';
import { generateSimpleEmbedding } from './decay/ebbinghaus-decay.js';

export class MemorySystem implements IMemorySystem {
  public readonly working: WorkingMemory;
  private readonly episodicStore: EpisodicStore;
  private readonly semanticStore: SemanticStore;
  private readonly retriever: HybridRetriever;

  constructor(
    db: IPersistenceLayer,
    private logger: IObservability,
    private eventBus: IEventBus,
    sessionId?: string
  ) {
    this.working = new WorkingMemory(sessionId ?? ulid());
    this.episodicStore = new EpisodicStore(db, logger);
    this.semanticStore = new SemanticStore(db, logger);
    this.retriever = new HybridRetriever(this.episodicStore, this.semanticStore, logger);
  }

  // ── Episodic ──

  async recordEpisode(input: EpisodicRecordInput): Promise<string> {
    const id = await this.episodicStore.recordEpisode(input);
    await this.eventBus.emit('memory.episodic.recorded', {
      memoryId: id,
      sessionId: input.sessionId,
      source: input.source,
    });
    return id;
  }

  async getEpisode(id: string): Promise<EpisodicMemoryRecord | null> {
    return this.episodicStore.getEpisode(id);
  }

  async queryEpisodic(query: MemoryQuery): Promise<ScoredMemoryRecord<EpisodicMemoryRecord>[]> {
    const result = await this.retriever.search(query);
    return result.episodic;
  }

  // ── Semantic ──

  async assertFact(input: SemanticFactInput): Promise<string> {
    const id = await this.semanticStore.assertFact(input);
    await this.eventBus.emit('memory.semantic.asserted', {
      memoryId: id,
      subject: input.subject,
      predicate: input.predicate,
      object: input.object,
    });
    return id;
  }

  async retractFact(factId: string, reason: string): Promise<void> {
    await this.semanticStore.retractFact(factId, reason);
    await this.eventBus.emit('memory.semantic.retracted', {
      memoryId: factId,
      reason,
    });
  }

  async querySemantic(query: MemoryQuery): Promise<ScoredMemoryRecord<SemanticMemoryRecord>[]> {
    const result = await this.retriever.search(query);
    return result.semantic;
  }

  // ── Unified Search ──

  async searchHybrid(query: MemoryQuery): Promise<UnifiedMemorySearchResult> {
    return this.retriever.search(query);
  }

  // ── Context Retrieval ──

  async retrieveForContext(query: string, tokenBudget: number): Promise<string> {
    return this.retriever.retrieveForContext(query, tokenBudget);
  }

  // ── Fact Ingestion / Extraction ──

  async extractAndAssertUserFacts(text: string, sourceEpisodeId?: string): Promise<string[]> {
    const trimmed = text.trim();
    const assertedIds: string[] = [];

    // Pattern 1: (please )?remember (that )?(my |the )?(.*)
    const rememberMatch = trimmed.match(/(?:please\s+)?remember(?:\s+that)?(?:\s+(?:my|the))?\s+(.+)/i);
    // Pattern 2: my (\w+(?:\s+\w+)?) is (.+)
    const myIsMatch = trimmed.match(/^my\s+([a-zA-Z0-9_\s]+?)\s+is\s+([^.\n]+)/i);
    // Pattern 3: I (hate|love|like|prefer)\s+([^.\n]+)
    const preferenceMatch = trimmed.match(/^i\s+(hate|love|like|prefer)\s+([^.\n]+)/i);

    let subject = 'user';
    let predicate = 'stated';
    let object = trimmed;
    let statement = trimmed;
    let matched = false;

    if (rememberMatch && rememberMatch[1]) {
      const factBody = rememberMatch[1].replace(/[.!?]+$/, '').trim();
      statement = factBody.startsWith('name is') || factBody.startsWith('favorite')
        ? `User ${factBody}`
        : factBody;
      subject = 'user';
      predicate = 'declared';
      object = factBody;
      matched = true;
    } else if (myIsMatch && myIsMatch[1] && myIsMatch[2]) {
      const attr = myIsMatch[1].trim();
      const val = myIsMatch[2].replace(/[.!?]+$/, '').trim();
      subject = 'user';
      predicate = attr;
      object = val;
      statement = `User ${attr} is ${val}`;
      matched = true;
    } else if (preferenceMatch && preferenceMatch[1] && preferenceMatch[2]) {
      const verb = preferenceMatch[1].trim().toLowerCase();
      const val = preferenceMatch[2].replace(/[.!?]+$/, '').trim();
      subject = 'user';
      predicate = 'preference';
      object = `${verb}s ${val}`;
      statement = `User ${verb}s ${val}`;
      matched = true;
    }

    if (matched) {
      const id = await this.assertFact({
        subject,
        predicate,
        object,
        statement,
        confidence: 1.0,
        sourceEpisodicIds: sourceEpisodeId ? [sourceEpisodeId] : [],
        validFrom: Date.now(),
        validUntil: null,
        embedding: generateSimpleEmbedding(statement),
      });
      assertedIds.push(id);
    }

    return assertedIds;
  }

  // ── Working Memory → Episodic Flush (§6.4.1) ──

  async flushWorkingToEpisodic(taskId?: string): Promise<string[]> {
    const turns = this.working.getTurns();
    if (turns.length === 0) return [];

    const ids: string[] = [];
    for (const turn of turns) {
      const embedding = generateSimpleEmbedding(turn.content);
      const id = await this.recordEpisode({
        timestamp: turn.timestamp,
        sessionId: this.working.sessionId,
        taskId,
        source: turn.role === 'user' ? 'user_interaction' : 'autonomous_event',
        actor: turn.role === 'system' ? 'system' : turn.role === 'user' ? 'user' : 'agent',
        summary: turn.content.slice(0, 200),
        content: turn.content,
        importanceScore: 0.5,
        embedding,
      });
      ids.push(id);
    }

    this.working.clearTurns();

    this.logger.log({
      level: 'debug',
      message: `Flushed ${ids.length} working memory turns to episodic store`,
    });

    return ids;
  }
}
