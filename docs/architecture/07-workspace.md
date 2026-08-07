# §7 — Workspace

## 7.1 Purpose

The Workspace is the agent's persistent filesystem home — analogous to a user's home directory in an operating system (`~/.fuckclaw/`). 

In traditional AI implementations (like ChatGPT or Claude.ai), the agent is an ethereal entity floating in a web browser; its only state is the current conversation thread. In IDE-based AI (like Cursor), the agent's state is bound to the human's current Git repository. 

FuckClaw rejects both models. The agent is a persistent, independent digital entity. It requires its own physical disk space to manage its internal state, store its databases, maintain independent cross-project knowledge, write logs, cache LLM responses, and store autonomous artifacts. 

The Workspace guarantees that the agent has a secure, predictable, and fully-owned local environment to execute its cognitive loop without constantly colliding with the human operator's ad-hoc file management.

## 7.2 Filesystem Layout

The Workspace is rigorously structured. It must never be polluted with random files.

```text
~/.fuckclaw/
├── data/                    # Primary Persistence Layer (§20)
│   ├── fuckclaw.db          # Main relational SQLite database (Memory, Kernel, Config)
│   ├── fuckclaw.db-wal      # Write-Ahead Log
│   └── vectors.db           # sqlite-vec database for embeddings
│
├── workspace/               # Active managed files
│   ├── projects/            # Agent-managed git repositories and codebases
│   ├── knowledge/           # Markdown/MDX knowledge base (Semantic Memory backup)
│   ├── artifacts/           # Generated outputs (documents, compiled binaries, plots)
│   └── scratch/             # Ephemeral working directory for current tasks
│
├── config/                  # Configuration Layer (§19)
│   ├── fuckclaw.toml        # Global configuration
│   ├── profiles/            # Profile-specific configurations
│   └── env.json             # Encrypted secrets and API keys
│
├── logs/                    # Observability (§18)
│   ├── system.log           # Kernel and routing logs
│   ├── traces/              # JSONL files of full reasoning traces
│   └── audit/               # Security and tool execution audit logs
│
├── cache/                   # Performance Optimization
│   ├── llm_cache/           # Content-addressable hash map of LLM responses
│   └── embedding_cache/     # Cache of text -> vector mappings
│
├── plugins/                 # Extensibility (§16)
│   ├── enabled/             # Symlinks to active plugins
│   └── registry/            # Downloaded plugin bundles
│
├── skills/                  # Skill Engine (§10)
│   └── extracted/           # Autonomously generated YAML/JSON skill manifests
│
└── snapshots/               # System Resilience
    └── daily/               # ZSTD compressed tarballs of data/ and config/
```

## 7.3 Core Sub-Directories

### 7.3.1 `data/` (Databases)
Houses the core SQLite databases. The agent requires read/write locks here. Modifying these files externally while the agent is running will cause database corruption. Backups are performed via SQLite's Online Backup API, never by raw file copying.

### 7.3.2 `workspace/projects/` (Managed Projects)
When the operator asks FuckClaw to "create a new React app for managing finances," the agent initializes it here. These are full Git repositories. The agent can also clone the operator's existing repositories here to perform background analysis without interfering with the operator's active IDE state.

### 7.3.3 `workspace/knowledge/` (Knowledge Base)
While Semantic Memory (§6) stores facts in SQLite, the agent mirrors complex, hierarchical knowledge into human-readable Markdown files here. This provides dual-utility: the agent can read/write structured Markdown via standard file tools, and the human operator can open `~/.fuckclaw/workspace/knowledge/` in Obsidian to directly browse the agent's brain.

### 7.3.4 `workspace/scratch/` (Temporary State)
Used for ephemeral operations: downloading a zip file, compiling a C binary to test it, or staging a complex git patch. 
**Lifecycle**: The `scratch/` directory is aggressively purged. It is cleared on Kernel boot and emptied 24 hours after task completion.

### 7.3.5 `cache/` (Caches)
Stores deterministic LLM and embedding responses to save API costs and reduce latency.
- **Eviction Policy**: LRU (Least Recently Used), hard-capped at 5GB.
- **Invalidation**: Hashed by `sha256(provider + model + temperature + prompt)`. Any variation results in a cache miss.

## 7.4 Artifact Management

Artifacts are finalized outputs produced by the agent that the operator might want to keep or share.

```typescript
interface ArtifactMetadata {
  id: string; // e.g., "art_01HQ..."
  taskId: string; // The task that generated it
  filename: string;
  mimeType: string;
  createdAt: number;
  sizeBytes: number;
  description: string;
  hash: string; // sha256 of contents
}
```

Artifacts are immutable. If the agent needs to update an artifact, it creates a new version (`report-v2.pdf`) and updates the internal registry.

## 7.5 Project Management & Indexing

A "Project" in FuckClaw is a recognized directory boundary with associated metadata, allowing the agent to maintain context scopes.

```typescript
interface ProjectManifest {
  id: string;
  name: string;
  path: string; // Absolute path (can be inside ~/.fuckclaw/ or elsewhere on the host)
  type: 'git' | 'local_dir';
  languagePrimary: string;
  frameworks: string[];
  watchEnabled: boolean; // Should the agent monitor file changes in the background?
  lastIndexedAt: number;
  // Commands the agent has learned to build/test this specific project
  toolchains: {
    build: string;
    test: string;
    lint: string;
  };
}
```

### File Watching Integration
If `watchEnabled` is true, the kernel spawns an OS-level file watcher (using `chokidar` or native `fsevents`). When files change, an event is emitted to the Event Bus (§14): `workspace.file.changed`. 
This allows the agent to proactively review code the human is writing in real-time, or automatically trigger test runs without being asked.

## 7.6 Snapshots & Rollback

Because FuckClaw operates with full autonomy, it requires a "save state" mechanism to undo catastrophic mistakes (e.g., the agent accidentally deletes its own database, or a corrupted update ruins its memory).

### Mechanism
1. **Daily Cron**: The Scheduler (§13) triggers a snapshot at 03:00 AM local time.
2. **Pre-Task Checkpoint**: Before executing high-risk tool chains (e.g., raw bash commands with `rm -rf`), the Planner triggers an incremental snapshot.

Snapshots compress the `data/`, `config/`, and `skills/` directories. They do *not* backup `projects/` or `cache/` to save disk space.

```bash
# Example restoration command available to the operator
fuckclaw workspace restore --snapshot daily-20231024.tar.zst
```

## 7.7 Interfaces

```typescript
export interface IWorkspaceManager {
  readonly rootPath: string;
  
  // File operations (Sandboxed to workspace root unless explicitly bypassed)
  read(relativePath: string): Promise<Buffer>;
  write(relativePath: string, data: Buffer | string): Promise<void>;
  delete(relativePath: string): Promise<void>;
  
  // Project Management
  registerProject(absolutePath: string, name: string): Promise<ProjectManifest>;
  listProjects(): Promise<ProjectManifest[]>;
  
  // Artifacts
  saveArtifact(taskId: string, filename: string, buffer: Buffer, description: string): Promise<ArtifactMetadata>;
  
  // Snapshots
  createSnapshot(label: string): Promise<string>;
  rollbackToSnapshot(snapshotId: string): Promise<void>;
  
  // Cleanup
  purgeScratch(): Promise<number>; // Returns bytes freed
}
```

## 7.8 Failure Modes

| Failure Mode | Impact | Mitigation |
|---|---|---|
| Disk Exhaustion | System crash, SQLite corruption | Quota monitoring daemon; auto-purges cache/logs at 90% disk usage. |
| Permission Denied | Agent cannot read/write workspace | Startup verification script checks `uid/gid` ownership of `~/.fuckclaw`. |
| Concurrent SQLite Writes | Database lock wait timeout | Strict single-writer connection pool enforced by the Kernel. |
| Infinite Loop in Scratch | Runaway script fills scratch space | Hard disk quota (`ulimit` or equivalent) on tool child processes. |

## 7.9 Future Improvements

1. **Git-Backed Data Directory**: Instead of opaque SQLite binary snapshots, periodically export Memory and DB state to human-readable JSON/Markdown and commit to a local hidden Git repo for granular, diffable history.
2. **Cloud Sync**: Optional end-to-end encrypted synchronization of the Workspace to an S3 bucket to share one FuckClaw identity across multiple operator machines (e.g., Desktop and Laptop).
3. **FUSE Mounts**: Mount the internal Memory/Knowledge graph as a virtual FUSE filesystem, allowing the operator to navigate the agent's brain using `ls` and `cat`.