/**
 * One-off after upgrading: writes the `-sm.webp` grid thumbnail for photos uploaded before thumbnails
 * existed. Originals are not touched. Run: node apps/api/dist/backfill-images.js
 */
import { readdir, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import sharp from "sharp";
import { env } from "./config";
import { THUMB_PX } from "./lib/photo";

const PHOTO = /\.(jpe?g|png|webp)$/i;

async function* walk(dir: string): AsyncGenerator<string> {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (PHOTO.test(e.name) && !/-sm\.webp$/i.test(e.name)) yield p;
  }
}

const exists = (p: string) => stat(p).then(() => true, () => false);
let made = 0;
let failed = 0;
for await (const file of walk(resolve(env.UPLOAD_DIR))) {
  const thumb = file.replace(PHOTO, "-sm.webp");
  if (await exists(thumb)) continue;
  try {
    const buf = await sharp(file).rotate().resize(THUMB_PX, THUMB_PX, { fit: "inside", withoutEnlargement: true }).webp({ quality: 74 }).toBuffer();
    await writeFile(thumb, buf);
    made++;
  } catch {
    failed++;
  }
}
console.log(`thumbnails written: ${made}, unreadable files skipped: ${failed}`);
