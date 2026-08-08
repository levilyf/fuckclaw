export type ModelTier = 'fast' | 'standard' | 'frontier' | 'local';

export class TierClassifier {
  static classify(complexity: 'low' | 'medium' | 'high'): ModelTier {
    switch (complexity) {
      case 'low':
        return 'fast';
      case 'medium':
        return 'standard';
      case 'high':
        return 'frontier';
    }
  }
}
