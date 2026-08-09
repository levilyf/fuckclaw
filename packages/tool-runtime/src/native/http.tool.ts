import { z } from 'zod';
import { ITool, ToolResult, StructuredToolError } from '../types.js';

export const HttpToolSchema = z.object({
  url: z.string().url(),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD']).default('GET'),
  headers: z.record(z.string()).optional(),
  query: z.record(z.string()).optional(),
  body: z.union([z.string(), z.record(z.unknown())]).optional(),
  timeoutMs: z.number().int().positive().default(30000),
});

export type HttpToolParams = z.infer<typeof HttpToolSchema>;

export class HttpTool implements ITool {
  name = 'http';
  description = 'Execute HTTP/HTTPS requests (GET, POST, PUT, DELETE, PATCH, HEAD) with custom headers, query params, and body.';
  schema = HttpToolSchema;

  async execute(params: unknown): Promise<ToolResult> {
    const start = Date.now();
    let parsed: HttpToolParams;
    try {
      parsed = this.schema.parse(params);
    } catch (err: any) {
      return {
        success: false,
        output: '',
        error: {
          code: 'INVALID_PARAMS',
          message: `HTTP tool parameter validation failed: ${err.message}`,
          category: 'internal',
          retryable: false,
        },
        executionTimeMs: Date.now() - start,
      };
    }

    try {
      // Build final URL with query parameters
      const urlObj = new URL(parsed.url);
      if (parsed.query) {
        for (const [key, value] of Object.entries(parsed.query)) {
          urlObj.searchParams.set(key, value);
        }
      }

      const headers: Record<string, string> = { ...(parsed.headers ?? {}) };
      let bodyData: string | undefined;

      if (parsed.body !== undefined && parsed.method !== 'GET' && parsed.method !== 'HEAD') {
        if (typeof parsed.body === 'object') {
          if (!headers['Content-Type'] && !headers['content-type']) {
            headers['Content-Type'] = 'application/json';
          }
          bodyData = JSON.stringify(parsed.body);
        } else {
          bodyData = parsed.body;
        }
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), parsed.timeoutMs);

      let response: Response;
      try {
        response = await fetch(urlObj.toString(), {
          method: parsed.method,
          headers,
          body: bodyData,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      const responseText = await response.text();
      let responseData: unknown;
      try {
        responseData = JSON.parse(responseText);
      } catch {
        responseData = responseText;
      }

      const isOk = response.ok;
      const resultOutput = typeof responseData === 'string'
        ? responseData
        : JSON.stringify(responseData, null, 2);

      return {
        success: isOk,
        output: resultOutput,
        metadata: {
          status: response.status,
          statusText: response.statusText,
          headers: Object.fromEntries(response.headers.entries()),
          url: urlObj.toString(),
        },
        error: !isOk
          ? {
              code: `HTTP_${response.status}`,
              message: `HTTP request failed with status ${response.status} (${response.statusText}): ${responseText.slice(0, 500)}`,
              category: response.status >= 500 ? 'network' : 'internal',
              retryable: response.status >= 500 || response.status === 429,
              details: { status: response.status, statusText: response.statusText },
            }
          : undefined,
        executionTimeMs: Date.now() - start,
      };
    } catch (err: any) {
      const isAbort = err.name === 'AbortError' || /aborted|timeout/i.test(err.message || '');
      const structuredError: StructuredToolError = {
        code: isAbort ? 'TIMEOUT' : 'NETWORK_ERROR',
        message: err.message || String(err),
        category: isAbort ? 'timeout' : 'network',
        retryable: isAbort || /econnrefused|etimedout|enotfound/i.test(err.message || ''),
      };

      return {
        success: false,
        output: '',
        error: structuredError,
        executionTimeMs: Date.now() - start,
      };
    }
  }
}
