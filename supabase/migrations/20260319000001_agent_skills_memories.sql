-- Enable pgvector for embeddings
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- Update integrations service CHECK to include all new services
ALTER TABLE integrations DROP CONSTRAINT IF EXISTS integrations_service_check;
ALTER TABLE integrations ADD CONSTRAINT integrations_service_check
  CHECK (service IN (
    'halo', 'hudu', 'jumpcloud', 'datto', 'datto-edr', 'rocketcyber',
    'unifi', 'vpentest', 'saas-alerts', 'unitrends', 'cove', 'pax8',
    'vultr', 'mxtoolbox', 'dmarc', 'threecx', 'twilio', 'spanning',
    'ai-provider', 'teams', 'cipp'
  ));

-- Update integration_mappings service CHECK
ALTER TABLE integration_mappings DROP CONSTRAINT IF EXISTS integration_mappings_service_check;
ALTER TABLE integration_mappings ADD CONSTRAINT integration_mappings_service_check
  CHECK (service IN (
    'halo', 'hudu', 'jumpcloud', 'datto', 'datto-edr', 'rocketcyber',
    'unifi', 'vpentest', 'saas-alerts', 'unitrends', 'cove', 'pax8',
    'vultr', 'mxtoolbox', 'dmarc', 'threecx', 'twilio', 'spanning',
    'ai-provider', 'teams', 'cipp'
  ));

-- ═══════════════════════════════════════════════════════════════════════
-- Agent Skills — uploadable knowledge / instructions per worker agent
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE agent_skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_name TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  skill_type TEXT NOT NULL DEFAULT 'instruction'
    CHECK (skill_type IN ('instruction', 'procedure', 'runbook', 'template', 'context')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_agent_skills_agent ON agent_skills(agent_name);
CREATE INDEX idx_agent_skills_type ON agent_skills(skill_type);
CREATE INDEX idx_agent_skills_active ON agent_skills(agent_name, is_active);

-- ═══════════════════════════════════════════════════════════════════════
-- Agent Memories — learned from ticket resolutions, embedding-searchable
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE agent_memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_name TEXT NOT NULL,
  ticket_id UUID REFERENCES tickets(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  summary TEXT NOT NULL,
  embedding extensions.vector(1536),
  memory_type TEXT NOT NULL DEFAULT 'resolution'
    CHECK (memory_type IN ('resolution', 'pattern', 'insight', 'escalation', 'workaround')),
  tags TEXT[] DEFAULT '{}',
  confidence REAL NOT NULL DEFAULT 0.8
    CHECK (confidence >= 0 AND confidence <= 1),
  times_recalled INTEGER NOT NULL DEFAULT 0,
  last_recalled_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_agent_memories_agent ON agent_memories(agent_name);
CREATE INDEX idx_agent_memories_type ON agent_memories(memory_type);
CREATE INDEX idx_agent_memories_ticket ON agent_memories(ticket_id);
CREATE INDEX idx_agent_memories_tags ON agent_memories USING GIN(tags);

-- Similarity search index for embeddings
CREATE INDEX idx_agent_memories_embedding ON agent_memories
  USING ivfflat (embedding extensions.vector_cosine_ops)
  WITH (lists = 100);

-- ═══════════════════════════════════════════════════════════════════════
-- RLS Policies
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE agent_skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_memories ENABLE ROW LEVEL SECURITY;

-- Skills: admins can manage, all authenticated can read
CREATE POLICY "Admins can manage agent skills"
  ON agent_skills FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
    )
  );

CREATE POLICY "Authenticated users can read agent skills"
  ON agent_skills FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Service role can manage agent skills"
  ON agent_skills FOR ALL
  USING (current_setting('role') = 'service_role');

-- Memories: admins can manage, all authenticated can read
CREATE POLICY "Admins can manage agent memories"
  ON agent_memories FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
    )
  );

CREATE POLICY "Authenticated users can read agent memories"
  ON agent_memories FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Service role can manage agent memories"
  ON agent_memories FOR ALL
  USING (current_setting('role') = 'service_role');

-- ═══════════════════════════════════════════════════════════════════════
-- Helper function: find similar memories via cosine similarity
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION match_agent_memories(
  query_embedding extensions.vector(1536),
  match_agent TEXT,
  match_threshold FLOAT DEFAULT 0.7,
  match_count INT DEFAULT 5
)
RETURNS TABLE (
  id UUID,
  agent_name TEXT,
  content TEXT,
  summary TEXT,
  memory_type TEXT,
  tags TEXT[],
  confidence REAL,
  similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    m.id,
    m.agent_name,
    m.content,
    m.summary,
    m.memory_type,
    m.tags,
    m.confidence,
    1 - (m.embedding <=> query_embedding) AS similarity
  FROM agent_memories m
  WHERE m.agent_name = match_agent
    AND m.embedding IS NOT NULL
    AND 1 - (m.embedding <=> query_embedding) > match_threshold
  ORDER BY m.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Enable realtime for skills and memories
ALTER PUBLICATION supabase_realtime ADD TABLE agent_skills;
ALTER PUBLICATION supabase_realtime ADD TABLE agent_memories;
