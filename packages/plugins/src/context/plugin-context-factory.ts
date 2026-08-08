import { IEventBus } from '@fuckclaw/event-bus';
import { IToolRuntime } from '@fuckclaw/tool-runtime';
import { ISkillEngine } from '@fuckclaw/skills';
import { IMemorySystem } from '@fuckclaw/memory';
import { IKnowledgeGraph } from '@fuckclaw/knowledge-graph';
import { IObservability } from '@fuckclaw/observability';
import { IWorkspaceManager } from '@fuckclaw/workspace';
import { PluginContext, PluginManifest } from '../types.js';
import fs from 'node:fs';
import path from 'node:path';

export class PluginContextFactory {
  constructor(
    private eventBus: IEventBus,
    private toolRuntime: IToolRuntime,
    private logger: IObservability,
    private workspace?: IWorkspaceManager,
    private skillEngine?: ISkillEngine,
    private memory?: IMemorySystem,
    private knowledgeGraph?: IKnowledgeGraph
  ) {}

  public createContext(manifest: PluginManifest, customConfig: Record<string, unknown> = {}): PluginContext {
    let dataDir = path.join(process.cwd(), '.fuckclaw-plugin-data', manifest.id);
    if (this.workspace) {
      dataDir = path.join(this.workspace.getDirectory('plugins'), 'data', manifest.id);
    }

    if (!fs.existsSync(dataDir)) {
      try {
        fs.mkdirSync(dataDir, { recursive: true });
      } catch {
        // Fallback or permission check
      }
    }

    return {
      config: { ...customConfig },
      eventBus: this.eventBus,
      toolRegistry: this.toolRuntime,
      skillEngine: this.skillEngine,
      memory: this.memory,
      knowledgeGraph: this.knowledgeGraph,
      logger: this.logger,
      dataDir,
    };
  }
}
