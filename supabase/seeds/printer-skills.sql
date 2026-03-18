-- ── Printer Diagnostic Skills for Agents ──────────────────────────────
-- Seeds agent_skills with printer expertise for andy_bernard (endpoint),
-- ryan_howard (classifier), and michael_scott (manager routing).

-- ── Andy Bernard: Printer Troubleshooting Procedures ─────────────────

INSERT INTO agent_skills (agent_name, title, content, skill_type, is_active, metadata)
VALUES
(
  'andy_bernard',
  'Printer Diagnostic Questions',
  'When a ticket involves a printer issue, ask or look for answers to these diagnostic questions before making recommendations:

1. **Printer Identification**
   - What is the printer make and model?
   - Is it a network printer, USB-connected, or wireless?
   - What is the printer IP address (if network)?
   - Is the printer shared via a print server or direct IP?

2. **Symptom Clarification**
   - Is the printer completely unresponsive or partially working?
   - Are print jobs stuck in the queue or disappearing?
   - Is there an error message on the printer display panel?
   - Is there an error on the computer when trying to print?
   - Does the issue affect one user or multiple users?
   - Can the user print from other applications?
   - Has the user tried printing a test page from the printer itself?

3. **Environment Context**
   - Has anything changed recently (driver update, OS update, new network setup)?
   - Is the printer on the same VLAN/subnet as the user?
   - Are other printers in the same location working?
   - Is the user connected via VPN (remote printing)?

4. **Print Quality Issues (if applicable)**
   - Are there streaks, smudges, or faded areas?
   - Is the issue on all pages or only certain ones?
   - Has the toner/ink been recently replaced?
   - What is the current toner/ink level?
   - Is the drum/fuser unit due for replacement?',
  'procedure',
  true,
  '{"category": "printer", "priority": "high"}'::jsonb
),
(
  'andy_bernard',
  'Common Printer Issue Runbook',
  'Step-by-step troubleshooting for the most common printer issues:

## Printer Not Printing / Offline

1. Verify printer is powered on and showing "Ready" on display
2. Check network connectivity:
   - Ping the printer IP from the user workstation
   - Verify printer IP has not changed (check DHCP lease or static config)
   - Confirm printer is on correct VLAN
3. On the user PC:
   - Open Settings > Printers & Scanners
   - Check if printer shows "Offline" — right-click > "Use Printer Online"
   - Clear the print queue: `net stop spooler && del /Q %systemroot%\System32\spool\PRINTERS\* && net start spooler`
   - Remove and re-add the printer if persistent
4. Check print server (if applicable):
   - Verify print spooler service is running
   - Check for stuck jobs on the server queue
   - Restart the spooler service if needed

## Paper Jam / Mechanical

1. Open all access panels per manufacturer guide
2. Remove jammed paper — pull gently in the direction of paper path
3. Check paper tray for correct paper size and proper loading
4. Inspect rollers for wear or debris
5. Run cleaning cycle from printer menu
6. If recurring, check pickup rollers and separation pad

## Print Quality Issues

1. Print a test page from printer menu to isolate PC vs printer issue
2. Check toner/ink levels via printer display or web interface
3. If streaks: clean the drum unit, replace if > 80% life
4. If faded: shake toner cartridge gently, replace if low
5. If smudges: check fuser unit temperature settings, replace fuser if worn
6. Run printer calibration/alignment from maintenance menu

## Scanning Issues

1. Verify scan-to-email SMTP settings (server, port, auth)
2. Check if scan-to-folder path is accessible (permissions, network path)
3. Verify SMB version compatibility (some printers need SMBv1)
4. Test scan to USB to isolate network vs scanner hardware
5. Check address book entries for correct email/folder destinations',
  'runbook',
  true,
  '{"category": "printer", "priority": "high"}'::jsonb
),
(
  'andy_bernard',
  'Halo Printer Asset Lookup',
  'When handling printer tickets, always check Halo for printer assets:

1. **Look up the client printer assets** using the Halo asset API:
   - Filter by client_id and assettype for printers
   - Check the asset fields for: IP address, model, serial number, location, warranty status

2. **Cross-reference the ticket** with known printer assets:
   - Match printer mentioned in ticket to inventory
   - Check if the printer has recent tickets (recurring issue pattern)
   - Note warranty/contract status for escalation decisions

3. **Asset fields to check**:
   - `key_field`: Usually the printer hostname or asset tag
   - `key_field2`: Often the IP address
   - `key_field3`: Serial number or location
   - Custom fields may include: toner levels, page count, firmware version

4. **If printer is NOT in Halo inventory**:
   - Flag for asset team to add
   - Note in technician comments that printer needs to be inventoried
   - Gather make, model, serial, IP, and location for the asset record',
  'instruction',
  true,
  '{"category": "printer", "integration": "halo"}'::jsonb
),
(
  'andy_bernard',
  'Printer Escalation Criteria',
  'Escalate printer issues under these conditions:

**Escalate to On-Site / Field Tech:**
- Hardware failure (paper path mechanism, fuser, formatter board)
- Recurring paper jams not resolved by basic troubleshooting
- Physical damage or unusual noises
- Printer needs firmware update that cannot be done remotely
- Toner/drum replacement if client does not self-service

**Escalate to Network Team:**
- Printer unreachable on network after basic checks
- VLAN or firewall changes needed
- Print server configuration issues
- DHCP reservation or static IP conflicts

**Escalate to Vendor/Manufacturer:**
- Under warranty hardware failures
- Firmware bugs causing print defects
- Managed print service (MPS) contract issues

**Do NOT escalate (resolve at L1):**
- Print queue clearing
- Driver reinstallation
- Adding/removing printer on user PC
- Basic connectivity (offline status toggle)
- Paper/toner replacement instructions
- Scan-to-email SMTP configuration',
  'instruction',
  true,
  '{"category": "printer", "priority": "medium"}'::jsonb
),
(
  'andy_bernard',
  'Printer Response Template',
  'Use these templates when responding to printer tickets:

## Initial Acknowledgment (Internal Note)
```
Printer issue identified for [CLIENT]. Checking Halo asset inventory for printer details.
Printer: [MAKE/MODEL] at [LOCATION] ([IP_ADDRESS])
Initial assessment: [BRIEF_DIAGNOSIS]
Recommended next steps: [STEPS]
```

## Remote Resolution Note
```
Resolved printer issue remotely:
- Issue: [DESCRIPTION]
- Root Cause: [CAUSE]
- Resolution: [WHAT_WAS_DONE]
- Printer Status: Online and printing test page successfully
- Prevention: [ANY_PREVENTIVE_MEASURES]
```

## Escalation Note
```
Escalating printer issue to [TEAM/VENDOR]:
- Printer: [MAKE/MODEL] - [SERIAL] at [LOCATION]
- Issue: [DESCRIPTION]
- Troubleshooting performed:
  1. [STEP_1]
  2. [STEP_2]
  3. [STEP_3]
- Reason for escalation: [REASON]
- Client impact: [IMPACT_DESCRIPTION]
```',
  'template',
  true,
  '{"category": "printer"}'::jsonb
),

-- ── Ryan Howard: Printer Classification Enhancement ──────────────────

(
  'ryan_howard',
  'Printer Ticket Classification Guide',
  'Enhanced classification rules for printer-related tickets:

**Type: endpoint**
**Subtype mapping:**
- "printer_offline" — Printer not responding, shows offline, cannot print
- "print_quality" — Streaks, faded, smudged, misaligned output
- "paper_jam" — Paper jams, mechanical feed issues
- "scanner_issue" — Scan-to-email, scan-to-folder, scanning not working
- "driver_issue" — Print driver errors, installation failures, compatibility
- "print_queue" — Jobs stuck, queue not clearing, spooler errors
- "printer_setup" — New printer installation, printer moves, network config
- "consumables" — Toner, ink, drum, fuser, maintenance kit replacement
- "multiple_hardware_issues" — Printer issue combined with other device problems

**Urgency adjustments for printers:**
- Shared office printer down affecting 5+ users → Urgency 4
- Single user cannot print, has workaround (another printer) → Urgency 2
- Print quality degraded but still functional → Urgency 2
- Billing/invoicing printer down (business-critical) → Urgency 4
- Label/shipping printer down (operations blocked) → Urgency 4
- Personal printer, user can use shared printer → Urgency 1

**Keyword signals:**
- "printer", "printing", "print", "prints" → endpoint/printer category
- "scanner", "scanning", "scan to" → endpoint/scanner_issue
- "toner", "ink", "drum", "fuser" → endpoint/consumables
- "paper jam", "jammed", "stuck paper" → endpoint/paper_jam
- "offline", "not printing", "cant print" → endpoint/printer_offline
- "streaks", "faded", "smudged", "lines on page" → endpoint/print_quality',
  'instruction',
  true,
  '{"category": "printer", "priority": "high"}'::jsonb
),

-- ── Michael Scott: Printer Routing Rules ─────────────────────────────

(
  'michael_scott',
  'Printer Ticket Routing Rules',
  'When the ticket is classified as a printer issue, apply these routing rules:

**Route to Endpoint Team** (default for printer issues):
- All printer troubleshooting starts with the endpoint team
- Andy Bernard should handle initial diagnosis and remote resolution attempts

**Route to Network Team if:**
- Printer is unreachable on the network after endpoint checks
- Multiple printers at same site are affected (likely network/VLAN issue)
- Print server infrastructure problems
- DHCP or DNS affecting printer connectivity

**Route to Field/On-Site if:**
- Hardware failure confirmed (mechanical, electrical)
- Physical paper path issues not resolved remotely
- Printer relocation or new printer setup
- Consumable replacement if client does not self-service

**Halo Asset Check:**
- Always instruct the technician to verify the printer exists in Halo assets
- Include printer IP, model, and serial in the triage notes if available
- Flag if printer is not in the asset inventory

**Special routing:**
- MPS (Managed Print Service) printers → Route to vendor first, note contract details
- Multifunction devices with email issues → Co-route to Email team (Phyllis Vance)
- Printers with security concerns (unauthorized access, print logs) → Flag for Angela Martin',
  'instruction',
  true,
  '{"category": "printer", "priority": "high"}'::jsonb
);
