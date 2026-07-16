import type { MockupKey } from "@/content/types";
import { TriageitMockup } from "./triageit";
import { SecureitMockup } from "./secureit";
import { ProjectitMockup } from "./projectit";
import { PortalitMockup } from "./portalit";
import { QuoteitMockup } from "./quoteit";
import { AccountitMockup } from "./accountit";
import { LootitMockup } from "./lootit";
import { ConnectitMockup } from "./connectit";
import { RunitMockup } from "./runit";
import { PhoneitMockup } from "./phoneit";
import { VenditMockup } from "./vendit";

export const MOCKUPS: Record<MockupKey, () => React.JSX.Element> = {
  triageit: TriageitMockup,
  secureit: SecureitMockup,
  projectit: ProjectitMockup,
  portalit: PortalitMockup,
  quoteit: QuoteitMockup,
  accountit: AccountitMockup,
  lootit: LootitMockup,
  connectit: ConnectitMockup,
  runit: RunitMockup,
  phoneit: PhoneitMockup,
  vendit: VenditMockup,
};
