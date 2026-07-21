-- Production mirror of ScreenIT migration 0007.

update public.screenit_positions
set
  requirements = requirements || '["Clearly stated motivation for working in IT and evidence of continued learning", "Ability to acknowledge a knowledge gap, seek help appropriately, and learn from the outcome"]'::jsonb,
  questions = questions || '[{"id":"msp-q6","prompt":"What first got you interested in working in IT?","reason":"Captures the candidate stated motivation in their own words.","required":true},{"id":"msp-q7","prompt":"Tell me about a time you did not know how to solve something at work.","reason":"Creates a concrete follow-up about seeking help and learning without inferring personality.","required":true}]'::jsonb,
  updated_at = now()
where id = '8a1c2e5a-0b80-4d63-8a8c-b605d64f2c11'
  and not (questions @> '[{"id":"msp-q6"}]'::jsonb);
