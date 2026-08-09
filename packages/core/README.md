# @fuckclaw/core

The `@fuckclaw/core` package provides the foundational building blocks, shared TypeScript interfaces, and domain-agnostic utilities used by every other package in the FuckClaw monorepo.

## What it does
It ensures consistency across the framework by centralizing error definitions and common types. It prevents circular dependencies by providing a neutral ground where two different packages (e.g., `kernel` and `tool-runtime`) can share a common interface without importing each other directly.

## Intended Audience
- **Contributors & Plugin Authors**: If you are writing a custom plugin or extending the core runtime, you will import your base classes and error types from here.
- **End Users**: You will never interact with this package directly.

## Typical Usage
This package exposes critical, standardized errors that the framework catches to decide whether a task is retryable or fatal:

```typescript
import { FuckClawError, ConfigurationError, ToolExecutionError } from '@fuckclaw/core';

if (!apiKey) {
  throw new ConfigurationError('API key is missing');
}
```

## How it fits into FuckClaw
**Depends on:** Nothing (No external business logic dependencies).
**Used by:** Everything. Every package in the monorepo imports `@fuckclaw/core`.

## Status
🟢 **Core**
Fully implemented. This package intentionally contains no business logic.
