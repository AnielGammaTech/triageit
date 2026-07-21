-- Availability-aware SLA warnings reuse the existing outbound call queue, but
-- need durable context so the voice assistant can distinguish a warning from
-- an already-breached ticket and so concurrent scans cannot call twice.
ALTER TABLE public.sla_call_requests
  ADD COLUMN IF NOT EXISTS call_type text NOT NULL DEFAULT 'breach',
  ADD COLUMN IF NOT EXISTS due_at timestamptz,
  ADD COLUMN IF NOT EXISTS availability_detail text,
  ADD COLUMN IF NOT EXISTS dedupe_key text;

UPDATE public.sla_call_requests
SET call_type = CASE
  WHEN objective LIKE '[DISPATCH FOLLOW-UP]%' THEN 'dispatch_followup'
  WHEN objective IS NOT NULL THEN 'info'
  ELSE 'breach'
END
WHERE call_type = 'breach';

ALTER TABLE public.sla_call_requests
  DROP CONSTRAINT IF EXISTS sla_call_requests_call_type_check;
ALTER TABLE public.sla_call_requests
  ADD CONSTRAINT sla_call_requests_call_type_check
  CHECK (call_type IN ('breach', 'pre_breach', 'info', 'dispatch_followup'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_sla_call_requests_dedupe_key
  ON public.sla_call_requests (dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sla_call_requests_pre_breach_due
  ON public.sla_call_requests (due_at)
  WHERE call_type = 'pre_breach';
