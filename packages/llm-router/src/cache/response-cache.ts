import { GenerationResponse } from '../types.js';

export class ResponseCache {
  private cache: Map<string, GenerationResponse> = new Map();

  get(key: string): GenerationResponse | undefined {
    return this.cache.get(key);
  }

  set(key: string, response: GenerationResponse): void {
    this.cache.set(key, response);
  }

  clear(): void {
    this.cache.clear();
  }
}
