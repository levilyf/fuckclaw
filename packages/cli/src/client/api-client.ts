import WebSocket from 'ws';

export interface ClientOptions {
  baseUrl?: string;
  apiKey?: string;
}

export interface TaskSubmitResult {
  taskId: string;
  state: string;
  output?: string;
  durationMs?: number;
  costUsd?: number;
  async?: boolean;
}

export interface SystemHealthResult {
  status: string;
  version: string;
  kernelState: string;
  uptimeSeconds: number;
  timestamp: string;
}

export class FuckClawClient {
  private baseUrl: string;
  private apiKey?: string;

  constructor(options: ClientOptions = {}) {
    this.baseUrl = options.baseUrl || 'http://127.0.0.1:8420';
    this.apiKey = options.apiKey;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  public async getHealth(): Promise<SystemHealthResult> {
    const res = await fetch(`${this.baseUrl}/api/system/health`, {
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      throw new Error(`Health check failed: ${res.status} ${res.statusText}`);
    }
    return (await res.json()) as SystemHealthResult;
  }

  public async submitTask(prompt: string, asyncMode: boolean = false): Promise<TaskSubmitResult> {
    const res = await fetch(`${this.baseUrl}/api/tasks`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ prompt, async: asyncMode }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Task submission failed: ${res.status} ${err}`);
    }
    return (await res.json()) as TaskSubmitResult;
  }

  public async getTask(taskId: string): Promise<any> {
    const res = await fetch(`${this.baseUrl}/api/tasks/${taskId}`, {
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      throw new Error(`Get task failed: ${res.status}`);
    }
    return await res.json();
  }

  public async cancelTask(taskId: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/tasks/${taskId}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      throw new Error(`Cancel task failed: ${res.status}`);
    }
  }

  public async listTools(): Promise<Array<{ name: string; description: string; source: unknown }>> {
    const res = await fetch(`${this.baseUrl}/api/tools`, {
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      throw new Error(`List tools failed: ${res.status}`);
    }
    const data = (await res.json()) as { tools: Array<{ name: string; description: string; source: unknown }> };
    return data.tools;
  }

  public connectStream(onMessage: (msg: any) => void): WebSocket {
    const wsUrl = this.baseUrl.replace(/^http/, 'ws');
    const ws = new WebSocket(wsUrl);
    ws.on('message', (data) => {
      try {
        const parsed = JSON.parse(data.toString('utf8'));
        onMessage(parsed);
      } catch {
        // Ignore unparseable
      }
    });
    return ws;
  }
}
