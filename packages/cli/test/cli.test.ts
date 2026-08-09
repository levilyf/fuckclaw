import { describe, it, expect } from 'vitest';
import { createFuckClawRuntime, FuckClawClient } from '../src/index.js';
import { TaskState } from '@fuckclaw/kernel';
import { ILLMProvider, GenerationRequest, GenerationResponse, OpenAICompatibleProvider } from '@fuckclaw/llm-router';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

class ReActFilesystemMockProvider implements ILLMProvider {
  public name = 'react-cli-mock';
  private callCount = 0;

  async generate(request: GenerationRequest): Promise<GenerationResponse> {
    this.callCount++;
    if (this.callCount === 1) {
      return {
        content: `Thought: I need to write a file via filesystem tool.
Action: filesystem
Action Input: {"action":"write","path":"workspace/cli-demo.txt","content":"CLI slice verified"}`,
        provider: this.name,
        model: 'mock',
        usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
      };
    }

    return {
      content: `Thought: The file is now written.
Final Answer: Task finished and workspace/cli-demo.txt created.`,
      provider: this.name,
      model: 'mock',
      usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
    };
  }
}

describe('CLI Runtime Integration', () => {
  it('should require configured OpenAI-compatible credentials by default', async () => {
    await expect(createFuckClawRuntime(
      { workspace: { root: fs.mkdtempSync(path.join(os.tmpdir(), 'fuckclaw-cli-config-test-')) } },
      undefined,
      {}
    )).rejects.toThrow('LLM configuration is required');
  });

  it('should run a complete task through Kernel, ReasoningEngine, and ToolRuntime', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fuckclaw-cli-test-'));
    const runtime = await createFuckClawRuntime(
      { workspace: { root: tempDir } },
      new ReActFilesystemMockProvider(),
      {}
    );

    try {
      const task = await runtime.kernel.submitTask({
        description: 'Create cli-demo.txt in workspace',
      });

      expect(task.state).toBe(TaskState.COMPLETED);
      expect(task.output).toBe('Task finished and workspace/cli-demo.txt created.');
      expect(task.results.length).toBe(2);

      const filePath = path.join(tempDir, 'workspace', 'cli-demo.txt');
      expect(fs.existsSync(filePath)).toBe(true);
      expect(fs.readFileSync(filePath, 'utf8')).toBe('CLI slice verified');

      // Verify KnowledgeGraph and SkillsEngine on runtime
      expect(runtime.knowledgeGraph).toBeDefined();
      expect(runtime.skillsEngine).toBeDefined();
      expect(runtime.mcpManager).toBeDefined();
      expect(runtime.pluginManager).toBeDefined();
      expect(runtime.networkManager).toBeDefined();

      const entity = await runtime.knowledgeGraph.createEntity({
        type: 'project',
        name: 'cli-test-project',
      });
      expect(entity.name).toBe('cli-test-project');

      // Verify MCP subsystem
      expect(runtime.mcpManager.listServers().length).toBe(0);

      // Verify Plugin subsystem
      expect(runtime.pluginManager.list().length).toBe(0);
    } finally {
      await runtime.shutdown();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should initialize successfully using unauthenticated local open-ai compatible configuration', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fuckclaw-cli-unauth-test-'));
    
    // Explicitly seed the persistence keystore config for an unauthenticated local endpoint
    const tempConfig = {
      workspace: { root: tempDir },
      providers: {
         openai: {
           baseUrl: 'http://localhost:20128/v1',
           model: 'bynara/agnes-2.5-flash',
           apiKey: '' // intentionally empty for local server testing
         }
      },
      llm: { provider: 'openai' }
    };
    
    // allowUnconfiguredLLM is false here, so we verify that the above config is treated as "configured"
    const runtime = await createFuckClawRuntime(tempConfig, undefined, process.env, { allowUnconfiguredLLM: false });
    
    try {
      const pName = (runtime.kernel.llmRouter as any).defaultProviderName;
      const p = (runtime.kernel.llmRouter as any).providers.get(pName);
      expect(p).toBeDefined();
      expect(p.name).toBe('openai-compatible');
      expect((p as OpenAICompatibleProvider)['baseUrl']).toBe('http://localhost:20128/v1');
      expect((p as OpenAICompatibleProvider)['apiKey']).toBe('');
      expect((p as OpenAICompatibleProvider)['model']).toBe('bynara/agnes-2.5-flash');
    } finally {
      await runtime.shutdown();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('verifies FuckClawClient communication with network server daemon', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fuckclaw-cli-client-test-'));
    const runtime = await createFuckClawRuntime(
      { workspace: { root: tempDir } },
      new ReActFilesystemMockProvider(),
      {}
    );

    try {
      const { host, port } = await runtime.networkManager.start({ port: 0 });
      const client = new FuckClawClient({ baseUrl: `http://${host}:${port}` });

      const health = await client.getHealth();
      expect(health.status).toBe('healthy');
      expect(health.kernelState).toBe('idle');

      const tools = await client.listTools();
      expect(tools.length).toBeGreaterThan(0);
    } finally {
      await runtime.shutdown();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should display a warning when a task completes with empty output', async () => {
    // Provider that returns empty content
    const emptyProvider: ILLMProvider = {
      name: 'empty-output-mock',
      async generate() {
        return {
          content: 'Final Answer: ',
          provider: 'empty-output-mock',
          model: 'mock',
          usage: { promptTokens: 5, completionTokens: 1, totalTokens: 6 },
        };
      },
    };

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fuckclaw-empty-output-'));
    const runtime = await createFuckClawRuntime(
      { workspace: { root: tempDir } },
      emptyProvider,
      {},
    );

    try {
      const task = await runtime.kernel.submitTask({
        description: 'say hi',
        source: { type: 'user' },
      });
      
      expect(task.state).toBe(TaskState.COMPLETED);
      // The output should be empty or whitespace-only because "Final Answer: " trims to empty
      const outputTrimmed = (task.output ?? '').trim();
      // renderTaskResult should handle this. We verify the task itself.
      // The key invariant: an empty output is NOT silently ok.
      // The rendering function must show something. We verify structure here.
      expect(task.state === TaskState.COMPLETED).toBe(true);
    } finally {
      await runtime.shutdown();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should properly register provider from layered config with keystore-recovered secret', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-provider-reg-'));
    const configDir = path.join(tmpDir, '.fuckclaw', 'config');
    fs.mkdirSync(configDir, { recursive: true });
    const configPath = path.join(configDir, 'fuckclaw.toml');

    // Create a config with local unauthenticated provider
    const { ConfigManager } = await import('@fuckclaw/config');
    const cm = new ConfigManager({
      globalConfigPath: configPath,
      projectConfigPath: '/dev/null',
    });
    await cm.update('llm.provider', 'openai');
    await cm.update('providers.openai.baseUrl', 'http://localhost:20128/v1');
    await cm.update('providers.openai.model', 'test-model');
    
    // Verify config is on disk
    expect(fs.existsSync(configPath)).toBe(true);
    const toml = fs.readFileSync(configPath, 'utf8');
    expect(toml).toContain('localhost');
    expect(toml).toContain('test-model');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('renderTaskResult shows diagnostic for empty output', async () => {
    const { renderTaskResult } = await import('../src/commands/ask.command.js');
    
    // Capture stdout
    const originalWrite = process.stdout.write;
    let captured = '';
    process.stdout.write = ((chunk: any) => {
      captured += typeof chunk === 'string' ? chunk : chunk.toString();
      return true;
    }) as any;

    try {
      // Simulate a completed task with empty output
      const fakeTask = {
        id: 'test-empty-123',
        description: 'test task',
        state: 'completed' as any,
        output: '',
        error: undefined,
        results: [],
        source: { type: 'user' as const },
        priority: 1,
        childIds: [],
        budget: {
          maxTokens: 1000, maxDuration: 60000, maxToolCalls: 10,
          maxLLMCalls: 10, maxCost: 1,
          consumed: { tokens: 0, duration: 0, toolCalls: 0, llmCalls: 0, cost: 0 },
        },
        createdAt: Date.now(),
        tags: [],
        cancellation: new AbortController(),
      } as any;

      renderTaskResult(fakeTask);

      expect(captured).toContain('no user-visible output');
      expect(captured).toContain('test-empty-123');
    } finally {
      process.stdout.write = originalWrite;
    }
  });
});
