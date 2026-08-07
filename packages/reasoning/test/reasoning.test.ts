import { describe, it, expect, beforeEach } from 'vitest';
import { ReasoningEngine, ToolCallParser } from '../src/index.js';
import { ConfigManager } from '@fuckclaw/config';
import { Logger } from '@fuckclaw/observability';
import { PersistenceLayer } from '@fuckclaw/persistence';
import { EventBus } from '@fuckclaw/event-bus';
import { WorkspaceManager } from '@fuckclaw/workspace';
import { ToolRuntime, ShellTool, FilesystemTool } from '@fuckclaw/tool-runtime';
import { LLMRouter, ILLMProvider, GenerationRequest, GenerationResponse } from '@fuckclaw/llm-router';
import { Task, TaskState } from '@fuckclaw/kernel';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

class ReActMockProvider implements ILLMProvider {
  public name = 'react-mock';
  private callCount = 0;

  async generate(request: GenerationRequest): Promise<GenerationResponse> {
    this.callCount++;
    let content = '';

    if (this.callCount === 1) {
      content = `Thought: I will write a greeting file.
Action: filesystem
Action Input: {"action":"write","path":"workspace/react-test.txt","content":"ReAct loop worked"}`;
    } else {
      content = `Thought: The file is written. I can finish now.
Final Answer: Successfully wrote workspace/react-test.txt with ReAct`;
    }

    return {
      content,
      provider: this.name,
      model: 'mock-react',
      usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
    };
  }
}

describe('ReasoningEngine', () => {
  let tempDir: string;
  let reasoningEngine: ReasoningEngine;
  let workspace: WorkspaceManager;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fuckclaw-reason-test-'));
    const config = new ConfigManager({ workspace: { root: tempDir } });
    const logger = new Logger(config);
    const db = new PersistenceLayer(':memory:', logger);
    const bus = new EventBus(db, logger);
    workspace = new WorkspaceManager(config, logger);
    await workspace.init();

    const toolRuntime = new ToolRuntime(logger, bus);
    toolRuntime.register(new ShellTool());
    toolRuntime.register(new FilesystemTool(workspace));

    const llmRouter = new LLMRouter(logger, bus);
    llmRouter.registerProvider(new ReActMockProvider());

    reasoningEngine = new ReasoningEngine(logger, bus, toolRuntime, llmRouter);
  });

  it('should parse ReAct actions correctly', () => {
    const text = `Thought: Let's run a shell command
Action: shell
Action Input: {"command":"ls"}`;

    const parsed = ToolCallParser.parse(text);
    expect(parsed.type).toBe('tool');
    expect(parsed.toolName).toBe('shell');
    expect(parsed.toolArgs).toEqual({ command: 'ls' });
  });

  it('should parse Final Answer correctly', () => {
    const text = `Thought: We are done
Final Answer: All operations succeeded`;

    const parsed = ToolCallParser.parse(text);
    expect(parsed.type).toBe('finish');
    expect(parsed.finalResponse).toBe('All operations succeeded');
  });

  it('should reject a premature final answer for an explicit file task before tool use', async () => {
    const loggerConfig = new ConfigManager({ workspace: { root: tempDir } });
    const logger = new Logger(loggerConfig);
    const db = new PersistenceLayer(':memory:', logger);
    const bus = new EventBus(db, logger);
    const toolRuntime = new ToolRuntime(logger, bus);
    toolRuntime.register(new FilesystemTool(workspace));
    const llmRouter = new LLMRouter(logger, bus);
    llmRouter.registerProvider({
      name: 'premature-finish',
      async generate(_request: GenerationRequest): Promise<GenerationResponse> {
        return {
          content: 'Final Answer: done without acting',
          provider: 'premature-finish',
          model: 'mock',
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        };
      },
    });
    const engine = new ReasoningEngine(logger, bus, toolRuntime, llmRouter, { maxSteps: 2 });
    const task = createTask('Create workspace/must-use-tool.txt with content Hello');

    await expect(engine.runTask(task, createContext(task))).rejects.toThrow(
      'Reasoning loop did not invoke a tool for a task that requires filesystem or shell execution'
    );
    db.close();
  });

  it('should execute a bounded ReAct loop with tool call and observation', async () => {
    const mockTask: Task = {
      id: '01TESTTASK',
      description: 'Write a react test file',
      source: { type: 'user' },
      priority: 50,
      state: TaskState.EXECUTING,
      childIds: [],
      budget: {
        maxTokens: 1000,
        maxDuration: 1000,
        maxToolCalls: 5,
        maxLLMCalls: 5,
        maxCost: 1,
        consumed: { tokens: 0, duration: 0, toolCalls: 0, llmCalls: 0, cost: 0 },
      },
      results: [],
      createdAt: Date.now(),
      tags: [],
      cancellation: new AbortController(),
    };

    const context = {
      taskId: mockTask.id,
      description: mockTask.description,
      systemPrompt: 'Test system prompt',
      history: [{ role: 'user' as const, content: mockTask.description }],
      availableTools: ['filesystem', 'shell'],
    };

    const result = await reasoningEngine.runTask(mockTask, context);

    expect(result.output).toBe('Successfully wrote workspace/react-test.txt with ReAct');
    expect(result.steps.length).toBe(2);
    expect(result.steps[0].action).toBe('filesystem');
    expect(result.steps[1].action).toBe('finish');
    expect(mockTask.budget.consumed.llmCalls).toBe(2);
    expect(mockTask.budget.consumed.toolCalls).toBe(1);
    expect(mockTask.budget.consumed.tokens).toBe(40);
    expect(mockTask.budget.consumed.duration).toBeGreaterThanOrEqual(0);

    // Verify filesystem state
    const createdFilePath = workspace.resolvePath('workspace', 'react-test.txt');
    expect(fs.existsSync(createdFilePath)).toBe(true);
    expect(fs.readFileSync(createdFilePath, 'utf8')).toBe('ReAct loop worked');
  });
});

function createTask(description: string): Task {
  return {
    id: '01TESTTASK-PREMATURE',
    description,
    source: { type: 'user' },
    priority: 50,
    state: TaskState.EXECUTING,
    childIds: [],
    budget: {
      maxTokens: 1000,
      maxDuration: 1000,
      maxToolCalls: 5,
      maxLLMCalls: 5,
      maxCost: 1,
      consumed: { tokens: 0, duration: 0, toolCalls: 0, llmCalls: 0, cost: 0 },
    },
    results: [],
    createdAt: Date.now(),
    tags: [],
    cancellation: new AbortController(),
  };
}

function createContext(task: Task) {
  return {
    taskId: task.id,
    description: task.description,
    systemPrompt: 'Test system prompt',
    history: [{ role: 'user' as const, content: task.description }],
    availableTools: ['filesystem', 'shell'],
  };
}
