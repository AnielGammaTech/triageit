# GTools Top Bar Standard

This repository follows the locked GTools application-shell standard. The canonical full specification is `~/Documents/GTools Brand/gtools-topbar-standard.md` and the visual source of truth is `~/Documents/GTools Brand/brand-guidelines.html`.

## TriageIT tokens

- Locked surface hex: `#A61B1B`
- Dark-ground text tint: `#E05555`
- Official assets: `~/Documents/GTools Brand/<Product>/<product>-mark.svg`
- Product name: white on dark glass, `#141311` on light
- `IT` suffix and dark-ground active rule: product tint
- Solid mark, avatar, and primary-command surfaces: locked hex

## Locked geometry

| Element | Value |
| --- | --- |
| Header | 64px |
| Inner width | 1800px max, centered |
| Gutters | 16px mobile, 24px desktop |
| Mark canvas | 52px |
| Mark optical lift | -3.25px beside a wordmark |
| Mark gap | 10px |
| Wordmark | Sora Bold, 22px, line-height 1, letter-spacing 0 |
| Optional descriptor | 9px uppercase, 0.08em tracking |
| Navigation | 64px high, 18px icon, 8px gap |
| Active rule | 2px product tint |
| Controls | 36px high, 8px radius, 18px icons |
| Avatar | 32px inside a 36px trigger |
| Content offset | 64px when the header is fixed |

## Shell contract

Desktop has three stable zones: brand and selector on the left, primary navigation centered, and commands/profile on the right. Use `minmax(0,1fr) auto minmax(0,1fr)` when the shell supports a three-column grid. Mobile keeps the header height and mark size, hides the wordmark only when required, and moves navigation into a 36px menu control.

The glass surface uses 72-78% dark opacity, 30px blur, 140% saturation, a subtle white top highlight, and a bottom border derived from the tint. Do not introduce unrelated accent colors.

## Required checks

1. Compare the shipped SVG byte-for-byte with the brand archive.
2. Verify 1440x900 and 390x844 layouts.
3. Confirm no clipping, overlap, or movement when controls appear.
4. Check keyboard focus, labels, profile menu, mobile navigation, and active state.
5. Use `Page · ProductIT` browser titles, or `Tenant · Section · ProductIT`.
6. Run the production build and focused tests before deployment.
