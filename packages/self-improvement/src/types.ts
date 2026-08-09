export interface AntiPatternRecord {
  id: string;
  context: string;          // e.g. "Docker build with Node.js on ARM64"
  mistake: string;          // e.g. "Used standard node image without --platform flag"
  consequence: string;      // e.g. "Build failed due to architecture mismatch"
  correctiveAction: string; // e.g. "Specify --platform=linux/amd64 or use multi-arch base"
  confidence: number;
  occurrences: number;
  sourceTaskId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface PromptMutationProposal {
  id: string;
  target: string;              // e.g. "agent:coder" or "skill:docker-deploy" or "system:react_loop"
  version: number;
  originalPrompt: string;
  proposedPrompt: string;
  rationale: string;
  failureCount: number;
  validationPassed: boolean;
  status: 'active' | 'rolled_back' | 'proposed';
  createdAt: number;
  updatedAt: number;
}

export interface ReasoningTraceStep {
  stepNumber: number;
  thought?: string;
  action?: string;
  observation?: string;
  success: boolean;
}

export interface ReasoningTrace {
  taskId: string;
  goal: string;
  success: boolean;
  error?: {
    code: string;
    message: string;
    stack?: string;
  };
  steps: ReasoningTraceStep[];
  durationMs?: number;
  tokensUsed?: number;
}

export interface SelfImprovementReport {
  id: string;
  timestamp: number;
  tracesAnalyzed: number;
  antiPatternsExtracted: number;
  promptProposals: PromptMutationProposal[];
  skillsExtracted: string[];
  recommendations: string[];
}

export interface ISelfImprovementEngine {
  /** Trigger a self-improvement analysis cycle */
  runAnalysis(): Promise<SelfImprovementReport>;

  /** Process a completed task trace for potential learnings */
  processTrace(trace: ReasoningTrace): Promise<void>;

  /** Propose a prompt optimization based on failure analysis */
  proposePromptImprovement(target: string, failures?: ReasoningTrace[]): Promise<PromptMutationProposal>;

  /** Apply a prompt proposal */
  applyPromptImprovement(proposalId: string): Promise<void>;

  /** Revert a self-improvement change */
  rollback(changeId: string): Promise<void>;

  /** Get anti-patterns matching a context query */
  getAntiPatterns(contextQuery?: string): Promise<AntiPatternRecord[]>;

  /** Format negative constraints for prompt injection */
  getNegativeConstraints(contextQuery?: string): Promise<string>;

  /** Manually record or update an anti-pattern */
  recordAntiPattern(
    antiPattern: Omit<AntiPatternRecord, 'id' | 'createdAt' | 'updatedAt' | 'occurrences'> & {
      occurrences?: number;
      id?: string;
    }
  ): Promise<AntiPatternRecord>;
}
