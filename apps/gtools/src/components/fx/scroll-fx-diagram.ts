import type { ScrollFxContext, ScrollFxCleanup } from "./scroll-fx-context";

const RADAR_ARM_PROGRESS = 0.9;

// Effect 4 — ConnectIT diagram assembly. The diagram (better-together.tsx)
// is plain divs, not SVG, so "drawing" a connector is a scaleY/scaleX tween
// against the transform-origin fx-scroll.css already pins per element
// (`data-fx-origin`). Everything below is measured in DOM order, which
// matches the component's fixed structure: 3 suite chips, top fan (bus +
// 3 stems), 2 junction dots (either side of the node), bottom fan (bus +
// 4 stems), 4 platform chips.
export function registerConnectItDiagram({ gsap, ScrollTrigger }: ScrollFxContext): ScrollFxCleanup {
  const diagram = document.querySelector<HTMLElement>('[data-fx="connectit-diagram"]');
  if (!diagram) return () => {};

  const chips = Array.from(diagram.querySelectorAll<HTMLElement>('[data-fx="chip"]'));
  const suiteChips = chips.slice(0, 3);
  const platformChips = chips.slice(3);
  const buses = Array.from(diagram.querySelectorAll<HTMLElement>('[data-fx="connector-bus"]'));
  const stems = Array.from(diagram.querySelectorAll<HTMLElement>('[data-fx="connector-stem"]'));
  const topStems = stems.slice(0, 3);
  const bottomStems = stems.slice(3);
  const junctions = Array.from(diagram.querySelectorAll<HTMLElement>('[data-fx="junction-dot"]'));
  const node = diagram.querySelector<HTMLElement>('[data-fx="connectit-node"]');

  gsap.set(suiteChips, { y: -10, opacity: 0 });
  gsap.set(platformChips, { y: 10, opacity: 0 });
  gsap.set(buses, { scaleX: 0 });
  gsap.set(stems, { scaleY: 0 });
  gsap.set(junctions, { scale: 0 });
  if (node) gsap.set(node, { scale: 0.85, opacity: 0 });

  const tl = gsap.timeline({
    scrollTrigger: {
      trigger: diagram,
      start: "top 78%",
      end: "bottom 55%",
      scrub: 0.5,
      onUpdate(self) {
        if (node) node.toggleAttribute("data-fx-armed", self.progress >= RADAR_ARM_PROGRESS);
      },
    },
  });

  tl.to(suiteChips, { y: 0, opacity: 1, stagger: 0.1, ease: "none" }, 0)
    .to(buses[0] ?? [], { scaleX: 1, ease: "none" }, 0.3)
    .to(topStems, { scaleY: 1, stagger: 0.08, ease: "none" }, 0.4)
    .to(junctions[0] ?? [], { scale: 1, ease: "none" }, 0.65)
    .to(node ?? [], { scale: 1, opacity: 1, ease: "none" }, 0.7)
    .to(junctions[1] ?? [], { scale: 1, ease: "none" }, 0.95)
    .to(buses[1] ?? [], { scaleX: 1, ease: "none" }, 1.05)
    .to(bottomStems, { scaleY: 1, stagger: 0.06, ease: "none" }, 1.15)
    .to(platformChips, { y: 0, opacity: 1, stagger: 0.08, ease: "none" }, 1.35);

  return () => {
    tl.scrollTrigger?.kill();
    tl.kill();
    gsap.set([...chips, ...buses, ...stems, ...junctions, node].filter(Boolean) as HTMLElement[], {
      clearProps: "transform,opacity",
    });
    node?.removeAttribute("data-fx-armed");
    ScrollTrigger.refresh();
  };
}
