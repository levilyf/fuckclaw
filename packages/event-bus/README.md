# @fuckclaw/event-bus

The `@fuckclaw/event-bus` package is the asynchronous nervous system of FuckClaw. It allows the monorepo's decoupled subsystems to broadcast and react to events without direct coupling.

## What it does
It provides a Publish/Subscribe (PubSub) mechanism with topic matching and priority queuing. When an agent completes a task, the Kernel publishes a `kernel.task.completed` event. The Event Bus delivers this event to subscribers, such as the Self-Improvement engine (which analyzes it for failures) or the Observability engine (which logs the metrics).

## Intended Audience
- **Contributors & Plugin Developers**: You will subscribe to the event bus if you are writing an extension that needs to react when a file is written (`tool.filesystem.write`) or a task fails.
- **End Users**: You do not interact with this package directly, though you benefit from the decoupling it provides.

## Key Behaviors
- **Pattern Matching**: Listeners can use wildcards (e.g., `tool.*`).
- **Dead Letter Queue (DLQ)**: If a subscriber crashes repeatedly while processing an event, the event is parked in the DLQ to prevent infinite crash loops.
- **Event Journaling**: Crucial events are persisted to SQLite so the daemon can recover state if it crashes mid-execution.

## How it fits into FuckClaw
**Depends on:** `@fuckclaw/persistence` (for the SQLite journal).
**Used by:** `@fuckclaw/kernel`, `@fuckclaw/self-improvement`, `@fuckclaw/observability`, `@fuckclaw/network`.

## Status
🟢 **Core**
In-memory PubSub and SQLite journaling are fully functional.
*Deferred:* Distributed transport layers (like Redis or Kafka) for multi-node deployments are explicitly deferred to maintain a local-first footprint.
