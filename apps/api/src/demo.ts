/**
 * Demo data for every panel section, on top of the base seed (`pnpm db:seed`): a few months of orders,
 * bookings, chats, AI runs, Instagram posts, stock, expenses, team and a second shop. Pictures are drawn
 * locally (demo-art), so it works offline. Safe to run twice: it stops if the demo is already there.
 * Run: pnpm demo (migrate + seed + this)
 */
import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import * as s from "@shopino/db";
import { createDb, resolveShopSettings, type ExtractedProduct, type StoreLanding } from "@shopino/db";
import { addDaysIso, bookingCode, orderCode, zonedIsoDate, zonedToUtc } from "@shopino/shared";
import { env } from "./config";
import { art, type ArtKind } from "./demo-art";
import { storeFile } from "./lib/uploads";
import { computeSegment } from "./modules/customers/segments";
import { parseCaption } from "./modules/instagram/caption";

const { db, client } = createDb(env.DATABASE_URL, { max: 2 });
const TZ = "Asia/Tehran";
const DAY = 86400_000;
const NOW = Date.now();
const MODEL = "claude-haiku-5-5";

// ---------------------------------------------------------------- helpers
let seed = 20261013;
/** deterministic random (mulberry32), so every run of the demo looks the same */
const rnd = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
const chance = (p: number) => rnd() < p;
const token = () => randomBytes(18).toString("base64url");
const ago = (days: number, minutes = 0) => new Date(NOW - days * DAY + minutes * 60_000);
const round = (n: number, to = 10_000) => Math.round(n / to) * to;
const today = zonedIsoDate(new Date(), TZ);
const at = (dayOffset: number, minuteOfDay: number) => zonedToUtc(addDaysIso(today, dayOffset), minuteOfDay, TZ);

type Palette = [string, string, string, string];
const P: Record<string, Palette> = {
  sand: ["#f6efe3", "#e8dcc6", "#b48a5a", "#7a5a3a"],
  night: ["#e9edf4", "#cfd8e6", "#2b2f3a", "#8a93a6"],
  rose: ["#fbeef0", "#f1d3d8", "#c9707f", "#8e3f4e"],
  sage: ["#eef3ec", "#d6e2d1", "#6f8f6a", "#3f5a3b"],
  sky: ["#eaf3fb", "#cfe2f3", "#4f7fae", "#24496f"],
  camel: ["#f7f0e6", "#ead7bb", "#a8743f", "#5b3b1c"],
  pearl: ["#f4f2ef", "#e2ddd6", "#d9cfc0", "#9b8f7d"],
  plum: ["#f3edf6", "#e0d1e8", "#7d4f8f", "#4c2a5a"],
  gold: ["#fbf5e6", "#f0e1b8", "#c9a24a", "#7a5c1c"],
};
const pic = async (kind: ArtKind, pal: Palette, folder = "demo", size?: { w?: number; h?: number }) => storeFile(await art(kind, pal, size), "image/jpeg", folder);

/** Re-host a base-seed photo so the demo does not depend on a CDN; fall back to a drawing offline. */
async function rehost(url: string, kind: ArtKind, pal: Palette) {
  if (!url.startsWith("http") || url.includes("/uploads/")) return url;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (res.ok) return await storeFile(Buffer.from(await res.arrayBuffer()), res.headers.get("content-type")?.split(";")[0] ?? "image/jpeg", "products");
  } catch {
    /* offline */
  }
  return pic(kind, pal, "products");
}

/** IR + check digits + 22-digit account (ISO 13616 mod 97). */
function sheba(bban: string) {
  const check = 98n - (BigInt(`${bban}182700`) % 97n);
  return `IR${String(check).padStart(2, "0")}${bban}`;
}

// ---------------------------------------------------------------- main
async function main() {
  const shop = await db.query.shops.findFirst({ where: (t, { eq }) => eq(t.slug, "atelier-raha") });
  if (!shop) throw new Error("run the base seed first: pnpm db:seed");
  const done = await db.query.campaigns.findFirst({ where: (t, { eq }) => eq(t.shopId, shop.id) });
  if (done) {
    console.log("demo data already present");
    return;
  }
  const shopId = shop.id;
  const owner = (await db.query.users.findFirst({ where: (t, { eq }) => eq(t.id, shop.ownerId) }))!;
  console.log("building demo data...");

  // ---------- shop profile and settings
  const logo = await pic("logo", ["#f6efe3", "#ead7bb", "#b48a5a", "#2b2f3a"], "logos", { w: 512, h: 512 });
  const base = resolveShopSettings(shop.settings);
  await db
    .update(s.shops)
    .set({
      logo,
      plan: "luxury",
      planExpiresAt: new Date(NOW + 90 * DAY),
      brandColor: "#b48a5a",
      settlementIban: sheba("0170000000123456789012"),
      igUserId: "17841400000000001",
      igUsername: "atelier.raha",
      igAccessToken: "demo-token",
      igTokenExpiresAt: new Date(NOW + 52 * DAY),
      igConnectedAt: ago(40),
      igTokenRefreshedAt: ago(8),
      igWebhookSubscribedAt: ago(40),
      igLastEventAt: ago(0, -12),
      igProfile: { name: "آتلیه رها", accountType: "BUSINESS", pictureUrl: logo, followers: 18_400, follows: 312, mediaCount: 486, fetchedAt: ago(1).toISOString() },
      settings: {
        ...shop.settings,
        loyalty: { ...base.loyalty, enabled: true },
        vipRule: { minOrders: 8, minSpend: 25_000_000, withinDays: 45 },
        booking: { ...base.booking, refundToWallet: true },
        agent: {
          ...base.agent,
          enabled: true,
          consultOnWeb: true,
          tone: "صمیمی و محترمانه",
          rules: "قیمت‌ها را فقط از ابزار بگو. برای سفارش بالای ۲۰ میلیون به همکار ارجاع بده.",
          learnedStyle: "کوتاه و گرم جواب می‌دهیم، با «عزیزم» و «حتما». اول موجودی را چک می‌کنیم بعد لینک می‌دهیم.",
        },
        cardToCard: { cardNumber: "6037991234567890", holder: "رها کریمی", bank: "ملی" },
        alerts: { phone: "09120000000", onHandoff: true, onOrder: true, onBooking: true },
        invoice: { address: "تهران، خیابان ولیعصر، بالاتر از پارک ساعی، کوچه نسترن، پلاک ۱۲", phone: "021-88990011", postalCode: "1596736511", footer: "ممنون که از آتلیه رها خرید کردید. تا ۷ روز امکان تعویض هست." },
        sales: {
          ...base.sales,
          assistantName: "ترانه",
          tonePreset: "friendly",
          style: "consultative",
          emoji: "few",
          address: "auto",
          register: "colloquial",
          askPhone: true,
          bannedWords: ["ارزان", "جنس بنجل"],
          promo: "حراج پاییزه: ۱۵٪ تخفیف پالتو و کت با کد AUTUMN15",
          promoUntil: addDaysIso(today, 12),
          handoffKeywords: ["شکایت", "مرجوعی", "کلاهبرداری", "پس بدم"],
          scarcity: true,
          greeting: "سلام عزیزم، به آتلیه رها خوش اومدی",
          signOff: "هر سوالی بود در خدمتم",
          phrases: ["حتما عزیزم", "دوخت خود آتلیه‌ست", "پارچه‌ش واقعا خوش‌دسته"],
          objections: [
            { objection: "گرونه", answer: "پارچه لینن درجه یک و دوخت دست خود آتلیه‌ست؛ تا ۷ روز هم امکان تعویض داری." },
            { objection: "سایزم رو نمی‌دونم", answer: "قد و وزنت رو بگو تا سایز دقیق رو پیشنهاد بدم؛ اگر نشد تعویض رایگانه." },
          ],
          examples: [
            { customer: "این کت سایز ۳۸ داره؟", reply: "سلام عزیزم، بله ۳۸ موجوده. قدت چنده که مطمئن بشیم اندازه‌ست؟" },
            { customer: "کی می‌رسه؟", reply: "تهران همون روز با پیک، شهرستان ۲ تا ۴ روز کاری با پست پیشتاز." },
          ],
          trainedAt: ago(6).toISOString(),
        },
        rag: { ...base.rag, lastRun: { at: ago(0, -300).toISOString(), products: 15, comments: 9, dms: 6 } },
      },
      landing: {
        headline: "پوشاک دست‌دوز و سالن زیبایی، در یک آتلیه",
        subheadline: "کت و شومیز لینن، اکسسوری‌های نقره و نوبت آرایش مو و ناخن؛ ارسال همان روز در تهران.",
        highlights: [
          { title: "دوخت خود آتلیه", text: "هر مدل در تعداد محدود و با پارچه درجه یک دوخته می‌شود." },
          { title: "ارسال سریع", text: "پیک همان روز در تهران، پست پیشتاز برای همه شهرها." },
          { title: "تعویض ۷ روزه", text: "اگر سایز مناسب نبود، بدون دردسر عوض کنید." },
        ],
        faq: [
          { q: "پرداخت قسطی دارید؟", a: "بله، با ترب‌پی در صفحه پرداخت می‌توانید قسطی بخرید." },
          { q: "نوبت را چطور لغو کنم؟", a: "تا ۳ ساعت قبل از لینک نوبت یا صفحه «نوبت‌های من»." },
        ],
        featuredCategorySlugs: ["clothing", "bags-shoes", "accessories"],
        generatedAt: ago(10).toISOString(),
      } satisfies StoreLanding,
    })
    .where(eq(s.shops.id, shopId));

  // ---------- team: members, a custom role, staff linked to members
  const mkUser = async (phone: string, name: string) => {
    const [u] = await db.insert(s.users).values({ phone, name }).onConflictDoUpdate({ target: s.users.phone, set: { name } }).returning();
    return u!;
  };
  const uNazanin = await mkUser("+989120000001", "نازنین احمدی");
  const uDm = await mkUser("+989120000002", "پریا سلامی");
  const uAcc = await mkUser("+989120000003", "کیوان مرادی");
  const [dmRole] = await db
    .insert(s.shopRoles)
    .values({
      shopId,
      name: "پاسخگوی دایرکت",
      permissions: { dashboard: "view", orders: "view", products: "view", inventory: "none", appointments: "view", inbox: "edit", automations: "view", ai: "none", customers: "view", reports: "none", settings: "none" },
    })
    .returning();
  await db.insert(s.shopRoles).values({
    shopId,
    name: "انباردار",
    permissions: { dashboard: "view", orders: "edit", products: "edit", inventory: "edit", appointments: "none", inbox: "none", automations: "none", ai: "none", customers: "none", reports: "view", settings: "none" },
  });
  const [mNazanin] = await db.insert(s.shopMembers).values({ shopId, userId: uNazanin.id, role: "staff" }).returning();
  await db.insert(s.shopMembers).values([
    { shopId, userId: uDm.id, role: "staff", customRoleId: dmRole!.id },
    { shopId, userId: uAcc.id, role: "viewer" },
  ]);

  const staffRows = await db.query.staff.findMany({ where: (t, { eq }) => eq(t.shopId, shopId), orderBy: (t, { asc }) => asc(t.sort) });
  const [raha, nazanin, mina] = staffRows as [(typeof staffRows)[0], (typeof staffRows)[0], (typeof staffRows)[0]];
  const avatarPal: Palette[] = [P.camel!, P.rose!, P.sky!];
  for (const [i, st] of staffRows.entries()) {
    await db
      .update(s.staff)
      .set({ avatar: await pic("hair", avatarPal[i % 3]!, "staff", { w: 400, h: 400 }), phone: `0912000000${i}`, ...(st.id === nazanin.id ? { memberId: mNazanin!.id } : {}) })
      .where(eq(s.staff.id, st.id));
  }
  await db.insert(s.timeOff).values([
    { shopId, staffId: nazanin.id, startsAt: at(4, 0), endsAt: at(5, 0), reason: "مرخصی" },
    { shopId, staffId: null, startsAt: at(9, 0), endsAt: at(10, 0), reason: "تعطیلی رسمی" },
  ]);

  // ---------- catalog
  const baseProducts = await db.query.products.findMany({ where: (t, { eq }) => eq(t.shopId, shopId) });
  const baseArt: Record<string, [ArtKind, Palette]> = {
    "cream-linen-coat": ["coat", P.sand!],
    "black-satin-blouse": ["blouse", P.night!],
    "grey-cotton-scarf": ["scarf", P.pearl!],
    "amber-perfume": ["bottle", P.gold!],
  };
  for (const p of baseProducts) {
    const [kind, pal] = baseArt[p.slug] ?? ["giftbox", P.sand!];
    const images = [await rehost(p.images[0] ?? "", kind, pal), await pic(kind, P.pearl!, "products")];
    await db.update(s.products).set({ images, description: `${p.description}\nپارچه و دوخت درجه یک، مناسب استفاده روزمره و مجلسی.`, createdAt: ago(80) }).where(eq(s.products.id, p.id));
  }
  // base variants: cost and a discount on the coat
  await db.execute(sql`update product_variants set cost_price = round(price * 0.55 / 10000) * 10000 where shop_id = ${shopId}`);
  await db.execute(sql`update product_variants v set compare_at_price = 5400000 from products p where p.id = v.product_id and p.slug = 'cream-linen-coat'`);

  const cats = await db
    .insert(s.categories)
    .values([
      { shopId, name: "کیف و کفش", slug: "bags-shoes", sort: 2 },
      { shopId, name: "اکسسوری", slug: "accessories", sort: 3 },
      { shopId, name: "خانه و دکور", slug: "home", sort: 4 },
    ])
    .returning();
  const catBy = Object.fromEntries([...(await db.query.categories.findMany({ where: (t, { eq }) => eq(t.shopId, shopId) }))].map((c) => [c.slug, c.id]));
  void cats;

  type V = { attrs: Record<string, string>; price: number; stock: number; compareAt?: number; reserved?: number; pool?: string };
  const newProducts: { title: string; slug: string; cat: string; kind: ArtKind; pals: Palette[]; desc: string; status?: "draft" | "active"; source?: string; variants: V[] }[] = [
    {
      title: "کیف دستی چرم طبیعی",
      slug: "leather-handbag",
      cat: "bags-shoes",
      kind: "bag",
      pals: [P.camel!, P.night!],
      desc: "چرم گاوی طبیعی، آستر ساتن و بند قابل تنظیم. ابعاد ۳۰ در ۲۲ سانتی‌متر.",
      source: "instagram",
      variants: [
        { attrs: { رنگ: "کاراملی" }, price: 3_400_000, compareAt: 3_900_000, stock: 6 },
        { attrs: { رنگ: "مشکی" }, price: 3_400_000, compareAt: 3_900_000, stock: 2 },
      ],
    },
    {
      title: "کفش تخت جیر",
      slug: "suede-flats",
      cat: "bags-shoes",
      kind: "shoe",
      pals: [P.sand!, P.rose!],
      desc: "جیر نرم با زیره طبی، سبک و راحت برای پیاده‌روی روزانه.",
      variants: ["37", "38", "39", "40"].map((sz, i) => ({ attrs: { سایز: sz }, price: 2_900_000, stock: [3, 5, 4, 1][i]! })),
    },
    {
      title: "پیراهن مجلسی ساتن",
      slug: "satin-evening-dress",
      cat: "clothing",
      kind: "dress",
      pals: [P.plum!, P.rose!],
      desc: "ساتن ابریشمی با برش اریب، یقه هفت و آستر کامل.",
      variants: ["S", "M", "L"].map((sz, i) => ({ attrs: { سایز: sz }, price: 5_600_000, stock: [2, 3, 2][i]!, reserved: i === 1 ? 1 : 0 })),
    },
    {
      title: "شومیز لینن آستین پفی",
      slug: "linen-puff-shirt",
      cat: "clothing",
      kind: "blouse",
      pals: [P.sage!, P.pearl!],
      desc: "لینن صددرصد، دکمه صدفی و آستین پفی. شستشو با آب سرد.",
      variants: ["S", "M", "L", "XL"].map((sz, i) => ({ attrs: { سایز: sz }, price: 2_100_000, stock: [4, 8, 0, 2][i]! })),
    },
    {
      title: "پالتو پشمی بلند",
      slug: "long-wool-coat",
      cat: "clothing",
      kind: "coat",
      pals: [P.night!, P.camel!],
      desc: "فاستونی پشمی ۷۰٪، جیب‌های مخفی و کمربند هم‌رنگ. مناسب پاییز و زمستان.",
      variants: ["38", "40", "42"].map((sz, i) => ({ attrs: { سایز: sz }, price: 7_900_000, compareAt: 8_900_000, stock: [1, 2, 1][i]! })),
    },
    {
      title: "انگشتر نقره ماه",
      slug: "silver-moon-ring",
      cat: "accessories",
      kind: "ring",
      pals: [P.pearl!, P.sky!],
      desc: "نقره ۹۲۵ با نگین زیرکونیا، قابل سفارش در سایز دلخواه.",
      variants: [{ attrs: {}, price: 1_450_000, stock: 14 }],
    },
    {
      title: "گردنبند مروارید",
      slug: "pearl-necklace",
      cat: "accessories",
      kind: "necklace",
      pals: [P.gold!, P.pearl!],
      desc: "مروارید پرورشی با زنجیر نقره آب‌طلا، طول ۴۵ سانتی‌متر.",
      variants: [{ attrs: {}, price: 1_980_000, stock: 9 }],
    },
    {
      title: "اسکارف ابریشم طرح‌دار",
      slug: "silk-print-scarf",
      cat: "accessories",
      kind: "scarf",
      pals: [P.rose!, P.gold!],
      desc: "ابریشم مصنوعی لطیف با چاپ دیجیتال، ۹۰ در ۹۰ سانتی‌متر.",
      variants: [
        { attrs: { رنگ: "صورتی" }, price: 1_250_000, stock: 7 },
        { attrs: { رنگ: "خردلی" }, price: 1_250_000, stock: 5 },
      ],
    },
    {
      title: "شمع معطر وانیل",
      slug: "vanilla-candle",
      cat: "home",
      kind: "candle",
      pals: [P.sand!, P.gold!],
      desc: "موم سویا، فتیله پنبه‌ای و حدود ۴۰ ساعت سوختن.",
      variants: [{ attrs: {}, price: 480_000, stock: 18, pool: "candle" }],
    },
    {
      title: "باکس هدیه شمع و ماگ",
      slug: "candle-mug-gift-box",
      cat: "home",
      kind: "giftbox",
      pals: [P.rose!, P.sand!],
      desc: "یک شمع معطر وانیل و یک ماگ سرامیکی در جعبه هدیه با کارت پیام.",
      variants: [{ attrs: {}, price: 890_000, stock: 18, pool: "candle" }],
    },
    {
      title: "ماگ سرامیکی دست‌ساز",
      slug: "handmade-mug",
      cat: "home",
      kind: "mug",
      pals: [P.sky!, P.sage!],
      desc: "لعاب دست‌ساز، هر ماگ کمی متفاوت از بقیه است. قابل استفاده در ماکروویو.",
      variants: [{ attrs: {}, price: 390_000, stock: 2 }],
    },
    {
      title: "عطر جیبی آمبر (به‌زودی)",
      slug: "amber-travel-perfume",
      cat: "beauty",
      kind: "bottle",
      pals: [P.gold!, P.camel!],
      desc: "نسخه ۱۵ میلی‌لیتری عطر آمبر برای کیف.",
      status: "draft",
      variants: [{ attrs: {}, price: 1_200_000, stock: 0 }],
    },
  ];

  const [candlePool] = await db.insert(s.stockPools).values({ shopId, name: "شمع وانیل" }).returning();
  let sku = 100;
  const productBySlug: Record<string, string> = {};
  for (const [pi, p] of newProducts.entries()) {
    const images = [];
    for (const pal of p.pals) images.push(await pic(p.kind, pal, "products"));
    const [prod] = await db
      .insert(s.products)
      .values({
        shopId,
        title: p.title,
        slug: p.slug,
        categoryId: catBy[p.cat] ?? null,
        images,
        description: p.desc,
        status: p.status ?? "active",
        source: p.source ?? "manual",
        createdAt: ago(75 - pi * 5),
      })
      .returning();
    productBySlug[p.slug] = prod!.id;
    for (const [i, v] of p.variants.entries()) {
      await db.insert(s.productVariants).values({
        shopId,
        productId: prod!.id,
        sku: `RA-${sku++}`,
        attributes: v.attrs,
        price: v.price,
        compareAtPrice: v.compareAt ?? null,
        costPrice: round(v.price * (0.45 + rnd() * 0.15)),
        stock: v.stock,
        reserved: v.reserved ?? 0,
        lowStockThreshold: 3,
        position: i,
        stockPoolId: v.pool ? candlePool!.id : null,
      });
    }
  }

  const variants = await db
    .select({ id: s.productVariants.id, productId: s.productVariants.productId, price: s.productVariants.price, cost: s.productVariants.costPrice, attrs: s.productVariants.attributes, title: s.products.title, status: s.products.status })
    .from(s.productVariants)
    .innerJoin(s.products, eq(s.products.id, s.productVariants.productId))
    .where(eq(s.productVariants.shopId, shopId));
  const sellable = variants.filter((v) => v.status === "active");

  // ---------- stock receipts, movements, expenses
  const receipts = [
    { code: "GR-1001", supplier: "تولیدی پارچه آریا", days: 62, items: sellable.slice(0, 6) },
    { code: "GR-1002", supplier: "کارگاه چرم تبریز", days: 30, items: sellable.filter((v) => /کیف|کفش/.test(v.title)) },
    { code: "GR-1003", supplier: "نقره‌سازی مهر", days: 9, items: sellable.filter((v) => /انگشتر|گردنبند/.test(v.title)) },
  ];
  for (const r of receipts) {
    const lines = r.items.map((v) => ({ v, qty: int(3, 10), cost: v.cost ?? round(v.price * 0.5) }));
    const [rec] = await db
      .insert(s.stockReceipts)
      .values({ shopId, code: r.code, supplier: r.supplier, receivedAt: ago(r.days), total: lines.reduce((a, l) => a + l.qty * l.cost, 0), createdBy: owner.id, createdAt: ago(r.days) })
      .returning();
    await db.insert(s.stockReceiptItems).values(lines.map((l) => ({ receiptId: rec!.id, variantId: l.v.id, quantity: l.qty, unitCost: l.cost })));
    await db.insert(s.inventoryMovements).values(
      lines.map((l) => ({ shopId, variantId: l.v.id, delta: l.qty, stockAfter: l.qty + int(0, 4), reason: "purchase", refType: "receipt", refId: rec!.id, actorId: owner.id, createdAt: ago(r.days) })),
    );
  }
  const someV = sellable[3]!;
  await db.insert(s.inventoryMovements).values([
    { shopId, variantId: someV.id, delta: -1, stockAfter: 4, reason: "damage", note: "لکه روی پارچه", actorId: owner.id, createdAt: ago(5) },
    { shopId, variantId: sellable[5]!.id, delta: 2, stockAfter: 9, reason: "count", note: "شمارش انبار", actorId: owner.id, createdAt: ago(3) },
  ]);
  const expenseRows: (typeof s.expenses.$inferInsert)[] = [];
  for (let m = 0; m < 3; m++) {
    const d = m * 30 + 2;
    expenseRows.push(
      { shopId, category: "اجاره", amount: 45_000_000, spentAt: ago(d), note: "اجاره مغازه", createdBy: owner.id },
      { shopId, category: "حقوق", amount: 62_000_000, spentAt: ago(d + 1), note: "حقوق همکاران", createdBy: owner.id },
      { shopId, category: "تبلیغات", amount: round(8_000_000 + rnd() * 6_000_000), spentAt: ago(d + 8), note: "تبلیغ اینستاگرام", createdBy: owner.id },
      { shopId, category: "مواد مصرفی", amount: round(3_000_000 + rnd() * 3_000_000), spentAt: ago(d + 12), note: "رنگ مو و لاک", createdBy: owner.id },
      { shopId, category: "قبوض", amount: round(1_800_000 + rnd() * 900_000), spentAt: ago(d + 15), createdBy: owner.id },
    );
  }
  await db.insert(s.expenses).values(expenseRows);

  // ---------- customers
  const firstNames = ["آیدا", "شیوا", "مهسا", "پریسا", "لیلا", "زهرا", "فاطمه", "نیلوفر", "سمانه", "ترانه", "یاسمن", "مینا", "رویا", "کتایون", "بهاره", "آرزو", "ستاره", "دریا"];
  const lastNames = ["محمدی", "حسینی", "رحیمی", "موسوی", "جعفری", "صادقی", "کریمی", "نوری", "شریفی", "اکبری", "قاسمی", "فرجی", "یزدانی", "امینی", "زمانی", "ملکی", "طاهری", "سبحانی"];
  const cities = ["تهران", "تهران", "تهران", "کرج", "اصفهان", "شیراز", "مشهد", "تبریز", "رشت"];
  const newPeople = firstNames.map((f, i) => ({
    shopId,
    name: `${f} ${lastNames[i]}`,
    phone: `+98912${String(5000000 + i * 7919).padStart(7, "0")}`,
    instagramUsername: `${["aida", "shiva", "mahsa", "parisa", "leila", "zahra", "fati", "niloofar", "samane", "tarane", "yasi", "mina", "roya", "katy", "bahar", "arezoo", "setare", "darya"][i]}.${i + 7}`,
    city: cities[i % cities.length]!,
    tags: i % 5 === 0 ? ["همکار", "عمده"] : i % 4 === 0 ? ["مشتری سالن"] : [],
    notes: i === 2 ? "سایز ۳۸ می‌پوشد، رنگ‌های روشن دوست دارد" : null,
    smsOptOut: i === 11,
  }));
  await db.insert(s.customers).values(newPeople);
  const custs = await db.query.customers.findMany({ where: (t, { eq }) => eq(t.shopId, shopId) });
  // a few loyal customers buy much more often
  // and the last three stay away (at risk / lost, set below)
  const weight = custs.map((_, i): number => (i < 3 ? 6 : i < 7 ? 3 : i >= custs.length - 3 ? 0 : 1));
  const wsum = weight.reduce((a, b) => a + b, 0);
  const pickCustomer = () => {
    let r = rnd() * wsum;
    for (const [i, w] of weight.entries()) if ((r -= w) <= 0) return custs[i]!;
    return custs[0]!;
  };
  const addressOf = (c: (typeof custs)[number]) => ({
    fullName: c.name ?? "",
    phone: (c.phone ?? "").replace("+98", "0"),
    province: c.city === "کرج" ? "البرز" : c.city === "اصفهان" ? "اصفهان" : c.city === "شیراز" ? "فارس" : c.city === "مشهد" ? "خراسان رضوی" : c.city === "تبریز" ? "آذربایجان شرقی" : c.city === "رشت" ? "گیلان" : "تهران",
    city: c.city ?? "تهران",
    line: `${pick(["خیابان شریعتی", "بلوار کشاورز", "خیابان فرشته", "خیابان ستارخان", "بلوار میرداماد", "خیابان پاسداران"])}، کوچه ${pick(["یاس", "لاله", "بهار", "نیلوفر"])}، پلاک ${int(2, 90)}`,
    postalCode: String(int(1000000000, 9999999999)),
  });

  // ---------- orders over 90 days
  const ships = await db.query.shippingMethods.findMany({ where: (t, { eq }) => eq(t.shopId, shopId) });
  await db.insert(s.discounts).values([
    { shopId, code: "AUTUMN15", type: "percent", value: 15, minOrder: 3_000_000, maxUses: 200, usedCount: 0, endsAt: at(12, 1439), appliesTo: "orders" },
    { shopId, code: "VIP500", type: "fixed", value: 500_000, minOrder: 2_000_000, appliesTo: "all" },
    { shopId, code: "YALDA1404", type: "percent", value: 20, active: false, appliesTo: "all", endsAt: ago(300) },
  ]);
  const receiptImg = await pic("receipt", P.sky!, "receipts", { w: 600, h: 900 });
  const orderRows: { id: string; code: string; customerId: string; total: number; createdAt: Date; channel: string }[] = [];
  let discountUses = 0;
  for (let n = 0; n < 96; n++) {
    // more orders recently (growth)
    const days = Math.floor(Math.pow(rnd(), 1.35) * 90);
    const created = ago(days, -int(0, 600));
    if (created.getTime() > NOW) continue;
    const c = pickCustomer();
    const channel = pick(["instagram", "instagram", "instagram", "instagram", "web", "web", "web", "pos", "phone", "agent"] as const);
    const lines = Array.from({ length: chance(0.3) ? 2 : 1 }, () => ({ v: pick(sellable), qty: chance(0.15) ? 2 : 1 }));
    const subtotal = lines.reduce((a, l) => a + l.v.price * l.qty, 0);
    const ship = channel === "pos" ? ships.find((x) => x.carrier === "pickup")! : pick(ships.filter((x) => x.carrier !== "pickup"));
    const shippingTotal = ship.freeOver && subtotal >= ship.freeOver ? 0 : ship.price;
    const useCode = days < 12 && subtotal >= 3_000_000 && chance(0.4);
    const discountTotal = useCode ? round(subtotal * 0.15, 1000) : 0;
    if (useCode) discountUses++;
    const total = subtotal + shippingTotal - discountTotal;
    const r = rnd();
    const status = (
      days > 12 ? (r < 0.84 ? "completed" : r < 0.9 ? "delivered" : r < 0.96 ? "cancelled" : "returned") : days > 4 ? (r < 0.5 ? "delivered" : r < 0.85 ? "shipped" : "completed") : r < 0.4 ? "confirmed" : r < 0.7 ? "processing" : r < 0.85 ? "ready_to_ship" : "shipped"
    ) as (typeof s.orderStatus.enumValues)[number];
    const method = channel === "pos" ? "cash" : pick(["gateway", "gateway", "gateway", "gateway", "card_to_card", "installment", "wallet"] as const);
    const paidAt = new Date(created.getTime() + int(2, 40) * 60_000);
    const shipped = ["shipped", "delivered", "completed", "returned"].includes(status);
    const [o] = await db
      .insert(s.orders)
      .values({
        shopId,
        code: orderCode(),
        accessToken: token(),
        customerId: c.id,
        channel,
        status,
        paymentStatus: status === "cancelled" || status === "returned" ? "refunded" : "paid",
        paymentMethod: method,
        subtotal,
        discountTotal,
        shippingTotal,
        total,
        discountCode: useCode ? "AUTUMN15" : null,
        address: channel === "pos" ? null : addressOf(c),
        shippingMethodId: ship.id,
        carrier: ship.carrier,
        trackingCode: shipped && ship.carrier !== "pickup" ? `${ship.carrier === "tipax" ? "TPX" : "PST"}-${int(10000000, 99999999)}` : null,
        paidAt,
        shippedAt: shipped ? new Date(paidAt.getTime() + DAY) : null,
        deliveredAt: ["delivered", "completed", "returned"].includes(status) ? new Date(paidAt.getTime() + 3 * DAY) : null,
        cancelledAt: status === "cancelled" ? new Date(paidAt.getTime() + 3 * 3600_000) : null,
        printedAt: shipped ? new Date(paidAt.getTime() + 20 * 3600_000) : null,
        note: chance(0.1) ? "لطفا کادوپیچ شود" : null,
        createdAt: created,
        updatedAt: created,
      })
      .returning();
    await db.insert(s.orderItems).values(
      lines.map((l) => ({
        orderId: o!.id,
        productId: l.v.productId,
        variantId: l.v.id,
        title: l.v.title,
        variantLabel: Object.values(l.v.attrs).join(" / "),
        unitPrice: l.v.price,
        quantity: l.qty,
        total: l.v.price * l.qty,
        unitCost: l.v.cost,
      })),
    );
    const ev: (typeof s.orderEvents.$inferInsert)[] = [
      { orderId: o!.id, type: "created", data: { channel }, createdAt: created },
      { orderId: o!.id, type: "paid", data: { method }, createdAt: paidAt },
    ];
    if (shipped) ev.push({ orderId: o!.id, type: "status", data: { to: "shipped" }, actorType: "user", actorId: owner.id, createdAt: new Date(paidAt.getTime() + DAY) });
    if (status === "completed") ev.push({ orderId: o!.id, type: "status", data: { to: "completed" }, actorType: "system", createdAt: new Date(paidAt.getTime() + 5 * DAY) });
    if (status === "cancelled") ev.push({ orderId: o!.id, type: "status", data: { to: "cancelled", reason: "درخواست مشتری" }, actorType: "user", actorId: owner.id, createdAt: new Date(paidAt.getTime() + 3 * 3600_000) });
    await db.insert(s.orderEvents).values(ev);
    await db.insert(s.payments).values({
      shopId,
      purpose: "order",
      orderId: o!.id,
      provider: method === "gateway" ? "mock" : method === "installment" ? "torobpay" : method,
      method,
      amount: total,
      platformFee: method === "gateway" || method === "installment" ? Math.round(total * 0.01) : 0,
      status: status === "cancelled" || status === "returned" ? "refunded" : "paid",
      authority: method === "gateway" || method === "installment" ? `DEMO-${token()}` : null,
      refId: method === "gateway" ? String(int(100000000, 999999999)) : null,
      receiptUrl: method === "card_to_card" ? receiptImg : null,
      paidAt,
      createdAt: created,
    });
    orderRows.push({ id: o!.id, code: o!.code, customerId: c.id, total, createdAt: created, channel });
  }
  await db.update(s.discounts).set({ usedCount: discountUses }).where(sql`${s.discounts.shopId} = ${shopId} and ${s.discounts.code} = 'AUTUMN15'`);

  // waiting on the customer or on the shop
  for (const [i, kind] of (["awaiting", "awaiting", "review", "review"] as const).entries()) {
    const c = custs[8 + i]!;
    const v = sellable[(i * 5 + 2) % sellable.length]!;
    const created = ago(0, -(40 + i * 70));
    const total = v.price + 90_000;
    const [o] = await db
      .insert(s.orders)
      .values({
        shopId,
        code: orderCode(),
        accessToken: token(),
        customerId: c.id,
        channel: i % 2 ? "web" : "instagram",
        status: kind === "awaiting" ? "awaiting_payment" : "confirmed",
        paymentStatus: kind === "awaiting" ? "unpaid" : "pending_review",
        paymentMethod: kind === "awaiting" ? null : "card_to_card",
        subtotal: v.price,
        shippingTotal: 90_000,
        total,
        address: addressOf(c),
        shippingMethodId: ships[0]!.id,
        carrier: ships[0]!.carrier,
        reservedUntil: kind === "awaiting" ? new Date(NOW + 2 * 3600_000) : null,
        createdAt: created,
      })
      .returning();
    await db.insert(s.orderItems).values({ orderId: o!.id, productId: v.productId, variantId: v.id, title: v.title, variantLabel: Object.values(v.attrs).join(" / "), unitPrice: v.price, quantity: 1, total: v.price });
    await db.insert(s.orderEvents).values({ orderId: o!.id, type: "created", data: { channel: o!.channel }, createdAt: created });
    if (kind === "review")
      await db.insert(s.payments).values({ shopId, purpose: "order", orderId: o!.id, provider: "card_to_card", method: "card_to_card", amount: total, status: "pending_review", receiptUrl: receiptImg, createdAt: created });
  }

  // ---------- services: pictures, before/after
  const svcRows = await db.query.services.findMany({ where: (t, { eq }) => eq(t.shopId, shopId), orderBy: (t, { asc }) => asc(t.sort) });
  const svcArt: [ArtKind, Palette][] = [
    ["hair", P.camel!],
    ["color", P.rose!],
    ["nails", P.plum!],
    ["story", P.sage!],
    ["makeup", P.rose!],
  ];
  for (const [i, sv] of svcRows.entries()) {
    const [kind, pal] = svcArt[i % svcArt.length]!;
    const gallery = [await pic(kind, P.pearl!, "services"), await pic(kind, P.sand!, "services")];
    await db
      .update(s.services)
      .set({
        image: await pic(kind, pal, "services", { w: 600, h: 600 }),
        banner: await pic(kind, pal, "services", { w: 1600, h: 600 }),
        gallery,
        description: sv.description || `${sv.name} با مواد درجه یک و توسط همکاران باتجربه آتلیه.`,
        beforeAfter: kind === "color" ? [{ before: await pic("hair", P.pearl!, "services"), after: await pic("hair", P.camel!, "services"), caption: "بالیاژ عسلی روی موی تیره" }] : [],
      })
      .where(eq(s.services.id, sv.id));
  }
  const canDo: Record<string, string[]> = {};
  for (const ss of await db.select().from(s.staffServices).where(sql`${s.staffServices.serviceId} in (select id from services where shop_id = ${shopId})`)) (canDo[ss.serviceId] ??= []).push(ss.staffId);

  // ---------- appointments: last 30 days and next 10
  const existing = await db.query.appointments.findMany({ where: (t, { eq }) => eq(t.shopId, shopId) });
  const busy = existing.map((a) => ({ staffId: a.staffId, from: a.blockStart.getTime(), to: a.blockEnd.getTime() }));
  const free = (staffId: string, from: Date, to: Date) => !busy.some((b) => b.staffId === staffId && b.from < to.getTime() && b.to > from.getTime());
  const STARTS = [600, 660, 720, 900, 960, 1020, 1080, 1110];
  const apptRows: { id: string; customerId: string; startsAt: Date; status: string }[] = [];
  for (let d = -30; d <= 10; d++) {
    const iso = addDaysIso(today, d);
    if (new Date(`${iso}T12:00:00Z`).getUTCDay() === 5) continue; // Friday closed
    const count = d < 0 ? int(2, 5) : d === 0 ? 4 : int(1, 4);
    for (let k = 0; k < count; k++) {
      const sv = pick(svcRows.slice(0, 4));
      const staffId = pick(canDo[sv.id] ?? [raha.id]);
      const startMin = pick(sv.durationMin > 100 ? [600, 900] : STARTS);
      const startsAt = at(d, startMin);
      const endsAt = new Date(startsAt.getTime() + sv.durationMin * 60_000);
      const blockStart = new Date(startsAt.getTime() - sv.bufferBeforeMin * 60_000);
      const blockEnd = new Date(endsAt.getTime() + sv.bufferAfterMin * 60_000);
      if (!free(staffId, blockStart, blockEnd)) continue;
      if (d >= 0 && nazanin.id === staffId && d === 4) continue; // on leave
      if (d === 9) continue; // holiday
      const past = endsAt.getTime() < NOW;
      const r = rnd();
      const status = (past ? (r < 0.82 ? "completed" : r < 0.9 ? "no_show" : "cancelled") : r < 0.75 ? "confirmed" : r < 0.92 ? "pending" : "cancelled") as (typeof s.appointmentStatus.enumValues)[number];
      if (status !== "cancelled") busy.push({ staffId, from: blockStart.getTime(), to: blockEnd.getTime() });
      const c = pickCustomer();
      const deposit = sv.deposit.type === "percent" ? round((sv.price * sv.deposit.value) / 100, 1000) : sv.deposit.type === "fixed" ? sv.deposit.value : 0;
      const paidAmount = status === "completed" ? sv.price : deposit && status !== "pending" ? deposit : 0;
      const created = new Date(startsAt.getTime() - int(1, 6) * DAY);
      const [a] = await db
        .insert(s.appointments)
        .values({
          shopId,
          code: bookingCode(),
          accessToken: token(),
          serviceId: sv.id,
          staffId,
          customerId: c.id,
          startsAt,
          endsAt,
          blockStart,
          blockEnd,
          status,
          channel: pick(["instagram", "instagram", "web", "web", "phone", "agent"] as const),
          price: sv.price,
          depositAmount: deposit,
          paidAmount,
          paymentStatus: paidAmount >= sv.price ? "paid" : paidAmount > 0 ? "paid" : "unpaid",
          note: chance(0.15) ? pick(["رنگ عسلی می‌خوام", "لطفا با خانم احمدی", "کمی دیرتر می‌رسم"]) : null,
          cancelReason: status === "cancelled" ? pick(["مسافرت پیش آمد", "بیماری", "تغییر برنامه"]) : null,
          cancelledBy: status === "cancelled" ? "customer" : null,
          refundStatus: status === "cancelled" && paidAmount > 0 ? (d > 0 ? "requested" : "refunded") : null,
          confirmedAt: status === "pending" ? null : created,
          checkedInAt: status === "completed" ? startsAt : null,
          completedAt: status === "completed" ? endsAt : null,
          cancelledAt: status === "cancelled" ? new Date(startsAt.getTime() - DAY) : null,
          createdAt: created,
          updatedAt: created,
        })
        .returning();
      apptRows.push({ id: a!.id, customerId: c.id, startsAt, status });
      if (paidAmount > 0)
        await db.insert(s.payments).values({
          shopId,
          purpose: "appointment",
          appointmentId: a!.id,
          provider: status === "completed" && !deposit ? "cash" : "mock",
          method: status === "completed" && !deposit ? "cash" : "gateway",
          amount: paidAmount,
          platformFee: deposit ? Math.round(paidAmount * 0.01) : 0,
          status: status === "cancelled" && d <= 0 ? "refunded" : "paid",
          authority: deposit ? `DEMO-${token()}` : null,
          paidAt: created,
          createdAt: created,
        });
    }
  }
  // one paid future booking cancelled by the customer, refund waiting for the shop
  const colorSvc = svcRows[1]!;
  {
    const startsAt = at(3, 1020);
    const endsAt = new Date(startsAt.getTime() + colorSvc.durationMin * 60_000);
    const c = custs[2]!;
    const [a] = await db
      .insert(s.appointments)
      .values({
        shopId,
        code: bookingCode(),
        accessToken: token(),
        serviceId: colorSvc.id,
        staffId: nazanin.id,
        customerId: c.id,
        startsAt,
        endsAt,
        blockStart: startsAt,
        blockEnd: new Date(endsAt.getTime() + colorSvc.bufferAfterMin * 60_000),
        status: "cancelled",
        channel: "web",
        price: colorSvc.price,
        depositAmount: 1_350_000,
        paidAmount: 1_350_000,
        paymentStatus: "paid",
        cancelReason: "مسافرت پیش آمد",
        cancelledBy: "customer",
        refundStatus: "requested",
        confirmedAt: ago(2),
        cancelledAt: ago(0, -90),
        createdAt: ago(2),
      })
      .returning();
    await db.insert(s.payments).values({ shopId, purpose: "appointment", appointmentId: a!.id, provider: "mock", method: "gateway", amount: 1_350_000, platformFee: 13_500, status: "paid", authority: `DEMO-${token()}`, paidAt: ago(2), createdAt: ago(2) });
  }

  // ---------- conversations (scripted), linked to customers by Instagram id
  type Line = [sender: "customer" | "agent" | "human" | "system", text: string, minutesAfter: number, meta?: Record<string, unknown>];
  const convs: Record<string, string> = {};
  async function chat(opts: {
    key: string;
    customer: (typeof custs)[number] | null;
    channel?: "instagram" | "web" | "telegram";
    startMinAgo: number;
    lines: Line[];
    status?: "open" | "needs_human" | "in_progress" | "resolved";
    mode?: "agent" | "human";
    assignee?: string | null;
    unread?: number;
    events?: [type: string, data: Record<string, unknown>, minutesAfter: number, actor?: string][];
    linked?: string;
    siteVisits?: number;
  }) {
    const channel = opts.channel ?? "instagram";
    const ext = channel === "web" ? `web_${token().slice(0, 12)}` : channel === "telegram" ? String(int(100000000, 999999999)) : `1784${int(10000000000, 99999999999)}`;
    if (opts.customer && channel === "instagram") await db.update(s.customers).set({ instagramId: ext }).where(eq(s.customers.id, opts.customer.id));
    const start = NOW - opts.startMinAgo * 60_000;
    const last = start + Math.max(...opts.lines.map((l) => l[2])) * 60_000;
    const lastIn = start + Math.max(0, ...opts.lines.filter((l) => l[0] === "customer").map((l) => l[2])) * 60_000;
    const status = opts.status ?? "open";
    const [conv] = await db
      .insert(s.conversations)
      .values({
        shopId,
        channel,
        externalUserId: ext,
        username: channel === "instagram" ? (opts.customer?.instagramUsername ?? `guest.${int(100, 999)}`) : null,
        customerId: opts.customer?.id ?? null,
        mode: opts.mode ?? "agent",
        needsHuman: status === "needs_human",
        unread: opts.unread ?? 0,
        lastMessageAt: new Date(last),
        lastInboundAt: new Date(lastIn),
        siteVisits: opts.siteVisits ?? 0,
        lastSiteVisitAt: opts.siteVisits ? new Date(last - 5 * 60_000) : null,
        lastSitePath: opts.siteVisits ? "/s/atelier-raha/p/cream-linen-coat" : null,
        linkedConversationId: opts.linked ? convs[opts.linked] : null,
        status,
        assigneeId: opts.assignee ?? null,
        resolvedAt: status === "resolved" ? new Date(last + 10 * 60_000) : null,
        createdAt: new Date(start),
      })
      .returning();
    convs[opts.key] = conv!.id;
    await db.insert(s.messages).values(
      opts.lines.map(([sender, text, m, meta]) => ({
        shopId,
        conversationId: conv!.id,
        direction: sender === "customer" ? ("in" as const) : ("out" as const),
        sender,
        text,
        meta: meta ?? (sender === "human" ? { userId: opts.assignee ?? owner.id } : null),
        createdAt: new Date(start + m * 60_000),
      })),
    );
    if (opts.events?.length)
      await db.insert(s.conversationEvents).values(opts.events.map(([type, data, m, actor]) => ({ shopId, conversationId: conv!.id, type, data, actorId: actor ?? null, createdAt: new Date(start + m * 60_000) })));
    return conv!.id;
  }

  const c = (i: number) => custs[i]!;
  const coatV = variants.find((v) => v.title === "کت کتان کرم" && v.attrs.size === "38")!;
  const linkedOrder = orderRows.filter((o) => o.createdAt.getTime() > NOW - 3 * DAY).at(-1) ?? orderRows.at(-1)!;
  await db.update(s.orders).set({ customerId: c(0).id }).where(eq(s.orders.id, linkedOrder.id));

  await chat({
    key: "voice",
    customer: c(5),
    startMinAgo: 25,
    status: "needs_human",
    unread: 2,
    lines: [
      ["customer", "", 0, { attachments: [{ type: "audio", url: "" }] }],
      ["agent", base.agent.voiceReply, 0],
      ["customer", "ممنون، منتظرم", 3],
    ],
    events: [["handoff", { reason: "voice message" }, 0]],
  });
  await chat({
    key: "complaint",
    customer: c(3),
    startMinAgo: 70,
    status: "needs_human",
    mode: "human",
    unread: 1,
    lines: [["customer", "سلام، سفارشم سه روزه نرسیده. می‌خوام شکایت کنم، کد پیگیری هم جواب نمی‌ده", 0]],
    events: [["handoff", { reason: "keyword: شکایت" }, 0]],
  });
  await chat({
    key: "color",
    customer: c(1),
    startMinAgo: 180,
    status: "in_progress",
    mode: "human",
    assignee: uNazanin.id,
    lines: [
      ["customer", "سلام، برای بالیاژ روی موی مشکی وقت دارید؟ چقدر طول می‌کشه؟", 0],
      ["agent", "سلام عزیزم! رنگ مو حدود ۲ ساعت و نیم طول می‌کشه و از ۴٫۵ میلیون تومن شروع می‌شه. برای بالیاژ روی موی تیره بهتره همکارم نازنین که متخصص رنگه راهنماییت کنه، الان بهش خبر می‌دم.", 1],
      ["human", "سلام سارا جان، نازنینم. برای موی مشکی معمولا دو جلسه لازمه. یه عکس از موهات تو نور روز بفرست ببینم", 14],
      ["customer", "باشه الان می‌فرستم", 20],
      ["customer", "[image]", 21, { attachments: [{ type: "image", url: "" }] }],
    ],
    events: [
      ["handoff", { reason: "colour consultation" }, 1],
      ["assigned", { assigneeId: uNazanin.id }, 10, owner.id],
      ["human_reply", { from: "needs_human" }, 14, uNazanin.id],
    ],
    unread: 1,
  });
  await chat({
    key: "wholesale",
    customer: c(5 + 4),
    startMinAgo: 400,
    status: "in_progress",
    mode: "human",
    assignee: owner.id,
    lines: [
      ["customer", "سلام، برای بوتیکم در شیراز عمده شومیز لینن می‌خوام، ۲۰ عدد. شرایط همکاری چیه؟", 0],
      ["agent", "سلام! خوشحالیم که به همکاری فکر می‌کنید. برای خرید عمده مدیر فروشگاه مستقیم جواب می‌دن، پیام شما رو بهشون رسوندم.", 1],
      ["human", "سلام وقت بخیر. برای ۲۰ عدد ۲۰٪ تخفیف همکار داریم و ارسال با تیپاکس رایگانه. چه رنگ‌هایی مدنظرتونه؟", 45],
    ],
    events: [
      ["handoff", { reason: "wholesale order" }, 1],
      ["assigned", { assigneeId: owner.id }, 40, owner.id],
    ],
  });
  await chat({
    key: "sale",
    customer: c(0),
    startMinAgo: 60 * 26,
    status: "resolved",
    siteVisits: 2,
    lines: [
      ["customer", "سلام این کت کرم سایز ۳۸ موجوده؟", 0],
      ["agent", "سلام الهام جان! بله کت کتان کرم سایز ۳۸ موجوده، ۴٫۸ میلیون تومن. قدت حدود ۱۶۵ تا ۱۷۰ هست؟ ۳۸ برای این قد عالیه.", 1],
      ["customer", "آره ۱۶۸ هستم. سفارش می‌دم", 4],
      ["agent", `سفارشت ثبت شد. از این لینک پرداخت کن: http://localhost:3000/o/${linkedOrder.code}\nبعد از پرداخت همون روز با پیک ارسال می‌شه.`, 5, { tools: ["search_products", "create_order"] }],
      ["customer", "پرداخت کردم مرسی 🙏", 12],
      ["agent", "ممنون از خریدت! کد پیگیری رو فردا صبح برات می‌فرستیم.", 12],
    ],
    events: [
      ["order", { code: linkedOrder.code, step: "created", total: linkedOrder.total }, 5],
      ["order", { code: linkedOrder.code, step: "paid", total: linkedOrder.total }, 12],
      ["status", { status: "resolved" }, 30, owner.id],
    ],
  });
  await db.update(s.orders).set({ conversationId: convs.sale }).where(eq(s.orders.id, linkedOrder.id));
  await chat({
    key: "web",
    customer: c(0),
    channel: "web",
    linked: "sale",
    startMinAgo: 60 * 25,
    lines: [
      ["customer", "این کت با شومیز لینن سفید ست می‌شه؟", 0],
      ["agent", "خیلی قشنگ ست می‌شه! شومیز لینن آستین پفی سایز M موجوده، ۲٫۱ میلیون تومن. می‌خوای به سبد اضافه‌ش کنم؟", 1],
    ],
  });
  const nextAppt = apptRows.find((a) => a.startsAt.getTime() > NOW && a.status === "confirmed");
  await chat({
    key: "booking",
    customer: c(6),
    startMinAgo: 60 * 5,
    status: "resolved",
    lines: [
      ["customer", "سلام برای مانیکور ژل پنجشنبه وقت دارید؟", 0],
      ["agent", "سلام! پنجشنبه ساعت ۱۱ و ۱۴ با مینا خانم خالیه. کدوم رو رزرو کنم؟", 1, { tools: ["find_slots"] }],
      ["customer", "۱۱ لطفا", 6],
      ["agent", "نوبتت ثبت شد ✨ یادآوری رو یک روز قبل و دو ساعت قبل برات می‌فرستیم.", 7, { tools: ["book_appointment"] }],
    ],
    events: nextAppt ? [["booking", { code: "BK-DEMO", step: "created", startsAt: nextAppt.startsAt.toISOString() }, 7]] : [],
  });
  if (nextAppt) await db.update(s.appointments).set({ conversationId: convs.booking, customerId: c(6).id }).where(eq(s.appointments.id, nextAppt.id));
  await chat({
    key: "size",
    customer: c(10),
    startMinAgo: 8,
    unread: 1,
    lines: [
      ["customer", "پیراهن ساتن سایز M هنوز هست؟", 0],
      ["agent", "سلام! سایز M پیراهن مجلسی ساتن فقط ۲ عدد مونده، ۵٫۶ میلیون تومن. برای چه مراسمی می‌خوای؟ بگو تا رنگ کیف و کفش ست هم پیشنهاد بدم.", 1, { tools: ["search_products"] }],
      ["customer", "عروسی دخترخاله‌مه، کفش تخت هم دارید؟", 3],
    ],
  });
  await chat({
    key: "story",
    customer: c(12),
    startMinAgo: 95,
    lines: [
      ["customer", "وای این پالتو محشره 😍", 0, { storyReplyId: "1800000000000001" }],
      ["system", "مرسی که استوری رو دیدی 😍 سوالی داری بپرس!", 0],
      ["customer", "قیمتش چنده؟", 2],
      ["agent", "پالتو پشمی بلند الان با تخفیف ۷٫۹ میلیون تومنه (قبلا ۸٫۹). با کد AUTUMN15 هم ۱۵٪ دیگه تخفیف می‌گیری تا آخر هفته بعد!", 3],
    ],
  });
  await chat({
    key: "comment",
    customer: c(14),
    startMinAgo: 60 * 3,
    lines: [
      ["system", "سلام! قیمت و موجودی رو این‌جا ببین: http://localhost:3000/s/atelier-raha", 0],
      ["customer", "ممنون، کیف چرم مشکی هم موجوده؟", 9],
      ["agent", "بله ولی فقط ۲ عدد مشکی مونده؛ کاراملی ۶ عدد موجوده. ۳٫۴ میلیون تومن با ارسال رایگان بالای ۱۰ میلیون.", 10],
    ],
  });
  await chat({
    key: "telegram",
    customer: c(15),
    channel: "telegram",
    startMinAgo: 60 * 30,
    status: "resolved",
    lines: [
      ["customer", "سلام، ساعت کاری سالن چیه؟", 0],
      ["agent", "سلام! شنبه تا چهارشنبه ۱۰ تا ۱۴ و ۱۵ تا ۲۰، پنجشنبه ۱۰ تا ۱۵. جمعه‌ها تعطیلیم.", 1],
    ],
  });
  const filler = [
    ["ارسال به اصفهان چند روز طول می‌کشه؟", "با پست پیشتاز ۲ تا ۴ روز کاری. بالای ۱۰ میلیون هم ارسال رایگانه."],
    ["انگشتر نقره سایز ۵۶ دارید؟", "بله! انگشتر نقره ماه رو در هر سایزی می‌سازیم، حدود ۳ روز کاری آماده می‌شه."],
    ["امکان پرداخت قسطی هست؟", "بله، در صفحه پرداخت گزینه «پرداخت اقساطی» با ترب‌پی هست؛ چهار قسط بدون کارمزد."],
    ["تعویض سایز چطوریه؟", "تا ۷ روز بعد از تحویل اگر برچسب سالم باشه رایگان عوض می‌کنیم."],
    ["کارت هدیه دارید؟", "باکس هدیه شمع و ماگ داریم با کارت پیام، ۸۹۰ هزار تومن 🎁"],
  ];
  for (const [i, [q, a]] of filler.entries())
    await chat({ key: `f${i}`, customer: c(16 + (i % 6)), startMinAgo: 60 * (8 + i * 19), status: i % 2 ? "resolved" : "open", lines: [["customer", q!, 0], ["agent", a!, 1]] });

  // ---------- AI runs and their cost (last 30 days)
  const convIds = Object.values(convs);
  const runs: (typeof s.agentRuns.$inferInsert)[] = [];
  const costByDay = new Map<number, number>();
  for (let i = 0; i < 160; i++) {
    const days = Math.floor(rnd() * 30);
    const created = ago(days, -int(0, 600));
    const inputTokens = int(1800, 4200);
    const outputTokens = int(90, 420);
    const cost = Math.ceil((inputTokens / 1e6) * env.AGENT_PRICE_IN_PER_MTOK + (outputTokens / 1e6) * env.AGENT_PRICE_OUT_PER_MTOK);
    const handoff = chance(0.06) ? pick(["wholesale order", "colour consultation", "complaint"]) : null;
    const tools = chance(0.6) ? [{ name: pick(["search_products", "find_slots", "create_order", "book_appointment", "order_status"]), ok: true }] : [];
    runs.push({ shopId, conversationId: pick(convIds), channel: pick(["instagram", "instagram", "web", "telegram"]), model: MODEL, inputTokens, outputTokens, cost, tools, handoff, reply: handoff ? null : "...", error: chance(0.02) ? "timeout" : null, durationMs: int(1400, 5200), createdAt: created });
    costByDay.set(days, (costByDay.get(days) ?? 0) + cost);
  }
  await db.insert(s.agentRuns).values(runs);

  // ---------- shop wallet: top-ups, AI usage, SMS
  let bal = shop.walletBalance;
  const wtx: (typeof s.walletTransactions.$inferInsert)[] = [];
  const addTx = (kind: (typeof s.walletTxKind.enumValues)[number], amount: number, createdAt: Date, meta?: Record<string, unknown>) => {
    bal += amount;
    wtx.push({ shopId, kind, amount, balanceAfter: bal, meta: meta ?? null, refType: kind === "topup" ? "payment" : null, createdAt });
  };
  addTx("topup", 1_000_000, ago(31), { gateway: "mock" });
  for (let d = 30; d >= 0; d--) {
    if (d === 15) addTx("topup", 500_000, ago(15), { gateway: "mock" });
    const cost = costByDay.get(d);
    if (cost) addTx("ai_usage", -cost, ago(d, -60), { runs: runs.filter((r) => Math.floor((NOW - r.createdAt!.getTime()) / DAY) === d).length });
    if (d % 3 === 0) addTx("sms", -int(4, 12) * 1_200, ago(d, -30), { count: int(4, 12) });
  }
  addTx("sms", -96_000, ago(6), { campaign: "حراج پاییزه" });
  await db.insert(s.walletTransactions).values(wtx);
  await db.update(s.shops).set({ walletBalance: bal }).where(eq(s.shops.id, shopId));

  // ---------- automations: hits and log
  const rules = await db.query.automationRules.findMany({ where: (t, { eq }) => eq(t.shopId, shopId) });
  const autoEvents: (typeof s.automationEvents.$inferInsert)[] = [];
  const inputs: Record<string, string[]> = {
    comment: ["قیمت؟", "چنده", "price pls", "قیمت سایز ۳۸"],
    story_reply: ["😍", "عالیه", "موجوده؟"],
    story_mention: ["[story_mention]"],
    dm_keyword: ["مشاوره رنگ می‌خوام", "برای رنگ مو مشاوره"],
    first_message: ["سلام", "سلام وقت بخیر"],
  };
  for (const r of rules) {
    const n = r.trigger === "comment" ? 64 : r.trigger === "first_message" ? 48 : r.trigger === "story_reply" ? 27 : 11;
    for (let i = 0; i < n; i++) autoEvents.push({ shopId, ruleId: r.id, conversationId: pick(convIds), trigger: r.trigger, input: pick(inputs[r.trigger] ?? ["سلام"]), ok: !chance(0.03), error: null, createdAt: ago(rnd() * 30) });
    await db.update(s.automationRules).set({ hits: n }).where(eq(s.automationRules.id, r.id));
  }
  await db.insert(s.automationEvents).values(autoEvents);
  await db.insert(s.automationRules).values({
    shopId,
    name: "کد تخفیف پاییزه",
    trigger: "dm_keyword",
    keywords: ["تخفیف", "حراج"],
    messages: [{ kind: "text", text: "تا آخر هفته بعد با کد AUTUMN15 روی پالتو و کت ۱۵٪ تخفیف داری 🍂" }],
    thenMode: "agent",
    priority: 1,
    hits: 19,
  });

  // ---------- forms
  const form = await db.query.forms.findFirst({ where: (t, { eq }) => eq(t.shopId, shopId) });
  if (form) {
    const subs = custs.slice(0, 9).map((cu, i) => ({
      shopId,
      formId: form.id,
      customerId: cu.id,
      data: { name: cu.name ?? "", phone: (cu.phone ?? "").replace("+98", "0"), hair: pick(["طبیعی", "رنگ‌شده", "دکلره"]), note: i % 3 ? "" : "می‌خوام روشن‌تر بشه ولی آسیب نبینه" },
      createdAt: ago(int(0, 25), -int(0, 500)),
    }));
    await db.insert(s.formSubmissions).values(subs);
    await db.update(s.forms).set({ submissions: subs.length }).where(eq(s.forms.id, form.id));
  }
  await db.insert(s.forms).values({
    shopId,
    title: "ثبت‌نام کارگاه میکاپ",
    description: "کارگاه گروهی هر ماه؛ ظرفیت محدود.",
    fields: [
      { key: "name", label: "نام", type: "text", required: true },
      { key: "phone", label: "موبایل", type: "phone", required: true },
      { key: "level", label: "سطح", type: "select", required: true, options: ["مبتدی", "متوسط", "حرفه‌ای"] },
    ],
    successMessage: "ثبت شد! زمان دقیق کارگاه را پیامک می‌کنیم.",
    submissions: 0,
  });

  // ---------- Instagram posts -> products, comments
  const posts: { caption: string; kind: ArtKind; pal: Palette; days: number; status?: "imported" | "ignored"; product?: string; ai?: boolean; type?: string }[] = [
    { caption: "کیف دستی چرم طبیعی 👜\nرنگبندی: کاراملی، مشکی\nقیمت: ۳/۴۰۰ میلیون تومان\nسفارش از طریق دایرکت", kind: "bag", pal: P.camel!, days: 40, status: "imported", product: "leather-handbag" },
    { caption: "پالتو پشمی بلند 🧥\nسایز ۳۸ تا ۴۲\nرنگ: مشکی، شتری\nقیمت با تخفیف ۷,۹۰۰,۰۰۰ تومان\n#پالتو #حراج", kind: "coat", pal: P.night!, days: 3 },
    { caption: "شومیز لینن آستین پفی\nسایز: S, M, L, XL\nرنگ: سفید، کرم، یشمی\n۲ میلیون و ۱۰۰ هزار تومان", kind: "blouse", pal: P.sage!, days: 6 },
    { caption: "کفش تخت جیر 🤎\nسایز ۳۷ تا ۴۰\nقیمت ۲۹۰۰ تومن\nارسال به سراسر ایران", kind: "shoe", pal: P.sand!, days: 9 },
    { caption: "گوشواره حلقه‌ای نقره\nفقط ۸۵۰ هزار تومان\nلینک خرید در بایو", kind: "ring", pal: P.pearl!, days: 12, ai: true, type: "CAROUSEL_ALBUM" },
    { caption: "پشت صحنه عکاسی کالکشن پاییزه 🍂 مرسی از همه دوستانی که همراه بودن", kind: "story", pal: P.gold!, days: 15, status: "ignored", type: "VIDEO" },
    { caption: "بالیاژ عسلی روی موی تیره، کار نازنین جان ✨ برای نوبت دایرکت بدید", kind: "color", pal: P.rose!, days: 18 },
    { caption: "ماگ سرامیکی دست‌ساز\nهر کدوم یک رنگ\n۳۹۰ هزار تومن", kind: "mug", pal: P.sky!, days: 22 },
  ];
  for (const [i, p] of posts.entries()) {
    const url = await pic(p.kind, p.pal, "instagram");
    let extracted: ExtractedProduct = parseCaption(p.caption);
    if (p.ai) extracted = { ...extracted, title: "گوشواره حلقه‌ای نقره", category: "زیورآلات", confidence: 0.92, source: "ai" };
    const mediaId = `1790000000000${String(i).padStart(4, "0")}`;
    await db.insert(s.igMedia).values({
      shopId,
      mediaId,
      mediaType: p.type ?? "IMAGE",
      caption: p.caption,
      mediaUrl: url,
      thumbnailUrl: url,
      permalink: `https://www.instagram.com/p/DEMO${i}/`,
      childUrls: p.type === "CAROUSEL_ALBUM" ? [url, await pic(p.kind, P.gold!, "instagram")] : [],
      postedAt: ago(p.days),
      status: p.status ?? "analyzed",
      extracted: p.status === "ignored" ? null : extracted,
      productId: p.product ? productBySlug[p.product] : null,
      createdAt: ago(p.days),
    });
    if (p.product) await db.update(s.products).set({ sourceRef: mediaId }).where(eq(s.products.id, productBySlug[p.product]!));
    if (i < 4) {
      const comments = [
        ["قیمت؟", false],
        ["دایرکت چک کنید 💌", true],
        ["سایز ۴۰ هم دارید؟", false],
        ["بله عزیزم موجوده", true],
        ["چه رنگی داره؟", false],
      ] as const;
      await db.insert(s.igComments).values(
        comments.map(([text, byShop], k) => ({
          shopId,
          commentId: `${mediaId}_${k}`,
          mediaId,
          parentId: byShop ? `${mediaId}_${k - 1}` : null,
          fromId: byShop ? shop.id : `1784${int(1e10, 9e10)}`,
          username: byShop ? "atelier.raha" : pick(["mahsa.k", "nilo_fa", "parisa.design", "ayda.style"]),
          text,
          byShop,
          postedAt: ago(p.days - 0.1 * k),
        })),
      );
    }
  }

  // ---------- knowledge
  await db.insert(s.knowledgeEntries).values([
    { shopId, source: "faq", title: "پرداخت اقساطی", content: "خرید قسطی با ترب‌پی در صفحه پرداخت سفارش و نوبت فعال است؛ چهار قسط ماهانه بدون کارمزد برای مشتری." },
    { shopId, source: "faq", title: "ساعت کاری", content: "شنبه تا چهارشنبه ۱۰ تا ۱۴ و ۱۵ تا ۲۰، پنجشنبه ۱۰ تا ۱۵. جمعه تعطیل." },
    { shopId, source: "manual", title: "نگهداری لینن", content: "لباس لینن را با آب سرد و دور ملایم بشویید، در سایه خشک کنید و با اتوی بخار نیمه‌خشک اتو کنید." },
    { shopId, source: "manual", title: "راهنمای سایز کفش", content: "کفش‌های تخت جیر استاندارد اروپایی هستند؛ اگر پای پهن دارید یک سایز بزرگ‌تر بردارید." },
    { shopId, source: "dm_history", ref: "dm:1", title: "سوال رایج: زمان رسیدن", content: "مشتری: کی می‌رسه؟\nپاسخ فروشگاه: تهران همون روز با پیک، شهرستان ۲ تا ۴ روز کاری." },
    { shopId, source: "dm_history", ref: "dm:2", title: "سوال رایج: عمده", content: "مشتری: فروش عمده دارید؟\nپاسخ فروشگاه: برای ۱۰ عدد به بالا ۲۰٪ تخفیف همکار و ارسال رایگان با تیپاکس." },
    { shopId, source: "comments", ref: "comments:price", title: "زیر پست: قیمت", content: "بیشتر کامنت‌ها قیمت را می‌پرسند؛ پاسخ فروشگاه: دایرکت را چک کنید و لینک محصول ارسال می‌شود." },
    ...newProducts
      .filter((p) => p.status !== "draft")
      .slice(0, 6)
      .map((p) => ({ shopId, source: "products", ref: productBySlug[p.slug]!, title: p.title, content: `${p.title}: ${p.desc} قیمت ${p.variants[0]!.price.toLocaleString("fa-IR")} تومان.` })),
  ]);

  // ---------- campaigns
  await db.insert(s.campaigns).values([
    { shopId, name: "حراج پاییزه", segment: "all", message: "آتلیه رها: ۱۵٪ تخفیف پالتو و کت با کد AUTUMN15 تا آخر هفته بعد. لغو۱۱", status: "sent", recipients: 80, sentCount: 78, cost: 96_000, sentAt: ago(6), createdAt: ago(6) },
    { shopId, name: "دلتنگ‌تون شدیم", segment: "at_risk", message: "مدتیه سر نزدید! با کد VIP500 پانصد هزار تومان تخفیف دارید.", status: "sent", recipients: 6, sentCount: 6, cost: 7_200, sentAt: ago(20), createdAt: ago(20) },
    { shopId, name: "کالکشن زمستانه", segment: "vip", message: "کالکشن زمستانه آتلیه رها رسید؛ اول از همه شما ببینید.", status: "draft", createdAt: ago(1) },
  ]);

  // ---------- customer stats, loyalty, wallet, segments
  const settings = resolveShopSettings((await db.query.shops.findFirst({ where: (t, { eq }) => eq(t.id, shopId) }))!.settings);
  const stats = await db.execute<{ id: string; orders: number; spent: number; last_order: Date | null; first_order: Date | null; visits: number; no_shows: number; last_visit: Date | null; first_visit: Date | null }>(sql`
    select c.id,
      (select count(*)::int from orders o where o.customer_id = c.id and o.payment_status = 'paid') as orders,
      (select coalesce(sum(total), 0)::bigint from orders o where o.customer_id = c.id and o.payment_status = 'paid') as spent,
      (select max(paid_at) from orders o where o.customer_id = c.id and o.payment_status = 'paid') as last_order,
      (select min(created_at) from orders o where o.customer_id = c.id) as first_order,
      (select count(*)::int from appointments a where a.customer_id = c.id and a.status = 'completed') as visits,
      (select count(*)::int from appointments a where a.customer_id = c.id and a.status = 'no_show') as no_shows,
      (select max(starts_at) from appointments a where a.customer_id = c.id and a.status = 'completed') as last_visit,
      (select min(created_at) from appointments a where a.customer_id = c.id) as first_visit
    from customers c where c.shop_id = ${shopId}`);
  for (const r of stats) {
    const toDate = (v: unknown) => (v ? new Date(v as string) : null);
    const first = [toDate(r.first_order), toDate(r.first_visit)].filter(Boolean).sort((a, b) => a!.getTime() - b!.getTime())[0] ?? ago(2);
    const createdAt = new Date(first.getTime() - DAY);
    const spent = Number(r.spent);
    const st = { ordersCount: r.orders, appointmentsCount: r.visits, totalSpent: spent, lastOrderAt: toDate(r.last_order), lastVisitAt: toDate(r.last_visit), createdAt };
    const earned = Math.floor(spent / settings.loyalty.tomanPerPoint);
    const redeemed = earned > 40 ? 20 : 0;
    await db
      .update(s.customers)
      .set({ ...st, noShowCount: r.no_shows, points: earned - redeemed, segment: computeSegment(st, settings) })
      .where(eq(s.customers.id, r.id));
    if (earned) {
      await db.insert(s.loyaltyLedger).values({ shopId, customerId: r.id, delta: earned, reason: "earn", refType: "order", expiresAt: new Date(NOW + 300 * DAY), createdAt: st.lastOrderAt ?? createdAt });
      if (redeemed) await db.insert(s.loyaltyLedger).values({ shopId, customerId: r.id, delta: -redeemed, reason: "redeem", refType: "order", createdAt: ago(4) });
    }
  }
  // two customers with store credit from refunds
  for (const [i, amount] of [
    [3, 1_350_000],
    [7, 480_000],
  ] as const) {
    await db.update(s.customers).set({ walletBalance: amount }).where(eq(s.customers.id, custs[i]!.id));
    await db.insert(s.customerWalletTx).values({ shopId, customerId: custs[i]!.id, amount, balanceAfter: amount, reason: "refund", refType: "appointment", note: "لغو به‌موقع نوبت", createdAt: ago(10 + i) });
  }
  // customers who drifted away (bought before the demo's 90 days)
  for (const [i, days, segment] of [
    [1, 210, "lost"],
    [2, 115, "at_risk"],
    [3, 130, "at_risk"],
  ] as const) {
    await db
      .update(s.customers)
      .set({ segment, ordersCount: 2, totalSpent: 6_400_000 + i * 900_000, points: 64 + i * 9, lastOrderAt: ago(days), createdAt: ago(days + 120) })
      .where(eq(s.customers.id, custs[custs.length - i]!.id));
  }

  // ---------- second shop for the shop switcher
  await secondShop(owner.id);

  console.log(`demo ready: ${orderRows.length + 4} orders, ${apptRows.length + 1} bookings, ${Object.keys(convs).length} chats, ${runs.length} AI runs`);
}

async function secondShop(ownerId: string) {
  const [shop] = await db
    .insert(s.shops)
    .values({ slug: "salon-mahtab", name: "سالن زیبایی مهتاب", kind: "services", ownerId, plan: "starter", planExpiresAt: new Date(NOW + 20 * DAY), brandColor: "#7d4f8f", walletBalance: 120_000, logo: await pic("logo", P.plum!, "logos", { w: 512, h: 512 }) })
    .returning();
  const shopId = shop!.id;
  const [member] = await db.insert(s.shopMembers).values({ shopId, userId: ownerId, role: "owner" }).returning();
  const svc = await db
    .insert(s.services)
    .values([
      { shopId, name: "کراتین مو", durationMin: 120, price: 3_800_000, color: "#7d4f8f", image: await pic("hair", P.plum!, "services", { w: 600, h: 600 }) },
      { shopId, name: "پاکسازی پوست", durationMin: 60, price: 1_400_000, color: "#c9707f", image: await pic("makeup", P.rose!, "services", { w: 600, h: 600 }) },
      { shopId, name: "اکستنشن مژه", durationMin: 90, price: 1_900_000, color: "#4f7fae", image: await pic("makeup", P.sky!, "services", { w: 600, h: 600 }) },
    ])
    .returning();
  const [st] = await db.insert(s.staff).values({ shopId, memberId: member!.id, name: "مهتاب صالحی", title: "مدیر سالن", color: "#7d4f8f" }).returning();
  await db.insert(s.staffServices).values(svc.map((x) => ({ staffId: st!.id, serviceId: x.id })));
  const hours: (typeof s.workingHours.$inferInsert)[] = [];
  for (const wd of [6, 0, 1, 2, 3, 4]) hours.push({ shopId, staffId: st!.id, weekday: wd, startMin: 600, endMin: 1140 });
  await db.insert(s.workingHours).values(hours);
  const people = await db
    .insert(s.customers)
    .values([
      { shopId, name: "شبنم وکیلی", phone: "+989351110000", city: "تهران" },
      { shopId, name: "آتنا رستمی", phone: "+989351110001", city: "تهران" },
    ])
    .returning();
  for (const [i, d] of [1, 2].entries()) {
    const sv = svc[i]!;
    const startsAt = at(d, 660);
    const endsAt = new Date(startsAt.getTime() + sv.durationMin * 60_000);
    await db.insert(s.appointments).values({ shopId, code: bookingCode(), accessToken: token(), serviceId: sv.id, staffId: st!.id, customerId: people[i]!.id, startsAt, endsAt, blockStart: startsAt, blockEnd: endsAt, status: "confirmed", channel: "instagram", price: sv.price, confirmedAt: new Date() });
  }
  await db.insert(s.walletTransactions).values({ shopId, kind: "plan_gift", amount: 120_000, balanceAfter: 120_000, refType: "plan", refId: "starter" });
}

try {
  await main();
} finally {
  await client.end();
}
