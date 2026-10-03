import { config } from "dotenv";
import { eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { addDaysIso, bookingCode, orderCode, zonedIsoDate, zonedToUtc } from "@shopino/shared";
import { createDb } from "./index";
import * as s from "./schema";

config({ path: "../../.env" });

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const { db, client } = createDb(url, { max: 1 });

const token = () => randomBytes(18).toString("base64url");
const TZ = "Asia/Tehran";

async function main() {
  const existing = await db.query.shops.findFirst({ where: (t, { eq }) => eq(t.slug, "atelier-raha") });
  if (existing) {
    console.log("seed already applied (shop atelier-raha exists)");
    return;
  }

  const [owner] = await db.insert(s.users).values({ phone: "+989120000000", name: "Raha Karimi" }).returning();
  const [shop] = await db
    .insert(s.shops)
    .values({
      slug: "atelier-raha",
      name: "آتلیه رها",
      kind: "hybrid",
      ownerId: owner!.id,
      plan: "pro",
      landing: null,
      planExpiresAt: new Date(Date.now() + 30 * 86400_000),
      walletBalance: 300_000,
      settings: { agent: { enabled: true }, cardToCard: { cardNumber: "6037991234567890", holder: "رها کریمی", bank: "ملی" } },
    })
    .returning();
  const shopId = shop!.id;
  const [member] = await db.insert(s.shopMembers).values({ shopId, userId: owner!.id, role: "owner" }).returning();
  await db.insert(s.walletTransactions).values({ shopId, kind: "plan_gift", amount: 300_000, balanceAfter: 300_000, refType: "plan", refId: "pro" });

  // ---------- catalog
  const [clothes, beauty] = await db
    .insert(s.categories)
    .values([
      { shopId, name: "پوشاک", slug: "clothing", sort: 0 },
      { shopId, name: "زیبایی", slug: "beauty", sort: 1 },
    ])
    .returning();

  const catalog: { title: string; slug: string; cat: string; img: string; variants: { attrs: Record<string, string>; price: number; stock: number }[] }[] = [
    {
      title: "کت کتان کرم",
      slug: "cream-linen-coat",
      cat: clothes!.id,
      img: "https://images.unsplash.com/photo-1591047139829-d91aecb6caea?w=900",
      variants: [
        { attrs: { size: "36" }, price: 4_800_000, stock: 2 },
        { attrs: { size: "38" }, price: 4_800_000, stock: 4 },
        { attrs: { size: "40" }, price: 4_800_000, stock: 0 },
      ],
    },
    {
      title: "بلوز ساتن مشکی",
      slug: "black-satin-blouse",
      cat: clothes!.id,
      img: "https://images.unsplash.com/photo-1564257631407-4deb1f99d992?w=900",
      variants: [
        { attrs: { size: "S" }, price: 2_600_000, stock: 5 },
        { attrs: { size: "M" }, price: 2_600_000, stock: 7 },
      ],
    },
    {
      title: "شال نخی طوسی",
      slug: "grey-cotton-scarf",
      cat: clothes!.id,
      img: "https://images.unsplash.com/photo-1601924994987-69e26d50dc26?w=900",
      variants: [{ attrs: {}, price: 950_000, stock: 2 }],
    },
    {
      title: "عطر آمبر",
      slug: "amber-perfume",
      cat: beauty!.id,
      img: "https://images.unsplash.com/photo-1541643600914-78b084683601?w=900",
      variants: [
        { attrs: { volume: "50ml" }, price: 3_900_000, stock: 12 },
        { attrs: { volume: "100ml" }, price: 6_200_000, stock: 6 },
      ],
    },
  ];

  const variantIds: { id: string; productId: string; title: string; label: string; price: number }[] = [];
  let sku = 1;
  for (const p of catalog) {
    const [prod] = await db
      .insert(s.products)
      .values({ shopId, title: p.title, slug: p.slug, categoryId: p.cat, images: [p.img], description: `${p.title} - دوخت آتلیه رها` })
      .returning();
    for (const [i, v] of p.variants.entries()) {
      const [row] = await db
        .insert(s.productVariants)
        .values({ shopId, productId: prod!.id, sku: `RA-${String(sku++).padStart(3, "0")}`, attributes: v.attrs, price: v.price, stock: v.stock, position: i })
        .returning();
      variantIds.push({ id: row!.id, productId: prod!.id, title: p.title, label: Object.values(v.attrs).join(" / "), price: v.price });
    }
  }

  await db.insert(s.shippingMethods).values([
    { shopId, name: "پست پیشتاز", carrier: "post", price: 90_000, freeOver: 10_000_000, sort: 0 },
    { shopId, name: "تیپاکس", carrier: "tipax", price: 150_000, sort: 1 },
    { shopId, name: "پیک تهران", carrier: "courier", price: 120_000, sort: 2 },
    { shopId, name: "تحویل حضوری", carrier: "pickup", price: 0, sort: 3 },
  ]);
  await db.insert(s.discounts).values({ shopId, code: "WELCOME10", type: "percent", value: 10, minOrder: 1_000_000 });

  // ---------- customers
  const people = [
    { name: "الهام بنیادی", phone: "+989121111111", ig: "elham.bn", orders: 7, spent: 31_000_000, lastDays: 4, segment: "vip" as const },
    { name: "سارا کاظمی", phone: "+989122222222", ig: "sara.k", orders: 5, spent: 21_500_000, lastDays: 12, segment: "vip" as const },
    { name: "نگار توکلی", phone: "+989123333333", ig: "negar.t", orders: 2, spent: 5_200_000, lastDays: 20, segment: "regular" as const },
    { name: "مریم رضایی", phone: "+989124444444", ig: "maryam.r", orders: 3, spent: 9_000_000, lastDays: 94, segment: "at_risk" as const },
    { name: "هانیه صدری", phone: "+989125555555", ig: "hanieh.s", orders: 0, spent: 0, lastDays: 0, segment: "new" as const },
  ];
  const customerRows = await db
    .insert(s.customers)
    .values(
      people.map((p) => ({
        shopId,
        name: p.name,
        phone: p.phone,
        instagramUsername: p.ig,
        ordersCount: p.orders,
        totalSpent: p.spent,
        lastOrderAt: p.orders ? new Date(Date.now() - p.lastDays * 86400_000) : null,
        segment: p.segment,
        points: Math.floor(p.spent / 100_000),
        city: "تهران",
      })),
    )
    .returning();

  // ---------- orders (a few, different stages)
  const address = { fullName: "الهام بنیادی", phone: "09121111111", province: "تهران", city: "تهران", line: "خیابان ولیعصر، کوچه نسترن، پلاک ۱۲", postalCode: "1234567890" };
  const statuses: (typeof s.orderStatus.enumValues)[number][] = ["confirmed", "processing", "shipped", "completed", "awaiting_payment"];
  for (const [i, st] of statuses.entries()) {
    const v = variantIds[i % variantIds.length]!;
    const cust = customerRows[i % customerRows.length]!;
    const paid = st !== "awaiting_payment";
    const [o] = await db
      .insert(s.orders)
      .values({
        shopId,
        code: orderCode(),
        accessToken: token(),
        customerId: cust.id,
        channel: i % 2 ? "web" : "instagram",
        status: st,
        paymentStatus: paid ? "paid" : "unpaid",
        paymentMethod: paid ? "gateway" : null,
        subtotal: v.price,
        total: v.price,
        address,
        paidAt: paid ? new Date(Date.now() - i * 3600_000) : null,
        trackingCode: st === "shipped" || st === "completed" ? `TPX-4419028${i}` : null,
        reservedUntil: paid ? null : new Date(Date.now() + 2 * 3600_000),
        createdAt: new Date(Date.now() - i * 5 * 3600_000),
      })
      .returning();
    await db.insert(s.orderItems).values({ orderId: o!.id, productId: v.productId, variantId: v.id, title: v.title, variantLabel: v.label, unitPrice: v.price, quantity: 1, total: v.price });
    await db.insert(s.orderEvents).values({ orderId: o!.id, type: "created", data: { channel: o!.channel } });
  }

  // ---------- appointments: services, staff, hours
  const svc = await db
    .insert(s.services)
    .values([
      { shopId, name: "کوتاهی و براشینگ", durationMin: 60, bufferAfterMin: 10, price: 1_200_000, color: "#d9d0b8", sort: 0 },
      { shopId, name: "رنگ مو", durationMin: 150, bufferAfterMin: 15, price: 4_500_000, priceFrom: true, deposit: { type: "percent", value: 30 }, color: "#c4b894", sort: 1 },
      { shopId, name: "مانیکور ژل", durationMin: 45, price: 850_000, color: "#aebbd0", sort: 2 },
      { shopId, name: "مشاوره استایل (آنلاین)", durationMin: 30, price: 600_000, deposit: { type: "fixed", value: 600_000 }, color: "#778da9", sort: 3 },
      { shopId, name: "کارگاه گروهی میکاپ", durationMin: 120, price: 2_000_000, capacity: 8, color: "#52b4fd", sort: 4 },
    ])
    .returning();

  const staffRows = await db
    .insert(s.staff)
    .values([
      { shopId, memberId: member!.id, name: "رها کریمی", title: "مدیر و استایلیست", color: "#d9d0b8", sort: 0 },
      { shopId, name: "نازنین احمدی", title: "متخصص رنگ", color: "#c4b894", sort: 1 },
      { shopId, name: "مینا فرهادی", title: "ناخن‌کار", color: "#aebbd0", sort: 2 },
    ])
    .returning();
  const [raha, nazanin, mina] = staffRows as [typeof staffRows[0], typeof staffRows[0], typeof staffRows[0]];
  await db.insert(s.staffServices).values([
    { staffId: raha.id, serviceId: svc[0]!.id },
    { staffId: raha.id, serviceId: svc[3]!.id },
    { staffId: raha.id, serviceId: svc[4]!.id },
    { staffId: nazanin.id, serviceId: svc[0]!.id },
    { staffId: nazanin.id, serviceId: svc[1]!.id },
    { staffId: mina.id, serviceId: svc[2]!.id },
  ]);
  // Sat(6)..Wed(3) 10:00-14:00 & 15:00-20:00, Thu(4) 10:00-15:00, Fri closed
  const hours: (typeof s.workingHours.$inferInsert)[] = [];
  for (const st of staffRows) {
    for (const wd of [6, 0, 1, 2, 3]) {
      hours.push({ shopId, staffId: st.id, weekday: wd, startMin: 600, endMin: 840 });
      hours.push({ shopId, staffId: st.id, weekday: wd, startMin: 900, endMin: 1200 });
    }
    hours.push({ shopId, staffId: st.id, weekday: 4, startMin: 600, endMin: 900 });
  }
  await db.insert(s.workingHours).values(hours);

  const today = zonedIsoDate(new Date(), TZ);
  const mk = (dayOffset: number, startMin: number, svcIdx: number, staffId: string, custIdx: number, status: (typeof s.appointmentStatus.enumValues)[number]) => {
    const service = svc[svcIdx]!;
    const startsAt = zonedToUtc(addDaysIso(today, dayOffset), startMin, TZ);
    const endsAt = new Date(startsAt.getTime() + service.durationMin * 60_000);
    return {
      shopId,
      code: bookingCode(),
      accessToken: token(),
      serviceId: service.id,
      staffId,
      customerId: customerRows[custIdx]!.id,
      startsAt,
      endsAt,
      blockStart: new Date(startsAt.getTime() - service.bufferBeforeMin * 60_000),
      blockEnd: new Date(endsAt.getTime() + service.bufferAfterMin * 60_000),
      status,
      channel: "instagram" as const,
      price: service.price,
      confirmedAt: status === "pending" ? null : new Date(),
      completedAt: status === "completed" ? endsAt : null,
    };
  };
  await db.insert(s.appointments).values([
    mk(0, 630, 0, raha.id, 0, "confirmed"),
    mk(0, 660, 1, nazanin.id, 1, "confirmed"),
    mk(0, 960, 2, mina.id, 2, "pending"),
    mk(1, 600, 0, nazanin.id, 3, "confirmed"),
    mk(1, 1020, 3, raha.id, 4, "confirmed"),
    mk(-1, 900, 2, mina.id, 0, "completed"),
  ]);

  // ---------- static automations + a form
  const [form] = await db
    .insert(s.forms)
    .values({
      shopId,
      title: "درخواست مشاوره رنگ مو",
      description: "چند سوال کوتاه تا بهترین رنگ رو برات پیشنهاد بدیم.",
      fields: [
        { key: "name", label: "نام", type: "text", required: true },
        { key: "phone", label: "موبایل", type: "phone", required: true },
        { key: "hair", label: "رنگ فعلی مو", type: "select", required: false, options: ["طبیعی", "رنگ‌شده", "دکلره"] },
        { key: "note", label: "توضیحات", type: "textarea", required: false },
      ],
      successMessage: "ممنون! به‌زودی باهاتون تماس می‌گیریم 🌿",
    })
    .returning();
  await db.insert(s.automationRules).values([
    {
      shopId,
      name: "قیمت زیر پست",
      trigger: "comment",
      keywords: ["قیمت", "price", "چند"],
      publicReply: "دایرکت رو چک کنید 💌",
      privateReply: "سلام! قیمت و موجودی رو این‌جا ببین: http://localhost:3000/s/atelier-raha",
      messages: [{ kind: "buttons", text: "برای خرید یا رزرو نوبت:", buttons: [{ title: "فروشگاه", url: "http://localhost:3000/s/atelier-raha" }, { title: "رزرو نوبت", url: "http://localhost:3000/b/atelier-raha" }] }],
    },
    { shopId, name: "پاسخ به استوری", trigger: "story_reply", matchMode: "any", messages: [{ kind: "text", text: "مرسی که استوری رو دیدی 😍 سوالی داری بپرس!" }], thenMode: "agent" },
    { shopId, name: "منشن در استوری", trigger: "story_mention", matchMode: "any", messages: [{ kind: "text", text: "ممنون از منشن 🙏 یه کد تخفیف برات داریم: WELCOME10" }] },
    { shopId, name: "مشاوره رنگ", trigger: "dm_keyword", keywords: ["مشاوره", "رنگ"], messages: [{ kind: "form", formId: form!.id, text: "برای مشاوره رنگ این فرم کوتاه رو پر کن:" }] },
    { shopId, name: "خوش‌آمد", trigger: "first_message", matchMode: "any", messages: [{ kind: "text", text: "سلام! به آتلیه رها خوش اومدی 🌙" }], thenMode: "agent", priority: 0 },
  ]);
  await db.insert(s.knowledgeEntries).values([
    { shopId, source: "faq", title: "ارسال", content: "ارسال تهران با پیک در همان روز و شهرستان با پست پیشتاز ۲ تا ۴ روز کاری. خرید بالای ۱۰ میلیون ارسال رایگان." },
    { shopId, source: "faq", title: "مرجوعی", content: "تا ۷ روز پس از تحویل در صورت سالم بودن برچسب، امکان تعویض یا مرجوعی هست. هزینه ارسال برگشت با مشتری است." },
    { shopId, source: "faq", title: "لغو نوبت", content: "لغو یا جابه‌جایی نوبت تا ۳ ساعت قبل از طریق لینک نوبت یا صفحه نوبت‌های من ممکن است. بیعانه رنگ مو در صورت لغو دیرتر برگشت داده نمی‌شود." },
    { shopId, source: "manual", title: "راهنمای سایز کت", content: "کت‌های کتان قالب استاندارد دارند؛ سایز ۳۶ برای قد ۱۶۰-۱۶۵، سایز ۳۸ برای ۱۶۵-۱۷۰ و سایز ۴۰ برای ۱۷۰ به بالا مناسب است." },
  ]);
  await db.update(s.users).set({ isSuperAdmin: true }).where(eq(s.users.id, owner!.id));

  console.log(`seeded shop atelier-raha (${shopId}); login phone: 09120000000`);
}

try {
  await main();
} finally {
  await client.end();
}
