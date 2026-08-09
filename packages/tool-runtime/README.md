# @fuckclaw/tool-runtime

The `@fuckclaw/tool-runtime` package provides the sandboxed environment where the LLM's abstract JSON commands are translated into actual, native impact on your machine.

## What it does
It enforces timeouts, validates arguments against Zod schemas, categorizes errors, and ensures the agent cannot run indefinitely or break out of its permissions. 

## Intended Audience
- **Security Auditors & All Users**: You care about the Tool Runtime to understand *what* FuckClaw can actually do to your system and *how* it is restricted.

## Key Native Tools
- **Shell (`ShellTool`)**: Executes native bash/sh commands. Safely captures `stdout` and `stderr` and includes strict timeout protections (default 60s) to kill hanging processes.
- **Filesystem (`FilesystemTool`)**: Operations (`read`, `write`, `delete`, `mkdir`, `list`, `search`). Strict path validation ensures the agent only operates within allowed directories.
- **Python (`PythonTool`)**: Sandboxed execution of Python scripts via the host's `python3` subprocess.
- **Docker (`DockerTool`)**: Manages containers via the host's Docker CLI (`run`, `exec`, `build`, `logs`, `stop`).
- **Git (`GitTool`)**: Safely executes repository operations (`commit`, `diff`, `branch`, `clone`, `status`).
- **HTTP (`HttpTool`)**: Makes web requests (`GET`, `POST`, etc.) to external APIs with configurable headers and timeouts.

## How it fits into FuckClaw
**Depends on:** `@fuckclaw/workspace` (for path confinement rules).
**Used by:** `@fuckclaw/reasoning`, `@fuckclaw/skills`.

## Status & Caveats
🟢 **Core**
All native tools listed above are fully implemented and integrated.
*Crucial Caveat:* **Host Dependencies.** These tools run on the host machine using the host's binaries. To use the Python tool, you must have `python3` installed. To use Docker, the `docker` daemon must be running. 
*Security Caveat:* The framework relies on path confinement and process timeouts, but strict containerized isolation (running the entire agent in a locked-down VM) is not handled by this package. If executing completely untrusted code, run FuckClaw itself inside a VM or container.
