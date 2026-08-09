import { Migration } from '../../types.js';

export const standardMigrations: Migration[] = [
  // Migration 1: Events Schema (§14.6)
  {
    version: 1,
    name: 'create_events_schema',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS events (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          payload TEXT NOT NULL,
          source TEXT NOT NULL DEFAULT 'system',
          correlation_id TEXT,
          causation_id TEXT,
          priority INTEGER NOT NULL DEFAULT 20,
          timestamp TEXT NOT NULL
        );
      `);

      // Safe column migration for pre-existing tables
      const cols = db.prepare("PRAGMA table_info(events)").all() as Array<{ name: string }>;
      const colNames = new Set(cols.map((c) => c.name));
      if (!colNames.has('source')) {
        db.exec("ALTER TABLE events ADD COLUMN source TEXT NOT NULL DEFAULT 'system'");
      }
      if (!colNames.has('correlation_id')) {
        db.exec("ALTER TABLE events ADD COLUMN correlation_id TEXT");
      }
      if (!colNames.has('causation_id')) {
        db.exec("ALTER TABLE events ADD COLUMN causation_id TEXT");
      }
      if (!colNames.has('priority')) {
        db.exec("ALTER TABLE events ADD COLUMN priority INTEGER NOT NULL DEFAULT 20");
      }

      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_events_type ON events(type, timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_events_correlation ON events(correlation_id);
        CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp DESC);
      `);
    },
  },

  // Migration 2: Tasks & Checkpoints Schema (§4.5, §4.6)
  {
    version: 2,
    name: 'create_tasks_and_checkpoints_schema',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS tasks (
          id TEXT PRIMARY KEY,
          description TEXT NOT NULL,
          source_json TEXT NOT NULL,
          priority INTEGER NOT NULL DEFAULT 10,
          state TEXT NOT NULL,
          parent_id TEXT,
          budget_json TEXT NOT NULL,
          output TEXT,
          error_json TEXT,
          tags_json TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          started_at INTEGER,
          completed_at INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_tasks_state ON tasks(state, priority DESC);

        CREATE TABLE IF NOT EXISTS task_steps (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL,
          step_number INTEGER NOT NULL,
          thought TEXT,
          action TEXT,
          observation_json TEXT,
          success INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_task_steps_task ON task_steps(task_id, step_number);

        CREATE TABLE IF NOT EXISTS checkpoints (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL,
          state TEXT NOT NULL,
          snapshot_json TEXT NOT NULL,
          hash TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_checkpoints_task ON checkpoints(task_id, created_at DESC);
      `);
    },
  },

  // Migration 3: Memory Subsystem Schema (§6)
  {
    version: 3,
    name: 'create_memory_schema',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS episodic_memories (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          task_id TEXT,
          timestamp INTEGER NOT NULL,
          source TEXT NOT NULL,
          actor TEXT NOT NULL,
          summary TEXT NOT NULL,
          content TEXT NOT NULL,
          tool_call_json TEXT,
          importance_score REAL NOT NULL DEFAULT 0.5,
          access_count INTEGER NOT NULL DEFAULT 0,
          last_accessed_at INTEGER NOT NULL,
          consolidated INTEGER NOT NULL DEFAULT 0,
          decay_factor REAL NOT NULL DEFAULT 1.0,
          embedding_json TEXT,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_episodic_time ON episodic_memories(timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_episodic_session ON episodic_memories(session_id);
        CREATE INDEX IF NOT EXISTS idx_episodic_task ON episodic_memories(task_id);

        CREATE TABLE IF NOT EXISTS semantic_memories (
          id TEXT PRIMARY KEY,
          subject TEXT NOT NULL,
          predicate TEXT NOT NULL,
          object TEXT NOT NULL,
          statement TEXT NOT NULL,
          confidence REAL NOT NULL DEFAULT 1.0,
          source_episodic_ids_json TEXT,
          valid_from INTEGER NOT NULL,
          valid_until INTEGER,
          superseded_by TEXT,
          context_json TEXT,
          last_verified_at INTEGER NOT NULL,
          access_count INTEGER NOT NULL DEFAULT 0,
          embedding_json TEXT,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_semantic_spo ON semantic_memories(subject, predicate);
        CREATE INDEX IF NOT EXISTS idx_semantic_validity ON semantic_memories(valid_until);
      `);

      try {
        db.exec(`
          CREATE VIRTUAL TABLE episodic_fts USING fts5(
            id UNINDEXED,
            summary,
            content,
            tokenize = 'porter unicode61'
          );
        `);
      } catch {}

      try {
        db.exec(`
          CREATE VIRTUAL TABLE semantic_fts USING fts5(
            id UNINDEXED,
            statement,
            subject,
            object,
            tokenize = 'porter unicode61'
          );
        `);
      } catch {}
    },
  },

  // Migration 4: Planner & Scheduler Schema (§5, §13)
  {
    version: 4,
    name: 'create_planner_and_scheduler_schema',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS plans (
          id TEXT PRIMARY KEY,
          goal_id TEXT NOT NULL,
          goal_description TEXT NOT NULL,
          version INTEGER NOT NULL DEFAULT 1,
          strategy TEXT NOT NULL,
          state TEXT NOT NULL,
          reflection_json TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS plan_steps (
          id TEXT PRIMARY KEY,
          plan_id TEXT NOT NULL,
          step_index INTEGER NOT NULL,
          description TEXT NOT NULL,
          type_json TEXT NOT NULL,
          state TEXT NOT NULL,
          result_json TEXT,
          error TEXT,
          created_at INTEGER NOT NULL,
          FOREIGN KEY(plan_id) REFERENCES plans(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_plan_steps_plan ON plan_steps(plan_id, step_index);

        CREATE TABLE IF NOT EXISTS schedules (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1,
          source_json TEXT NOT NULL,
          task_template_json TEXT NOT NULL,
          stats_json TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS schedule_history (
          id TEXT PRIMARY KEY,
          schedule_id TEXT NOT NULL,
          fired_at INTEGER NOT NULL,
          result TEXT NOT NULL,
          task_id TEXT,
          error TEXT,
          FOREIGN KEY(schedule_id) REFERENCES schedules(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_sched_hist ON schedule_history(schedule_id, fired_at DESC);
      `);
    },
  },

  // Migration 5: Knowledge Graph Schema (§8)
  {
    version: 5,
    name: 'create_knowledge_graph_schema',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS entities (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          name TEXT NOT NULL,
          aliases_json TEXT NOT NULL DEFAULT '[]',
          description TEXT NOT NULL DEFAULT '',
          properties_json TEXT NOT NULL DEFAULT '{}',
          source_memory_ids_json TEXT NOT NULL DEFAULT '[]',
          confidence REAL NOT NULL DEFAULT 1.0,
          embedding_json TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          last_referenced_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);
        CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name);
        CREATE INDEX IF NOT EXISTS idx_entities_updated ON entities(updated_at DESC);

        CREATE TABLE IF NOT EXISTS relationships (
          id TEXT PRIMARY KEY,
          from_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
          to_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
          type TEXT NOT NULL,
          weight REAL NOT NULL DEFAULT 1.0,
          properties_json TEXT NOT NULL DEFAULT '{}',
          valid_from INTEGER NOT NULL,
          valid_until INTEGER,
          source_memory_ids_json TEXT NOT NULL DEFAULT '[]',
          confidence REAL NOT NULL DEFAULT 1.0,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_rel_from ON relationships(from_id, type);
        CREATE INDEX IF NOT EXISTS idx_rel_to ON relationships(to_id, type);
        CREATE INDEX IF NOT EXISTS idx_rel_type ON relationships(type);
        CREATE INDEX IF NOT EXISTS idx_rel_valid ON relationships(valid_until);

        CREATE TABLE IF NOT EXISTS entity_history (
          id TEXT PRIMARY KEY,
          entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
          changed_at INTEGER NOT NULL,
          change_type TEXT NOT NULL,
          previous_state_json TEXT,
          change_description TEXT,
          source_memory_id TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_entity_history ON entity_history(entity_id, changed_at DESC);
      `);

      try {
        db.exec(`
          CREATE VIRTUAL TABLE IF NOT EXISTS entities_fts USING fts5(
            id UNINDEXED,
            name,
            description,
            aliases_text,
            tokenize = 'porter unicode61'
          );
        `);
      } catch {}
    },
  },

  // Migration 6: Self-Improvement & Multi-Agent Delegation Schema (§15, §23)
  {
    version: 6,
    name: 'create_self_improvement_and_delegation_schema',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS anti_patterns (
          id TEXT PRIMARY KEY,
          context TEXT NOT NULL,
          mistake TEXT NOT NULL,
          consequence TEXT NOT NULL,
          corrective_action TEXT NOT NULL,
          confidence REAL NOT NULL DEFAULT 1.0,
          occurrences INTEGER NOT NULL DEFAULT 1,
          source_task_id TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_anti_patterns_created ON anti_patterns(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_anti_patterns_confidence ON anti_patterns(confidence DESC);

        CREATE TABLE IF NOT EXISTS prompt_mutations (
          id TEXT PRIMARY KEY,
          target TEXT NOT NULL,
          version INTEGER NOT NULL DEFAULT 1,
          original_prompt TEXT NOT NULL,
          proposed_prompt TEXT NOT NULL,
          rationale TEXT NOT NULL,
          failure_count INTEGER NOT NULL DEFAULT 0,
          validation_passed INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'active',
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_prompt_mutations_target ON prompt_mutations(target, version DESC);
        CREATE INDEX IF NOT EXISTS idx_prompt_mutations_status ON prompt_mutations(status);

        CREATE TABLE IF NOT EXISTS delegations (
          id TEXT PRIMARY KEY,
          parent_task_id TEXT NOT NULL,
          agent_type TEXT NOT NULL,
          task TEXT NOT NULL,
          context_json TEXT NOT NULL DEFAULT '{}',
          expected_output_json TEXT,
          budget_json TEXT NOT NULL DEFAULT '{}',
          timeout_ms INTEGER NOT NULL DEFAULT 60000,
          state TEXT NOT NULL DEFAULT 'pending',
          result_json TEXT,
          created_at INTEGER NOT NULL,
          completed_at INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_delegations_parent ON delegations(parent_task_id);
        CREATE INDEX IF NOT EXISTS idx_delegations_agent ON delegations(agent_type);
        CREATE INDEX IF NOT EXISTS idx_delegations_state ON delegations(state);
      `);

      try {
        db.exec(`
          CREATE VIRTUAL TABLE IF NOT EXISTS anti_patterns_fts USING fts5(
            id UNINDEXED,
            context,
            mistake,
            consequence,
            corrective_action,
            tokenize = 'porter unicode61'
          );
        `);
      } catch {}
    },
  },

  // Migration 7: Procedural Memory Schema (§6.4.4, §6.7)
  {
    version: 7,
    name: 'create_procedural_memory_schema',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS procedural_memories (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          intent_signature TEXT NOT NULL,
          preconditions_json TEXT NOT NULL DEFAULT '[]',
          execution_graph_json TEXT NOT NULL DEFAULT '[]',
          success_rate REAL NOT NULL DEFAULT 1.0,
          execution_count INTEGER NOT NULL DEFAULT 0,
          last_executed_at INTEGER NOT NULL,
          embedding_json TEXT,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_procedural_intent ON procedural_memories(intent_signature);
        CREATE INDEX IF NOT EXISTS idx_procedural_name ON procedural_memories(name);
      `);

      try {
        db.exec(`
          CREATE VIRTUAL TABLE IF NOT EXISTS procedural_fts USING fts5(
            id UNINDEXED,
            name,
            intent_signature,
            tokenize = 'porter unicode61'
          );
        `);
      } catch {}
    },
  },
];
