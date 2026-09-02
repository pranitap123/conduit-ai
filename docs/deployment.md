# Deployment

The application is one container: the Fastify gateway, which also serves the
built dashboard. It needs a Postgres database and a Redis instance.

## Secrets

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Process refuses to start without it |
| `REDIS_URL` | yes | Same |
| `AUTH_SECRET` | yes in production | Signs session tokens. Rotating it signs everyone out |
| `CORS_ORIGIN` | no | Unused when the dashboard is served from the same origin |
| `ENABLED_PROVIDERS` | no | Defaults to `mock`. Add `openai` to enable the real adapter |
| `OPENAI_API_KEY` | only with `openai` enabled | Omitting it skips the provider rather than failing at request time |
| `OPENAI_BASE_URL` | no | Point at Groq, Together, vLLM or any OpenAI-compatible endpoint |

## Fly.io

```bash
fly launch --no-deploy                 # uses the committed fly.toml
fly postgres create --name tollgate-db
fly postgres attach tollgate-db        # sets DATABASE_URL
fly redis create                       # sets REDIS_URL
fly secrets set AUTH_SECRET="$(openssl rand -base64 32)"
fly deploy
```

Migrations run at boot, inside a transaction per file, before the server listens.
For a single-machine deployment that is correct and simple. **With more than one
machine it becomes a race** — two instances booting together would both try to
apply the same migration. The transaction makes that safe rather than corrupting
anything, but the right fix at that point is a release command:

```toml
[deploy]
  release_command = "node apps/gateway/dist/db/migrate.js"
```

Not enabled now, because a release command on a single machine adds a deploy
step for no benefit. Recorded so the decision is visible rather than forgotten.

## Seeding the demo

```bash
fly ssh console -C "node apps/gateway/dist/demo/seed.js --url http://localhost:3000 --count 500"
```

This drives real traffic through the deployed gateway. It does not insert rows.

## Any other host

Anywhere that runs a container works. Render, Railway and a plain VM with
`docker compose --profile app up` all need the same four environment variables
and a reachable Postgres and Redis.

## Not configured

- No CDN. Assets are served by the app with a one-year cache on hashed
  filenames; at this traffic level a CDN would be ceremony.
- No autoscaling. One machine.
- No backups beyond whatever the managed Postgres provides by default.
- **Deployment has not been executed.** This document is the configuration and
  the procedure; the running URL does not exist until someone runs `fly deploy`
  with their own credentials.
