-- Ticket embeddings for similar ticket detection
CREATE TABLE IF NOT EXISTS ticket_embeddings (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  halo_id integer NOT NULL,
  summary text NOT NULL,
  classification text,
  client_name text,
  embedding vector(1536),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT ticket_embeddings_ticket_id_key UNIQUE (ticket_id)
);

CREATE INDEX IF NOT EXISTS idx_ticket_embeddings_embedding
  ON ticket_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

CREATE INDEX IF NOT EXISTS idx_ticket_embeddings_client
  ON ticket_embeddings (client_name);

-- RPC function for vector similarity search on tickets
CREATE OR REPLACE FUNCTION match_similar_tickets(
  query_embedding vector(1536),
  exclude_ticket_id uuid,
  match_threshold float DEFAULT 0.65,
  match_count int DEFAULT 10
)
RETURNS TABLE (
  "ticketId" uuid,
  "haloId" integer,
  summary text,
  "clientName" text,
  classification text,
  similarity float,
  "resolvedAt" timestamptz,
  status text
)
LANGUAGE sql STABLE
AS $$
  SELECT
    te.ticket_id AS "ticketId",
    te.halo_id AS "haloId",
    te.summary,
    te.client_name AS "clientName",
    te.classification,
    1 - (te.embedding <=> query_embedding) AS similarity,
    t.updated_at AS "resolvedAt",
    t.status
  FROM ticket_embeddings te
  JOIN tickets t ON t.id = te.ticket_id
  WHERE te.ticket_id != exclude_ticket_id
    AND te.embedding IS NOT NULL
    AND 1 - (te.embedding <=> query_embedding) > match_threshold
    AND t.status IN ('triaged', 'resolved', 'closed')
  ORDER BY te.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- RPC function for duplicate detection (open tickets only)
CREATE OR REPLACE FUNCTION match_duplicate_tickets(
  query_embedding vector(1536),
  exclude_ticket_id uuid,
  match_threshold float DEFAULT 0.82,
  match_count int DEFAULT 5,
  filter_client text DEFAULT NULL
)
RETURNS TABLE (
  "ticketId" uuid,
  "haloId" integer,
  summary text,
  "clientName" text,
  similarity float,
  status text,
  "createdAt" timestamptz
)
LANGUAGE sql STABLE
AS $$
  SELECT
    te.ticket_id AS "ticketId",
    te.halo_id AS "haloId",
    te.summary,
    te.client_name AS "clientName",
    1 - (te.embedding <=> query_embedding) AS similarity,
    t.status,
    t.created_at AS "createdAt"
  FROM ticket_embeddings te
  JOIN tickets t ON t.id = te.ticket_id
  WHERE te.ticket_id != exclude_ticket_id
    AND te.embedding IS NOT NULL
    AND 1 - (te.embedding <=> query_embedding) > match_threshold
    AND t.status IN ('pending', 'triaging', 'triaged')
    AND (filter_client IS NULL OR te.client_name = filter_client)
  ORDER BY te.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- RLS
ALTER TABLE ticket_embeddings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage ticket_embeddings"
  ON ticket_embeddings
  FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Authenticated users can read ticket_embeddings"
  ON ticket_embeddings
  FOR SELECT
  USING (auth.role() = 'authenticated');
