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

export type EpisodicRecordInput = Omit<
  EpisodicMemoryRecord,
  'id' | 'accessCount' | 'lastAccessedAt' | 'decayFactor' | 'consolidated'
>;

export type SemanticFactInput = Omit<SemanticMemoryRecord, 'id' | 'accessCount' | 'lastVerifiedAt'>;

export interface RetrievalWeights {
  vector: number;
  keyword: number;
  recency: number;
  importance: number;
  frequency: number;
}

export interface IMemorySystem {
  readonly working: any;
  readonly procedural: any;
  recordEpisode(input: EpisodicRecordInput): Promise<string>;
  getEpisode(id: string): Promise<EpisodicMemoryRecord | null>;
  queryEpisodic(query: MemoryQuery): Promise<ScoredMemoryRecord<EpisodicMemoryRecord>[]>;
  assertFact(input: SemanticFactInput): Promise<string>;
  retractFact(factId: string, reason: string): Promise<void>;
  querySemantic(query: MemoryQuery): Promise<ScoredMemoryRecord<SemanticMemoryRecord>[]>;
  searchHybrid(query: MemoryQuery): Promise<UnifiedMemorySearchResult>;
  retrieveForContext(query: string, tokenBudget: number): Promise<string>;
  flushWorkingToEpisodic(taskId?: string): Promise<string[]>;
  extractAndAssertUserFacts(text: string, sourceEpisodeId?: string): Promise<string[]>;
  runConsolidationCycle(): Promise<any>;
  runDreamingCycle(): Promise<any>;
}
