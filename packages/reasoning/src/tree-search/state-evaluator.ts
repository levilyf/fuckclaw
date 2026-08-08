export class StateEvaluator {
  static evaluate(stateDescription: string, _goal: string): number {
    // Score between 0.0 and 1.0 indicating progress toward goal
    if (stateDescription.toLowerCase().includes('success') || stateDescription.toLowerCase().includes('completed')) {
      return 1.0;
    }
    return 0.5;
  }
}
