import fs from 'node:fs/promises';
import path from 'node:path';
import { IObservability } from '@fuckclaw/observability';
import {
  SkillManifest,
  SkillOrigin,
  SkillStats,
  ScoredSkill,
  SkillError,
} from '../types.js';
import { ManifestParser } from '../parser/manifest-parser.js';

export class SkillRegistry {
  private skills: Map<string, SkillManifest> = new Map();
  private statsMap: Map<string, SkillStats> = new Map();

  constructor(private observability?: IObservability) {}

  public async register(manifest: SkillManifest): Promise<void> {
    // 1. Validate composition acyclicity (cycle detection)
    this.detectCompositionCycle(manifest);

    // 2. Initialize default stats if not present
    if (!this.statsMap.has(manifest.id)) {
      this.statsMap.set(manifest.id, {
        totalExecutions: 0,
        successCount: 0,
        failureCount: 0,
        averageDurationMs: 0,
        averageTokenCost: 0,
        lastExecutedAt: 0,
        successRate: 1.0,
      });
    }

    this.skills.set(manifest.id, manifest);

    this.observability?.log({
      level: 'debug',
      module: 'skills',
      message: `Registered skill "${manifest.name}" (${manifest.id}) [${manifest.origin}] with ${manifest.steps.length} steps`,
      metadata: { skillId: manifest.id, name: manifest.name, version: manifest.version },
    });
  }

  public get(skillId: string): SkillManifest | null {
    return this.skills.get(skillId) || null;
  }

  public list(filter?: { origin?: SkillOrigin; tags?: string[] }): SkillManifest[] {
    let result = Array.from(this.skills.values());

    if (filter?.origin) {
      result = result.filter((s) => s.origin === filter.origin);
    }

    if (filter?.tags && filter.tags.length > 0) {
      const tagSet = new Set(filter.tags.map((t) => t.toLowerCase()));
      result = result.filter((s) =>
        s.tags.some((t) => tagSet.has(t.toLowerCase()))
      );
    }

    return result;
  }

  public getStats(skillId: string): SkillStats {
    const stats = this.statsMap.get(skillId);
    if (!stats) {
      return {
        totalExecutions: 0,
        successCount: 0,
        failureCount: 0,
        averageDurationMs: 0,
        averageTokenCost: 0,
        lastExecutedAt: 0,
        successRate: 0,
      };
    }
    return { ...stats };
  }

  public updateStats(
    skillId: string,
    outcome: { success: boolean; durationMs: number; tokenCost: number }
  ): void {
    let stats = this.statsMap.get(skillId);
    if (!stats) {
      stats = {
        totalExecutions: 0,
        successCount: 0,
        failureCount: 0,
        averageDurationMs: 0,
        averageTokenCost: 0,
        lastExecutedAt: 0,
        successRate: 0,
      };
    }

    const total = stats.totalExecutions + 1;
    const successCount = stats.successCount + (outcome.success ? 1 : 0);
    const failureCount = stats.failureCount + (outcome.success ? 0 : 1);
    const averageDurationMs =
      (stats.averageDurationMs * stats.totalExecutions + outcome.durationMs) / total;
    const averageTokenCost =
      (stats.averageTokenCost * stats.totalExecutions + outcome.tokenCost) / total;
    const successRate = total > 0 ? successCount / total : 0;

    const updatedStats: SkillStats = {
      totalExecutions: total,
      successCount,
      failureCount,
      averageDurationMs,
      averageTokenCost,
      lastExecutedAt: Date.now(),
      successRate,
    };

    this.statsMap.set(skillId, updatedStats);
  }

  public async matchSkills(intent: string, limit: number = 5): Promise<ScoredSkill[]> {
    const normalizedIntent = intent.toLowerCase();
    const scored: ScoredSkill[] = [];

    for (const skill of this.skills.values()) {
      let score = 0;

      // 1. Direct name match
      if (normalizedIntent.includes(skill.name.toLowerCase())) {
        score += 0.8;
      }

      // 2. Trigger pattern matches
      for (const pattern of skill.triggerPatterns) {
        const pLower = pattern.toLowerCase();
        if (normalizedIntent.includes(pLower)) {
          score += 0.6;
        } else {
          // Token overlap
          const pTokens = pLower.split(/\s+/);
          const matchedTokens = pTokens.filter((tok) => normalizedIntent.includes(tok));
          if (matchedTokens.length > 0) {
            score += 0.3 * (matchedTokens.length / pTokens.length);
          }
        }
      }

      // 3. Tag matches
      for (const tag of skill.tags) {
        if (normalizedIntent.includes(tag.toLowerCase())) {
          score += 0.2;
        }
      }

      // 4. Description keywords
      const descTokens = skill.description.toLowerCase().split(/\s+/).slice(0, 20);
      const descMatches = descTokens.filter((tok) => tok.length > 3 && normalizedIntent.includes(tok));
      if (descMatches.length > 0) {
        score += 0.1 * Math.min(descMatches.length, 3);
      }

      if (score > 0) {
        const stats = this.getStats(skill.id);
        scored.push({
          skill,
          relevanceScore: Math.min(score, 1.0),
          successRate: stats.successRate,
        });
      }
    }

    scored.sort((a, b) => b.relevanceScore * b.successRate - a.relevanceScore * a.successRate);
    return scored.slice(0, limit);
  }

  public async loadFromDirectory(dirPath: string): Promise<number> {
    let count = 0;
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          count += await this.loadFromDirectory(fullPath);
        } else if (
          entry.isFile() &&
          (entry.name.endsWith('.yaml') || entry.name.endsWith('.yml'))
        ) {
          try {
            const content = await fs.readFile(fullPath, 'utf8');
            const manifest = ManifestParser.parse(content);
            await this.register(manifest);
            count++;
          } catch (err: any) {
            this.observability?.log({
              level: 'warn',
              module: 'skills',
              message: `Failed to load skill manifest from ${fullPath}: ${err.message}`,
            });
          }
        }
      }
    } catch {
      // Directory may not exist yet
    }
    return count;
  }

  private detectCompositionCycle(newSkill: SkillManifest): void {
    // Build adjacency of sub_skill references
    const subSkills: string[] = [];
    for (const step of newSkill.steps) {
      if (step.action.type === 'sub_skill') {
        if (step.action.skillId === newSkill.id) {
          throw new SkillError(
            'FC_SKILL_CYCLE_DETECTED',
            `Skill ${newSkill.id} directly references itself as a sub_skill`
          );
        }
        subSkills.push(step.action.skillId);
      }
    }

    // DFS for transitive cycle
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    recursionStack.add(newSkill.id);

    const checkCycle = (currSkillId: string) => {
      if (recursionStack.has(currSkillId)) {
        throw new SkillError(
          'FC_SKILL_CYCLE_DETECTED',
          `Cycle detected in skill composition involving "${currSkillId}"`
        );
      }
      if (visited.has(currSkillId)) return;

      visited.add(currSkillId);
      recursionStack.add(currSkillId);

      const s = this.skills.get(currSkillId);
      if (s) {
        for (const step of s.steps) {
          if (step.action.type === 'sub_skill') {
            checkCycle(step.action.skillId);
          }
        }
      }

      recursionStack.delete(currSkillId);
    };

    for (const subId of subSkills) {
      checkCycle(subId);
    }
  }
}
