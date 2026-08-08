import { ANSI } from './banner.js';

export interface StatusBarInfo {
  kernelState: string;
  activeTasks: number;
  toolCount: number;
  memoryItems?: number;
  uptimeSeconds: number;
}

export function renderStatusBar(info: StatusBarInfo): string {
  const stateColor =
    info.kernelState === 'idle'
      ? ANSI.green
      : info.kernelState === 'processing'
        ? ANSI.yellow
        : ANSI.cyan;

  const parts = [
    `[ State: ${stateColor}${info.kernelState.toUpperCase()}${ANSI.reset} ]`,
    `[ Tasks: ${ANSI.bold}${info.activeTasks}${ANSI.reset} ]`,
    `[ Tools: ${ANSI.bold}${info.toolCount}${ANSI.reset} ]`,
    info.memoryItems !== undefined ? `[ Memory: ${ANSI.bold}${info.memoryItems}${ANSI.reset} ]` : '',
    `[ Uptime: ${info.uptimeSeconds}s ]`,
  ].filter(Boolean);

  return `${ANSI.dim}─────────────────────────────────────────────────────────────────────────────${ANSI.reset}\n${parts.join('  ')}\n${ANSI.dim}─────────────────────────────────────────────────────────────────────────────${ANSI.reset}`;
}
