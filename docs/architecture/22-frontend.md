# §22 — Frontend Architecture

## 22.1 Purpose

FuckClaw is a headless cognitive runtime (the Agent Kernel), but it requires interfaces for human interaction. The Frontend Architecture defines how the operator interacts with the agent across different modalities: CLI, Terminal UI (TUI), Web Dashboard, and Desktop App.

## 22.2 Design Philosophy

1. **API-First**: All frontends communicate with the core via the Networking Layer (§21). The core does not contain UI logic.
2. **Multi-Modal**: The operator can switch seamlessly between the CLI (for rapid terminal tasks) and the Web/Desktop UI (for complex visualization and configuration).
3. **Real-time**: All frontends reflect the agent's current state instantly via WebSockets/SSE.

## 22.3 CLI & Terminal UI (TUI)

The primary interface for developers, running in the terminal.

- **Technology**: Built using `commander` for argument parsing and `ink` (React for the terminal) for the interactive TUI.
- **Capabilities**:
  - `fuckclaw ask "deploy the app"`: Rapid one-off task execution
  - `fuckclaw chat`: Interactive conversational mode
  - `fuckclaw status`: View active tasks and system health
  - `fuckclaw config`: Manage configuration and profiles

### 22.3.1 TUI Components

The TUI provides rich, interactive components:

- **Reasoning Trace Viewer**: Expandable tree view of the agent's thought process
- **Log Streamer**: Live tailing of tool execution stdout/stderr
- **Approval Prompts**: (If configured) Interactive yes/no prompts for high-risk actions
- **Progress Bars**: Real-time progress for multi-step plans

## 22.4 Web Dashboard

A comprehensive visual interface for managing the agent.

- **Technology**: Built with Next.js (or SvelteKit) and Tailwind CSS.
- **Delivery**: Served directly by the FuckClaw API Gateway (Hono). No external web server required.

### 22.4.1 Dashboard Views

| View | Purpose |
|---|---|
| **Overview** | Active tasks, recent notifications, system health metrics |
| **Tasks** | Detailed view of task plans, reasoning traces, and artifact outputs |
| **Memory Browser** | Search and visualize Episodic and Semantic memory |
| **Knowledge Graph** | Interactive node-edge visualization of the entity graph (D3.js) |
| **Skills** | View, edit, and create skills; browse the marketplace |
| **Configuration** | UI for editing `fuckclaw.toml` and managing secrets |

## 22.5 Desktop App (Tauri)

The Desktop App wraps the Web Dashboard into a native application with deeper OS integration.

- **Technology**: Tauri (Rust backend, web frontend). chosen over Electron for its dramatically smaller footprint and lower memory usage.
- **Capabilities**:
  - **Global Hotkey**: Press a shortcut (e.g., `Cmd+Space`) to summon a Spotlight-like quick entry bar for the agent
  - **Filesystem Access**: Native file dialogs for passing files to the agent
  - **System Tray**: Background status indicator and quick actions
  - **Notifications**: Native OS notifications when long-running tasks complete

## 22.6 Voice Interface (Experimental)

A voice-driven interface for hands-free interaction.

- **Architecture**: Audio capture $\to$ Local/Cloud Whisper (STT) $\to$ FuckClaw API $\to$ Text Response $\to$ Local/Cloud TTS $\to$ Audio playback.
- **Use Case**: "FuckClaw, summarize the PR I just opened while I get coffee."

## 22.7 Interfaces (Frontend to Backend)

Frontends use a unified SDK client to interact with the backend:

```typescript
export class FuckClawClient {
  constructor(baseUrl: string, apiKey?: string);
  
  // REST operations
  async submitTask(task: TaskRequest): Promise<Task>;
  async getTask(taskId: string): Promise<Task>;
  
  // Real-time operations
  connect(): void;
  onStream(taskId: string, callback: (chunk: StreamChunk) => void): () => void;
  onEvent(eventType: string, callback: (event: SystemEvent) => void): () => void;
}
```

## 22.8 Failure Modes

| Failure | Impact | Mitigation |
|---|---|---|
| Core API is down | Frontends cannot connect | Clear offline UI state; automatic reconnection polling |
| WebSocket disconnects | Live updates freeze | Fallback to HTTP polling (REST API); display "Reconnecting..." indicator |
| CLI rendering garbled | Unusable terminal | Fallback to raw text output if terminal does not support advanced ANSI codes |

## 22.9 Future Improvements

1. **IDE Extensions**: VSCode/JetBrains extensions that embed FuckClaw directly in the editor (similar to Cursor, but backed by the persistent autonomous kernel)
2. **Mobile App**: A companion app for iOS/Android to monitor long-running tasks or capture quick voice notes into the agent's memory
3. **TUI Themes**: Customizable color schemes and layouts for the terminal interface