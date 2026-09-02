/** The product mark: a gate with a counter beneath it. Drawn once, reused. */
export function Mark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3 7h18M3 7v13M21 7v13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="square" />
      <path d="M7 7v6h10V7" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="12" cy="17" r="2" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}
