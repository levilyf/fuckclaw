import fs from 'node:fs';
import path from 'node:path';
import { ProjectMetadata } from '../types.js';

export class ProjectRegistry {
  constructor(private projectsDir: string) {}

  registerProject(project: ProjectMetadata): void {
    if (!fs.existsSync(this.projectsDir)) {
      fs.mkdirSync(this.projectsDir, { recursive: true });
    }
    const filePath = path.join(this.projectsDir, `${project.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(project, null, 2), 'utf8');
  }

  getProject(id: string): ProjectMetadata | null {
    const filePath = path.join(this.projectsDir, `${id}.json`);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }
}
