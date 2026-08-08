export interface BeamNode<T> {
  state: T;
  score: number;
  depth: number;
}

export class BeamSearch<T> {
  constructor(private beamWidth: number = 3) {}

  selectBest(nodes: BeamNode<T>[]): BeamNode<T>[] {
    return [...nodes].sort((a, b) => b.score - a.score).slice(0, this.beamWidth);
  }
}
