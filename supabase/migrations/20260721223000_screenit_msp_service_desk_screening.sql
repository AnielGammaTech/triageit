-- Keep the shared production Supabase migration history aligned with the
-- ScreenIT-local migration set.

update public.screenit_positions
set
  requirements = '["Experience supporting multiple customer environments in an MSP or similar setting", "Hands-on use of RMM tools for monitoring, remote access, automation, or endpoint management", "Ownership of tickets in a PSA or ticketing system from intake through prioritization, escalation, documentation, and closure", "Clear technical notes, internal documentation, and customer-facing status updates", "Practical Microsoft 365 and Windows remote troubleshooting"]'::jsonb,
  questions = '[{"id":"msp-q1","prompt":"Tell me about the MSP or multi-customer environments you have supported.","reason":"Establishes whether the candidate has worked across multiple client environments.","required":true},{"id":"msp-q2","prompt":"Which RMM tool did you use most often?","reason":"Identifies hands-on remote monitoring and management experience before a concrete follow-up.","required":true},{"id":"msp-q3","prompt":"Walk me through a ticket you owned from the first report to resolution.","reason":"Tests ticket ownership, troubleshooting, escalation, and closure through one real example.","required":true},{"id":"msp-q4","prompt":"What did you include in your ticket notes so another technician could take over?","reason":"Tests practical documentation quality and handoff readiness.","required":true},{"id":"msp-q5","prompt":"Tell me about a difficult issue you solved remotely for a customer.","reason":"Collects an understandable but in-depth remote troubleshooting example.","required":true}]'::jsonb,
  updated_at = now()
where id = '8a1c2e5a-0b80-4d63-8a8c-b605d64f2c11';
