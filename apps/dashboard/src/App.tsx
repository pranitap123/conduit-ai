import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Landing } from './pages/Landing';
import { Auth } from './pages/Auth';

/*
 * Route-level code splitting.
 *
 * The landing page is what a first-time visitor loads, and it needs no charting
 * library, no data tables and no app shell. Recharts alone is most of the
 * bundle, so shipping it to someone who has not signed in is wasted bytes on
 * the one page where load time is most visible.
 */
const Shell = lazy(async () => ({ default: (await import('./components/Shell')).Shell }));
const Overview = lazy(async () => ({ default: (await import('./pages/Overview')).Overview }));
const Requests = lazy(async () => ({ default: (await import('./pages/Requests')).Requests }));
const Keys = lazy(async () => ({ default: (await import('./pages/Keys')).Keys }));

/** Holds layout while a route chunk arrives, so nothing shifts on arrival. */
function Pending() {
  return <div className="min-h-dvh p-6" aria-busy="true"><span className="sr-only">Loading</span></div>;
}

function App_({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<Pending />}><Shell>{children}</Shell></Suspense>;
}

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<Pending />}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Auth mode="login" />} />
          <Route path="/signup" element={<Auth mode="signup" />} />
          <Route path="/app" element={<App_><Overview /></App_>} />
          <Route path="/app/requests" element={<App_><Requests /></App_>} />
          <Route path="/app/keys" element={<App_><Keys /></App_>} />
          <Route path="*" element={<Landing />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
