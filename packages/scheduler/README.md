# @fuckclaw/scheduler

The `@fuckclaw/scheduler` package manages time-based and event-based autonomous execution.

## What it does
It allows FuckClaw to wake up and perform tasks proactively, without a human having to manually type `fuckclaw run` in the terminal.

## Intended Audience
- **Automation Engineers & Power Users**: If you want FuckClaw to act as a background assistant that continuously monitors your workspace, cleans up logs, or runs periodic maintenance, you will register jobs with the scheduler.

## Key Behaviors
- **Cron Jobs**: Run agent workflows on a recurring schedule (e.g., "Review my git diffs and summarize them every Friday at 5 PM").
- **Filesystem Watchers**: Trigger tasks automatically when specific files change (e.g., "Run tests whenever a `.ts` file is saved in `/src`").
- **Webhooks**: Trigger agent workflows via incoming HTTP requests, allowing easy integration with external CI/CD pipelines (like GitHub Actions).

## How it fits into FuckClaw
**Depends on:** `@fuckclaw/kernel` (to submit tasks), `@fuckclaw/network` (for webhook routes).
**Used by:** `@fuckclaw/cli` (The scheduler starts automatically when you run `fuckclaw serve`).

## Status
🟢 **Core**
Cron parsing, file watchers, and webhooks are implemented.
*Limitations:* Distributed cron locking (ensuring a cron job only fires once across multiple machines) is not supported in the local-first architecture. If you run multiple daemons, they will all fire the cron job.
