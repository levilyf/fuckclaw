import { describe, it, expect, beforeEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { ToolRuntime, ShellTool, FilesystemTool } from '@fuckclaw/tool-runtime';
import { EventBus } from '@fuckclaw/event-bus';
import { PersistenceLayer } from '@fuckclaw/persistence';
import { Logger } from '@fuckclaw/observability';
import { ManifestParser } from '../src/parser/manifest-parser.js';
import { SkillsEngine } from '../src/skills-engine.js';
import { SkillError, SkillManifest } from '../src/types.js';

describe('Skills Engine Subsystem (§10)', () => {
  let tempDir: string;
  let toolRuntime: ToolRuntime;
  let skillsEngine: SkillsEngine;
  let eventBus: EventBus;
  let persistence: PersistenceLayer;

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `fc-skills-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    await fs.mkdir(tempDir, { recursive: true });

    persistence = new PersistenceLayer(':memory:');
    const mockConfig = {
      get: () => ({ system: { logLevel: 'error' }, logging: { level: 'error' } }),
    };
    const logger = new Logger(mockConfig as any);
    eventBus = new EventBus(persistence, logger);
    toolRuntime = new ToolRuntime(logger, eventBus);
    toolRuntime.register(new ShellTool());
    toolRuntime.register(new FilesystemTool());

    skillsEngine = new SkillsEngine(toolRuntime, undefined, logger, eventBus);
  });

  describe('Manifest Parsing & Validation', () => {
    it('parses valid YAML skill manifest into structured SkillManifest', () => {
      const yaml = `
id: deploy_service
name: Deploy Service
version: "1.0.0"
description: Multi-step service build and deployment
origin: builtin
tags: [deployment, ops]

triggerPatterns:
  - "deploy the service"
  - "push to staging"

inputs:
  - name: environment
    type: string
    description: Target environment
    required: true
    default: staging
  - name: service_name
    type: string
    description: Service to deploy
    required: true

outputs:
  - name: deploy_status
    type: string
    description: Final deployment status

requiredTools: [filesystem, shell]

steps:
  - id: write_manifest
    action:
      type: tool_call
      tool: filesystem
      argsTemplate:
        action: write
        path: "{{workspace_path}}/deploy.json"
        content: '{"service":"{{service_name}}","env":"{{environment}}"}'
    onFailure: abort

  - id: verify_manifest
    action:
      type: tool_call
      tool: filesystem
      argsTemplate:
        action: read
        path: "{{workspace_path}}/deploy.json"
    onFailure: abort
`;

      const manifest = ManifestParser.parse(yaml);
      expect(manifest.id).toBe('deploy_service');
      expect(manifest.name).toBe('Deploy Service');
      expect(manifest.version).toBe('1.0.0');
      expect(manifest.inputs.length).toBe(2);
      expect(manifest.steps.length).toBe(2);
      expect(manifest.steps[0]?.action.type).toBe('tool_call');
      expect(manifest.requiredTools).toEqual(['filesystem', 'shell']);
    });

    it('rejects invalid manifests missing required fields or containing duplicate steps', () => {
      const invalidYaml = `
id: invalid_skill
# missing name
steps:
  - id: step_1
    action:
      type: tool_call
      tool: shell
      argsTemplate:
        command: "echo test"
  - id: step_1 # duplicate step ID
    action:
      type: tool_call
      tool: shell
      argsTemplate:
        command: "echo duplicate"
`;

      expect(() => ManifestParser.parse(invalidYaml)).toThrow(SkillError);
    });
  });

  describe('Skill Registry & Cycle Detection', () => {
    it('detects and rejects direct and transitive skill recursion cycles', async () => {
      const skillA: SkillManifest = {
        id: 'skill_a',
        name: 'Skill A',
        version: '1.0.0',
        description: 'Calls skill B',
        triggerPatterns: [],
        inputs: [],
        outputs: [],
        requiredTools: [],
        origin: 'user_defined',
        tags: [],
        steps: [
          {
            id: 's1',
            action: { type: 'sub_skill', skillId: 'skill_b', inputMapping: {} },
            onFailure: 'abort',
          },
        ],
      };

      const skillB: SkillManifest = {
        id: 'skill_b',
        name: 'Skill B',
        version: '1.0.0',
        description: 'Calls skill A forming a cycle',
        triggerPatterns: [],
        inputs: [],
        outputs: [],
        requiredTools: [],
        origin: 'user_defined',
        tags: [],
        steps: [
          {
            id: 's1',
            action: { type: 'sub_skill', skillId: 'skill_a', inputMapping: {} },
            onFailure: 'abort',
          },
        ],
      };

      await skillsEngine.register(skillA);
      await expect(skillsEngine.register(skillB)).rejects.toThrow(SkillError);
    });

    it('matches skills by intent and trigger patterns', async () => {
      const deploySkill = ManifestParser.parse(`
id: k8s_deploy
name: Kubernetes Deploy
version: "1.0.0"
description: Deploy application containers to Kubernetes cluster
origin: builtin
tags: [kubernetes, deploy]
triggerPatterns:
  - "deploy to k8s"
  - "rollout new pod"
inputs: []
outputs: []
requiredTools: [shell]
steps:
  - id: s1
    action:
      type: tool_call
      tool: shell
      argsTemplate: { command: "echo k8s" }
    onFailure: abort
`);

      await skillsEngine.register(deploySkill);

      const matches = await skillsEngine.matchSkills('Please deploy to k8s cluster');
      expect(matches.length).toBeGreaterThan(0);
      expect(matches[0]?.skill.id).toBe('k8s_deploy');
    });
  });

  describe('Multi-Step Skill Execution', () => {
    it('executes a multi-step routine and binds template variables', async () => {
      const deployFilePath = path.join(tempDir, 'release.txt');

      const manifest = ManifestParser.parse(`
id: multi_step_file_routine
name: Multi Step File Routine
version: "1.0.0"
description: Writes a config file and verifies content
origin: user_defined
tags: [test]
triggerPatterns: []
inputs:
  - name: target_file
    type: file_path
    description: Destination path
    required: true
  - name: release_tag
    type: string
    description: Version tag
    required: true
outputs:
  - name: final_content
    type: string
    description: Content read from file
requiredTools: [filesystem]
steps:
  - id: step_write
    action:
      type: tool_call
      tool: filesystem
      argsTemplate:
        action: write
        path: "{{target_file}}"
        content: "release={{release_tag}}"
    onFailure: abort

  - id: step_verify
    action:
      type: tool_call
      tool: filesystem
      argsTemplate:
        action: read
        path: "{{target_file}}"
    onFailure: abort
`);

      await skillsEngine.register(manifest);

      const result = await skillsEngine.execute('multi_step_file_routine', {
        target_file: deployFilePath,
        release_tag: 'v2.5.0-production',
      });

      expect(result.success).toBe(true);
      expect(result.stepsExecuted).toBe(2);
      expect(result.stepsFailed).toBe(0);

      // Verify file was written to disk
      const content = await fs.readFile(deployFilePath, 'utf8');
      expect(content).toBe('release=v2.5.0-production');

      // Verify stats were updated
      const stats = skillsEngine.getStats('multi_step_file_routine');
      expect(stats.totalExecutions).toBe(1);
      expect(stats.successCount).toBe(1);
      expect(stats.successRate).toBe(1.0);
    });

    it('handles step conditions and failure skip policies', async () => {
      const manifest = ManifestParser.parse(`
id: conditional_routine
name: Conditional Routine
version: "1.0.0"
description: Tests conditional skipping
origin: user_defined
tags: [test]
triggerPatterns: []
inputs:
  - name: skip_optional
    type: boolean
    description: Whether to skip step 2
    required: false
    default: true
outputs: []
requiredTools: [shell]
steps:
  - id: step_always
    action:
      type: tool_call
      tool: shell
      argsTemplate:
        command: "echo 'first'"
    onFailure: abort

  - id: step_conditional
    condition: "skip_optional === false"
    action:
      type: tool_call
      tool: shell
      argsTemplate:
        command: "echo 'second'"
    onFailure: skip
`);

      await skillsEngine.register(manifest);

      const result = await skillsEngine.execute('conditional_routine', {
        skip_optional: true,
      });

      expect(result.success).toBe(true);
      expect(result.stepsExecuted).toBe(1);
      expect(result.stepsSkipped).toBe(1);
    });
  });

  describe('Pattern Detection & Synthesis (§10.5)', () => {
    it('detects recurring step sequences and synthesizes candidate SkillManifest', async () => {
      const traces = [
        { steps: ['shell:npm test', 'shell:git commit', 'shell:git push'], success: true, duration: 1200 },
        { steps: ['shell:npm test', 'shell:git commit', 'shell:git push'], success: true, duration: 1100 },
        { steps: ['filesystem:read', 'shell:npm test', 'shell:git commit', 'shell:git push'], success: true, duration: 1400 },
      ];

      const patterns = await skillsEngine.detectPatterns(traces);
      expect(patterns.length).toBeGreaterThan(0);
      expect(patterns[0]?.occurrences).toBeGreaterThanOrEqual(2);

      const generated = await skillsEngine.generateSkill(patterns[0]!);
      expect(generated.id).toBeDefined();
      expect(generated.origin).toBe('extracted');
      expect(generated.steps.length).toBeGreaterThanOrEqual(2);

      const fetched = skillsEngine.get(generated.id);
      expect(fetched).not.toBeNull();
      expect(fetched?.origin).toBe('extracted');
    });
  });
});
