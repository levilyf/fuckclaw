import http, { IncomingMessage, ServerResponse, Server } from 'node:http';
import { URL } from 'node:url';
import { IObservability } from '@fuckclaw/observability';
import { IAgentKernel } from '@fuckclaw/kernel';
import { IMemorySystem } from '@fuckclaw/memory';
import { IKnowledgeGraph } from '@fuckclaw/knowledge-graph';
import { IToolRuntime } from '@fuckclaw/tool-runtime';
import { Scheduler } from '@fuckclaw/scheduler';
import {
  HttpMethod,
  RouteHandler,
  RouteContext,
  NetworkConfig,
} from '../types.js';
import { applyCorsHeaders } from './middleware/cors.middleware.js';
import { authenticateRequest } from './middleware/auth.middleware.js';

interface RouteEntry {
  method: HttpMethod;
  pattern: RegExp;
  paramNames: string[];
  handler: RouteHandler;
}

export class HttpServer {
  private server?: Server;
  private routes: RouteEntry[] = [];

  constructor(
    private kernel: IAgentKernel,
    private config: NetworkConfig,
    private logger?: IObservability,
    private memory?: IMemorySystem,
    private knowledgeGraph?: IKnowledgeGraph,
    private toolRuntime?: IToolRuntime,
    private scheduler?: Scheduler
  ) {
    this.registerDefaultRoutes();
  }

  public registerRoute(method: HttpMethod, pathPattern: string, handler: RouteHandler): void {
    const paramNames: string[] = [];
    const regexPattern = pathPattern.replace(/:([a-zA-Z0-9_]+)/g, (_, name) => {
      paramNames.push(name);
      return '([^/]+)';
    });

    const pattern = new RegExp(`^${regexPattern}$`);
    this.routes.push({ method, pattern, paramNames, handler });
  }

  private registerDefaultRoutes(): void {
    // 1. System Health
    this.registerRoute('GET', '/api/system/health', async () => {
      return {
        status: 'healthy',
        version: '1.0.0',
        kernelState: this.kernel.getState(),
        uptimeSeconds: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
      };
    });

    // 2. Tasks Endpoints (§21.4.1)
    this.registerRoute('POST', '/api/tasks', async (ctx) => {
      const body = (ctx.body || {}) as { prompt?: string; goal?: string; description?: string; priority?: number; async?: boolean };
      const description = body.prompt || body.goal || body.description;
      if (!description) {
        throw { statusCode: 400, message: 'Missing "prompt", "goal", or "description" in request body' };
      }

      if (body.async) {
        // Enqueue task asynchronously without awaiting completion
        const taskPromise = this.kernel.submitTask({
          description,
          priority: body.priority ?? 10,
          source: { type: 'user' },
        });
        // Catch any uncaught rejection on the background promise
        taskPromise.catch(() => {});

        // Fetch task record or return early
        return {
          status: 'accepted',
          description,
          async: true,
        };
      }

      const task = await this.kernel.submitTask({
        description,
        priority: body.priority ?? 10,
        source: { type: 'user' },
      });

      return {
        taskId: task.id,
        state: task.state,
        output: task.output,
        durationMs: task.budget.consumed.duration,
        costUsd: task.budget.consumed.cost,
      };
    });

    this.registerRoute('GET', '/api/tasks/:id', async (ctx) => {
      const taskId = ctx.params.id || '';
      const task = await this.kernel.getTask(taskId);
      if (!task) {
        throw { statusCode: 404, message: `Task "${taskId}" not found` };
      }
      return { task };
    });

    this.registerRoute('DELETE', '/api/tasks/:id', async (ctx) => {
      const taskId = ctx.params.id || '';
      const task = await this.kernel.getTask(taskId);
      if (!task) {
        throw { statusCode: 404, message: `Task "${taskId}" not found` };
      }
      await this.kernel.cancelTask(taskId);
      return { success: true, taskId, state: 'cancelled' };
    });

    // 3. Memory Search Endpoints
    this.registerRoute('GET', '/api/memory/search', async (ctx) => {
      if (!this.memory) {
        return { results: [] };
      }
      const query = ctx.query.q || ctx.query.query || '';
      const limit = parseInt(ctx.query.limit || '5', 10);
      const searchResult = await this.memory.searchHybrid({ text: query, limit });
      const count = searchResult.episodic.length + searchResult.semantic.length;
      return { query, count, results: searchResult };
    });

    this.registerRoute('POST', '/api/memory/query', async (ctx) => {
      if (!this.memory) {
        return { results: [] };
      }
      const body = (ctx.body || {}) as { query?: string; limit?: number };
      const searchResult = await this.memory.searchHybrid({ text: body.query || '', limit: body.limit || 5 });
      return { results: searchResult };
    });

    // 4. Knowledge Graph Endpoints
    this.registerRoute('GET', '/api/graph/entity/:id', async (ctx) => {
      if (!this.knowledgeGraph) {
        throw { statusCode: 404, message: 'Knowledge Graph not configured' };
      }
      const entityId = ctx.params.id || '';
      const entity = await this.knowledgeGraph.getEntity(entityId);
      if (!entity) {
        throw { statusCode: 404, message: `Entity "${entityId}" not found` };
      }
      return { entity };
    });

    this.registerRoute('GET', '/api/graph/traverse', async (ctx) => {
      if (!this.knowledgeGraph) {
        throw { statusCode: 404, message: 'Knowledge Graph not configured' };
      }
      const entityId = ctx.query.entityId;
      const depth = parseInt(ctx.query.depth || '1', 10);
      if (!entityId) {
        throw { statusCode: 400, message: 'Missing entityId parameter' };
      }
      const neighborhood = await this.knowledgeGraph.getNeighbors(entityId, depth);
      return { neighborhood };
    });

    // 5. Tools Listing
    this.registerRoute('GET', '/api/tools', async () => {
      if (!this.toolRuntime) {
        return { tools: [] };
      }
      const tools = this.toolRuntime.list().map((t: { name: string; description: string; source?: unknown }) => ({
        name: t.name,
        description: t.description,
        source: t.source || { type: 'native' },
      }));
      return { count: tools.length, tools };
    });

    // 6. Web Dashboard Overview API & Web UI (§22.4)
    this.registerRoute('GET', '/api/dashboard/overview', async () => {
      const allTasks = this.kernel.listTasks();
      const activeTasks = allTasks.filter(
        (t) =>
          t.state !== ('completed' as any) &&
          t.state !== ('failed' as any) &&
          t.state !== ('cancelled' as any)
      );
      const metrics = this.logger?.getMetrics?.().getSnapshot?.() ?? {};
      const toolsCount = this.toolRuntime?.list().length ?? 0;
      const triggersCount = this.scheduler?.listTriggers().length ?? 0;

      return {
        kernel: {
          state: this.kernel.getState(),
          uptimeSeconds: Math.floor(process.uptime()),
        },
        tasks: {
          activeCount: activeTasks.length,
          totalCount: allTasks.length,
          activeTasks,
        },
        metrics,
        counts: {
          tools: toolsCount,
          triggers: triggersCount,
        },
      };
    });

    // 7. Web Dashboard Single-Page HTML Interface (§22.4)
    this.registerRoute('GET', '/dashboard', async () => {
      return {
        _rawHtml: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>FuckClaw AI Operating System — Web Dashboard</title>
  <style>
    :root { --bg: #0f172a; --panel: #1e293b; --text: #f8fafc; --accent: #38bdf8; --green: #22c55e; }
    body { margin: 0; padding: 24px; font-family: ui-monospace, monospace; background: var(--bg); color: var(--text); }
    h1 { color: var(--accent); margin-top: 0; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 20px; }
    .card { background: var(--panel); border: 1px solid #334155; border-radius: 8px; padding: 18px; }
    .card h2 { margin-top: 0; color: #94a3b8; font-size: 14px; text-transform: uppercase; letter-spacing: 0.05em; }
    .stat { font-size: 28px; font-weight: bold; color: var(--green); margin: 8px 0; }
    button { background: var(--accent); color: #000; border: none; padding: 8px 16px; border-radius: 4px; font-weight: bold; cursor: pointer; }
    input { background: #0f172a; border: 1px solid #475569; color: #fff; padding: 8px; border-radius: 4px; width: calc(100% - 20px); margin-bottom: 10px; }
    pre { background: #0b1120; padding: 10px; border-radius: 4px; overflow-x: auto; font-size: 12px; }
  </style>
</head>
<body>
  <h1>⚡ FuckClaw Web Dashboard (§22.4)</h1>
  <div class="grid">
    <div class="card">
      <h2>Agent Kernel Status</h2>
      <div id="kernelState" class="stat">Loading...</div>
      <p id="uptime">Uptime: --</p>
    </div>
    <div class="card">
      <h2>Quick Task Dispatcher</h2>
      <input type="text" id="taskInput" placeholder="Enter task objective...">
      <button onclick="submitTask()">Dispatch Task</button>
      <div id="taskStatus" style="margin-top: 10px; font-size: 12px;"></div>
    </div>
    <div class="card">
      <h2>Registered Tools</h2>
      <div id="toolsList">Loading tools...</div>
    </div>
    <div class="card">
      <h2>Observability Metrics</h2>
      <pre id="metricsJson">Loading metrics...</pre>
    </div>
  </div>
  <script>
    async function loadData() {
      try {
        const res = await fetch('/api/dashboard/overview');
        const data = await res.json();
        document.getElementById('kernelState').innerText = data.kernel.state.toUpperCase();
        document.getElementById('uptime').innerText = 'Uptime: ' + data.kernel.uptimeSeconds + 's';
        document.getElementById('metricsJson').innerText = JSON.stringify(data.metrics, null, 2);

        const toolsRes = await fetch('/api/tools');
        const toolsData = await toolsRes.json();
        document.getElementById('toolsList').innerHTML = toolsData.tools.map(t => '<div>✓ ' + t.name + '</div>').join('');
      } catch (err) {
        console.error(err);
      }
    }
    async function submitTask() {
      const desc = document.getElementById('taskInput').value;
      if (!desc) return;
      document.getElementById('taskStatus').innerText = 'Submitting task...';
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: desc })
      });
      const data = await res.json();
      document.getElementById('taskStatus').innerText = 'Task ' + data.taskId + ' (' + data.state + ')';
      loadData();
    }
    loadData();
    setInterval(loadData, 5000);
  </script>
</body>
</html>`,
      };
    });

    // 8. Webhooks Ingress
    this.registerRoute('POST', '/api/webhooks/:id', async (ctx) => {
      const triggerId = ctx.params.id || '';
      const payload = ctx.body;

      if (this.scheduler) {
        const triggers = this.scheduler.listTriggers();
        const trigger = triggers.find((t) => t.id === triggerId && t.source.type === 'webhook');
        if (trigger) {
          const submitted = await this.kernel.submitTask({
            description: trigger.taskTemplate.description,
            priority: trigger.taskTemplate.priority ?? 10,
            source: { type: 'schedule', triggerId },
          });
          return {
            status: 'accepted',
            triggerId,
            taskId: submitted.id,
          };
        }
      }

      // Default webhook execution: submit task directly
      const task = await this.kernel.submitTask({
        description: `Webhook ${triggerId} triggered`,
        source: { type: 'event', triggerId, payload },
      });
      return { status: 'accepted', taskId: task.id };
    });
  }

  public async start(): Promise<{ host: string; port: number }> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => this.handleRequest(req, res));

      this.server.on('error', (err) => {
        this.logger?.error?.(`HTTP Server error: ${err.message}`);
        reject(err);
      });

      this.server.listen(this.config.port, this.config.host, () => {
        const addr = this.server?.address();
        const actualPort = typeof addr === 'object' && addr ? addr.port : this.config.port;
        this.logger?.info?.(`HTTP REST API listening on http://${this.config.host}:${actualPort}`);
        resolve({ host: this.config.host, port: actualPort });
      });
    });
  }

  public getRawServer(): Server | undefined {
    return this.server;
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // 1. CORS
    if (applyCorsHeaders(req, res, this.config)) {
      return;
    }

    // 2. Parse URL and body
    const reqUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = reqUrl.pathname;
    const method = (req.method || 'GET').toUpperCase() as HttpMethod;

    const query: Record<string, string> = {};
    reqUrl.searchParams.forEach((val, key) => {
      query[key] = val;
    });

    let body: unknown = undefined;
    if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
      try {
        body = await this.parseRequestBody(req);
      } catch {
        this.sendJson(res, 400, { error: 'Invalid JSON payload in request body' });
        return;
      }
    }

    // Match route
    let matchedEntry: RouteEntry | undefined;
    const params: Record<string, string> = {};

    for (const entry of this.routes) {
      if (entry.method === method) {
        const match = pathname.match(entry.pattern);
        if (match) {
          matchedEntry = entry;
          entry.paramNames.forEach((name, idx) => {
            const val = match[idx + 1];
            if (val !== undefined) {
              params[name] = val;
            }
          });
          break;
        }
      }
    }

    const routeCtx: RouteContext = {
      req,
      res,
      params,
      query,
      body,
    };

    // 3. Auth verification
    if (!authenticateRequest(routeCtx, this.config)) {
      this.sendJson(res, 401, { error: 'Unauthorized: Invalid or missing API token' });
      return;
    }

    if (!matchedEntry) {
      this.sendJson(res, 404, { error: `Cannot ${method} ${pathname}` });
      return;
    }

    try {
      const responseData = await matchedEntry.handler(routeCtx);
      if (!res.writableEnded) {
        if (responseData && typeof responseData === 'object' && '_rawHtml' in (responseData as any)) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end((responseData as any)._rawHtml);
        } else {
          this.sendJson(res, 200, responseData);
        }
      }
    } catch (err: unknown) {
      const statusCode = (err as { statusCode?: number }).statusCode || 500;
      const message = (err as Error).message || (err as { message?: string }).message || 'Internal Server Error';
      if (!res.writableEnded) {
        this.sendJson(res, statusCode, { error: message });
      }
    }
  }

  private parseRequestBody(req: IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8').trim();
        if (!raw) {
          resolve({});
          return;
        }
        try {
          resolve(JSON.parse(raw));
        } catch (e) {
          reject(e);
        }
      });
      req.on('error', reject);
    });
  }

  private sendJson(res: ServerResponse, status: number, data: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }

  public async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.logger?.info?.('HTTP Server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}
