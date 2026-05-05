import type { SopRecord } from "@/lib/types";

const now = "2026-05-05T00:00:00.000Z";

export const seedSops: readonly SopRecord[] = [
  {
    slug: "scheduling-ticket-appointments",
    title: "Scheduling and Completing Ticket Appointments",
    category: "PSA & Ticketing",
    owner: "Service Desk",
    approver: "Operations",
    status: "Approved",
    version: "1.0",
    effective_date: "2026-05-05",
    last_reviewed: "2026-05-05",
    next_review: "2027-05-05",
    classification: "Internal",
    tags: ["halo", "appointments", "dispatch", "customer communication"],
    created_at: now,
    updated_at: now,
    created_by: "followit-seed",
    updated_by: "followit-seed",
    screenshots: [],
    content_html: `
      <section>
        <h2>1. Purpose</h2>
        <p>This SOP defines how Gamma Tech schedules, confirms, completes, and documents ticket appointments so customers receive clear expectations and technicians leave a clean Halo timeline.</p>
      </section>

      <section>
        <h2>2. Scope</h2>
        <p>This applies to service desk, dispatcher, and field support appointments created from Halo tickets, including remote sessions, onsite work, vendor meetings, and customer follow-up calls.</p>
      </section>

      <section>
        <h2>3. Definitions</h2>
        <table>
          <thead>
            <tr><th>Term</th><th>Definition</th></tr>
          </thead>
          <tbody>
            <tr><td>Appointment</td><td>A scheduled time block tied to a Halo ticket and a named owner.</td></tr>
            <tr><td>Customer-facing note</td><td>A visible Halo action that the customer can read.</td></tr>
            <tr><td>Internal note</td><td>A hidden Halo action used for technician context and handoff details.</td></tr>
          </tbody>
        </table>
      </section>

      <section>
        <h2>4. Roles and Responsibilities</h2>
        <ul>
          <li><strong>Dispatcher:</strong> Confirms availability, books the appointment, and watches for schedule conflicts.</li>
          <li><strong>Assigned technician:</strong> Owns preparation, customer communication, work completion, and documentation.</li>
          <li><strong>Service manager:</strong> Reviews exceptions, missed appointments, and repeated scheduling issues.</li>
        </ul>
      </section>

      <section>
        <h2>5. Procedure</h2>
        <div class="step-card">
          <div class="step-number">1</div>
          <div class="step-body">
            <h3>Confirm the ticket is ready to schedule</h3>
            <p>Review the ticket summary, customer contact, priority, required access, and any prerequisite vendor or onsite details before offering a time.</p>
            <div class="expected-result"><strong>Expected result:</strong> The ticket has a clear reason for the appointment and no obvious missing blocker.</div>
          </div>
        </div>
        <div class="step-card">
          <div class="step-number">2</div>
          <div class="step-body">
            <h3>Offer a specific appointment window</h3>
            <p>Send the customer a concise message with one or two available windows, the expected duration, and whether the work is remote or onsite.</p>
            <div class="expected-result"><strong>Expected result:</strong> The customer understands exactly when the appointment can happen and what participation is needed.</div>
          </div>
        </div>
        <div class="step-card">
          <div class="step-number">3</div>
          <div class="step-body">
            <h3>Create the Halo appointment</h3>
            <p>Add the appointment to the ticket, assign the correct technician, set the start and end time, and include any access notes needed for the session.</p>
            <div class="expected-result"><strong>Expected result:</strong> The appointment appears on the technician schedule and stays tied to the correct ticket.</div>
          </div>
        </div>
        <div class="step-card">
          <div class="step-number">4</div>
          <div class="step-body">
            <h3>Complete and document the work</h3>
            <p>After the appointment, add a customer-facing summary of the outcome and an internal note with technical details, unresolved blockers, and next action.</p>
            <div class="expected-result"><strong>Expected result:</strong> The ticket timeline shows what happened, what changed, and who owns the next step.</div>
          </div>
        </div>
      </section>

      <section>
        <h2>6. Compliance and Quality Checks</h2>
        <ul>
          <li>Do not include passwords, private keys, or customer secrets in customer-facing notes.</li>
          <li>Use internal notes for technical context that should not be sent to the customer.</li>
          <li>Reschedule missed appointments the same business day when practical.</li>
        </ul>
      </section>

      <section>
        <h2>7. Related Documents</h2>
        <ul>
          <li>Halo ticket communication standards</li>
          <li>Customer follow-up and waiting-on-customer workflow</li>
          <li>Dispatcher daily queue review checklist</li>
        </ul>
      </section>

      <section>
        <h2>8. Exceptions</h2>
        <p>Emergency tickets, security incidents, and outage work may bypass normal scheduling. Document the reason in Halo and notify the dispatcher or service manager.</p>
      </section>

      <section>
        <h2>9. Records</h2>
        <p>Halo remains the system of record for appointment history, customer communication, and work notes. FollowIT stores the current approved SOP and revision metadata.</p>
      </section>

      <section>
        <h2>10. Revision History</h2>
        <table>
          <thead>
            <tr><th>Version</th><th>Date</th><th>Change</th><th>Approver</th></tr>
          </thead>
          <tbody>
            <tr><td>1.0</td><td>2026-05-05</td><td>Initial FollowIT seed SOP.</td><td>Operations</td></tr>
          </tbody>
        </table>
      </section>
    `,
  },
];
