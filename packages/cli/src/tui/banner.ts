export const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
  bgCyan: '\x1b[46m',
  bgDarkGray: '\x1b[100m',
};

export function renderBanner(): string {
  const lines = [
    `${ANSI.cyan}${ANSI.bold}  ███████╗██╗   ██╗ ██████╗██╗  ██╗ ██████╗██╗      █████╗ ██╗    ██╗`,
    `  ██╔════╝██║   ██║██╔════╝██║ ██╔╝██╔════╝██║     ██╔══██╗██║    ██║`,
    `  █████╗  ██║   ██║██║     █████═╝ ██║     ██║     ███████║██║ █╗ ██║`,
    `  ██╔══╝  ██║   ██║██║     ██╔═██╗ ██║     ██║     ██╔══██║██║███╗██║`,
    `  ██║     ╚██████╔╝╚██████╗██║ ╚██╗╚██████╗███████╗██║  ██║╚███╔███╔╝`,
    `  ╚═╝      ╚═════╝  ╚═════╝╚═╝  ╚═╝ ╚═════╝╚══════╝╚═╝  ╚═╝ ╚══╝╚══╝ ${ANSI.reset}`,
    `  ${ANSI.dim}FuckClaw Autonomous Sovereign Intelligence Engine v1.0.0${ANSI.reset}`,
    `  ${ANSI.yellow}Type ${ANSI.bold}/help${ANSI.reset}${ANSI.yellow} for available commands or submit any prompt directly.${ANSI.reset}\n`,
  ];
  return lines.join('\n');
}
