# ADR-009: Dashboard architecture

**Status:** Accepted — 2026-09-02

## Vite SPA, not Next.js

**Decision.** React + Vite, built to static assets, served by the gateway.

**Why.** Every screen is behind authentication and renders per-user data, so
there is nothing to server-render or statically generate. Next.js would add a
second runtime to deploy, a second place for environment configuration to be
wrong, and a rendering model whose main benefits (SSR, ISR, RSC) this product
cannot use.

**Rejected: Next.js.** Better if the landing page needed SEO at scale or if any
authenticated view needed server rendering for first paint. Neither applies:
the landing page is one route, and the dashboard's first paint is gated on a
session check anyway.

**Rejected: serving the dashboard from a separate static host (Vercel, Pages).**
Faster asset delivery, independent deploys. Rejected because the session lives
in a cookie: same-origin makes it first-party, removes CORS from the picture
entirely, and leaves no origin allowlist to get wrong. One container instead of
two also removes a whole class of "which URL is the API" configuration bugs.

**Cost accepted.** A dashboard-only change requires redeploying the API.

## Polling, not WebSockets

The overview refreshes every 15 seconds with three small indexed queries.

**Rejected: WebSocket or SSE push.** Genuinely nicer, and the right answer if
this were a live tail. Rejected because it adds connection lifecycle, reconnect
and backpressure handling to get a number that nobody reads at sub-15-second
resolution. A cost dashboard is not a trading terminal.

**Revisit when** a live request tail is added — that view has a real argument
for streaming, and the SSE machinery already exists for the proxy path.

## Route-level code splitting

The landing page is what a first-time visitor loads and needs no charting
library. Splitting moved Recharts into the Overview chunk: the entry bundle went
from 190 kB to 78 kB gzipped, and the landing page no longer downloads a
charting library it never renders.

## No component framework

No shadcn/ui, no MUI. The product is tables, figures and two charts. A component
kit would have supplied a lot of surface this design does not use, and the
generated-dashboard look comes precisely from using a kit's defaults unchanged.
Tailwind provides the tokens; the eight components in `src/components` are the
whole system.

## Money never becomes a JavaScript number

The API returns cost as a `NUMERIC` string with 10 decimal places (ADR-002).
`formatCost` works on the string and parses only for display, never for a value
that will be summed. Parsing to `number` in the client would reintroduce the
float error the backend exists to avoid.

## Accessibility floor
Semantic tables with `<caption>` and scoped headers; one visible focus ring on
every interactive element; the detail drawer closes on Escape and traps nothing
the keyboard cannot reach; colour never carries meaning alone — every status
pill states its outcome in words; `prefers-reduced-motion` disables the pipe
animation and all transitions.
