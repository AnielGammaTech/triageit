-- Michael Scott Chat Interface
-- Conversations and messages for direct interaction with Michael

CREATE TABLE michael_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL DEFAULT 'New Conversation',
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ticket_id UUID REFERENCES tickets(id) ON DELETE SET NULL,
  is_archived BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE michael_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES michael_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Skills Michael learns from conversations (user-taught)
CREATE TABLE michael_learned_skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  source_conversation_id UUID REFERENCES michael_conversations(id) ON DELETE SET NULL,
  taught_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_michael_conversations_user ON michael_conversations(user_id, created_at DESC);
CREATE INDEX idx_michael_messages_conversation ON michael_messages(conversation_id, created_at ASC);
CREATE INDEX idx_michael_learned_skills_active ON michael_learned_skills(is_active) WHERE is_active = true;

-- RLS
ALTER TABLE michael_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE michael_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE michael_learned_skills ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own conversations"
  ON michael_conversations FOR ALL
  USING (auth.uid() = user_id);

CREATE POLICY "Users can manage messages in their conversations"
  ON michael_messages FOR ALL
  USING (
    conversation_id IN (
      SELECT id FROM michael_conversations WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Authenticated users can read learned skills"
  ON michael_learned_skills FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can manage learned skills"
  ON michael_learned_skills FOR ALL
  USING (auth.uid() IS NOT NULL);
