-- Toby Flenderson Chat Interface
-- Conversations and messages for analytics/insights interaction with Toby

CREATE TABLE toby_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL DEFAULT 'New Conversation',
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  is_archived BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE toby_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES toby_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_toby_conversations_user ON toby_conversations(user_id, created_at DESC);
CREATE INDEX idx_toby_messages_conversation ON toby_messages(conversation_id, created_at ASC);

-- RLS
ALTER TABLE toby_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE toby_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own toby conversations"
  ON toby_conversations FOR ALL
  USING (auth.uid() = user_id);

CREATE POLICY "Users can manage messages in their toby conversations"
  ON toby_messages FOR ALL
  USING (
    conversation_id IN (
      SELECT id FROM toby_conversations WHERE user_id = auth.uid()
    )
  );
