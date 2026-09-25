export function LogoMark({ size = 28 }: { size?: number }) {
  // a bag whose handle is a crescent moon - shop + "night-shift" agent
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden>
      <rect x="4" y="10" width="24" height="19" rx="6" fill="var(--accent)" />
      <path d="M11 11V9a5 5 0 0 1 10 0v2" stroke="var(--accent)" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M19.5 15.5a5 5 0 1 0 0 8 4 4 0 1 1 0-8Z" fill="var(--accent-ink)" />
    </svg>
  );
}

export function Logo({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-2 font-bold strong">
      <LogoMark />
      <span className="text-lg tracking-tight">{label}</span>
    </span>
  );
}
