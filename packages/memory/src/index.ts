/**
 * @fuckclaw/memory — Multi-tier cognitive memory subsystem (§6)
 *
 * Milestone 4 scope:
 *   - WorkingMemory: in-process session scratchpad
 *   - EpisodicStore: persistence-backed chronological experience records
 *   - SemanticStore: persistence-backed fact/belief assertions with provenance
 *   - HybridRetriever: multi-signal ranked search across tiers
 *   - EbbinghausDecay: mathematical decay for memory retrievability
 *   - MemorySystem: unified facade
 *
 * Deferred to later milestones:
 *   - Procedural memory (§6.4.4)
 *   - Consolidation daemon (§6.6.1)
 *   - Dreaming engine (§6.6.2)
 *   - Knowledge graph synchronization (§8)
 *   - sqlite-vec native vector index (using brute-force cosine fallback per risk register §8)
 *
 * Implementation assumptions:
 *   - Embeddings are stored as JSON-serialized number arrays (not sqlite-vec virtual tables)
 *     because sqlite-vec native C extension compilation is unreliable on Termux/ARM.
 *     The risk register (§8) explicitly permits brute-force cosine similarity as fallback.
 *   - Embedding generation uses a simple deterministic term-frequency vector for M4.
 *     The interface accepts externally-supplied embeddings and is ready for a real
 *     embedding provider in a later milestone.
 *   - FTS5 is used for keyword/BM25 scoring (confirmed supported in this SQLite build).
 *   - Token estimation uses a 4-chars-per-token heuristic (spec §4.8 mentions token budget
 *     trimming but does not specify the exact tokenizer for M4).
 */

import { IPersistenceLayer } from '@fuckclaw/persistence';
import { IObservability } from '@fuckclaw/observability';
import { IEventBus } from '@fuckclaw/event-bus';
import { ulid } from 'ulidx';

// ─── Domain Types (traceable to §6.4, §6.5, §6.8) ────────────────────────

export interface EpisodicMemoryRecord {
  id: string;
  timestamp: number;
  sessionId: string;
  taskId?: string;
  source: 'user_interaction' | 'tool_execution' | 'autonomous_event' | 'system_alert';
  actor: 'user' | 'agent' | 'system' | 'tool';
  summary: string;
  content: string;
  toolCall?: {
    toolName: string;
    inputParams: Record<string, unknown>;
    outputResult: string;
    exitCode: number;
    durationMs: number;
  };
  importanceScore: number;
  accessCount: number;
  lastAccessedAt: number;
  consolidated: boolean;
  decayFactor: number;
  embedding: number[];
}

export interface SemanticMemoryRecord {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  statement: string;
  confidence: number;
  sourceEpisodicIds: string[];
  validFrom: number;
  validUntil: number | null;
  supersededBy?: string;
  contextConditions?: Record<string, string>;
  lastVerifiedAt: number;
  accessCount: number;
  embedding: number[];
}

export interface MemoryQuery {
  text: string;
  limit?: number;
  minScore?: number;
  timeRange?: { from?: number; to?: number };
}

export interface ScoreBreakdown {
  vectorScore: number;
  keywordScore: number;
  recencyScore: number;
  importanceScore: number;
  frequencyScore: number;
}

export interface ScoredMemoryRecord<T> {
  record: T;
  score: number;
  breakdown: ScoreBreakdown;
}

export interface UnifiedMemorySearchResult {
  episodic: ScoredMemoryRecord<EpisodicMemoryRecord>[];
  semantic: ScoredMemoryRecord<SemanticMemoryRecord>[];
  totalTokensEstimated: number;
}

export interface ConversationTurn {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

export interface WorkingMemorySnapshot {
  sessionId: string;
  activeTaskId: string | null;
  scratchpad: Record<string, unknown>;
  turnBuffer: ConversationTurn[];
}

// ─── Ebbinghaus Decay (§6.5.2) ────────────────────────────────────────────

/**
 * Calculates memory retrievability using the Ebbinghaus-inspired decay formula.
 *
 * R(t) = baseImportance * e^(-λ(m) * (t - lastAccessed))
 * λ(m) = λ₀ / (1 + ln(1 + accessCount))
 *
 * λ₀ = 1.15e-7 per second ≈ 10-day half-life for unaccessed items.
 * Semantic facts with confidence > 0.9 have λ₀ = 0 (no decay).
 */
const LAMBDA_0 = 1.15e-7; // Base decay constant (per second)

export function computeDecay(
  baseImportance: number,
  accessCount: number,
  lastAccessedAt: number,
  nowMs: number
): number {
  const elapsedSeconds = Math.max(0, (nowMs - lastAccessedAt) / 1000);
  const lambda = LAMBDA_0 / (1 + Math.log(1 + accessCount));
  return baseImportance * Math.exp(-lambda * elapsedSeconds);
}

// ─── Embedding Utilities ──────────────────────────────────────────────────

/**
 * Simple deterministic term-frequency embedding for Milestone 4.
 *
 * Implementation assumption: The spec requires embeddings (1536d or 768d)
 * but M4 does not mandate a specific embedding model. This generates a
 * deterministic 128-dimensional term-frequency vector that enables cosine
 * similarity search without an external API call.
 *
 * The interface accepts pre-computed embeddings so a real provider can be
 * plugged in at a later milestone.
 */
const EMBEDDING_DIM = 128;

export function generateSimpleEmbedding(text: string): number[] {
  const vec = new Array<number>(EMBEDDING_DIM).fill(0);
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean);
  for (const word of words) {
    // Hash word to a bucket
    let hash = 0;
    for (let i = 0; i < word.length; i++) {
      hash = ((hash << 5) - hash + word.charCodeAt(i)) | 0;
    }
    const bucket = ((hash % EMBEDDING_DIM) + EMBEDDING_DIM) % EMBEDDING_DIM;
    vec[bucket]! += 1;
  }
  // L2 normalize
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  if (norm > 0) {
    for (let i = 0; i < EMBEDDING_DIM; i++) {
      vec[i] = vec[i]! / norm;
    }
  }
  return vec;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

/**
 * Rough token estimation: 4 characters per token.
 * Spec §4.8 mentions token budget trimming; exact tokenizer is unspecified for M4.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ─── Working Memory (§6.4.1) ──────────────────────────────────────────────

export class WorkingMemory {
  public sessionId: string;
  public activeTaskId: string | null = null;
  private scratchpad: Map<string, unknown> = new Map();
  private turnBuffer: ConversationTurn[] = [];

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  set(key: string, value: unknown): void {
    this.scratchpad.set(key, value);
  }

  get<T>(key: string): T | undefined {
    return this.scratchpad.get(key) as T | undefined;
  }

  delete(key: string): boolean {
    return this.scratchpad.delete(key);
  }

  appendTurn(turn: ConversationTurn): void {
    this.turnBuffer.push(turn);
  }

  getTurns(): readonly ConversationTurn[] {
    return this.turnBuffer;
  }

  clearTurns(): void {
    this.turnBuffer = [];
  }

  snapshot(): WorkingMemorySnapshot {
    const scratchpadObj: Record<string, unknown> = {};
    for (const [k, v] of this.scratchpad) {
      scratchpadObj[k] = v;
    }
    return {
      sessionId: this.sessionId,
      activeTaskId: this.activeTaskId,
      scratchpad: scratchpadObj,
      turnBuffer: [...this.turnBuffer],
    };
  }

  restore(snap: WorkingMemorySnapshot): void {
    this.sessionId = snap.sessionId;
    this.activeTaskId = snap.activeTaskId;
    this.scratchpad.clear();
    for (const [k, v] of Object.entries(snap.scratchpad)) {
      this.scratchpad.set(k, v);
    }
    this.turnBuffer = [...snap.turnBuffer];
  }
}

// ─── Episodic Store (§6.4.2) ──────────────────────────────────────────────

/** Input type for recording a new episode (id and auto-fields are generated). */
export type EpisodicRecordInput = Omit<
  EpisodicMemoryRecord,
  'id' | 'accessCount' | 'lastAccessedAt' | 'decayFactor' | 'consolidated'
>;

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

// ─── Semantic Store (§6.4.3) ──────────────────────────────────────────────

export type SemanticFactInput = Omit<SemanticMemoryRecord, 'id' | 'accessCount' | 'lastVerifiedAt'>;

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

// ─── Hybrid Retriever (§6.5.1) ────────────────────────────────────────────

/**
 * Composite scoring weights from §6.5.1:
 *   w_v = 0.40 (Dense Semantic Similarity)
 *   w_k = 0.20 (Lexical BM25 Keyword Match)
 *   w_r = 0.15 (Temporal Recency)
 *   w_i = 0.15 (Intrinsic Importance)
 *   w_f = 0.10 (Access Frequency / Reinforcement)
 */
export interface RetrievalWeights {
  vector: number;
  keyword: number;
  recency: number;
  importance: number;
  frequency: number;
}

const DEFAULT_WEIGHTS: RetrievalWeights = {
  vector: 0.40,
  keyword: 0.20,
  recency: 0.15,
  importance: 0.15,
  frequency: 0.10,
};

export class HybridRetriever {
  private readonly weights: RetrievalWeights;

  constructor(
    private episodicStore: EpisodicStore,
    private semanticStore: SemanticStore,
    private logger: IObservability,
    weights?: Partial<RetrievalWeights>
  ) {
    this.weights = { ...DEFAULT_WEIGHTS, ...weights };
  }

  async search(query: MemoryQuery): Promise<UnifiedMemorySearchResult> {
    const limit = query.limit ?? 20;
    const minScore = query.minScore ?? 0.0;
    const queryEmbedding = generateSimpleEmbedding(query.text);
    const nowMs = Date.now();

    // 1. Retrieve episodic candidates
    const episodicScored = await this.scoreEpisodicCandidates(
      query, queryEmbedding, nowMs, limit
    );

    // 2. Retrieve semantic candidates
    const semanticScored = await this.scoreSemanticCandidates(
      query, queryEmbedding, nowMs, limit
    );

    // 3. Filter by minimum score
    const filteredEpisodic = episodicScored
      .filter((s) => s.score >= minScore)
      .slice(0, limit);

    const filteredSemantic = semanticScored
      .filter((s) => s.score >= minScore)
      .slice(0, limit);

    // 4. Estimate total tokens
    const totalTokensEstimated =
      filteredEpisodic.reduce((sum, s) => sum + estimateTokens(s.record.summary + s.record.content), 0) +
      filteredSemantic.reduce((sum, s) => sum + estimateTokens(s.record.statement), 0);

    this.logger.log({
      level: 'debug',
      message: 'Hybrid retrieval completed',
      metadata: {
        episodicCount: filteredEpisodic.length,
        semanticCount: filteredSemantic.length,
        totalTokensEstimated,
      },
    });

    return {
      episodic: filteredEpisodic,
      semantic: filteredSemantic,
      totalTokensEstimated,
    };
  }

  /**
   * Token-aware context assembly: retrieves memory and trims to fit a token budget.
   * Returns a formatted string suitable for injection into the LLM context window.
   */
  async retrieveForContext(query: string, tokenBudget: number): Promise<string> {
    const results = await this.search({ text: query, limit: 50 });
    const parts: string[] = [];
    let tokensUsed = 0;

    // Interleave semantic facts first (higher signal density), then episodic
    const semanticHeader = '## Relevant Facts\n';
    if (results.semantic.length > 0) {
      const headerTokens = estimateTokens(semanticHeader);
      if (tokensUsed + headerTokens < tokenBudget) {
        parts.push(semanticHeader);
        tokensUsed += headerTokens;
      }
      for (const s of results.semantic) {
        const line = `- [${s.record.confidence.toFixed(2)}] ${s.record.statement}\n`;
        const lineTokens = estimateTokens(line);
        if (tokensUsed + lineTokens > tokenBudget) break;
        parts.push(line);
        tokensUsed += lineTokens;
      }
    }

    const episodicHeader = '\n## Prior Experience\n';
    if (results.episodic.length > 0) {
      const headerTokens = estimateTokens(episodicHeader);
      if (tokensUsed + headerTokens < tokenBudget) {
        parts.push(episodicHeader);
        tokensUsed += headerTokens;
      }
      for (const e of results.episodic) {
        const line = `- [${new Date(e.record.timestamp).toISOString()}] ${e.record.summary}\n`;
        const lineTokens = estimateTokens(line);
        if (tokensUsed + lineTokens > tokenBudget) break;
        parts.push(line);
        tokensUsed += lineTokens;
      }
    }

    return parts.join('');
  }

  private async scoreEpisodicCandidates(
    query: MemoryQuery,
    queryEmbedding: number[],
    nowMs: number,
    limit: number
  ): Promise<ScoredMemoryRecord<EpisodicMemoryRecord>[]> {
    // Get all episodic records (brute-force scan per risk register fallback)
    const allRecords = await this.episodicStore.getAll(500);

    // Get FTS matches for keyword scoring
    const ftsMatches = new Map<string, number>();
    try {
      const ftsResults = await this.episodicStore.searchFTS(query.text, limit * 2);
      for (const r of ftsResults) {
        // FTS5 rank is negative (more negative = better match); normalize to 0..1
        ftsMatches.set(r.id, Math.min(1, Math.abs(r.rank)));
      }
    } catch {
      // FTS query may fail on special characters; fall back to zero keyword scores
    }

    // Time range filtering
    let candidates = allRecords;
    if (query.timeRange) {
      candidates = candidates.filter((r) => {
        if (query.timeRange!.from && r.timestamp < query.timeRange!.from) return false;
        if (query.timeRange!.to && r.timestamp > query.timeRange!.to) return false;
        return true;
      });
    }

    // Score each candidate
    const scored: ScoredMemoryRecord<EpisodicMemoryRecord>[] = candidates.map((record) => {
      const vectorScore = cosineSimilarity(queryEmbedding, record.embedding);

      // Normalize FTS rank to 0..1 range
      const rawKeyword = ftsMatches.get(record.id) ?? 0;
      const keywordScore = Math.min(1, rawKeyword);

      // Recency: exponential decay over the last 7 days
      const ageMs = Math.max(0, nowMs - record.timestamp);
      const recencyScore = Math.exp(-ageMs / (7 * 24 * 3600 * 1000));

      const importanceScore = record.importanceScore;

      // Frequency: log-scaled access count, capped at 1.0
      const frequencyScore = Math.min(1, Math.log(1 + record.accessCount) / Math.log(100));

      const score =
        this.weights.vector * vectorScore +
        this.weights.keyword * keywordScore +
        this.weights.recency * recencyScore +
        this.weights.importance * importanceScore +
        this.weights.frequency * frequencyScore;

      // Apply Ebbinghaus decay
      const decayMultiplier = computeDecay(1.0, record.accessCount, record.lastAccessedAt, nowMs);
      const decayedScore = score * decayMultiplier;

      return {
        record,
        score: decayedScore,
        breakdown: {
          vectorScore,
          keywordScore,
          recencyScore,
          importanceScore,
          frequencyScore,
        },
      };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }

  private async scoreSemanticCandidates(
    query: MemoryQuery,
    queryEmbedding: number[],
    nowMs: number,
    limit: number
  ): Promise<ScoredMemoryRecord<SemanticMemoryRecord>[]> {
    // Get active facts only (valid_until IS NULL)
    const allFacts = await this.semanticStore.getActiveFacts(500);

    // Get FTS matches for keyword scoring
    const ftsMatches = new Map<string, number>();
    try {
      const ftsResults = await this.semanticStore.searchFTS(query.text, limit * 2);
      for (const r of ftsResults) {
        ftsMatches.set(r.id, Math.min(1, Math.abs(r.rank)));
      }
    } catch {
      // FTS query may fail on special characters
    }

    const scored: ScoredMemoryRecord<SemanticMemoryRecord>[] = allFacts.map((record) => {
      const vectorScore = cosineSimilarity(queryEmbedding, record.embedding);
      const rawKeyword = ftsMatches.get(record.id) ?? 0;
      const keywordScore = Math.min(1, rawKeyword);

      // Semantic facts use validFrom as the recency anchor
      const ageMs = Math.max(0, nowMs - record.validFrom);
      const recencyScore = Math.exp(-ageMs / (7 * 24 * 3600 * 1000));

      // Importance for semantic facts = confidence
      const importanceScore = record.confidence;

      const frequencyScore = Math.min(1, Math.log(1 + record.accessCount) / Math.log(100));

      const score =
        this.weights.vector * vectorScore +
        this.weights.keyword * keywordScore +
        this.weights.recency * recencyScore +
        this.weights.importance * importanceScore +
        this.weights.frequency * frequencyScore;

      // Semantic facts with confidence > 0.9 do not decay (§6.5.2)
      let decayedScore = score;
      if (record.confidence <= 0.9) {
        const decayMultiplier = computeDecay(1.0, record.accessCount, record.lastVerifiedAt, nowMs);
        decayedScore = score * decayMultiplier;
      }

      return {
        record,
        score: decayedScore,
        breakdown: {
          vectorScore,
          keywordScore,
          recencyScore,
          importanceScore,
          frequencyScore,
        },
      };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }
}

// ─── Memory System Facade (§6.8) ──────────────────────────────────────────

export interface IMemorySystem {
  readonly working: WorkingMemory;
  recordEpisode(input: EpisodicRecordInput): Promise<string>;
  getEpisode(id: string): Promise<EpisodicMemoryRecord | null>;
  queryEpisodic(query: MemoryQuery): Promise<ScoredMemoryRecord<EpisodicMemoryRecord>[]>;
  assertFact(input: SemanticFactInput): Promise<string>;
  retractFact(factId: string, reason: string): Promise<void>;
  querySemantic(query: MemoryQuery): Promise<ScoredMemoryRecord<SemanticMemoryRecord>[]>;
  searchHybrid(query: MemoryQuery): Promise<UnifiedMemorySearchResult>;
  retrieveForContext(query: string, tokenBudget: number): Promise<string>;
  flushWorkingToEpisodic(taskId?: string): Promise<string[]>;
}

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
