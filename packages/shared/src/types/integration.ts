export type ServiceType =
  | "halo"
  | "hudu"
  | "jumpcloud"
  | "datto"
  | "datto-edr"
  | "rocketcyber"
  | "unifi"
  | "vpentest"
  | "saas-alerts"
  | "unitrends"
  | "cove"
  | "pax8"
  | "darkweb"
  | "bullphish"
  | "inky"
  | "vultr"
  | "mxtoolbox"
  | "dmarc"
  | "threecx"
  | "spanning"
  | "twilio"
  | "ai-provider";

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

export interface SpanningConfig {
  readonly api_key: string;
  readonly region: string;
}

export interface ThreeCxConfig {
  readonly api_url: string;
  readonly api_key: string;
}

export interface TwilioConfig {
  readonly account_sid: string;
  readonly auth_token: string;
}

export interface GenericApiKeyConfig {
  readonly api_key: string;
}

export interface GenericApiUrlKeyConfig {
  readonly api_url: string;
  readonly api_key: string;
}

export type IntegrationConfig =
  | HaloConfig
  | HuduConfig
  | JumpCloudConfig
  | DattoConfig
  | VultrConfig
  | MxToolboxConfig
  | SpanningConfig
  | ThreeCxConfig
  | TwilioConfig
  | GenericApiKeyConfig
  | GenericApiUrlKeyConfig
  | Record<string, string>;

export interface IntegrationConfigField {
  readonly key: string;
  readonly label: string;
  readonly type: "text" | "password" | "url" | "select";
  readonly placeholder: string;
  readonly required: boolean;
  readonly options?: ReadonlyArray<{ readonly value: string; readonly label: string }>;
}

export interface IntegrationDefinition {
  readonly service: ServiceType;
  readonly display_name: string;
  readonly description: string;
  readonly fields: ReadonlyArray<IntegrationConfigField>;
}
