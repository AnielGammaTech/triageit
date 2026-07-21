# ScreenIT

ScreenIT is a separate candidate-screening application inside the TriageIT monorepo. It deploys as its own Railway service, has its own logo and domain, and uses a dedicated Supabase project for recruiting data.

## Local preview

```bash
SCREENIT_DEMO_MODE=true npm run dev:screenit
```

The demo workspace is synthetic. No TriageIT production data is used.

## Production boundaries

- Staff authentication: Supabase email and password (`NEXT_PUBLIC_SUPABASE_*`).
- Recruiting data: dedicated ScreenIT Supabase (`NEXT_PUBLIC_SCREENIT_SUPABASE_*` and `SCREENIT_SUPABASE_SERVICE_ROLE_KEY`).
- Voice: server-minted OpenAI Realtime client secrets. The OpenAI API key never reaches the browser.
- Candidate entry: opaque interview link with explicit transcription consent.
- Audio: not retained by default. Transcript and evidence report are retained.
- Decision: ScreenIT does not accept/reject candidates or produce a hidden candidate score.

Apply `supabase/migrations/0001_screenit_initial.sql` only to the dedicated ScreenIT Supabase project.

## Railway service

Use the repository root as the source root and `apps/screenit-web/Dockerfile` as the Dockerfile path. Health endpoint: `/api/health`.
