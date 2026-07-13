-- Make the customer commitment explicit and track whether the customer
-- accepts or rejects the proposed contact time after Dispatch sends it.
ALTER TABLE dispatch_customer_updates
  ADD COLUMN IF NOT EXISTS contact_method text,
  ADD COLUMN IF NOT EXISTS next_action_at timestamptz,
  ADD COLUMN IF NOT EXISTS customer_reply_message text,
  ADD COLUMN IF NOT EXISTS customer_replied_at timestamptz,
  ADD COLUMN IF NOT EXISTS customer_reply_action_id int;

ALTER TABLE dispatch_customer_updates
  DROP CONSTRAINT IF EXISTS dispatch_customer_updates_contact_method_check;
ALTER TABLE dispatch_customer_updates
  ADD CONSTRAINT dispatch_customer_updates_contact_method_check
  CHECK (contact_method IS NULL OR contact_method IN ('call', 'reply'));

ALTER TABLE dispatch_customer_updates
  DROP CONSTRAINT IF EXISTS dispatch_customer_updates_status_check;
ALTER TABLE dispatch_customer_updates
  ADD CONSTRAINT dispatch_customer_updates_status_check
  CHECK (status IN ('pending', 'sending', 'sent', 'dismissed', 'failed', 'customer_declined'));

CREATE INDEX IF NOT EXISTS idx_dispatch_customer_updates_reply_watch
  ON dispatch_customer_updates (sent_at DESC)
  WHERE status = 'sent' AND customer_replied_at IS NULL;
