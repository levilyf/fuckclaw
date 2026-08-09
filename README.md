# FuckClaw 🦞

**A local-first, autonomous AI agent framework designed to safely execute complex workspace tasks.**

FuckClaw is an open-source framework that turns Large Language Models into capable, autonomous agents. It does not just chat with you; it actively plans, writes code, executes shell commands, learns from failures, and manages its own token budgets.

**Why FuckClaw?** Most agent scripts are fragile loops that get stuck repeating the same error or hallucinate destructive commands. FuckClaw fixes this by introducing **Memory** and **Self-Improvement**. If it fails, it extracts an "anti-pattern" and never makes the same mistake again. Before it edits files, it takes a highly compressed snapshot of your workspace so you can instantly roll back if the AI corrupts your data.

## What can I do with it?

FuckClaw runs entirely locally. You provide an API key (Anthropic or Google) and the framework handles the orchestration.

**Realistic Workflows:**
- **Automated Refactoring:** `fuckclaw run "Refactor the src/auth module to use bcrypt instead of plain text, and update all tests."` The AI will read the files, write the code, run the tests, and fix errors until the tests pass.
- **System Automation:** `fuckclaw run "Scan my git repo, find all unused node_modules, and delete them."`
- **Interactive Assistance:** `fuckclaw ask "Why is Docker failing to build my container?"` The AI will execute shell commands to read your Docker logs and explain the issue.
- **Agent Monitoring:** `fuckclaw serve` boots a background daemon and HTTP Web Dashboard so you can watch the agent's internal reasoning (Thoughts, Actions, Observations) in real-time.

---

## Quick Start

The framework requires **Node.js (v18+)** and **pnpm (v9+)**.
For workspace snapshots, your host machine must have `tar` and `zstd` installed.

**1. Clone and Install**
```bash
git clone https://github.com/your-org/fuckclaw.git
cd fuckclaw

# Install dependencies and compile all 22 monorepo packages
pnpm install
pnpm build

# Link the CLI binary globally
cd packages/cli
pnpm link --global
```

**2. Configure your LLM Provider**
FuckClaw stores configuration locally and encrypts sensitive keys.
```bash
# Add your API key
fuckclaw config set providers.anthropic.apiKey "sk-ant-..."

# (Optional) Set a hard spending limit per task to prevent runaway costs
fuckclaw config set budget.defaultTaskLimitUsd 1.50
```

**3. Execute your first task**
```bash
# Run an autonomous task
fuckclaw run "List all files in the current directory and write the summary to files.txt"
```

---

## CLI Reference

The CLI is powered by `@fuckclaw/cli` and acts as the entry point to the system.

| Command | Purpose | Example |
|---|---|---|
| `fuckclaw run <goal>` | Headless, autonomous execution of a complex multi-step task. Uses the Planner to build a dependency graph (DAG) before executing. | `fuckclaw run "Fix the failing tests in persistence.test.ts"` |
| `fuckclaw ask <prompt>` | Fast, single-turn execution. Best for queries or simple tool calls where deep planning is overkill. | `fuckclaw ask "What branch am I on?"` |
| `fuckclaw serve` | Boots the HTTP server (default port 8420), WebSocket gateway, and the Web Dashboard. | `fuckclaw serve --port 3000` |
| `fuckclaw status` | Pings the local daemon to report active tasks and agent health. | `fuckclaw status` |
| `fuckclaw config` | View or modify local configuration. Keys are stored in `~/.fuckclaw/fuckclaw.toml`. | `fuckclaw config set system.logLevel "debug"` |
| `fuckclaw mcp` | Manage external Model Context Protocol integrations. | `fuckclaw mcp list` |

---

## Configuration

Configuration is managed by `@fuckclaw/config`. It merges environment variables, global `~/.fuckclaw/fuckclaw.toml` files, and local `.fuckclaw.toml` files.

### Important Configuration Keys

| Key | Description | Default |
|---|---|---|
| `providers.<name>.apiKey` | Encrypted API key for the LLM. | `undefined` |
| `providers.<name>.model` | The specific model to use (e.g., `claude-3-5-sonnet-20241022`). | `default-model` |
| `budget.defaultTaskLimitUsd`| The hard spending limit per task. The LLM Router tracks tokens and costs; if the agent exceeds this, the task is killed. | `$1.00` |
| `system.logLevel` | Console output verbosity (`info`, `debug`, `warn`). | `info` |
| `workspace.root` | The directory where FuckClaw stores memory, events, and snapshots. | `~/.fuckclaw` |

*Note: Environment variables override TOML files. For example, `FUCKCLAW_LLM_API_KEY` will override the stored configuration.*

---

## How it works (User Perspective)

When you type `fuckclaw run "Do X"`, a massive amount of orchestration happens locally:

1. **Kernel (`@fuckclaw/kernel`)**: Accepts the task, locks concurrent resources, and creates a token budget.
2. **Planner (`@fuckclaw/planner`)**: Asks the LLM to break "Do X" into a logical sequence (e.g., Step 1: Read files. Step 2: Write code. Step 3: Test).
3. **Reasoning (`@fuckclaw/reasoning`)**: Takes a step and enters a "ReAct" loop (Observe → Think → Act). It outputs JSON asking to run a specific tool.
4. **Tool Runtime (`@fuckclaw/tool-runtime`)**: Validates the JSON. If the AI asked for `shell` with `command: "npm install"`, this package spawns a native subprocess, captures the output, and returns it to the AI.
5. **Self-Improvement (`@fuckclaw/self-improvement`)**: If the native subprocess fails 3 times, this package intercepts the trace. It extracts the error (e.g., "Missing package.json"), writes an "anti-pattern", and injects it into the AI's prompt for the next try so it stops looping.

---

## Status & Known Limitations

FuckClaw is a Beta project. We are honest about what works and what is deferred.

### 🟢 Supported (Core Features)
- **Local SQLite Persistence**: All episodic memory, anti-patterns, and event journals use SQLite WAL + FTS5. Your data never leaves your machine.
- **Native Tools**: `shell`, `filesystem`, `python` (requires `python3` on host), `docker`, and `git` are fully wired up.
- **Anthropic & Google Routing**: The `@fuckclaw/llm-router` natively tracks usage and caching for Claude and Gemini APIs.

### 🟡 Partial / Experimental
- **Knowledge Graph**: The backend (`@fuckclaw/knowledge-graph`) extracts dependencies into SQLite, but advanced visual querying is experimental.
- **Plugins**: `@fuckclaw/plugins` supports loading local JS modules, but lacks strict V8 isolate sandboxing. Only run trusted plugins.

### ⚪ Deferred
- **PostgreSQL**: Distributed database scale-out is deferred. The system intentionally relies on local SQLite.
- **Redis / Kafka**: Distributed event bus transports are deferred. The system uses in-memory PubSub with SQLite journaling.

---

## Security & Trust Model

Giving an LLM access to your shell and filesystem is dangerous. 
FuckClaw mitigates this through:

- **Workspace Boundaries**: `filesystem` operations enforce strict path resolution. The agent cannot use `../../` to escape the workspace root.
- **Subprocess Timeouts**: The `shell` and `python` tools wrap execution in strict timeouts (default 60s) to prevent the AI from spawning infinite loops.
- **Snapshots**: The `@fuckclaw/workspace` archiver takes `.tar.zst` backups of the target directory before complex task execution.
- **API Keys**: Stored in a local AES-256-GCM encrypted keystore, never in plaintext.

## Demos

You can verify the architecture by running the built-in demo scripts.
```bash
# Demonstrates multi-agent delegation (Supervisor routing to Coder and Reviewer)
pnpm run demo:multi-agent

# Demonstrates the failure analysis engine learning a negative constraint
pnpm run demo:self-improvement

# Complete architectural end-to-end integration test
pnpm run demo:e2e
```

## Contributing
1. Clone the repo.
2. `pnpm install`
3. Check `package.json` for the monorepo structure.
4. Run tests via `pnpm test` (Runs Vitest concurrently across the workspace).
5. All new features must adhere to the modular boundaries in `docs/architecture`.

## License
MIT License.
