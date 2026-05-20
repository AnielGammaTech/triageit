-- Update the live workflow skill and cron description after the owner clarified
-- that TriageIT must never email customers automatically.

delete from agent_skills
where agent_name = 'michael_scott'
  and title = 'Halo Help Desk Workflow';

insert into agent_skills (agent_name, title, content, skill_type, metadata)
values (
  'michael_scott',
  'Halo Help Desk Workflow',
  E'## Canonical Help Desk Workflow\n\nEvery ticket must keep three workflow levers consistent: status, auto_release, and resolution_time. Ownership is explicit and role-based. Never invent an owner transfer; every transfer needs a private internal note.\n\n### Workflow statuses\nNEW, WOT, IN_PROGRESS, WAITING_ON_CUSTOMER, WAITING_ON_PARTS, NEEDS_QUOTE, PAST_DUE, RESOLVED.\n\n### Owner roles\nTriage, Assigned Tech, Parts Owner, Triage Lead, Help Desk Manager, Director.\n\n### Escalation chain\nTriage, Assigned Tech, and Parts Owner escalate to Triage Lead. Triage Lead escalates to Help Desk Manager. Help Desk Manager escalates to Director. Director is terminal for automated workflow.\n\n### Never email the customer automatically\nTriageIT must never click Email Customer, send RFI, send email, or create an automatic outbound customer message. Escalations and deadline misses create private Halo notes and internal Teams alerts only. A human manager or assigned tech decides any customer follow-up.\n\n### RFI loops\nRFI loops do not create PAST_DUE. TriageIT does not send RFI automatically. If info is missing, post a private Halo note for Bryanna or the owner to gather it manually. When Halo is already WAITING_ON_CUSTOMER, track auto_release and resolution_time. At rfi_cycle_count >= 2, escalate internally to Triage Lead and post a private Halo note. Reset rfi_cycle_count when the customer responds and work moves forward.\n\n### Tech deadline misses\nIf a tech misses resolution_time once, set PAST_DUE, increment past_due_count, notify Triage Lead internally, post a private Halo note calling out the responsible owner, and reset the next-action deadline while the tech keeps ownership. On the second consecutive miss, transfer owner to Triage Lead, set escalation_level=1, post a private Halo note, and reset past_due_count because ownership changed.\n\n### Parts and quotes\nCustomer-provided parts use WAITING_ON_CUSTOMER with auto_release at the expected delivery date, or 5 business days if unknown. Gamma-ordered parts use owner Parts Owner, status WAITING_ON_PARTS, auto_release on delivery morning, and resolution_time by end of delivery day. Quotes use NEEDS_QUOTE until sent, then WAITING_ON_CUSTOMER while awaiting customer response.\n\n### Close\nClosing requires resolution notes explaining what was wrong, what was done, and customer follow-up. TriageIT may create an internal reminder, but it must not email the customer automatically.\n\n### Reminder behavior\nWhen reviewing a ticket, call out missing or inconsistent workflow state: no owner, no promised next action, missing auto_release while waiting, missing resolution_time while active, missing private note for escalation, RFI loops at 2+ cycles, or repeated missed deadlines.',
  'instruction',
  '{"source":"docs/halo-help-desk-workflow.md","canonical":true,"customer_email":"never_auto_send"}'::jsonb
);

update public.cron_jobs
set description = 'Checks ticket workflow state for missing owners, missing timers, fired auto-release windows, missed deadlines, and escalation steps that require private internal Halo notes.',
    updated_at = now()
where name = 'Workflow Guardrail Scan';
