# TriageIt - Architecture Plan

## Overview

AI-powered MSP ticket triage system using a multi-agent architecture inspired by The Office. A manager agent (Michael Scott) orchestrates specialist worker agents who each handle specific integrations and responsibilities. All communication flows through Michael — agents never talk to each other directly.

---

## Tech Stack

| Layer | Technology | Deployment |
|---|---|---|
| Frontend + Web API | Next.js 15 App Router, shadcn/ui, Tailwind CSS | Railway Service 1 |
| Agent Worker | Fastify, Claude Agent SDK (TS), BullMQ consumer | Railway Service 2 |
| Job Queue | BullMQ | Connects to Railway Redis |
| Cache / Queue Backend | Redis | Railway managed service |
| Database | Supabase Postgres | Supabase Cloud |
| Auth | Supabase Auth | Supabase Cloud |
| Real-time | Supabase Realtime + Next.js SSE | Supabase + Railway |
| AI Models | Claude Sonnet 4.6 (manager), Haiku 4.5 (workers) | Anthropic API |
| Language | TypeScript | Everywhere |

---

## Agent Architecture

### The Dunder Mifflin Triage Team

All agents report to Michael. Michael is the only agent that communicates with others. No agent-to-agent communication.

```
                        ┌─────────────────────┐
                        │   MICHAEL SCOTT      │
                        │   Triage Manager      │
                        │   (Sonnet 4.6)        │
                        │                       │
                        │   • Analyzes tickets   │
                        │   • Delegates to team  │
                        │   • Synthesizes results │
                        │   • Makes final call   │
                        └──────────┬────────────┘
                                   │
           ┌───────────┬───────────┼───────────┬───────────┐
           │           │           │           │           │
           ▼           ▼           ▼           ▼           ▼
    ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐
    │ DWIGHT  │ │  JIM    │ │  PAM    │ │  RYAN   │ │  ANDY   │
    │ Hudu    │ │JumpCloud│ │ Comms   │ │ Analytics│ │ Datto   │
    └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘
           │           │           │           │           │
    ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐
    │ STANLEY │ │ PHYLLIS │ │ ANGELA  │ │ OSCAR   │ │ KEVIN   │
    │ Vultr   │ │ DNS/MX  │ │ Security│ │ Reports │ │ Patches │
    └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘
           │           │           │
    ┌─────────┐ ┌─────────┐ ┌─────────┐
    │ KELLY   │ │  TOBY   │ │MEREDITH │
    │ Notifs  │ │Compliance│ │ Legacy  │
    └─────────┘ └─────────┘ └─────────┘
```

### Agent Roster

| Agent | Character | Specialty | Integration | Model | Tools |
|---|---|---|---|---|---|
| **Manager** | Michael Scott | Triage Orchestrator | Halo PSA (read/write) | Sonnet 4.6 | All Halo endpoints, delegates to workers |
| **Documentation** | Dwight Schrute | IT Documentation & Assets | Hudu | Haiku 4.5 | Assets, passwords, articles, procedures, companies |
| **Identity** | Jim Halpert | User & Device Identity | JumpCloud | Haiku 4.5 | Users, devices, groups, MFA status, policies |
| **Communications** | Pam Beesly | Response Drafting & Comms | Halo (notes) | Sonnet 4.6 | Draft responses, internal notes, client comms |
| **Analytics** | Ryan Howard | Ticket Classification & Priority | Internal | Haiku 4.5 | Classify type, score urgency, detect patterns |
| **Endpoint Mgmt** | Andy Bernard | Device Monitoring & RMM | Datto RMM | Haiku 4.5 | Device status, alerts, patch status, software audit |
| **Cloud Infra** | Stanley Hudson | Cloud Infrastructure | Vultr | Haiku 4.5 | Instances, DNS, firewalls, bandwidth |
| **DNS/Email** | Phyllis Vance | Email & DNS Diagnostics | MX Toolbox | Haiku 4.5 | MX, SPF, DKIM, DMARC, blacklist checks |
| **Security** | Angela Martin | Security Assessment | Cross-platform | Haiku 4.5 | Analyze security implications, flag incidents |
| **Reporting** | Oscar Martinez | Financial & SLA Reporting | Supabase | Haiku 4.5 | SLA tracking, cost analysis, metrics |
| **Patch Mgmt** | Kevin Malone | Patch Compliance | Datto RMM | Haiku 4.5 | Patch status, missing updates, compliance |
| **Notifications** | Kelly Kapoor | Alert & Notification Routing | Webhooks | Haiku 4.5 | Escalation rules, notification delivery |
| **Compliance** | Toby Flenderson | Compliance & Audit | Cross-platform | Haiku 4.5 | Audit logs, compliance checks, policy review |
| **Legacy Systems** | Meredith Palmer | Legacy & Edge Cases | Various | Haiku 4.5 | Handle unusual ticket types, legacy integrations |

### Reserved Characters (Future Agents)

| Character | Planned Specialty |
|---|---|
| Creed Bratton | Shadow IT Detection |
| Darryl Philbin | Workflow Automation |
| Karen Filippelli | Vendor Management |
| Erin Hannon | Client Onboarding |
| Holly Flax | Training & Knowledge Base |
| Jan Levinson | Project Management |
| David Wallace | Executive Reporting |
| Charles Miner | Escalation Management |
| Jo Bennett | Multi-Tenant Management |
| Robert California | Strategic Analysis |
| Nellie Bertram | Process Improvement |
| Deangelo Vickers | Disaster Recovery |
| Clark Green | Social Media / Web Monitoring |
| Pete Miller | Mobile Device Management |
| Danny Cordray | Sales/Billing Integration |
| Todd Packer | On-site Dispatch Coordination |
| Madge Madsen | Hardware Inventory |
| Lonny Collins | Network Monitoring |
| Roy Anderson | Physical Security |

---

## Integration Details

### 1. Halo PSA (Michael Scott - Manager)

**Auth**: OAuth 2.0 Client Credentials
**Trigger**: Webhook on new ticket → POST to our endpoint
**Fallback**: Polling via `GET /api/tickets` with `datesearch` + `startdate`

**Capabilities**:
- Read ticket details: `GET /api/tickets/{id}`
- Read ticket actions: `GET /api/actions?ticket_id={id}`
- Update ticket priority/status: `POST /api/tickets` (with `id` field)
- Add internal notes: `POST /api/actions` (with `hiddenfromuser: true`)
- Add client-facing notes: `POST /api/actions` (with `hiddenfromuser: false`)
- Update custom fields: via `customfields` array on ticket update

### 2. Hudu (Dwight Schrute - Documentation)

**Auth**: API Key (`x-api-key` header)
**Base URL**: `https://{instance}.hudu.com/api/v1/`

**Capabilities**:
- Search assets: `GET /api/v1/assets?search={term}&company_id={id}`
- Get asset layouts (printer, email, network, etc.): `GET /api/v1/asset_layouts`
- Lookup passwords: `GET /api/v1/asset_passwords?company_id={id}`
- Search KB articles: `GET /api/v1/articles?search={term}`
- Find procedures: `GET /api/v1/procedures?search={term}`
- Company info: `GET /api/v1/companies/{id}`

**Asset Types Available**: Printers, Email configs, Network Devices, Computers, Wireless, People/Contacts

### 3. JumpCloud (Jim Halpert - Identity)

**Auth**: API Key (`x-api-key` header) or OAuth 2.0
**Base URL**: `https://console.jumpcloud.com`

**Capabilities**:
- List/search users: `GET /api/systemusers?filter=username:$eq:{name}`
- Check MFA status: `filter=totp_enabled:$eq:true`
- Get device details: `GET /api/systems/{id}`
- List user groups: `GET /api/v2/usergroups`
- Check device associations: `GET /api/v2/systems/{id}/associations`

### 4. Datto RMM (Andy Bernard + Kevin Malone)

**Auth**: OAuth 2.0 Client Credentials
**Base URL**: Region-specific (e.g., `https://pinotage-api.centrastage.net`)
**Rate Limits**: 600 reads / 100 writes per 60 seconds

**Capabilities**:
- List all devices: `GET /v2/account/devices`
- Device details: `GET /v2/device/{uid}`
- Open alerts: `GET /v2/device/{uid}/alerts/open`
- Software audit: `GET /v2/device/{uid}/softwareaudit`
- Run remote jobs: `POST /v2/device/{uid}/quickjob` (future - actions phase)
- Patch status: via device patch management fields

### 5. Vultr (Stanley Hudson - Cloud Infra)

**Auth**: Bearer Token
**Base URL**: `https://api.vultr.com`

**Capabilities**:
- List instances: `GET /v2/instances`
- Instance details: `GET /v2/instances/{id}`
- Bandwidth usage: `GET /v2/instances/{id}/bandwidth`
- DNS management: `GET /v2/domains/{domain}/records`
- Firewall rules: `GET /v2/firewalls/{group-id}/rules`

### 6. MX Toolbox (Phyllis Vance - DNS/Email)

**Auth**: API Key (`Authorization` header)
**Base URL**: `https://mxtoolbox.com`

**Capabilities**:
- MX records: `GET /api/v1/Lookup/mx/{domain}`
- SPF check: `GET /api/v1/Lookup/spf/{domain}`
- DKIM check: `GET /api/v1/Lookup/dkim/{selector._domainkey.domain}`
- DMARC check: `GET /api/v1/Lookup/dmarc/{domain}`
- Blacklist check: `GET /api/v1/Lookup/blacklist/{ip-or-domain}`
- SMTP diagnostics: `GET /api/v1/Lookup/smtp/{mail-server}`

---

## Data Flow

```
1. TICKET INTAKE
   Halo PSA webhook → POST /api/webhooks/halo
   │
   ▼
2. QUEUE
   Insert into Supabase `tickets` table → Enqueue BullMQ job
   │
   ▼
3. TRIAGE (Fastify Worker)
   Michael Scott (Manager) receives ticket
   │
   ├─→ Ryan Howard: Classify ticket type & urgency score
   │
   ├─→ Based on classification, Michael asks relevant specialists:
   │   ├─→ Dwight (Hudu): "What do we know about this client/asset?"
   │   ├─→ Jim (JumpCloud): "What's the user's MFA/device status?"
   │   ├─→ Andy (Datto): "Any alerts on this device?"
   │   ├─→ Phyllis (MX Toolbox): "Check email/DNS for this domain"
   │   ├─→ Stanley (Vultr): "What's the server status?"
   │   └─→ Angela (Security): "Any security concerns?"
   │
   ├─→ Michael synthesizes all findings
   │
   ├─→ Pam (Comms): Draft response & internal notes
   │
   ▼
4. WRITE BACK
   Michael updates Halo ticket:
   ├─→ Set priority based on Ryan's urgency score
   ├─→ Add internal note with Dwight/Jim/Andy findings
   ├─→ Add suggested response from Pam
   ├─→ Update custom fields (classification, confidence score)
   │
   ▼
5. DASHBOARD UPDATE
   Supabase Realtime pushes update → Next.js dashboard reflects results
   Admin reviews → Approves/Adjusts → Final update sent to Halo
```

---

## Database Schema (Supabase)

### Core Tables

```sql
-- Admin users for the dashboard
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  email TEXT NOT NULL,
  full_name TEXT,
  role TEXT DEFAULT 'viewer', -- admin, manager, viewer
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Integration credentials (encrypted)
CREATE TABLE integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service TEXT NOT NULL, -- halo, hudu, jumpcloud, datto, vultr, mxtoolbox
  display_name TEXT NOT NULL,
  config JSONB NOT NULL, -- encrypted API keys, URLs, tenant info
  is_active BOOLEAN DEFAULT false,
  last_health_check TIMESTAMPTZ,
  health_status TEXT DEFAULT 'unknown', -- healthy, degraded, down, unknown
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Incoming tickets from Halo
CREATE TABLE tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  halo_id INTEGER NOT NULL UNIQUE,
  summary TEXT NOT NULL,
  details TEXT,
  client_name TEXT,
  client_id INTEGER,
  user_name TEXT,
  user_email TEXT,
  original_priority INTEGER,
  status TEXT DEFAULT 'pending', -- pending, triaging, triaged, approved, error
  raw_data JSONB, -- full Halo ticket payload
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Triage results from the agent pipeline
CREATE TABLE triage_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES tickets(id),
  classification JSONB NOT NULL, -- { type, subtype, confidence }
  urgency_score INTEGER NOT NULL, -- 1-5
  urgency_reasoning TEXT,
  recommended_priority INTEGER,
  recommended_team TEXT,
  recommended_agent TEXT,
  security_flag BOOLEAN DEFAULT false,
  security_notes TEXT,
  findings JSONB, -- { agent_name: { summary, data, confidence } }
  suggested_response TEXT,
  internal_notes TEXT,
  processing_time_ms INTEGER,
  model_tokens_used JSONB, -- { manager: N, workers: { agent: N } }
  approved_by UUID REFERENCES profiles(id),
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Agent execution log for debugging and analytics
CREATE TABLE agent_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES tickets(id),
  agent_name TEXT NOT NULL, -- michael_scott, dwight_schrute, etc.
  agent_role TEXT NOT NULL, -- manager, documentation, identity, etc.
  status TEXT NOT NULL, -- started, completed, error, skipped
  input_summary TEXT,
  output_summary TEXT,
  tokens_used INTEGER,
  duration_ms INTEGER,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Triage rules and configuration
CREATE TABLE triage_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  conditions JSONB NOT NULL, -- { field, operator, value }
  actions JSONB NOT NULL, -- { set_priority, assign_team, skip_agents, etc. }
  priority INTEGER DEFAULT 0, -- rule evaluation order
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

---

## Project Structure

```
triageit/
├── apps/
│   ├── web/                          # Next.js 15 App Router
│   │   ├── src/
│   │   │   ├── app/
│   │   │   │   ├── (auth)/           # Login/signup pages
│   │   │   │   ├── (dashboard)/      # Protected dashboard routes
│   │   │   │   │   ├── tickets/      # Ticket list + detail views
│   │   │   │   │   ├── agents/       # Agent status + logs
│   │   │   │   │   ├── integrations/ # Integration config (adminland)
│   │   │   │   │   ├── rules/        # Triage rule management
│   │   │   │   │   ├── analytics/    # Reporting dashboard
│   │   │   │   │   └── settings/     # App settings
│   │   │   │   ├── api/
│   │   │   │   │   ├── webhooks/     # Halo webhook receiver
│   │   │   │   │   └── stream/       # SSE endpoints for live triage
│   │   │   │   └── layout.tsx
│   │   │   ├── components/
│   │   │   │   ├── ui/               # shadcn/ui components
│   │   │   │   ├── tickets/          # Ticket-specific components
│   │   │   │   ├── agents/           # Agent visualization components
│   │   │   │   └── integrations/     # Integration config forms
│   │   │   └── lib/
│   │   │       ├── supabase/         # Supabase client + types
│   │   │       └── utils/
│   │   └── package.json
│   │
│   └── worker/                       # Fastify Agent Worker
│       ├── src/
│       │   ├── server.ts             # Fastify + BullMQ setup
│       │   ├── agents/
│       │   │   ├── manager/
│       │   │   │   └── michael-scott.ts    # Triage Manager
│       │   │   ├── workers/
│       │   │   │   ├── dwight-schrute.ts   # Hudu Documentation
│       │   │   │   ├── jim-halpert.ts      # JumpCloud Identity
│       │   │   │   ├── pam-beesly.ts       # Communications
│       │   │   │   ├── ryan-howard.ts      # Classification
│       │   │   │   ├── andy-bernard.ts     # Datto RMM
│       │   │   │   ├── stanley-hudson.ts   # Vultr Cloud
│       │   │   │   ├── phyllis-vance.ts    # MX Toolbox DNS
│       │   │   │   ├── angela-martin.ts    # Security
│       │   │   │   ├── oscar-martinez.ts   # Reporting
│       │   │   │   ├── kevin-malone.ts     # Patch Mgmt
│       │   │   │   ├── kelly-kapoor.ts     # Notifications
│       │   │   │   └── toby-flenderson.ts  # Compliance
│       │   │   └── types.ts
│       │   ├── integrations/
│       │   │   ├── halo/
│       │   │   │   ├── client.ts           # Halo PSA API client
│       │   │   │   ├── auth.ts             # OAuth token management
│       │   │   │   └── types.ts
│       │   │   ├── hudu/
│       │   │   │   ├── client.ts           # Hudu API client
│       │   │   │   └── types.ts
│       │   │   ├── jumpcloud/
│       │   │   │   ├── client.ts
│       │   │   │   └── types.ts
│       │   │   ├── datto/
│       │   │   │   ├── client.ts
│       │   │   │   └── types.ts
│       │   │   ├── vultr/
│       │   │   │   ├── client.ts
│       │   │   │   └── types.ts
│       │   │   └── mxtoolbox/
│       │   │       ├── client.ts
│       │   │       └── types.ts
│       │   ├── queue/
│       │   │   ├── producer.ts
│       │   │   └── consumer.ts
│       │   └── db/
│       │       └── supabase.ts
│       └── package.json
│
├── packages/
│   └── shared/                       # Shared types & utilities
│       ├── src/
│       │   ├── types/
│       │   │   ├── ticket.ts
│       │   │   ├── triage.ts
│       │   │   ├── agent.ts
│       │   │   └── integration.ts
│       │   └── constants/
│       │       ├── agents.ts          # Agent definitions & personas
│       │       └── integrations.ts    # Service identifiers
│       └── package.json
│
├── supabase/
│   ├── migrations/                   # Database migrations
│   └── seed.sql                      # Default triage rules
│
├── turbo.json                        # Turborepo config
├── package.json                      # Root workspace
├── .env.example
└── docs/
    └── architecture.md               # This file
```

---

## Implementation Phases

### Phase 1: Foundation (MVP)
- [ ] Project scaffolding (Turborepo + Next.js + Fastify)
- [ ] Supabase setup (auth, database schema, RLS policies)
- [ ] Dashboard login & layout (Supabase Auth)
- [ ] Integration settings page (adminland) — store API keys securely
- [ ] Halo PSA integration (webhook receiver + API client)
- [ ] Michael Scott manager agent (basic ticket analysis)
- [ ] Ryan Howard classifier agent (ticket type + urgency scoring)
- [ ] Write triage results back to Halo as internal notes
- [ ] Basic ticket list view with triage status

### Phase 2: Intelligence
- [ ] Dwight Schrute — Hudu integration (asset/documentation lookup)
- [ ] Jim Halpert — JumpCloud integration (user/device identity)
- [ ] Pam Beesly — Response drafting agent
- [ ] Ticket detail view with agent findings
- [ ] Approve/adjust triage results from dashboard
- [ ] BullMQ queue with priority processing

### Phase 3: Full Coverage
- [ ] Andy Bernard — Datto RMM integration (device monitoring)
- [ ] Stanley Hudson — Vultr integration (cloud infrastructure)
- [ ] Phyllis Vance — MX Toolbox integration (DNS/email diagnostics)
- [ ] Angela Martin — Security assessment agent
- [ ] Kevin Malone — Patch compliance agent
- [ ] Real-time triage progress via Supabase Realtime

### Phase 4: Operations
- [ ] Oscar Martinez — SLA & reporting dashboard
- [ ] Kelly Kapoor — Notification routing (escalation rules)
- [ ] Toby Flenderson — Compliance & audit logging
- [ ] Triage rules engine (custom rules from dashboard)
- [ ] Analytics & accuracy tracking
- [ ] Meredith Palmer — Legacy system handling

### Phase 5: Automation (Future)
- [ ] Agent actions (restart services via Datto, etc.)
- [ ] Auto-approve for high-confidence triage results
- [ ] Activate reserved agents (Creed, Darryl, etc.)
- [ ] Multi-tenant support
- [ ] Mobile app

---

## Railway Deployment

```
Railway Project: triageit
├── Service: web (Next.js)
│   ├── Build: npm run build --filter=web
│   ├── Start: npm run start --filter=web
│   └── Domain: triageit.up.railway.app
├── Service: worker (Fastify)
│   ├── Build: npm run build --filter=worker
│   └── Start: npm run start --filter=worker
├── Service: redis (Railway managed)
│   └── Internal URL for BullMQ
└── Environment Variables:
    ├── ANTHROPIC_API_KEY
    ├── SUPABASE_URL
    ├── SUPABASE_ANON_KEY
    ├── SUPABASE_SERVICE_ROLE_KEY
    └── REDIS_URL (auto-injected)
```

Integration API keys are stored in the Supabase `integrations` table (encrypted), not as environment variables — so they can be managed from the dashboard.
