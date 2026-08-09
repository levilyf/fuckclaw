import { existsSync, readFileSync } from 'node:fs';
import { parse as parseToml } from 'smol-toml';

/**
 * File loader boundary defined by §19.2.
 * Reads and parses TOML/JSON config files from filesystem paths.
 */
export function loadConfigFile(filePath: string): Record<string, unknown> {
  if (!existsSync(filePath)) {
    return {};
  }
  try {
    const raw = readFileSync(filePath, 'utf-8');
    if (filePath.endsWith('.json')) {
      return JSON.parse(raw) as Record<string, unknown>;
    }
    // Default to TOML or try JSON fallback
    try {
      const parsed = parseToml(raw);
      return parsed as Record<string, unknown>;
    } catch (e: any) {
      console.error(`TOML Parse Error in ${filePath}:`, e);
      return JSON.parse(raw) as Record<string, unknown>;
    }
  } catch {
    return {};
  }
}
