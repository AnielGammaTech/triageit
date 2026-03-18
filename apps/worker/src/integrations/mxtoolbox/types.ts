export interface MxLookupResponse {
  readonly Command: string;
  readonly IsTransitioned: boolean;
  readonly CommandArgument: string;
  readonly TimeoutSeconds: number;
  readonly Information: ReadonlyArray<MxInformation>;
  readonly Failed: ReadonlyArray<MxFailed>;
  readonly Passed: ReadonlyArray<MxPassed>;
  readonly Warnings: ReadonlyArray<MxWarning>;
  readonly Errors: ReadonlyArray<string>;
  readonly RelatedLookups: ReadonlyArray<MxRelatedLookup>;
}

export interface MxInformation {
  readonly Type: string;
  readonly AdditionalInfo: string;
  readonly Status: number;
  readonly Domain: string;
  readonly IP: string;
  readonly Hostname: string;
  readonly TTL: string;
  readonly Info: string;
}

export interface MxFailed {
  readonly Name: string;
  readonly Info: string;
  readonly AdditionalInfo: string;
  readonly Url: string;
}

export interface MxPassed {
  readonly Name: string;
  readonly Info: string;
  readonly AdditionalInfo: string;
  readonly Url: string;
}

export interface MxWarning {
  readonly Name: string;
  readonly Info: string;
  readonly AdditionalInfo: string;
  readonly Url: string;
}

export interface MxRelatedLookup {
  readonly Name: string;
  readonly Command: string;
  readonly CommandArgument: string;
  readonly Url: string;
}

export interface EmailDiagnostics {
  readonly domain: string;
  readonly mx: MxLookupResponse | null;
  readonly spf: MxLookupResponse | null;
  readonly dmarc: MxLookupResponse | null;
  readonly blacklist: MxLookupResponse | null;
  readonly smtp: MxLookupResponse | null;
  readonly errors: ReadonlyArray<string>;
}
