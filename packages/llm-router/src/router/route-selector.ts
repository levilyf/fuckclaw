import { ILLMProvider } from '../types.js';

export class RouteSelector {
  static select(providers: Map<string, ILLMProvider>, requested?: string, defaultName?: string): ILLMProvider[] {
    const targetName = requested ?? defaultName;
    if (!targetName) {
      return Array.from(providers.values());
    }

    const primary = providers.get(targetName);
    const fallbacks = Array.from(providers.values()).filter((p) => p.name !== targetName);

    return primary ? [primary, ...fallbacks] : fallbacks;
  }
}
