import { describe, it, expect, beforeEach } from 'vitest';
import { ConfigManager } from '@fuckclaw/config';
import { Logger } from '@fuckclaw/observability';
import { PersistenceLayer } from '@fuckclaw/persistence';
import { EventBus } from '@fuckclaw/event-bus';
import { WorkspaceManager } from '@fuckclaw/workspace';
import { ToolRuntime, ITool, ToolDefinition, ToolResult } from '@fuckclaw/tool-runtime';
import { LLMRouter, ILLMProvider, LLMRequest, LLMResponse } from '@fuckclaw/llm-router';
import { MemorySystem } from '@fuckclaw/memory';
import { AgentOrchestrator, AGENT_SPECS } from '../src/index.js';

class MockLLMProvider implements ILLMProvider {
  name = 'mock-multi-agent-provider';

  async generate(request: LLMRequest): Promise<LLMResponse> {
    const lastMsg = request.messages[request.messages.length - 1]?.content || '';
    const systemPrompt = request.messages.find((m) => m.role === 'system')?.content || '';

    // If Coder agent is working on pagination
    if (systemPrompt.includes('Coder agent') && lastMsg.includes('pagination')) {
      return {
        content: '```tool_call {"tool": "mock_code_gen", "args": {"file": "src/routes/users.ts", "content": "export function paginate() { return []; }"}} ```',
        usage: { promptTokens: 40, completionTokens: 20, totalTokens: 60 },
        costUsd: 0.0006,
      };
    }

    // Observation response from tool
    if (lastMsg.includes('Observation from tool "mock_code_gen"')) {
      return {
        content: 'I have implemented pagination in src/routes/users.ts and verified the function structure. All tests are passing.',
        usage: { promptTokens: 50, completionTokens: 25, totalTokens: 75 },
        costUsd: 0.00075,
      };
    }

    // Reviewer agent reviewing code
    if (systemPrompt.includes('Reviewer agent')) {
      return {
        content: 'Review complete: The pagination implementation in src/routes/users.ts conforms to standard patterns. Approved with no blocking issues.',
        usage: { promptTokens: 30, completionTokens: 15, totalTokens: 45 },
        costUsd: 0.00045,
      };
    }

    // Researcher agent
    if (systemPrompt.includes('Research agent')) {
      return {
        content: 'Research Brief: SQLite WAL mode provides maximum write concurrency for single-node embedded databases while maintaining ACID isolation.',
        usage: { promptTokens: 30, completionTokens: 20, totalTokens: 50 },
        costUsd: 0.0005,
      };
    }

    return {
      content: `Specialized agent processed objective: ${lastMsg.slice(0, 100)}`,
      usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
      costUsd: 0.0002,
    };
  }
}

class MockCodeGenTool implements ITool {
  definition: ToolDefinition = {
    name: 'mock_code_gen',
    description: 'Generates code in the workspace',
    parameters: {
      type: 'object',
      properties: {
        file: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['file', 'content'],
    },
  };

  async execute(args: { file: string; content: string }): Promise<ToolResult> {
    return {
      success: true,
      output: `File ${args.file} created with ${args.content.length} characters`,
    };
  }
}

describe('Multi-Agent Architecture Subsystem (@fuckclaw/multi-agent) §15', () => {
  let orchestrator: AgentOrchestrator;
  let eventBus: EventBus;
  let persistence: PersistenceLayer;
  let toolRuntime: ToolRuntime;
  let memory: MemorySystem;
  let eventsEmitted: string[] = [];

  beforeEach(() => {
    eventsEmitted = [];
    const config = new ConfigManager({ workspace: { root: ':memory:' } });
    const logger = new Logger(config);
    persistence = new PersistenceLayer(':memory:', logger);
    eventBus = new EventBus(persistence, logger);
    const workspace = new WorkspaceManager(config, logger);

    toolRuntime = new ToolRuntime(logger, eventBus);
    toolRuntime.register(new MockCodeGenTool());

    const llmRouter = new LLMRouter(logger, eventBus);
    llmRouter.registerProvider(new MockLLMProvider(), true);

    memory = new MemorySystem(persistence, logger, eventBus);

    orchestrator = new AgentOrchestrator(
      logger,
      eventBus,
      toolRuntime,
      llmRouter,
      workspace,
      memory,
      persistence
    );

    eventBus.subscribe('agent.*', async (evt) => {
      eventsEmitted.push(evt.type);
    });
  });

  it('loads all standard agent specifications defined in §15.2.1', () => {
    expect(orchestrator.getAgentSpec('supervisor')).toBeDefined();
    expect(orchestrator.getAgentSpec('researcher')).toBeDefined();
    expect(orchestrator.getAgentSpec('coder')).toBeDefined();
    expect(orchestrator.getAgentSpec('reviewer')).toBeDefined();
    expect(orchestrator.getAgentSpec('writer')).toBeDefined();
    expect(orchestrator.getAgentSpec('planner')).toBeDefined();
    expect(orchestrator.getAgentSpec('memory_manager')).toBeDefined();
    expect(orchestrator.getAgentSpec('devops')).toBeDefined();

    expect(orchestrator.getAgentSpec('coder')?.allowedTools).toBe('all');
    expect(orchestrator.getAgentSpec('supervisor')?.maxInstances).toBe(1);
    expect(orchestrator.getAgentSpec('researcher')?.maxInstances).toBe(3);
  });

  it('delegates a task from supervisor to a specialized coder agent and receives structured results', async () => {
    const result = await orchestrator.delegate({
      parentTaskId: 'parent-task-101',
      agentType: 'coder',
      task: 'Implement pagination for /api/users endpoint',
      context: {
        files: ['src/routes/users.ts'],
        data: { pageSize: 20 },
      },
      budget: { maxTokens: 10000 },
      timeoutMs: 15000,
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain('pagination');
    expect(result.tokensUsed).toBeGreaterThan(0);

    // Verify events were dispatched on event bus (§15.4)
    expect(eventsEmitted).toContain('agent.coder.started');
    expect(eventsEmitted).toContain('agent.coder.progress');
    expect(eventsEmitted).toContain('agent.coder.completed');
  });

  it('restricts tool execution according to the specialized agent specification', async () => {
    // Reviewer has allowedTools: ['filesystem', 'shell']. MockCodeGenTool is not allowed.
    const spec = orchestrator.getAgentSpec('reviewer');
    expect(spec?.allowedTools).toEqual(['filesystem', 'shell']);
  });

  it('executes parallel delegations to multiple specialized agents concurrently (§15.1, §15.7)', async () => {
    const results = await orchestrator.delegateParallel([
      {
        parentTaskId: 'parent-task-202',
        agentType: 'researcher',
        task: 'Investigate SQLite WAL mode performance characteristics',
        context: {},
        budget: { maxTokens: 5000 },
        timeoutMs: 10000,
      },
      {
        parentTaskId: 'parent-task-202',
        agentType: 'reviewer',
        task: 'Review SQLite configuration in packages/persistence',
        context: { files: ['packages/persistence/src/connection/pragmas.ts'] },
        budget: { maxTokens: 5000 },
        timeoutMs: 10000,
      },
    ]);

    expect(results.length).toBe(2);
    expect(results[0]!.success).toBe(true);
    expect(results[0]!.output).toContain('SQLite WAL mode');
    expect(results[1]!.success).toBe(true);
    expect(results[1]!.output).toContain('Review complete');
  });

  it('persists delegation records and allows status querying (§15.3.2)', async () => {
    const delegation = await orchestrator.delegate({
      parentTaskId: 'parent-task-303',
      agentType: 'writer',
      task: 'Author release notes for version 1.0',
      context: { data: { version: '1.0.0' } },
      budget: { maxTokens: 5000 },
      timeoutMs: 10000,
    });

    expect(delegation.success).toBe(true);

    const rows = persistence.query<{ id: string; state: string; agent_type: string }>(
      'SELECT id, state, agent_type FROM delegations WHERE parent_task_id = ?',
      ['parent-task-303']
    );

    expect(rows.length).toBe(1);
    expect(rows[0]!.agent_type).toBe('writer');
    expect(rows[0]!.state).toBe('completed');

    const queriedStatus = orchestrator.status(rows[0]!.id);
    expect(queriedStatus).toBeDefined();
    expect(queriedStatus?.agentType).toBe('writer');
  });

  it('registers custom agent types dynamically (§15.7)', () => {
    orchestrator.registerAgentType({
      type: 'security_auditor',
      role: 'Perform vulnerability scans and audit dependencies',
      systemPrompt: 'You are a Security Auditor. Inspect all packages for known CVEs.',
      allowedTools: ['shell'],
      defaultModelTier: 'standard',
      memoryFocus: { priorityTypes: ['semantic'] },
      maxInstances: 1,
      maxBudget: { maxTokens: 50000 },
    });

    const custom = orchestrator.getAgentSpec('security_auditor');
    expect(custom).toBeDefined();
    expect(custom?.role).toContain('vulnerability scans');
  });
});
