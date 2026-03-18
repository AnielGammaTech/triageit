-- Graphus Phish911 skill for agents
-- Teaches agents to recognize Phish911 as a phishing REPORTING tool, not a phishing attack

INSERT INTO agent_skills (agent_name, skill_type, name, content, priority)
VALUES
-- For Ryan Howard (classifier) — so he doesn't flag Phish911 as a security threat
('ryan_howard', 'instruction', 'Phish911 by Graphus — Phishing Report Tool',
'## Phish911 by Graphus

Phish911 is a feature in Graphus (an email security platform) that allows users to REPORT and quarantine suspicious/phishing emails. It is NOT a phishing attack itself.

### Key Facts
- Phish911 is a REPORTING MECHANISM, not a threat
- Users forward suspicious emails to a dedicated inbox (e.g., reportphish@company.com)
- The system quarantines reported emails for IT review
- Tickets mentioning "Phish911" are typically:
  - A user reporting a suspicious email (GOOD — user is being security-aware)
  - An admin reviewing a Phish911 report
  - Configuration or setup of the Phish911 feature
  - Issues with the Phish911 plugin in Outlook

### How to Classify
- If a ticket mentions "Phish911" or "Graphus": classify as email/security MONITORING, NOT as a phishing attack
- The user is REPORTING a potential phish, not being phished
- Security flag should be LOW or NONE unless the REPORTED email is confirmed malicious
- Urgency depends on the reported email content, not the Phish911 report itself

### Related Products
- Graphus: AI-driven email security for Microsoft 365 and Google Workspace
- BullPhish ID: Phishing simulation and security awareness training
- Phishing Awareness Training: Third-party plugins for reporting suspicious emails', 10),

-- For Angela Martin (security) — so she assesses Phish911 reports correctly
('angela_martin', 'instruction', 'Phish911 by Graphus — Security Context',
'## Phish911 Security Assessment Guide

Phish911 (by Graphus) is a legitimate email security tool that lets users report suspicious emails. When you see "Phish911" in a ticket:

### This is NOT an attack
- The user/system is REPORTING a suspicious email through proper channels
- This is expected security behavior — users are trained to do this
- The Phish911 system quarantines the reported email automatically

### What to Assess Instead
- Look at the CONTENT of the reported email (if provided) for actual phishing indicators
- Check if the reported email contains: spoofed sender, malicious links, urgency tactics, credential harvesting
- If no email content is provided, severity should be LOW — it''s just a process report

### Severity Guide for Phish911 Reports
- NONE: Phish911 config/setup issue, or user asking about the tool
- LOW: User reported a suspicious email (no details about the email itself)
- MEDIUM: User reported an email with potential phishing indicators mentioned in the ticket
- HIGH: User clicked a link or opened an attachment BEFORE reporting via Phish911
- CRITICAL: Confirmed credential theft or malware execution before the Phish911 report', 10),

-- For Michael Scott (orchestrator) — overall context
('michael_scott', 'instruction', 'Phish911 and Graphus — Product Knowledge',
'## Product Knowledge: Phish911 / Graphus

Phish911 is Graphus''s email reporting feature. When triaging tickets that mention Phish911:

1. **It''s a reporting tool** — the user or system is reporting a suspicious email, NOT being attacked
2. **Classify appropriately** — this is email security monitoring, not a security incident
3. **Check the reported content** — if the ticket includes details about the reported email, analyze THOSE for threats
4. **Common ticket types involving Phish911:**
   - "Phish911 report from [user]" = User reported a suspicious email (routine)
   - "Phish911 not working" = Technical issue with the reporting tool
   - "Graphus quarantined email" = System auto-quarantined, needs review
   - "False positive Phish911" = Legitimate email was flagged

### Other Kaseya/Graphus Products to Know
- **BullPhish ID**: Phishing simulation training (sends FAKE phishing emails to train users)
- **Graphus EmployeeShield**: Warns users about external/suspicious emails
- **SaaS Alerts**: Monitors SaaS application behavior
- **Dark Web ID**: Monitors dark web for compromised credentials', 10)

ON CONFLICT (agent_name, name) DO UPDATE SET
  content = EXCLUDED.content,
  priority = EXCLUDED.priority,
  updated_at = now();
