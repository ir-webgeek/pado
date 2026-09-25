// Deterministic star field (no hydration mismatch), pure CSS twinkle.
const stars = Array.from({ length: 70 }, (_, i) => {
  const r = (n: number) => ((Math.sin(i * 999 + n) + 1) / 2) % 1;
  return { x: r(1) * 100, y: r(2) * 70, s: r(3) > 0.85 ? 2 : 1, d: r(4) * 4 };
});

export function Sky() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {stars.map((st, i) => (
        <span
          key={i}
          className="absolute rounded-full bg-white/80 animate-twinkle"
          style={{ left: `${st.x}%`, top: `${st.y}%`, width: st.s, height: st.s, animationDelay: `${st.d}s` }}
        />
      ))}
      <svg className="absolute inset-x-0 bottom-0 h-40 w-full text-[var(--bg)]" viewBox="0 0 1440 160" preserveAspectRatio="none">
        <path d="M0 120 C 240 60, 420 150, 720 100 S 1200 40, 1440 110 V160 H0 Z" fill="currentColor" opacity=".55" />
        <path d="M0 140 C 300 100, 520 160, 860 130 S 1260 100, 1440 140 V160 H0 Z" fill="currentColor" />
      </svg>
    </div>
  );
}
