import { ResourceLock } from './resource-lock.js';

/**
 * Task orchestrator boundary defined by IMPLEMENTATION-SPEC §4.8.
 * Coordinates task dispatch, resource locking, and subtask fan-out.
 */
export class TaskOrchestrator {
  private resourceLock: ResourceLock;

  constructor() {
    this.resourceLock = new ResourceLock();
  }

  acquireResource(resourceId: string): boolean {
    return this.resourceLock.acquire(resourceId);
  }

  releaseResource(resourceId: string): void {
    this.resourceLock.release(resourceId);
  }

  isResourceLocked(resourceId: string): boolean {
    return this.resourceLock.isLocked(resourceId);
  }
}
