import { describe, it, expect } from 'vitest';
import { createFuckClawRuntime } from '../src/index.js';
import { TaskState } from '@fuckclaw/kernel';
import { ILLMProvider, GenerationRequest, GenerationResponse } from '@fuckclaw/llm-router';
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
    )).rejects.toThrow('OpenAI-compatible LLM configuration is required');
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

      const entity = await runtime.knowledgeGraph.createEntity({
        type: 'project',
        name: 'cli-test-project',
      });
      expect(entity.name).toBe('cli-test-project');
    } finally {
      await runtime.shutdown();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
