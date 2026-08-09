# @fuckclaw/observability

The `@fuckclaw/observability` package provides visibility into what the AI is thinking, doing, and spending.

## What it does
It handles structured logging, distributed tracing, metrics collection, and features a powerful deterministic Trace Replay engine for debugging AI behaviors.

## Intended Audience
- **Power Users & Developers**: If an agent fails in a confusing way, or if you want to test whether a new System Prompt improves behavior without breaking past workflows, you use the Trace Replay engine to step through the historical reasoning process.

## Key Behaviors
- **Structured Logging**: Emits JSON-formatted logs for machine ingestion and colorized output for the terminal UI.
- **Metrics Registry**: Tracks system health, including token usage, API latency, tool execution times, and success rates.
- **Trace Replay Engine**: A unique diagnostic tool. It can load a recorded execution trace (what the agent saw and did) and "replay" it deterministically step-by-step. It compares expected actions against actual actions to detect if the LLM's reasoning diverges.

## How it fits into FuckClaw
**Depends on:** Nothing (No business logic dependencies).
**Used by:** Everything. Every package imports the Logger and Tracer. It subscribes to the `@fuckclaw/event-bus` to aggregate system-wide metrics.

## Status
🟢 **Core**
Logging, tracing, metrics, and trace replay are fully implemented.
*Limitations:* Metrics and traces are stored locally. Exporting telemetry to external SaaS providers (like Datadog or Honeycomb) requires configuring custom external sinks.
