import { LOCKUP, WORD_BOX, WORD_PATH } from "./paths";

// The Konnect mark: a K whose arms meet at a single point — where two people meet.
// Ink follows currentColor; the node takes the accent.

export function MarkPaths({ node = "var(--accent)" }: { node?: string }) {
  return (
    <>
      <path d="M11 8.5V39.5M37 8.5L26.4 19.4M37 39.5L26.4 28.6" fill="none" stroke="currentColor" strokeWidth="5.4" strokeLinecap="round" />
      <circle cx="21.2" cy="24" r="3.9" fill={node} />
    </>
  );
}

export function Mark({ size = 32, className, node }: { size?: number; className?: string; node?: string }) {
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} className={className} aria-hidden="true">
      <MarkPaths node={node} />
    </svg>
  );
}

export function Logo({ height = 26, className, node }: { height?: number; className?: string; node?: string }) {
  const w = (LOCKUP.width / LOCKUP.height) * height;
  return (
    <svg viewBox={`0 ${LOCKUP.top} ${LOCKUP.width} ${LOCKUP.height}`} width={w} height={height} className={className} role="img" aria-label="Konnect">
      <g transform={`translate(${LOCKUP.markX} ${LOCKUP.markY}) scale(${LOCKUP.markScale})`}>
        <MarkPaths node={node} />
      </g>
      <path transform={`translate(${LOCKUP.wordX} 0)`} fill="currentColor" d={WORD_PATH} />
    </svg>
  );
}

export function Wordmark({ height = 24, className }: { height?: number; className?: string }) {
  const b = WORD_BOX;
  return (
    <svg viewBox={`${b.x} ${b.y - 1} ${b.w} ${b.h + 2}`} height={height} width={(b.w / (b.h + 2)) * height} className={className} role="img" aria-label="Konnect">
      <path fill="currentColor" d={WORD_PATH} />
    </svg>
  );
}
