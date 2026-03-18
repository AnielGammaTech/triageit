export type ServiceType =
  | "halo"
  | "hudu"
  | "jumpcloud"
  | "datto"
  | "vultr"
  | "mxtoolbox"
  | "teams"
  | "cipp";

export type HealthStatus = "healthy" | "degraded" | "down" | "unknown";

export interface Integration {
  readonly id: string;
  readonly service: ServiceType;
  readonly display_name: string;
  readonly config: IntegrationConfig;
  readonly is_active: boolean;
  readonly last_health_check: string | null;
  readonly health_status: HealthStatus;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface HaloConfig {
  readonly base_url: string;
  readonly client_id: string;
  readonly client_secret: string;
  readonly tenant?: string;
}

export interface HuduConfig {
  readonly base_url: string;
  readonly api_key: string;
}

export interface JumpCloudConfig {
  readonly api_key: string;
}

export interface DattoConfig {
  readonly api_url: string;
  readonly api_key: string;
  readonly api_secret: string;
}

export interface VultrConfig {
  readonly api_key: string;
}

export interface MxToolboxConfig {
  readonly api_key: string;
}

export interface TeamsConfig {
  readonly webhook_url: string;
  readonly channel_name?: string;
}

export interface CippConfig {
  readonly base_url: string;
  readonly client_id: string;
  readonly client_secret: string;
  readonly tenant_id: string;
}

export type IntegrationConfig =
  | HaloConfig
  | HuduConfig
  | JumpCloudConfig
  | DattoConfig
  | VultrConfig
  | MxToolboxConfig
  | TeamsConfig
  | CippConfig;

export interface IntegrationConfigField {
  readonly key: string;
  readonly label: string;
  readonly type: "text" | "password" | "url";
  readonly placeholder: string;
  readonly required: boolean;
}

export interface IntegrationDefinition {
  readonly service: ServiceType;
  readonly display_name: string;
  readonly description: string;
  readonly fields: ReadonlyArray<IntegrationConfigField>;
}
