import { Link } from 'react-router-dom';
import { Suspense, lazy, useState } from 'react';
import { Mark } from '../components/Mark';

const GatewayScene = lazy(() =>
  import('../components/GatewayScene').then((m) => ({ default: m.GatewayScene })));

/**
 * The hero is the product's own diagram, animated with the actual thing it
 * does: requests travelling a pipe through a gate that counts them. This is the
 * one place motion is used, and it is not decoration — it is the explanation.
 *
 * Kept as the fallback for the 3D scene: no WebGL, JS still loading, or the
 * dynamic import failing all land here, so the hero is never blank.
 */
function Pipe() {
  return (
    <svg viewBox="0 0 720 220" className="w-full h-auto" role="img"
      aria-label="Applications send requests through the gateway, which meters, limits and caches them before forwarding to model providers.">
      <g stroke="var(--color-rule)" strokeWidth="1">
        <line x1="0" y1="60" x2="720" y2="60" />
        <line x1="0" y1="160" x2="720" y2="160" />
      </g>

      {/* Left: applications */}
      {[95, 130].map((y, i) => (
        <g key={y}>
          <rect x="8" y={y - 13} width="118" height="26" fill="var(--color-surface)" stroke="var(--color-rule)" />
          <text x="67" y={y + 4} textAnchor="middle" fontSize="11.5" fill="var(--color-ink-soft)"
            fontFamily="var(--font-sans)">{i === 0 ? 'Your API' : 'Your workers'}</text>
        </g>
      ))}

      {/* Inbound flow */}
      <path d="M126 95 H286 M126 130 H286" stroke="var(--color-accent)" strokeWidth="1.4"
        className="pipe-flow" fill="none" />

      {/* The gate */}
      <rect x="288" y="52" width="144" height="116" fill="var(--color-surface)" stroke="var(--color-accent)" strokeWidth="1.4" />
      <text x="360" y="76" textAnchor="middle" fontSize="12" fontWeight="600"
        fill="var(--color-accent)" fontFamily="var(--font-sans)">Tollgate</text>
      {['authenticate', 'rate limit', 'cache', 'meter', 'record'].map((t, i) => (
        <text key={t} x="360" y={96 + i * 15} textAnchor="middle" fontSize="10.5"
          fill="var(--color-ink-soft)" fontFamily="var(--font-mono)">{t}</text>
      ))}

      {/* Outbound flow */}
      <path d="M432 95 H586 M432 130 H586" stroke="var(--color-accent)" strokeWidth="1.4"
        className="pipe-flow" fill="none" />

      {/* Right: providers */}
      {[95, 130].map((y, i) => (
        <g key={y}>
          <rect x="588" y={y - 13} width="124" height="26" fill="var(--color-surface)" stroke="var(--color-rule)" />
          <text x="650" y={y + 4} textAnchor="middle" fontSize="11.5" fill="var(--color-ink-soft)"
            fontFamily="var(--font-sans)">{i === 0 ? 'Model provider' : 'Fallback provider'}</text>
        </g>
      ))}

      <text x="360" y="196" textAnchor="middle" fontSize="11" fill="var(--color-ink-faint)"
        fontFamily="var(--font-sans)">Every request counted, priced and kept</text>
    </svg>
  );
}

const CAPABILITIES: Array<[string, string]> = [
  ['Spend you can trust',
   'Costs are computed from provider-reported token counts in exact decimal arithmetic, never floating point. A request whose cost is unknown is shown as unknown, not as zero.'],
  ['Limits that hold under load',
   'Rate limiting runs as a single atomic Redis script, so concurrent requests cannot slip past the limit together. A sliding window means no cliff at the minute boundary.'],
  ['A cache that cannot leak',
   'Cache keys are namespaced by organization and project before anything else, so two tenants sending the same prompt never see each other\'s response.'],
  ['Retries that bill once',
   'Send an Idempotency-Key and a retry returns the original response byte for byte, without a second charge — even when several retries arrive at the same moment.'],
  ['Failures on the record',
   'Rate-limited, timed-out and provider-failed requests are all written to the ledger. A dashboard that only counts successes disagrees with your invoice.'],
  ['Streaming, properly',
   'Responses stream through as server-sent events, with client disconnects cancelling the upstream call so you stop paying for tokens nobody will read.'],
];

export function Landing() {
  return (
    <div className="min-h-dvh">
      <header className="border-b border-rule bg-surface">
        <div className="max-w-[1080px] mx-auto px-5 h-14 flex items-center justify-between">
          <span className="flex items-center gap-2 text-ink"><Mark /><b className="text-[15px] tracking-tight">Tollgate</b></span>
          <nav className="flex items-center gap-4 text-[13px]">
            <Link to="/login" className="text-ink-soft hover:text-ink">Sign in</Link>
            <Link to="/signup" className="px-3 h-8 leading-8 bg-accent text-paper font-medium">Create organization</Link>
          </nav>
        </div>
      </header>

      <main className="max-w-[1080px] mx-auto px-5">
        <section className="pt-14 pb-10 grid lg:grid-cols-[minmax(0,420px)_1fr] gap-10 items-center">
          <div>
            <h1 className="text-[38px] sm:text-[46px] leading-[1.05] font-semibold tracking-tight">
              Every AI request, accounted for
            </h1>
            <p className="mt-4 text-[15px] leading-relaxed text-ink-soft max-w-[52ch]">
              Point your applications at Tollgate instead of the provider. It authenticates
              them, holds them to their limits, serves what it can from cache, and writes down
              exactly what each request cost.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              <Link to="/signup" className="px-4 h-9 leading-9 bg-accent text-paper text-[14px] font-medium">
                Create an organization
              </Link>
              <Link to="/login" className="px-4 h-9 leading-9 border border-rule bg-surface text-[14px]">
                Sign in
              </Link>
            </div>
          </div>
          {/*
           * The hero visual: the 3D scene where it can run, the original
           * diagram everywhere else — no WebGL, reduced-motion, slow network,
           * or a failed dynamic import all resolve to the same fallback.
           */}
          <div className="bg-surface border border-rule p-4">
            <Suspense fallback={<Pipe />}>
              <GatewayHero />
            </Suspense>
          </div>
        </section>

        <section className="py-10 border-t border-rule">
          <h2 className="text-[13px] font-semibold text-ink-soft">What it handles</h2>
          <div className="mt-5 grid sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-7">
            {CAPABILITIES.map(([title, body]) => (
              <div key={title}>
                <h3 className="text-[14px] font-semibold">{title}</h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-ink-soft">{body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="py-10 border-t border-rule grid lg:grid-cols-2 gap-8 items-start">
          <div>
            <h2 className="text-[20px] font-semibold tracking-tight">One change to your client</h2>
            <p className="mt-2 text-[13px] leading-relaxed text-ink-soft max-w-[52ch]">
              Tollgate speaks the OpenAI chat completions format. Change the base URL and the
              key; everything else stays as it is.
            </p>
          </div>
          <pre className="figure text-[12px] leading-relaxed bg-surface border border-rule p-4 overflow-x-auto">
{`curl https://your-gateway/v1/chat/completions \\
  -H "Authorization: Bearer tg_live_..." \\
  -H "Idempotency-Key: order-4471" \\
  -d '{
    "model": "mock-small",
    "messages": [{"role":"user","content":"hello"}]
  }'`}
          </pre>
        </section>
      </main>

      <footer className="border-t border-rule mt-6">
        <div className="max-w-[1080px] mx-auto px-5 py-6 text-[12px] text-ink-faint flex flex-wrap gap-x-4 gap-y-2 justify-between">
          <span>Tollgate — an LLM gateway and usage meter.</span>
          <span>Built as an engineering portfolio project. Not a commercial service.</span>
        </div>
      </footer>
    </div>
  );
}

/**
 * GatewayScene reports, one tick after mount, whether WebGL is actually
 * available — a check that cannot be expressed as a Suspense fallback because
 * it isn't about the module loading, it's about the runtime environment. This
 * wrapper holds that as real state, so "no WebGL" swaps to the SVG diagram in
 * the same render rather than leaving an empty box.
 */
function GatewayHero() {
  const [unsupported, setUnsupported] = useState(false);
  if (unsupported) return <Pipe />;
  return <GatewayScene onUnsupported={() => setUnsupported(true)} />;
}