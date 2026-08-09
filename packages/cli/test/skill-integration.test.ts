import { describe, it, expect } from 'vitest';
import { createFuckClawRuntime } from '../src/index.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { ILLMProvider } from '@fuckclaw/llm-router';

class MockProvider implements ILLMProvider {
  name = 'mock';
  async generate() { return { content: '', provider: 'mock', model: 'mock', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }}; }
}

describe('CLI Skills Integration', () => {
  it('should load builtin skills into the engine, including the operator console skill', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fuckclaw-cli-skill-test-'));
    
    // Copy the skills to the temp workspace so they get loaded
    const skillsDest = path.join(tempDir, 'skills');
    fs.mkdirSync(skillsDest, { recursive: true });
    fs.copyFileSync(
      path.join(process.cwd(), 'skills/terminal_operator_console.yaml'),
      path.join(skillsDest, 'terminal_operator_console.yaml')
    );

    const runtime = await createFuckClawRuntime(
      { workspace: { root: tempDir }, llm: { provider: 'mock', model: 'mock-model' } },
      new MockProvider(),
      {}
    );

    try {
      const skills = runtime.skillsEngine.list();
      const consoleSkill = skills.find((s) => s.id === 'terminal_operator_console');
      
      expect(consoleSkill).toBeDefined();
      expect(consoleSkill?.name).toBe('Terminal Operator Console');
      expect(consoleSkill?.steps[0]?.action.type).toBe('tool_call');
      expect(consoleSkill?.steps[0]?.action.tool).toBe('shell');
    } finally {
      await runtime.shutdown();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
