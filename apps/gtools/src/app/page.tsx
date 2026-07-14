import { BetterTogether } from "@/components/better-together";
import { Footer } from "@/components/footer";
import { Hero } from "@/components/hero";
import { Nav } from "@/components/nav";
import { SuiteGrid } from "@/components/suite-grid";

export default function Home() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <SuiteGrid />
        <BetterTogether />
      </main>
      <Footer />
    </>
  );
}
