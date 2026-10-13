import sharp from "sharp";

/**
 * Demo pictures drawn from simple shapes (no fonts, no network), so the demo shop looks finished even
 * offline. Each kind is a soft gradient with one product silhouette.
 */
export type ArtKind = "bag" | "shoe" | "dress" | "blouse" | "coat" | "ring" | "necklace" | "candle" | "giftbox" | "mug" | "bottle" | "scarf" | "hair" | "color" | "nails" | "makeup" | "logo" | "receipt" | "story";

const W = 900;
const H = 1125;

const shapes: Record<ArtKind, (c: string, d: string) => string> = {
  bag: (c, d) => `<path d="M330 430 Q450 250 570 430" fill="none" stroke="${d}" stroke-width="26" stroke-linecap="round"/>
    <path d="M250 440 H650 L700 820 Q700 860 660 860 H240 Q200 860 200 820 Z" fill="${c}"/>
    <rect x="410" y="520" width="80" height="44" rx="10" fill="${d}" opacity=".7"/>`,
  shoe: (c, d) => `<path d="M170 720 Q180 560 300 540 L420 520 Q470 600 560 610 L700 640 Q760 660 760 720 V770 H170 Z" fill="${c}"/>
    <rect x="160" y="770" width="610" height="46" rx="20" fill="${d}"/>
    <path d="M330 560 L360 620 M380 545 L410 610 M430 540 L460 605" stroke="${d}" stroke-width="10" stroke-linecap="round"/>`,
  dress: (c, d) => `<path d="M380 250 Q450 300 520 250 L560 330 L520 420 L640 880 H260 L380 420 L340 330 Z" fill="${c}"/>
    <path d="M380 420 H520" stroke="${d}" stroke-width="14"/>`,
  blouse: (c, d) => `<path d="M330 300 Q450 360 570 300 L700 380 L650 500 L600 470 V820 H300 V470 L250 500 L200 380 Z" fill="${c}"/>
    <path d="M420 330 L450 420 L480 330" fill="none" stroke="${d}" stroke-width="10"/>`,
  coat: (c, d) => `<path d="M320 270 L450 330 L580 270 L700 360 L680 860 H220 L200 360 Z" fill="${c}"/>
    <path d="M450 330 V860" stroke="${d}" stroke-width="10"/>
    <circle cx="420" cy="500" r="12" fill="${d}"/><circle cx="420" cy="600" r="12" fill="${d}"/><circle cx="420" cy="700" r="12" fill="${d}"/>`,
  ring: (c, d) => `<circle cx="450" cy="640" r="170" fill="none" stroke="${c}" stroke-width="44"/>
    <path d="M450 380 L520 450 L450 520 L380 450 Z" fill="${d}"/>`,
  necklace: (c, d) => `<path d="M230 300 Q450 820 670 300" fill="none" stroke="${c}" stroke-width="14"/>
    <path d="M450 560 a60 60 0 1 0 0.1 0 Z" fill="${d}"/><circle cx="470" cy="610" r="48" fill="${c}"/>`,
  candle: (c, d) => `<rect x="300" y="460" width="300" height="400" rx="40" fill="${c}"/>
    <rect x="300" y="460" width="300" height="70" rx="30" fill="${d}" opacity=".5"/>
    <path d="M450 360 Q490 410 450 450 Q410 410 450 360 Z" fill="#f2b84b"/><rect x="444" y="440" width="12" height="30" fill="${d}"/>`,
  giftbox: (c, d) => `<rect x="230" y="470" width="440" height="380" rx="20" fill="${c}"/><rect x="210" y="400" width="480" height="90" rx="16" fill="${c}"/>
    <rect x="425" y="400" width="50" height="450" fill="${d}"/><path d="M450 400 Q360 300 380 380 M450 400 Q540 300 520 380" fill="none" stroke="${d}" stroke-width="22"/>`,
  mug: (c, d) => `<rect x="270" y="440" width="300" height="360" rx="40" fill="${c}"/>
    <path d="M570 520 Q690 520 690 620 Q690 720 570 720" fill="none" stroke="${c}" stroke-width="40"/>
    <path d="M360 330 Q390 380 360 410 M430 320 Q460 370 430 400 M500 330 Q530 380 500 410" fill="none" stroke="${d}" stroke-width="12" stroke-linecap="round"/>`,
  bottle: (c, d) => `<rect x="400" y="300" width="100" height="90" rx="12" fill="${d}"/>
    <rect x="290" y="380" width="320" height="460" rx="60" fill="${c}"/><rect x="340" y="560" width="220" height="140" rx="16" fill="${d}" opacity=".35"/>`,
  scarf: (c, d) => `<path d="M220 340 Q450 260 680 340 L640 500 Q450 430 260 500 Z" fill="${c}"/>
    <path d="M300 480 Q330 700 280 880 L380 880 Q420 700 380 480 Z" fill="${c}"/><path d="M290 860 V900 M320 860 V900 M350 860 V900" stroke="${d}" stroke-width="8"/>`,
  hair: (c, d) => `<circle cx="450" cy="520" r="240" fill="${c}"/><path d="M260 470 Q450 230 640 470 Q620 760 450 820 Q280 760 260 470 Z" fill="${d}" opacity=".55"/>`,
  color: (c, d) => `<circle cx="340" cy="520" r="150" fill="${c}"/><circle cx="560" cy="520" r="150" fill="${d}" opacity=".8"/><circle cx="450" cy="700" r="150" fill="#f2b84b" opacity=".7"/>`,
  nails: (c, d) => `${[0, 1, 2, 3, 4].map((i) => `<rect x="${230 + i * 95}" y="${420 + Math.abs(2 - i) * 40}" width="70" height="200" rx="35" fill="${i % 2 ? d : c}"/>`).join("")}`,
  makeup: (c, d) => `<rect x="260" y="380" width="120" height="440" rx="30" fill="${c}"/><rect x="420" y="460" width="120" height="360" rx="30" fill="${d}"/><circle cx="640" cy="640" r="90" fill="${c}" opacity=".7"/>`,
  logo: (c, d) => `<circle cx="450" cy="562" r="300" fill="${c}"/><circle cx="530" cy="500" r="250" fill="${d}"/>`,
  receipt: (c, d) => `<rect x="250" y="200" width="400" height="720" rx="18" fill="#ffffff"/>
    ${[0, 1, 2, 3, 4, 5, 6].map((i) => `<rect x="290" y="${280 + i * 70}" width="${i % 3 === 0 ? 320 : 220}" height="22" rx="8" fill="${i === 6 ? c : d}" opacity=".7"/>`).join("")}`,
  story: (c, d) => `<circle cx="300" cy="400" r="200" fill="${c}" opacity=".7"/><circle cx="620" cy="760" r="240" fill="${d}" opacity=".6"/>`,
};

/** JPEG of one demo picture. `palette` = [background from, background to, shape, detail]. */
export async function art(kind: ArtKind, palette: [string, string, string, string], size: { w?: number; h?: number } = {}): Promise<Buffer> {
  const [from, to, c, d] = palette;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient>
    <radialGradient id="s" cx=".5" cy=".9" r=".5"><stop offset="0" stop-color="#000" stop-opacity=".18"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient></defs>
    <rect width="${W}" height="${H}" fill="url(#g)"/>
    <ellipse cx="450" cy="900" rx="330" ry="60" fill="url(#s)"/>
    ${shapes[kind](c, d)}
  </svg>`;
  return sharp(Buffer.from(svg))
    .resize(size.w ?? W, size.h ?? H, { fit: "cover" })
    .jpeg({ quality: 86, mozjpeg: true })
    .toBuffer();
}
