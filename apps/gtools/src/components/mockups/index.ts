import type { MockupKey } from "@/content/types";
import { TriageitMockup } from "./triageit";
import { SecureitMockup } from "./secureit";
import { ProjectitMockup } from "./projectit";
import { PortalitMockup } from "./portalit";
import { QuoteitMockup } from "./quoteit";
import { ConnectitMockup } from "./connectit";
import { RunitMockup } from "./runit";
import { PhoneitMockup } from "./phoneit";

export const MOCKUPS: Record<MockupKey, () => React.JSX.Element> = {
  triageit: TriageitMockup,
  secureit: SecureitMockup,
  projectit: ProjectitMockup,
  portalit: PortalitMockup,
  quoteit: QuoteitMockup,
  connectit: ConnectitMockup,
  runit: RunitMockup,
  phoneit: PhoneitMockup,
};
