// Types
export type {
  HaloTicket,
  HaloCustomField,
  HaloAction,
  HaloAttachment,
  TicketStatus,
  Ticket,
} from "./types/ticket.js";

export type {
  TicketClassification,
  AgentFinding,
  ModelTokenUsage,
  TriageResult,
} from "./types/triage.js";

export type { AgentStatus, AgentLog, AgentDefinition } from "./types/agent.js";

export type {
  ServiceType,
  HealthStatus,
  Integration,
  HaloConfig,
  HuduConfig,
  JumpCloudConfig,
  DattoConfig,
  UnifiConfig,
  VultrConfig,
  SpanningConfig,
  ThreeCxConfig,
  TwilioConfig,
  GenericApiKeyConfig,
  GenericApiUrlKeyConfig,
  TeamsConfig,
  CoveConfig,
  UnitrendsConfig,
  CippConfig,
  MxToolboxConfig,
  Pax8Config,
  IntegrationConfig,
  IntegrationConfigField,
  IntegrationDefinition,
} from "./types/integration.js";

export type {
  SkillType,
  AgentSkill,
  MemoryType,
  AgentMemory,
  MemoryMatch,
  MemoryConfig,
} from "./types/memory.js";

export { DEFAULT_MEMORY_CONFIG } from "./types/memory.js";

export type {
  HaloWorkflowStatus,
  HaloWorkflowOwnerRole,
  HaloWorkflowState,
} from "./types/workflow.js";

// Constants
export {
  AGENTS,
  PHASE_1_AGENTS,
  PHASE_2_AGENTS,
  PHASE_3_AGENTS,
} from "./constants/agents.js";

export { INTEGRATION_DEFINITIONS } from "./constants/integrations.js";

export { isSlaTargetBreached, isSlaTimerBreached } from "./constants/sla.js";
export {
  isCustomerReplyStatus,
  isCustomerWaitingForTech,
  isWaitingOnTechStatus,
} from "./constants/action-queues.js";
export { ACCOUNT_MANAGERS, DISPATCHER, TEAM_FACTS } from "./constants/workflow.js";
export {
  BUSINESS_TIME_ZONE,
  BUSINESS_START_MINUTE,
  BUSINESS_END_MINUTE,
  isBusinessTime,
} from "./constants/business-time.js";

export {
  WORKFLOW_STATUSES,
  WORKFLOW_OWNER_ROLES,
  HELPDESK_TECHNICIANS,
  SUPPORT_CALL_STAFF,
  CALL_AUDIT_STAFF,
  NON_TECH_STAFF,
  FORMER_STAFF_NAMES,
  INTERNAL_STAFF_NAMES,
  deriveWorkflowOwnerRole,
  deriveWorkflowStatusFromHalo,
  isHelpdeskTechnicianName,
  isSupportCallStaffName,
  isAccountManagerName,
  isCallAuditStaffName,
  isKnownNonTechStaffName,
  isInternalStaffName,
} from "./constants/workflow.js";
