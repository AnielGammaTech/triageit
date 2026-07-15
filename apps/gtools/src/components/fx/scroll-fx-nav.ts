import type { ScrollFxContext, ScrollFxCleanup } from "./scroll-fx-context";

// Effect 6 — scroll progress beam (fixed right-edge hairline, filled via
// scaleY against whole-document scroll) plus the active-section nav
// underline: each tool section gets its own ScrollTrigger window (roughly
// "in the middle third of the viewport"), toggling `data-active` on the
// matching nav link (fx-journey.css draws the accent-colored underline/left
// accent bar off that attribute, whether the link lives in the "Tools"
// dropdown panel or a flat nav row). Both directions are handled by
// `onToggle`, so scrolling back up un-highlights cleanly — no separate
// "reverse" logic needed. Also copies the same `--nav-accent` onto the
// dropdown trigger itself (nav.tsx, `[data-fx="nav-tools-trigger"]`), so
// which tool is active stays legible even with the panel closed.
export function registerProgressAndNav({
  gsap,
  ScrollTrigger,
}: ScrollFxContext): ScrollFxCleanup {
  const triggers: Array<ReturnType<typeof ScrollTrigger.create>> = [];

  const beam = document.querySelector<HTMLElement>('[data-fx="progress-beam"]');
  if (beam) {
    const tween = gsap.to(beam, {
      scaleY: 1,
      ease: "none",
      scrollTrigger: {
        trigger: document.body,
        start: "top top",
        end: "bottom bottom",
        scrub: true,
      },
    });
    if (tween.scrollTrigger) triggers.push(tween.scrollTrigger);
  }

  const navLinks = new Map<string, HTMLElement>();
  document.querySelectorAll<HTMLElement>('[data-fx="nav-link"]').forEach((link) => {
    const target = link.dataset.fxTarget;
    if (target) navLinks.set(target, link);
  });

  const toolsTrigger = document.querySelector<HTMLElement>('[data-fx="nav-tools-trigger"]');
  function syncTriggerAccent() {
    if (!toolsTrigger) return;
    const activeLink = document.querySelector<HTMLElement>(
      '[data-fx="nav-link"][data-active="true"]',
    );
    if (activeLink) {
      toolsTrigger.style.setProperty(
        "--nav-accent",
        activeLink.style.getPropertyValue("--nav-accent"),
      );
    } else {
      toolsTrigger.style.removeProperty("--nav-accent");
    }
  }

  document.querySelectorAll<HTMLElement>('[data-fx="tool-section"]').forEach((section) => {
    const slug = section.dataset.fxSlug;
    const link = slug ? navLinks.get(slug) : undefined;
    if (!link) return;

    triggers.push(
      ScrollTrigger.create({
        trigger: section,
        start: "top center",
        end: "bottom center",
        onToggle(self) {
          if (self.isActive) link.setAttribute("data-active", "true");
          else link.removeAttribute("data-active");
          syncTriggerAccent();
        },
      }),
    );
  });

  return () => {
    triggers.forEach((trigger) => trigger?.kill());
    navLinks.forEach((link) => link.removeAttribute("data-active"));
    toolsTrigger?.style.removeProperty("--nav-accent");
  };
}
