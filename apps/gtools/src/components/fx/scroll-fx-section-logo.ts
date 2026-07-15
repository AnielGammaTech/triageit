import type { ScrollTrigger } from "gsap/ScrollTrigger";
import type { ScrollFxContext, ScrollFxCleanup } from "./scroll-fx-context";

const GLIDE_DISTANCE_PX = 130;

// THE LOGO JOURNEY, phase 3 (task 17) — each tool section's own logo
// performs a "guide" entrance: as the section scrubs into view, the logo
// glides down from above the kicker into its docked position, with a thin
// accent trail (logo-trail, tool-section.tsx) shrinking away behind it as
// it lands. One timeline per section (same pattern as the copy/mockup
// parallax differential in scroll-fx-parallax.ts), scrub-based so scrolling
// back up un-docks it exactly.
//
// The trigger is the kicker text, not the section box: `items-center` on
// the copy/mockup grid means a section with a tall mockup (e.g. ConnectIT's
// diagram) vertically centers its copy column well below the section's own
// top edge, so a section-anchored "top 85%"/"top 45%" window can finish
// before the kicker ever scrolls into view. The kicker sits in the same flex
// row as the logo and is never itself transformed by this effect, so it's a
// stable, accurately-positioned anchor — same fix `registerDecryptKickers`
// already applies by triggering off the kicker element itself.
export function registerSectionLogoGlide({ gsap }: ScrollFxContext): ScrollFxCleanup {
  const triggers: ScrollTrigger[] = [];

  document.querySelectorAll<HTMLElement>('[data-fx="tool-section"]').forEach((section) => {
    const logo = section.querySelector<HTMLElement>('[data-fx="section-logo"]');
    const trail = section.querySelector<HTMLElement>('[data-fx="logo-trail"]');
    const kicker = section.querySelector<HTMLElement>('[data-fx="decrypt-kicker"]');
    if (!logo) return;

    const tl = gsap.timeline({
      scrollTrigger: {
        trigger: kicker ?? logo,
        start: "top 85%",
        end: "top 45%",
        scrub: 0.5,
      },
    });

    tl.fromTo(logo, { y: -GLIDE_DISTANCE_PX, opacity: 0 }, { y: 0, opacity: 1, ease: "none" }, 0);
    if (trail) {
      tl.fromTo(
        trail,
        { scaleY: 1, opacity: 0.9 },
        { scaleY: 0, opacity: 0, ease: "none" },
        0,
      );
    }

    if (tl.scrollTrigger) triggers.push(tl.scrollTrigger);
  });

  return () => {
    triggers.forEach((trigger) => trigger?.kill());
  };
}
