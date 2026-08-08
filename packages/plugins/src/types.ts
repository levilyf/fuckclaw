import { IEventBus } from '@fuckclaw/event-bus';
import { IToolRuntime } from '@fuckclaw/tool-runtime';
import { ISkillEngine } from '@fuckclaw/skills';
import { IMemorySystem } from '@fuckclaw/memory';
import { IKnowledgeGraph } from '@fuckclaw/knowledge-graph';
import { IObservability } from '@fuckclaw/observability';
import { Task } from '@fuckclaw/kernel';

export type PluginCapability =
  | { type: 'tool'; tools: string[] }
  | { type: 'skill'; skills: string[] }
  | { type: 'provider'; providers: string[] }
  | { type: 'memory_backend'; backends: string[] }
  | { type: 'event_handler'; events: string[] }
  | { type: 'scheduler_trigger'; triggers: string[] }
  | { type: 'ui_component'; components: string[] };

export interface PluginRequirements {
  minVersion: string;
  tools?: string[];
  plugins?: string[];
}

export interface PluginAuthor {
  name: string;
  email?: string;
  url?: string;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author: PluginAuthor;
  main: string;
  capabilities: PluginCapability[];
  requirements: PluginRequirements;
  configSchema?: Record<string, unknown>;
  hooks?: string[];
}

export interface PluginContext {
  config: Record<string, unknown>;
  eventBus: IEventBus;
  toolRegistry: IToolRuntime;
  skillEngine?: ISkillEngine;
  memory?: IMemorySystem;
  knowledgeGraph?: IKnowledgeGraph;
  logger: IObservability;
  dataDir: string;
}

export interface Plugin {
  onInit(ctx: PluginContext): Promise<void>;
  onShutdown?(ctx: PluginContext): Promise<void>;
  onTaskCreated?(task: Task, ctx: PluginContext): Promise<void>;
  onTaskCompleted?(task: Task, result: unknown, ctx: PluginContext): Promise<void>;
  healthCheck?(ctx: PluginContext): Promise<{ healthy: boolean; message?: string }>;
}

export type PluginState =
  | 'discovered'
  | 'validating'
  | 'resolved'
  | 'loading'
  | 'initializing'
  | 'active'
  | 'stopping'
  | 'stopped'
  | 'error'
  | 'disabled';

export interface PluginInstance {
  manifest: PluginManifest;
  module: Plugin;
  state: PluginState;
  context: PluginContext;
  location?: string;
  error?: string;
  loadedAt?: number;
}

export interface IPluginManager {
  discover(pluginsDir?: string): Promise<PluginManifest[]>;
  load(manifestOrPath: PluginManifest | string, pluginModule?: Plugin, config?: Record<string, unknown>): Promise<void>;
  unload(pluginId: string): Promise<void>;
  list(): PluginInstance[];
  get(pluginId: string): PluginInstance | undefined;
  invokeTaskCreatedHook(task: Task): Promise<void>;
  invokeTaskCompletedHook(task: Task, result: unknown): Promise<void>;
  healthCheck(): Promise<Record<string, { healthy: boolean; message?: string }>>;
  shutdown(): Promise<void>;
}
