import { FuckClawRuntimeInstance } from '../index.js';
import { InteractiveTUI } from './app.js';

export interface AppProps {
  runtime: FuckClawRuntimeInstance;
}

export class App {
  private tui: InteractiveTUI;

  constructor(props: AppProps) {
    this.tui = new InteractiveTUI(props.runtime);
  }

  async start(): Promise<void> {
    await this.tui.start();
  }
}
