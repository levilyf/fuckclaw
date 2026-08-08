/**
 * Environment variable loader boundary defined by IMPLEMENTATION-SPEC §4.1.
 * Resolves FUCKCLAW_* env vars into config overrides.
 */
export function loadEnvOverrides(): Record<string, unknown> {
  const overrides: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('FUCKCLAW_') && value !== undefined) {
      const configPath = key.slice('FUCKCLAW_'.length).toLowerCase().replace(/_/g, '.');
      overrides[configPath] = value;
    }
  }
  return overrides;
}
