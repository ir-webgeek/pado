// Deterministic star field, rounded so server and client serialize identical styles. Pure CSS motion.
const round = (n: number) => Math.round(n * 100) / 100;
const stars = Array.from({ length: 70 }, (_, i) => {
  const r = (n: number) => ((Math.sin(i * 999 + n) + 1) / 2) % 1;
  return { x: round(r(1) * 100), y: round(r(2) * 70), s: r(3) > 0.85 ? 2 : 1, d: round(r(4) * 4) };
});

export function Sky() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute inset-x-0 top-24 mx-auto size-[28rem] rounded-full bg-gold/10 blur-3xl animate-halo" />
      {stars.map((st, i) => (
        <span
          key={i}
          className="absolute rounded-full bg-white/80 animate-twinkle"
          style={{ left: `${st.x}%`, top: `${st.y}%`, width: st.s, height: st.s, animationDelay: `${st.d}s` }}
        />
      ))}
      {/* two hill layers; the back one drifts slowly like promall's landscape */}
      <svg className="absolute -inset-x-[6%] bottom-0 h-40 w-[112%] text-[var(--bg)] animate-drift" viewBox="0 0 1440 160" preserveAspectRatio="none">
        <path d="M0 120 C 240 60, 420 150, 720 100 S 1200 40, 1440 110 V160 H0 Z" fill="currentColor" opacity=".55" />
      </svg>
      <svg className="absolute inset-x-0 bottom-0 h-40 w-full text-[var(--bg)]" viewBox="0 0 1440 160" preserveAspectRatio="none">
        <path d="M0 140 C 300 100, 520 160, 860 130 S 1260 100, 1440 140 V160 H0 Z" fill="currentColor" />
      </svg>
    </div>
  );
}
