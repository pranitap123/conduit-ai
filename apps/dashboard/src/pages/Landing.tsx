import { Link } from 'react-router-dom';
import { Suspense, lazy, useState } from 'react';
import { Mark } from '../components/Mark';

const GatewayScene = lazy(() =>
  import('../components/GatewayScene').then((m) => ({ default: m.GatewayScene })));

function FallbackHero() {
  return (
    <div className="w-full h-[320px] sm:h-[420px] flex items-center justify-center border border-rule bg-surface relative overflow-hidden">
      <div className="absolute inset-0 bg-[linear-gradient(var(--color-rule)_1px,transparent_1px),linear-gradient(90deg,var(--color-rule)_1px,transparent_1px)] bg-[size:36px_36px] opacity-40" />
      <div className="relative z-10 w-16 h-16 border border-rule bg-surface-2 flex items-center justify-center pulse-ring">
        <Mark size={30} />
      </div>
    </div>
  );
}

const CAPABILITIES = [
  { title: 'Zero-leak caching', body: 'Cache keys are strictly namespaced by organization and project. Tenant prompts never bleed across boundaries.' },
  { title: 'Atomic rate limiting', body: 'Implemented via single atomic Redis scripts. No concurrency slip-ups under heavy production load.' },
  { title: 'Idempotent retries', body: 'Send an Idempotency-Key and retries return the exact original response byte-for-byte, billed only once.' },
  { title: 'True streaming', body: 'Responses stream as SSE. Client disconnects instantly cancel upstream calls, halting runaway token spend.' },
  { title: 'Exact-precision spend', body: 'Costs computed from provider-reported token counts using strict decimal arithmetic. No floating-point drift.' },
  { title: 'Ledger-grade telemetry', body: 'Rate limits, timeouts, and upstream failures are recorded instantly. Complete observability, zero dropped logs.' },
];

export function Landing() {
  return (
    <div className="min-h-dvh flex flex-col bg-bg">
      <header className="fixed top-0 inset-x-0 z-50 bg-bg/95 border-b border-rule">
        <div className="max-w-6xl mx-auto px-6 h-18 flex items-center justify-between">
          <span className="flex items-center gap-2.5 text-ink">
            <Mark size={22} />
            <b className="text-[18px] tracking-tight font-semibold">Conduit</b>
          </span>
          <nav className="flex items-center gap-6">
            <Link to="/login" className="text-[15px] font-medium text-ink-soft hover:text-ink transition-colors">Sign in</Link>
            <Link to="/signup" className="text-[15px] font-medium px-4 py-2 bg-ink text-bg hover:opacity-85 transition-opacity">
              Deploy gateway
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1 w-full max-w-6xl mx-auto px-6 pt-32 pb-24">
        {/* Hero */}
        <section className="flex flex-col items-center text-center mt-8 mb-16">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 border border-rule bg-surface text-ink-soft text-[13px] font-medium mb-7 animate-in">
            <span className="w-1.5 h-1.5 rounded-full bg-accent" />
            Control plane active
          </div>
          <h1 className="t-hero text-ink mb-5 max-w-3xl animate-in stagger-1">
            Every AI request, routed and accounted for.
          </h1>
          <p className="t-body text-ink-soft max-w-xl mb-9 animate-in stagger-2">
            Point your applications at Conduit instead of the provider. Authenticate traffic, enforce limits, serve from cache, and log exact token spend — instantly.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 animate-in stagger-3">
            <Link to="/signup" className="px-7 py-3.5 bg-accent text-paper font-medium text-[15px] hover:opacity-90 transition-opacity">
              Start building
            </Link>
            <Link to="/login" className="px-7 py-3.5 bg-surface text-ink font-medium text-[15px] border border-rule hover:bg-surface-2 transition-colors">
              View dashboard
            </Link>
          </div>
        </section>

        {/* 3D architecture */}
        <section className="mb-24 w-full animate-in stagger-4">
          <p className="text-center t-label mb-4">Application → Conduit gateway → Providers</p>
          <Suspense fallback={<FallbackHero />}>
            <GatewayHero />
          </Suspense>
        </section>

        {/* Feature grid */}
        <section className="py-16 border-t border-rule">
          <div className="mb-12">
            <h2 className="t-page text-ink mb-3">Infrastructure-grade architecture</h2>
            <p className="t-body text-ink-soft max-w-xl">Engineered for production scale. Conduit handles the complexity of LLM traffic routing so your application doesn't have to.</p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 border border-rule divide-y lg:divide-y-0 lg:divide-x divide-rule">
            {CAPABILITIES.map((cap) => (
              <div key={cap.title} className="p-7 bg-surface panel-hover">
                <h3 className="text-[16px] font-semibold text-ink mb-2.5">{cap.title}</h3>
                <p className="t-body text-ink-soft">{cap.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Integration */}
        <section className="py-16 border-t border-rule grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <h2 className="t-page text-ink mb-5">Zero-friction integration.</h2>
            <p className="t-body text-ink-soft">
              Conduit natively speaks the OpenAI chat completions format. Change your base URL and bearer token; your application logic remains entirely untouched.
            </p>
          </div>
          <div className="bg-surface border border-rule overflow-hidden">
            <div className="border-b border-rule px-5 py-3 t-label">Terminal</div>
            <pre className="figure text-[14px] leading-relaxed p-5 overflow-x-auto text-ink">
{`curl https://gateway.conduit.dev/v1/chat/completions \\
  -H "Authorization: Bearer tg_live_..." \\
  -H "Idempotency-Key: req-tx-4471" \\
  -d '{
    "model": "gpt-4o",
    "messages": [{"role":"user","content":"status"}]
  }'`}
            </pre>
          </div>
        </section>
      </main>

      <footer className="border-t border-rule bg-surface py-10">
        <div className="max-w-6xl mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-5">
          <span className="flex items-center gap-2 text-ink-soft text-[14px]">
            <Mark size={16} /> Conduit AI control plane
          </span>
          <span className="figure text-[12px] text-ink-faint uppercase tracking-widest border border-rule px-3 py-1.5">
            System operational
          </span>
        </div>
      </footer>
    </div>
  );
}

function GatewayHero() {
  const [unsupported, setUnsupported] = useState(false);
  if (unsupported) return <FallbackHero />;
  return <GatewayScene onUnsupported={() => setUnsupported(true)} />;
}