-- Replace older SLA guidance with the canonical Halo Help Desk Workflow.

update agent_skills
set is_active = false,
    updated_at = now()
where agent_name = 'michael_scott'
  and title in ('Response Time & SLA Rules', 'Triage Workflow Rules');

delete from agent_skills
where agent_name = 'michael_scott'
  and title = 'Halo Help Desk Workflow';

insert into agent_skills (agent_name, title, content, skill_type, metadata)
values (
  'michael_scott',
  'Halo Help Desk Workflow',
  E'## Canonical Help Desk Workflow\n\nEvery ticket must keep three workflow levers consistent: status, auto_release, and resolution_time. Ownership is explicit and role-based. Never invent an owner transfer; every transfer needs a note.\n\n### Workflow statuses\nNEW, WOT, IN_PROGRESS, WAITING_ON_CUSTOMER, WAITING_ON_PARTS, NEEDS_QUOTE, PAST_DUE, RESOLVED.\n\n### Owner roles\nTriage, Assigned Tech, Parts Owner, Triage Lead, Help Desk Manager, Director.\n\n### Escalation chain\nTriage, Assigned Tech, and Parts Owner escalate to Triage Lead. Triage Lead escalates to Help Desk Manager. Help Desk Manager escalates to Director. Director is terminal for automated workflow.\n\n### No silent escalation\nAny escalation must include a customer email in the same step. The email must acknowledge the situation, state the role escalated to, set a new expectation, and apologize when a deadline or SLA was missed. If customer email cannot be sent, pause escalation and flag Triage Lead manually.\n\n### RFI loops\nRFI loops do not create PAST_DUE. RFI sets WAITING_ON_CUSTOMER, auto_release to the next business day at the same time, and resolution_time according to the stage. Reissue RFI until rfi_cycle_count >= 2, then escalate to Triage Lead and email the customer. Reset rfi_cycle_count when the customer responds and work moves forward.\n\n### Tech deadline misses\nIf a tech misses resolution_time once, set PAST_DUE, increment past_due_count, notify Triage Lead, email the customer, and reset the next-action deadline while the tech keeps ownership. On the second consecutive miss, transfer owner to Triage Lead, set escalation_level=1, email the customer, and reset past_due_count because ownership changed.\n\n### Parts and quotes\nCustomer-provided parts use WAITING_ON_CUSTOMER with auto_release at the expected delivery date, or 5 business days if unknown. Gamma-ordered parts use owner Parts Owner, status WAITING_ON_PARTS, auto_release on delivery morning, and resolution_time by end of delivery day. Quotes use NEEDS_QUOTE until sent, then WAITING_ON_CUSTOMER while awaiting customer response.\n\n### Close\nClosing requires resolution notes explaining what was wrong, what was done, and customer follow-up. Always email the customer with the resolution summary.\n\n### Reminder behavior\nWhen reviewing a ticket, call out missing or inconsistent workflow state: no owner, no promised next action, missing auto_release while waiting, missing resolution_time while active, escalation without customer email, RFI loops at 2+ cycles, or repeated missed deadlines.',
  'instruction',
  '{"source":"docs/halo-help-desk-workflow.md","canonical":true}'::jsonb
);
