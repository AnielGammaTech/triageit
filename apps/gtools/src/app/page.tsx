import { Nav } from "@/components/nav";
import { Hero } from "@/components/hero";
import { SuiteGrid } from "@/components/suite-grid";
import { BetterTogether } from "@/components/better-together";
import { StatsStrip } from "@/components/stats-strip";
import { ToolSection } from "@/components/tool-section";
import { Footer } from "@/components/footer";
import { Backdrop } from "@/components/fx/backdrop";
import { Spotlight } from "@/components/fx/spotlight";
import { ReticleCursor } from "@/components/fx/cursor";
import { SmokeTrail } from "@/components/fx/smoke-trail";
import { EasterEgg } from "@/components/fx/easter-egg";
import { ScrollFx } from "@/components/fx/scroll-fx";
import { BackToTop } from "@/components/fx/back-to-top";
import { TOOLS } from "@/content/tools";

export default function Home() {
  return (
    <>
      <Backdrop />
      <Spotlight />
      <Nav />
      <main>
        <Hero />
        <SuiteGrid />
        <BetterTogether />
        <StatsStrip />
        {TOOLS.map((tool, i) => (
          <ToolSection key={tool.slug} tool={tool} flip={i % 2 === 1} index={i} />
        ))}
      </main>
      <Footer />
      <ReticleCursor />
      <SmokeTrail />
      <EasterEgg />
      <ScrollFx />
      <BackToTop />
    </>
  );
}
