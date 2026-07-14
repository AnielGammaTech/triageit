import { Nav } from "@/components/nav";
import { Hero } from "@/components/hero";
import { SuiteGrid } from "@/components/suite-grid";
import { BetterTogether } from "@/components/better-together";
import { ToolSection } from "@/components/tool-section";
import { Footer } from "@/components/footer";
import { Backdrop } from "@/components/fx/backdrop";
import { Marquee } from "@/components/fx/marquee";
import { Spotlight } from "@/components/fx/spotlight";
import { ReticleCursor } from "@/components/fx/cursor";
import { EasterEgg } from "@/components/fx/easter-egg";
import { TOOLS } from "@/content/tools";

export default function Home() {
  return (
    <>
      <Backdrop />
      <Spotlight />
      <Nav />
      <main>
        <Hero />
        <Marquee />
        <SuiteGrid />
        <BetterTogether />
        {TOOLS.map((tool, i) => (
          <ToolSection key={tool.slug} tool={tool} flip={i % 2 === 1} />
        ))}
      </main>
      <Footer />
      <ReticleCursor />
      <EasterEgg />
    </>
  );
}
