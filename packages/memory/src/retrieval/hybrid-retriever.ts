import { IObservability } from '@fuckclaw/observability';
import {
  EpisodicMemoryRecord,
  SemanticMemoryRecord,
  MemoryQuery,
  RetrievalWeights,
  UnifiedMemorySearchResult,
  ScoredMemoryRecord,
} from '../types.js';
import { EpisodicStore } from '../episodic/episodic-store.js';
import { SemanticStore } from '../semantic/semantic-store.js';
import {
  computeDecay,
  generateSimpleEmbedding,
  cosineSimilarity,
  estimateTokens,
} from '../decay/ebbinghaus-decay.js';

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
