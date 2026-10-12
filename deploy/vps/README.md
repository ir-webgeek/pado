# راه‌اندازی پادو روی سرور مجازی (VPS)

این پوشه همه چیزی است که برای نصب روی یک سرور لازم دارید. همه سرویس‌ها با Docker بالا می‌آیند و Caddy گواهی HTTPS را خودش می‌گیرد و تمدید می‌کند.

```
اینترنت ──> Caddy (80/443) ──> web   (Next.js، صفحه‌ها و پنل)
                          └─> api   (Fastify، /api/*: API، فایل‌ها، وب‌هوک اینستاگرام، بازگشت درگاه)
                               worker (صف کارها: یادآوری، پیامک، هوش مصنوعی، همگام‌سازی)
                               postgres 16 + redis 7 (فقط داخل شبکه Docker، بیرون باز نیستند)
```

بک‌اند Fastify است (یک فریم‌ورک Node.js مثل Express، سریع‌تر و با اعتبارسنجی ورودی‌ها) و فرانت Next.js. هر دو روی Node.js 22 اجرا می‌شوند؛ بازنویسی با Express چیزی اضافه نمی‌کرد.

## پیش‌نیاز

- سرور Ubuntu 22.04 یا 24.04، حداقل ۲ هسته، ۴ گیگ رم، ۴۰ گیگ دیسک
- یک دامنه که رکورد A آن به IP سرور اشاره کند (مثلا `pado.ir` یا `shop.example.ir`)
- پورت‌های 80 و 443 آزاد

## ۱. نصب Docker

```bash
curl -fsSL https://get.docker.com | sh
docker compose version   # باید نسخه را نشان دهد
```

اگر سرور در ایران است و دریافت ایمیج از Docker Hub خطا می‌دهد (403 یا 429)، میرور رجیستری که ارائه‌دهنده سرور معرفی می‌کند را در `/etc/docker/daemon.json` بگذارید و Docker را ری‌استارت کنید:

```json
{ "registry-mirrors": ["https://آدرس-میرور"] }
```

```bash
systemctl restart docker
```

## ۲. آپلود و باز کردن بسته

```bash
mkdir -p /opt && cd /opt
# فایل zip را با scp یا پنل سرور آپلود کنید، بعد:
unzip pado-*.zip        # پوشه /opt/pado ساخته می‌شود
cd /opt/pado/deploy/vps
```

## ۳. نصب

```bash
./deploy.sh
```

بار اول فایل `.env` را می‌سازد و می‌ایستد. آن را باز کنید (`nano .env`) و این‌ها را تنظیم کنید:

| متغیر | مقدار |
|---|---|
| `DOMAIN` | دامنه، مثلا `pado.ir` |
| `PUBLIC_WEB_URL` | `https://pado.ir` |
| `CORS_ORIGINS` | `https://pado.ir` |
| `SUPER_ADMIN_PHONES` | موبایل شما؛ با این شماره مدیر کل می‌شوید |
| `KAVENEGAR_API_KEY` و `KAVENEGAR_SENDER` | برای ارسال کد ورود (بدون پیامک کسی نمی‌تواند وارد شود) |

رمزها (`POSTGRES_PASSWORD`، `JWT_SECRET`، `COOKIE_SECRET`، `META_VERIFY_TOKEN`) را خود اسکریپت می‌سازد. دوباره اجرا کنید:

```bash
./deploy.sh
```

این دستور ایمیج‌ها را می‌سازد، دیتابیس را مهاجرت می‌دهد و همه سرویس‌ها را بالا می‌آورد. چند دقیقه بعد سایت روی `https://دامنه` باز است.

اگر ساخت ایمیج روی سرور به خاطر دسترسی به npm شکست خورد، ایمیج‌ها را روی یک سیستم دیگر بسازید و منتقل کنید:

```bash
# روی سیستمی که به اینترنت آزاد دسترسی دارد، در پوشه deploy/vps:
docker compose -f docker-compose.prod.yml build
docker save pado-api pado-web | gzip > pado-images.tgz
# روی سرور:
gunzip -c pado-images.tgz | docker load
docker compose -f docker-compose.prod.yml up -d postgres redis
docker compose -f docker-compose.prod.yml run --rm migrate
docker compose -f docker-compose.prod.yml up -d --no-build api worker web caddy
```

## ۴. بعد از نصب

۱. با موبایل `SUPER_ADMIN_PHONES` وارد شوید؛ لینک «مدیریت کل» در منوی پنل است (`/admin`).
۲. در «تنظیمات پلتفرم» این‌ها را وارد کنید (مقادیر پنل بر `.env` اولویت دارند):
   - کلید هوش مصنوعی و مدل (پیش‌فرض Claude Haiku 5.5، ارزان‌ترین)، نرخ دلار و درصد سود برای کسر هزینه از کیف پول فروشگاه‌ها
   - درگاه: تا قرارداد بانک، `mock` (دمو) فعال بماند؛ بعد کد پذیرنده، ترمینال و کلید خصوصی پاسارگاد و شبای پلتفرم برای تسهیم
   - پرداخت اقساطی ترب‌پی: Client ID/Secret و نام کاربری/رمز از پنل پذیرندگی ترب‌پی؛ با پر شدن، گزینه «پرداخت اقساطی» در صفحه پرداخت سفارش و نوبت ظاهر می‌شود
   - متا/اینستاگرام: App Secret و Instagram App ID/Secret
   - اینماد: متاتگ، کد HTML و لینک/لوگوی نشان اعتماد
۳. آدرس‌هایی که در داشبورد Meta وارد می‌کنید (همین‌ها در تب اینستاگرام مدیریت کل هم نمایش داده می‌شوند):
   - وب‌هوک: `https://دامنه/api/v1/webhooks/instagram` با Verify Token برابر `META_VERIFY_TOKEN` در `.env`
   - OAuth Redirect: `https://دامنه/api/v1/instagram/oauth/callback`
۴. بازگشت از درگاه خودکار روی `https://دامنه/api/v1/pay/callback/...` تنظیم می‌شود؛ اگر بانک IP یا دامنه بازگشت را ثبت می‌کند، IP همین سرور و دامنه را بدهید.

## به‌روزرسانی

بسته جدید را در همان مسیر باز کنید (فایل `.env` و داده‌ها دست نمی‌خورند) و:

```bash
cd /opt/pado/deploy/vps && ./deploy.sh
```

مهاجرت دیتابیس خودکار انجام می‌شود. فقط یک بار بعد از ارتقا از نسخه‌های قبل از تصویر کوچک (thumbnail):

```bash
docker compose -f docker-compose.prod.yml exec api node apps/api/dist/backfill-images.js
```

## پشتیبان‌گیری

```bash
./backup.sh                       # دیتابیس + فایل‌های آپلودی در deploy/vps/backups، ۱۴ نسخه آخر می‌ماند
crontab -e                        # هر شب ساعت ۳:۳۰:
30 3 * * * /opt/pado/deploy/vps/backup.sh >> /var/log/pado-backup.log 2>&1
```

پوشه `backups` را مرتب به جای دیگری (یک سرور یا فضای ابری دیگر) هم کپی کنید.

بازگردانی:

```bash
C="docker compose -f docker-compose.prod.yml"
$C stop api worker web
$C exec -T postgres pg_restore -U pado -d pado --clean --if-exists < backups/db-YYYYMMDD-HHMM.dump
$C run --rm --no-deps --user root -v "$PWD/backups":/backup --entrypoint sh api -c "tar xzf /backup/uploads-YYYYMMDD-HHMM.tgz -C /app"
$C up -d api worker web
```

## امنیت

```bash
chmod 600 .env
ufw allow 22 && ufw allow 80 && ufw allow 443 && ufw enable
```

- Postgres و Redis هیچ پورتی بیرون باز نمی‌کنند.
- کد ورود در حالت production هرگز در پاسخ API برنمی‌گردد؛ فقط پیامک می‌شود.
- عکس‌ها موقع آپلود کوچک می‌شوند و اطلاعات EXIF (مثل موقعیت GPS گوشی) حذف می‌شود.

## عیب‌یابی

```bash
C="docker compose -f docker-compose.prod.yml"
$C ps                      # وضعیت سرویس‌ها
$C logs -f --tail=100 api  # لاگ API (همین‌طور worker، web، caddy)
curl -s https://دامنه/api/health
```

| مشکل | علت معمول |
|---|---|
| Caddy گواهی نمی‌گیرد | رکورد A هنوز به IP سرور نرسیده یا پورت 80 بسته است |
| کد ورود نمی‌رسد | کلید کاوه‌نگار یا شماره فرستنده؛ در حالت `SMS_PROVIDER=console` کد فقط در `$C logs api` چاپ می‌شود |
| ساخت ایمیج خطای شبکه می‌دهد | دسترسی به npm یا Docker Hub؛ بخش ۱ و راه ساخت روی سیستم دیگر |
| پاسخ هوش مصنوعی نمی‌آید | کلید AI در مدیریت کل، و موجودی کیف پول فروشگاه |

## بدون Docker (اختیاری)

اگر نمی‌خواهید Docker نصب کنید: Node.js 22، pnpm (با `corepack enable`، نسخه از `package.json`)، PostgreSQL 16 (با افزونه `pg_trgm`) و Redis 7 را نصب کنید. در `.env` این دو را هم اضافه کنید:

```
DATABASE_URL=postgres://pado:رمز@127.0.0.1:5432/pado
REDIS_URL=redis://127.0.0.1:6379
```

سپس در ریشه پروژه (`/opt/pado`):

```bash
pnpm install --frozen-lockfile
pnpm --filter @shopino/api build
API_INTERNAL_URL=http://127.0.0.1:4000 pnpm --filter @shopino/web build
cp -r apps/web/.next/static apps/web/.next/standalone/apps/web/.next/static
cp -r apps/web/public apps/web/.next/standalone/apps/web/public
set -a && . deploy/vps/.env && set +a && node apps/api/dist/migrate.js
```

سه سرویس را با فایل‌های پوشه `systemd/` اجرا کنید (کاربر `pado` و پوشه `/var/lib/pado/uploads` را بسازید). جلوی آن‌ها Caddy یا Nginx بگذارید: `/api/*` با حذف پیشوند `/api` به پورت 4000 و بقیه به پورت 3000 (مثل `Caddyfile` همین پوشه، با `127.0.0.1` به جای نام سرویس‌ها).
