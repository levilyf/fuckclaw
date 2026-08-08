import { EventHandler } from '../types.js';

export class PatternMatcher {
  static matches(pattern: string, eventType: string): boolean {
    if (pattern === '*' || pattern === eventType) {
      return true;
    }
    if (pattern.endsWith('.*')) {
      const prefix = pattern.slice(0, -2);
      return eventType === prefix || eventType.startsWith(prefix + '.');
    }
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(2);
      return eventType === suffix || eventType.endsWith('.' + suffix);
    }
    return false;
  }

  static findMatchingHandlers(
    handlersMap: Map<string, Set<EventHandler>>,
    eventType: string
  ): EventHandler[] {
    const matched = new Set<EventHandler>();

    for (const [pattern, handlerSet] of handlersMap.entries()) {
      if (this.matches(pattern, eventType)) {
        handlerSet.forEach((h) => matched.add(h));
      }
    }

    return Array.from(matched);
  }
}
