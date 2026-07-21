-- Seed a usable ScreenIT workspace. IDs are stable so test links survive redeploys.

insert into public.screenit_positions (id, title, department, location, status, requirements, questions, created_at)
values
  (
    '8a1c2e5a-0b80-4d63-8a8c-b605d64f2c11',
    'Service Desk Technician',
    'Technical Operations',
    'Naples, FL · Hybrid',
    'active',
    '["Two or more years supporting Microsoft 365 users", "Clear customer communication and ticket documentation", "Experience troubleshooting Windows endpoints"]'::jsonb,
    '[{"id":"q1","prompt":"Walk me through your recent Microsoft 365 support experience.","reason":"Confirms the role primary technical requirement.","required":true},{"id":"q2","prompt":"Tell me about a difficult customer issue and how you communicated the next steps.","reason":"Looks for job-related communication evidence.","required":true},{"id":"q3","prompt":"Your resume mentions endpoint management. Which tools did you use and what did you own?","reason":"Clarifies a resume claim without making assumptions.","required":true}]'::jsonb,
    '2026-07-18T14:00:00.000Z'
  ),
  (
    'f68d9c01-a101-4d04-90cd-8da8f281c1a2',
    'IT Project Coordinator',
    'Projects',
    'Naples, FL',
    'draft',
    '["Own project schedules and customer follow-up", "Coordinate procurement and technical resources"]'::jsonb,
    '[]'::jsonb,
    '2026-07-20T16:30:00.000Z'
  )
on conflict (id) do update set
  title = excluded.title,
  department = excluded.department,
  location = excluded.location,
  status = excluded.status,
  requirements = excluded.requirements,
  questions = excluded.questions,
  updated_at = now();

insert into public.screenit_candidates (id, position_id, full_name, email, phone, stage, resume_file_name, resume_highlights, interview_mode, scheduled_at, public_invite_token, public_invite_expires_at, created_at)
values
  ('4fdb4283-3be9-400e-b557-7412aa94acd9', '8a1c2e5a-0b80-4d63-8a8c-b605d64f2c11', 'ScreenIT Test Candidate', 'screenit-test@gamma.tech', null, 'new', 'Test-Resume.pdf', '["Test candidate record restored from the initial ScreenIT trial"]'::jsonb, 'browser', null, '8a61f55f2f5240d3a254744880f1c630', now() + interval '14 days', now())
on conflict (id) do update set
  position_id = excluded.position_id,
  full_name = excluded.full_name,
  email = excluded.email,
  public_invite_expires_at = excluded.public_invite_expires_at,
  updated_at = now();
