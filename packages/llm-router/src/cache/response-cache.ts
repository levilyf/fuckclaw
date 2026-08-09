import crypto from 'node:crypto';
import { GenerationRequest, GenerationResponse } from '../types.js';

export interface CacheEntry {
  response: GenerationResponse;
  expiresAt: number;
}

export class ResponseCache {
  private cache: Map<string, CacheEntry> = new Map();
  private defaultTtlMs: number;

  constructor(defaultTtlMs: number = 3600000) {
    this.defaultTtlMs = defaultTtlMs;
  }

  static generateKey(request: GenerationRequest): string {
    const serialized = JSON.stringify({
      provider: request.provider ?? 'default',
      model: request.model ?? 'default',
      messages: request.messages,
      temperature: request.temperature ?? 0.7,
      maxTokens: request.maxTokens ?? 4096,
    });
    return crypto.createHash('sha256').update(serialized).digest('hex');
  }

  get(key: string): GenerationResponse | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      return undefined;
    }
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }
    return JSON.parse(JSON.stringify(entry.response));
  }

  set(key: string, response: GenerationResponse, ttlMs?: number): void {
    const expiresAt = Date.now() + (ttlMs ?? this.defaultTtlMs);
    this.cache.set(key, {
      response: JSON.parse(JSON.stringify(response)),
      expiresAt,
    });
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }
}
