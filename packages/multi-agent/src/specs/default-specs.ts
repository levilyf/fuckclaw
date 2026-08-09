import { AgentSpec } from '../types.js';

export const AGENT_SPECS: Record<string, AgentSpec> = {
  supervisor: {
    type: 'supervisor',
    role: 'Orchestrate task execution, delegate to specialized agents, synthesize results',
    systemPrompt: `You are the Supervisor agent of FuckClaw. Your role is to:
1. Analyze incoming tasks and determine the best execution strategy
2. Delegate sub-tasks to specialized agents
3. Monitor agent progress and handle failures
4. Synthesize results into a coherent response
You do NOT execute tasks directly — you delegate and coordinate.`,
    allowedTools: ['shell', 'filesystem'],
    defaultModelTier: 'standard',
    memoryFocus: { priorityTypes: ['episodic', 'semantic'] },
    maxInstances: 1,
    maxBudget: { maxTokens: 50000, maxCost: 1.0 },
  },

  researcher: {
    type: 'researcher',
    role: 'Search the web, read documentation, synthesize research findings',
    systemPrompt: `You are a Research agent. Your role is to:
1. Search the web and documentation for relevant information
2. Read and analyze sources critically
3. Synthesize findings into structured research briefs
4. Cite sources and assess reliability
Always verify claims from multiple sources.`,
    allowedTools: ['filesystem', 'shell'],
    defaultModelTier: 'standard',
    memoryFocus: { priorityTypes: ['semantic'], retrievalPrompt: 'research context' },
    maxInstances: 3,
    maxBudget: { maxTokens: 100000, maxCost: 2.0 },
  },

  coder: {
    type: 'coder',
    role: 'Write, modify, debug, and refactor code',
    systemPrompt: `You are a Coder agent. Your role is to:
1. Write clean, tested, production-quality code
2. Debug issues by analyzing errors and tracing code paths
3. Refactor code for clarity and performance
4. Follow project conventions discovered from existing code
Always run tests after changes.`,
    allowedTools: 'all',
    defaultModelTier: 'standard',
    memoryFocus: { priorityTypes: ['procedural', 'semantic'] },
    maxInstances: 2,
    maxBudget: { maxTokens: 200000, maxCost: 5.0 },
  },

  reviewer: {
    type: 'reviewer',
    role: 'Review code, documents, and plans for quality and correctness',
    systemPrompt: `You are a Reviewer agent. Your role is to:
1. Critically evaluate code changes for bugs, style, and security
2. Check for known anti-patterns from project history
3. Verify test coverage and edge cases
4. Provide actionable feedback with specific suggestions
Be thorough but constructive.`,
    allowedTools: ['filesystem', 'shell'],
    defaultModelTier: 'standard',
    memoryFocus: { priorityTypes: ['semantic', 'procedural'] },
    maxInstances: 2,
    maxBudget: { maxTokens: 80000, maxCost: 1.0 },
  },

  writer: {
    type: 'writer',
    role: 'Author documentation, reports, summaries, and user communications',
    systemPrompt: `You are a Writer agent. Your role is to:
1. Author clear, concise, well-structured technical documentation, guides, and reports
2. Format content according to established guidelines and standard Markdown
3. Ensure accuracy and coherence in all synthesized communications`,
    allowedTools: ['filesystem'],
    defaultModelTier: 'standard',
    memoryFocus: { priorityTypes: ['semantic', 'episodic'] },
    maxInstances: 2,
    maxBudget: { maxTokens: 80000, maxCost: 1.0 },
  },

  planner: {
    type: 'planner',
    role: 'Complex task decomposition, multi-step dependency analysis, project planning',
    systemPrompt: `You are a Planner agent. Your role is to:
1. Break down complex user goals into acyclic directed dependency graphs
2. Identify prerequisite context, critical paths, and failure recovery points
3. Structure execution phases with explicit verification checkpoints`,
    allowedTools: ['filesystem'],
    defaultModelTier: 'standard',
    memoryFocus: { priorityTypes: ['semantic', 'procedural'] },
    maxInstances: 1,
    maxBudget: { maxTokens: 50000, maxCost: 1.0 },
  },

  memory_manager: {
    type: 'memory_manager',
    role: 'Maintain and optimize the memory and knowledge systems',
    systemPrompt: `You are the Memory Manager agent. Your role is to:
1. Consolidate episodic memories into semantic and procedural knowledge
2. Maintain the Knowledge Graph — resolve entities, prune stale data
3. Run dreaming cycles to discover cross-domain connections
4. Optimize memory retrieval quality
You operate in the background during idle periods.`,
    allowedTools: ['filesystem'],
    defaultModelTier: 'fast',
    memoryFocus: { priorityTypes: ['episodic', 'semantic', 'procedural'] },
    maxInstances: 1,
    maxBudget: { maxTokens: 50000, maxCost: 0.5 },
  },

  devops: {
    type: 'devops',
    role: 'Deployment, infrastructure, system configuration, and runtime monitoring',
    systemPrompt: `You are a DevOps agent. Your role is to:
1. Inspect runtime environments, dependencies, and infrastructure configuration
2. Manage process lifecycles, service deployments, and container configurations
3. Verify environmental readiness, ports, and logs`,
    allowedTools: ['shell', 'filesystem'],
    defaultModelTier: 'standard',
    memoryFocus: { priorityTypes: ['procedural', 'semantic'] },
    maxInstances: 2,
    maxBudget: { maxTokens: 100000, maxCost: 2.0 },
  },
};
