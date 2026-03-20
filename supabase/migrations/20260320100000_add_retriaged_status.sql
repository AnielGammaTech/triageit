-- Add "re-triaged" and "needs_review" to tickets.status check constraint
ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_status_check;
ALTER TABLE tickets ADD CONSTRAINT tickets_status_check
  CHECK (status IN ('pending', 'triaging', 'triaged', 're-triaged', 'approved', 'needs_review', 'error'));
