import { Nav } from "@/components/nav";
import { Hero } from "@/components/hero";
import { SuiteGrid } from "@/components/suite-grid";
import { BetterTogether } from "@/components/better-together";
import { ToolSection } from "@/components/tool-section";
import { Footer } from "@/components/footer";
import { TOOLS } from "@/content/tools";

export default function Home() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <SuiteGrid />
        <BetterTogether />
        {TOOLS.map((tool, i) => (
          <ToolSection key={tool.slug} tool={tool} flip={i % 2 === 1} />
        ))}
      </main>
      <Footer />
    </>
  );
}
