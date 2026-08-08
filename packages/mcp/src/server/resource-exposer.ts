import { IWorkspaceManager } from '@fuckclaw/workspace';
import { IKnowledgeGraph } from '@fuckclaw/knowledge-graph';
import { MCPResource } from '../types.js';

export class ResourceExposer {
  constructor(
    private workspace?: IWorkspaceManager,
    private knowledgeGraph?: IKnowledgeGraph
  ) {}

  public async listResources(): Promise<MCPResource[]> {
    const resources: MCPResource[] = [];

    if (this.workspace) {
      const root = this.workspace.getRoot();
      resources.push({
        uri: `fuckclaw://workspace/root`,
        name: 'Workspace Root Directory',
        description: `Active FuckClaw workspace located at ${root}`,
        mimeType: 'text/directory',
      });
    }

    if (this.knowledgeGraph) {
      const stats = await this.knowledgeGraph.stats();
      resources.push({
        uri: `fuckclaw://knowledge-graph/stats`,
        name: 'Knowledge Graph Topology Statistics',
        description: `Knowledge graph metrics: ${stats.entityCount} entities, ${stats.relationshipCount} relationships`,
        mimeType: 'application/json',
      });
    }

    return resources;
  }

  public async readResource(uri: string): Promise<{ uri: string; mimeType: string; text?: string; blob?: string }> {
    if (uri === 'fuckclaw://workspace/root' && this.workspace) {
      return {
        uri,
        mimeType: 'text/plain',
        text: this.workspace.getRoot(),
      };
    }

    if (uri === 'fuckclaw://knowledge-graph/stats' && this.knowledgeGraph) {
      const stats = await this.knowledgeGraph.stats();
      return {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(stats, null, 2),
      };
    }

    throw new Error(`Resource not found: ${uri}`);
  }
}
