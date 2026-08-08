import { existsSync, readFileSync } from 'node:fs';

/**
 * File loader boundary defined by IMPLEMENTATION-SPEC §4.1.
 * Reads TOML/JSON config files from filesystem paths.
 */
export function loadConfigFile(filePath: string): Record<string, unknown> {
  if (!existsSync(filePath)) {
    return {};
  }
  const raw = readFileSync(filePath, 'utf-8');
  // Simple JSON parse; TOML parsing deferred to when toml dependency is added
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}
