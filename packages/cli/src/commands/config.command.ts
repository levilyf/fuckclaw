import { FuckClawRuntimeInstance } from '../index.js';
import { ANSI } from '../tui/banner.js';

export async function executeConfigCommand(
  runtime: FuckClawRuntimeInstance,
  key?: string,
  val?: string
): Promise<void> {
  const currentConfig = runtime.config.get();

  if (!key) {
    console.log(`\n${ANSI.bold}${ANSI.cyan}Current FuckClaw Configuration:${ANSI.reset}`);
    console.log(JSON.stringify(currentConfig, null, 2));
    console.log();
    return;
  }

  if (val === undefined) {
    const value = (currentConfig as any)[key];
    console.log(`${key} = ${JSON.stringify(value)}`);
  } else {
    try {
      const parsedVal = JSON.parse(val);
      await runtime.config.update(key, parsedVal);
    } catch {
      await runtime.config.update(key, val);
    }
    console.log(`${ANSI.green}✓ Updated configuration key "${key}"${ANSI.reset}`);
  }
}
