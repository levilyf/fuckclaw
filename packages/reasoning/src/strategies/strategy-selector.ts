import { Task, ContextBundle } from '@fuckclaw/kernel';
import { ReasoningStrategyType } from '../types.js';

export class StrategySelector {
  /**
   * Selects reasoning strategy based on task metadata and description (§11.2.1).
   */
  static select(task: Task, _context: ContextBundle, defaultStrategy?: ReasoningStrategyType): ReasoningStrategyType {
    if (defaultStrategy) {
      return defaultStrategy;
    }

    const tags = task.tags ?? [];
    const desc = task.description.toLowerCase();

    // Check tags first
    if (tags.some((t) => t.includes('tree_search') || t.includes('beam_search'))) {
      return 'tree_search';
    }
    if (tags.some((t) => t.includes('direct') || t.includes('single_turn'))) {
      return 'direct';
    }
    if (tags.some((t) => t.includes('react'))) {
      return 'react';
    }

    // Check description heuristics
    if (
      desc.includes('tree search') ||
      desc.includes('explore multiple branches') ||
      desc.includes('search alternative paths') ||
      desc.includes('beam search')
    ) {
      return 'tree_search';
    }

    if (
      desc.startsWith('what is') ||
      desc.startsWith('summarize') ||
      desc.startsWith('define ') ||
      desc.startsWith('explain ')
    ) {
      return 'direct';
    }

    return 'react';
  }
}
