export interface ProceduralWorkflow {
  id: string;
  name: string;
  description: string;
  steps: string[];
  successCount: number;
  failureCount: number;
}

export class ProceduralStore {
  private workflows: Map<string, ProceduralWorkflow> = new Map();

  recordWorkflow(workflow: ProceduralWorkflow): void {
    this.workflows.set(workflow.id, workflow);
  }

  getWorkflow(id: string): ProceduralWorkflow | undefined {
    return this.workflows.get(id);
  }
}
