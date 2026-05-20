# Halo Help Desk Workflow

This is the canonical workflow TriageIT should use when reviewing, routing,
reminding, or escalating Halo tickets.

## Core Principle

Every ticket must have a clear current state, one explicit owner, and two
timers:

- `auto_release`: when the ticket re-enters the active queue for review.
- `resolution_time`: when the current promised action is due.

If the status, owner, `auto_release`, or `resolution_time` is missing or
inconsistent, TriageIT should call that out instead of improvising.

## Workflow Statuses

- `NEW`
- `WOT`
- `IN_PROGRESS`
- `WAITING_ON_CUSTOMER`
- `WAITING_ON_PARTS`
- `NEEDS_QUOTE`
- `PAST_DUE`
- `RESOLVED`

`PAST_DUE` is a breach flag/state, not a stopping point. Once a fresh
`resolution_time` is set, the workflow continues.

## Ownership Roles

Workflow ownership uses roles, not personal names:

- `Triage`
- `Assigned Tech`
- `Parts Owner`
- `Triage Lead`
- `Help Desk Manager`
- `Director`

Names live in the personnel matrix. Updating people should not require changing
the workflow.

## Personnel Matrix

- Helpdesk technicians: Dylan Henjum, Raul Tapanes, Jarid Carlson, Matthew
  Lawyer, Ryan Fitzpatrick, Darren Davillier.
- Triage / dispatcher: Bryanna.
- Help Desk Manager: David.
- Project Manager: Jonathan.
- Sales / account management: Roman Hernandez, Todd.
- Owner/admin: Aniel.

Only the six helpdesk technicians should be evaluated as techs for response
time, ticket handling, and performance.

## Escalation Chain

- `Triage` escalates to `Triage Lead`.
- `Assigned Tech` escalates to `Triage Lead`.
- `Parts Owner` escalates to `Triage Lead`.
- `Triage Lead` escalates to `Help Desk Manager`.
- `Help Desk Manager` escalates to `Director`.
- `Director` is terminal for automated workflow purposes.

Every role has exactly one escalation contact. There is no dynamic escalation
tree.

## Universal Customer Communication Rule

No escalation is silent.

Whenever a ticket is escalated for any reason, the customer must be informed in
the same step using `Email Customer`, not RFI. The message must:

- Acknowledge the situation.
- State that the ticket has been escalated and to which role.
- Set a new expectation for when the customer will hear back.
- Apologize if an SLA or promised deadline was missed.

If the system cannot send the customer email, pause the escalation and flag the
Triage Lead manually.

## Intake

New non-alert tickets start as:

- `status = NEW`
- `owner = Triage`
- `resolution_time = now + standard SLA resolution window`

If the ticket is an alert and needs no action, resolve it. If the alert needs
action, route it through triage assignment.

If triage misses the first response window:

- Set `status = PAST_DUE`.
- Notify `Triage Lead`.
- Send the customer an escalation/update email.
- Continue the workflow rather than stopping.

Triage then decides whether there is enough information to assign. If yes,
assign to a tech. If no, use RFI.

## Assignment

When assigning a ticket:

- Set `status = WOT`.
- Set `owner = Assigned Tech`.
- Select the tech by skillset first, then lightest open queue.
- Set `resolution_time` to the promised next action deadline, not the final
  resolution estimate.
- Log the assignment and promised next action.

## RFI Loops

RFI is for asking for missing information or customer/third-party action.

When sending RFI:

- Use the RFI action.
- Set `status = WAITING_ON_CUSTOMER`.
- Set `auto_release = next business day at same time`.
- Set `resolution_time` according to the workflow stage.
- Increment `rfi_cycle_count`.

RFI loops do not create `PAST_DUE`. If there is no response, reissue RFI until
`rfi_cycle_count >= 2`, then escalate to `Triage Lead` and send the customer an
escalation email.

Reset `rfi_cycle_count` to 0 when the customer responds and the ticket moves
forward.

## Tech Action

If the assigned tech acts before `resolution_time`:

- They write a personal note describing the plan.
- Set `status = IN_PROGRESS`.
- Set `resolution_time = expected completion + up to 1 hour padding`.

If the assigned tech misses `resolution_time`:

- Set `status = PAST_DUE`.
- Increment `past_due_count`.
- On the first miss, notify `Triage Lead`, email the customer, and reset the
  promised next action deadline while the tech retains ownership.
- On the second consecutive miss, set `owner = Triage Lead`, set
  `escalation_level = 1`, email the customer, and transfer ownership.

Reset `past_due_count` when ownership transfers.

## Escalation Handling

Manual escalation requires the tech to document:

- What was tried.
- Why escalation is needed.
- What is needed next.
- Reason tag: `technical_complexity`, `out_of_scope`, `time_sensitive`, or
  `customer_issue`.

Escalation transfers ownership to `Triage Lead`, resets the deadline, and sends
the customer an update email.

The `Triage Lead` may reassign, call the customer, close with notes, or escalate
to `Help Desk Manager`. Every path requires a customer email before action.

`Help Desk Manager` may reassign, contact the customer, close, or escalate to
`Director`. Director handling is case-specific and outside automation.

## Parts

If the customer is sourcing parts:

- Email the customer confirming Gamma is waiting on parts.
- Set `status = WAITING_ON_CUSTOMER`.
- Set `auto_release = expected delivery date`, or `now + 5 business days` if
  unknown.
- Set `resolution_time = auto_release + 4 hours`.

If Gamma orders parts:

- Set `owner = Parts Owner`.
- Set `status = WAITING_ON_PARTS`.
- Email the customer with expected delivery.
- Set `auto_release = morning of delivery day`.
- Set `resolution_time = end of expected delivery day`.

If delivery changes, update both timers and email the customer.

## Quotes

When a quote is needed:

- Email the customer with when the quote will be sent.
- Set `status = NEEDS_QUOTE`.
- Set `resolution_time = promised quote delivery datetime`.

After sending the quote:

- Set `status = WAITING_ON_CUSTOMER`.
- Set `auto_release = now + 1 business day`.
- Set `resolution_time = now + 1 business day + 2 hours`.

If the customer accepts, order parts. If declined, close with decline notes. If
there is no response after two quote follow-ups, escalate to `Triage Lead` and
email the customer.

## Appointments

If an appointment is needed:

- Use the Set Appointment function.
- Email the customer with the appointment time.
- Set `auto_release = appointment_time + 1 hour`.
- Set `resolution_time = expected_finish_time + 1 hour padding`.

At appointment time, the tech resumes work in `IN_PROGRESS`.

## Close

Closing requires resolution notes covering:

- What was wrong.
- What was done.
- Any follow-up the customer should know.

Set `status = RESOLVED` and email the customer that the ticket has been
resolved, including a short resolution summary and instructions to reply if the
issue returns.

## AI Behavior

For every ticket interaction, TriageIT should:

1. Read workflow state: status, owner, `auto_release`, `resolution_time`,
   `past_due`, counters, and escalation level.
2. Identify the current workflow step.
3. Check `auto_release` and `resolution_time`.
4. Execute or recommend the next workflow action.
5. Keep status, `auto_release`, and `resolution_time` consistent.
6. If escalation is required, require customer email in the same operation.
7. Log every ownership transfer, escalation, and timer change.

If a state is not covered by this workflow, stop and flag `Triage Lead`.

## TriageIT Guardrails

TriageIT stores this workflow state on each ticket using:

- `workflow_status`
- `workflow_owner_role`
- `auto_release_at`
- `resolution_time_at`
- `workflow_past_due`
- `rfi_cycle_count`
- `past_due_count`
- `escalation_level`

The worker runs a `Workflow Guardrail Scan` every 15 minutes. The scan checks
for missing owners, missing timers, fired `auto_release` windows, missed
`resolution_time` deadlines, repeated RFI loops, and escalation ownership
mismatches.

The scan logs findings to `workflow_events`, marks missed deadlines as
`PAST_DUE`, and sends Teams alerts. It does not silently escalate ownership
when customer email is required; instead it flags that the customer email must
be sent before escalation proceeds.
