-- 3CX / VoIP skills for agents
-- Teaches agents to properly scope VoIP issues and not over-escalate

INSERT INTO agent_skills (agent_name, skill_type, title, content, priority)
VALUES
-- For Ryan Howard (classifier) — so he classifies VoIP tickets correctly
('ryan_howard', 'instruction', '3CX and VoIP Ticket Classification',
'## 3CX / VoIP Ticket Classification

### FQDN Format
3CX instances use FQDNs like: customer.region.3cx.us (e.g., stahlman.fl.3cx.us)
This is a CUSTOMER INSTANCE, not a 3CX global system. Issues with one instance do NOT affect others.

### SIP Error Codes — What They Actually Mean
- 404 Not Found: DID not configured, trunk misconfigured, or number ported. This is a CONFIG issue, NOT an outage.
- 403 Forbidden: Auth failed, IP not whitelisted. CONFIG issue, NOT an outage.
- 408 Timeout: Network issue or firewall blocking SIP. CHECK CONNECTIVITY first.
- 480 Temporarily Unavailable: Endpoint offline or DND. Single user issue.
- 503 Service Unavailable: Provider overloaded. CHECK PROVIDER STATUS.

### Scope Rules
- Single trunk 404/403/503 → classify as voip, urgency 3 (Medium), NOT "system-wide outage"
- Single DID not routing → classify as voip, urgency 3 (Medium)
- Multiple trunks ALL failing → classify as voip, urgency 4 (High)
- 3CX FQDN unreachable + no extensions registered → urgency 5 (Critical, actual outage)
- FlowRoute/Twilio/provider error → check if it is the PROVIDER or the LOCAL config

### Common 3CX Alert Ticket Formats
- "Call or Registration to [number]@([trunk]) failed. sip:[ip]; replied: [reason] ([code])"
  → This is a SINGLE trunk registration alert, NOT an outage
  → Urgency: 3 | Type: voip | Subtype: trunk_registration_failure

### SIP Trunk Providers
FlowRoute (Lumen), Twilio, Bandwidth, Telnyx, VoIPms, Vonage, SIPStation', 10),

-- For Kelly Kapoor (VoIP specialist) — deep 3CX troubleshooting knowledge
('kelly_kapoor', 'instruction', '3CX Troubleshooting Playbook',
'## 3CX Troubleshooting Playbook

### Trunk Registration Failures (404/403)
1. Check provider status page (status.flowroute.com, status.twilio.com)
2. Verify DID assignment in provider portal — is the number still assigned?
3. Check trunk credentials in 3CX admin (Authentication ID, password)
4. Verify IP whitelisting if provider requires it
5. Check if number was ported away
6. Review 3CX SIP logs for detailed error messages
7. Test with alternative trunk/provider

### FlowRoute Specific
- FlowRoute uses SIP registration or IP authentication
- 404 usually means: DID not found in FlowRoute account, or trunk not configured for that DID
- Check FlowRoute portal > Interconnections > SIP Trunks for trunk status
- Check FlowRoute portal > Numbers > DIDs for number assignment

### Twilio Specific
- Twilio Elastic SIP Trunking uses credential lists or IP ACLs
- Check Twilio console > Elastic SIP Trunking > Trunks for status
- Review Twilio Debugger for error details
- Check if number is assigned to the correct trunk

### Common Misconceptions
- A single "Call or Registration failed" alert does NOT mean the whole phone system is down
- Other trunks on the same 3CX may be working perfectly fine
- Extensions can still make internal calls even if all external trunks are down
- 3CX FQDN being reachable = system is UP, even if one trunk is failing', 10),

-- For Michael Scott (orchestrator) — VoIP context
('michael_scott', 'instruction', '3CX and VoIP — Scope Assessment',
'## VoIP Issue Scoping

When triaging VoIP/3CX tickets, ALWAYS determine scope FIRST:

### Single Component Failure (MOST tickets)
- One trunk, one DID, one extension
- "Call or Registration to X failed" = SINGLE trunk issue
- Route to Kelly Kapoor, urgency 3
- Do NOT say "system-wide outage" unless ALL evidence supports it

### Partial Degradation
- Multiple trunks failing, but system is UP
- Some calls working, some not
- Urgency 4

### True System Outage (RARE)
- 3CX FQDN unreachable
- ALL trunks down, ALL extensions unregistered
- No calls possible at all
- Urgency 5

### Key: Look at the Evidence
- Does the ticket mention ONE trunk/number? → Single issue
- Does it say "all phones down" or "nobody can make calls"? → Possible outage
- Is the 3CX FQDN mentioned as unreachable? → Possible outage
- Is it just an automated alert about one registration? → Single issue', 10)

ON CONFLICT (agent_name, title) DO UPDATE SET
  content = EXCLUDED.content,
  priority = EXCLUDED.priority,
  updated_at = now();
