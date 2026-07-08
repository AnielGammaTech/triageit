-- Memory client scoping — match_agent_memories now returns metadata,
-- created_at, and times_recalled.
--
-- Why: recall had no customer awareness. client_name lives only in
-- metadata, which the RPC never returned, so:
--   1. Client A's environment facts were injected into client B's triages
--      with no way to tell them apart (cross-client contamination).
--   2. The composite re-ranking in MemoryManager reads created_at and
--      times_recalled — neither was returned, so recency decay and
--      frequency weighting were silent no-ops since the day they shipped.
--
-- The worker filters/labels by metadata->>'client_name' in TypeScript
-- (soft scoping: cross-client memories are rank-penalized and labeled,
-- not excluded — generic fixes transfer between clients, environment
-- facts do not).

DROP FUNCTION IF EXISTS match_agent_memories(extensions.vector, TEXT, FLOAT, INT);

CREATE FUNCTION match_agent_memories(
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
  similarity FLOAT,
  metadata JSONB,
  created_at TIMESTAMPTZ,
  times_recalled INT
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
    1 - (m.embedding <=> query_embedding) AS similarity,
    m.metadata,
    m.created_at,
    m.times_recalled
  FROM agent_memories m
  WHERE m.agent_name = match_agent
    AND m.embedding IS NOT NULL
    AND 1 - (m.embedding <=> query_embedding) > match_threshold
  ORDER BY m.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
