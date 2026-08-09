# @fuckclaw/skills

The `@fuckclaw/skills` package provides a standardized, declarative format for saving, executing, and evolving repeatable workflows.

## What it does
If you teach the agent how to deploy your app to Vercel, you don't want it to waste tokens guessing the steps from scratch every single time. Skills package these workflows into deterministic manifests that the agent can execute directly.

## Intended Audience
- **Advanced Users & Team Leads**: You care about this package when you want to extend FuckClaw's capabilities reliably. You can write custom skill manifests (YAML/JSON) for your company's specific workflows, and the agent will load and execute them consistently.

## Key Behaviors
- **Manifest Parsing**: Reads, validates, and loads skill definitions from the filesystem.
- **Skill Execution**: Runs the steps defined in a skill deterministically, bypassing the LLM's standard reasoning loop.
- **Skill Refinement**: Analyzes failure history to automatically mutate step execution policies (e.g., changing `abort` to `retry` if a step frequently flakes) or optimize prompt augmentations. It automatically bumps the semantic version of a skill (e.g., `1.0.0` -> `1.0.1`) when it makes refinements.

## How it fits into FuckClaw
**Depends on:** `@fuckclaw/tool-runtime` (to execute the steps).
**Used by:** `@fuckclaw/reasoning`. Skills act as higher-level, composite tools exposed to the Reasoning engine.

## Status
🟢 **Core**
Manifest parsing, execution, and automatic refinement are fully implemented.
*Limitations:* Skill manifests must conform strictly to the internal JSON schema. Complex conditional branching within a deterministic skill is limited; heavily branched logic should be handled by standard agent reasoning instead.
