# gtools — gtools.io promotional site

Static single-page showcase of the Gamma Tech tool suite. No env vars, no database.

## Develop
npm run dev --workspace=gtools   # http://localhost:3002

## Deploy (Railway — TriageIT project)
1. New service "gtools" from this GitHub repo.
2. Settings → Config file path: `apps/gtools/railway.json`.
3. Settings → Watch paths: `apps/gtools/**`, `packages/**`.
4. Settings → Networking → Custom domain: `gtools.io` (apex only — no www).
5. Cloudflare DNS: flattened CNAME on the apex pointing at the Railway domain, DNS-only or proxied per preference.

## Content edits
All copy lives in `src/content/tools.ts`. To swap a CSS mockup for a real
screenshot, add the image under `public/screenshots/` and set `screenshotSrc`
on that tool.
