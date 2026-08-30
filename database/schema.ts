export const SCHEMA = `
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  title TEXT DEFAULT 'New Conversation',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  category TEXT DEFAULT 'general',
  timestamp INTEGER NOT NULL,
  project_path TEXT DEFAULT '',
  pinned INTEGER DEFAULT 0,
  embedding BLOB DEFAULT NULL,
  source TEXT DEFAULT 'agent_inference',
  status TEXT DEFAULT 'active',
  importance REAL DEFAULT 0.5,
  confidence REAL DEFAULT 0.8,
  last_verified_at INTEGER DEFAULT NULL,
  superseded_by TEXT DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_memories_key ON memories(key);
CREATE INDEX IF NOT EXISTS idx_memories_category ON memories(category);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS provider_keys (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  name TEXT NOT NULL,
  api_key_encrypted TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  priority INTEGER DEFAULT 0,
  requests INTEGER DEFAULT 0,
  failures INTEGER DEFAULT 0,
  last_success INTEGER,
  last_failure INTEGER,
  quota_state TEXT DEFAULT 'ok',
  cooldown_until INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_provider_keys_provider ON provider_keys(provider);
`
