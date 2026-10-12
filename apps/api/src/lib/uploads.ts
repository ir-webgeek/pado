import type { MultipartFile } from "@fastify/multipart";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { optimizePhoto } from "./photo";
import { env, publicApiUrl } from "../config";
import { badRequest } from "./errors";

const ALLOWED = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"],
  ["application/pdf", ".pdf"],
  // pre-recorded voice notes and clips for automated DMs
  ["audio/mpeg", ".mp3"],
  ["audio/mp4", ".m4a"],
  ["audio/x-m4a", ".m4a"],
  ["audio/aac", ".aac"],
  ["audio/wav", ".wav"],
  ["video/mp4", ".mp4"],
  ["video/quicktime", ".mov"],
]);

const PHOTO = new Set(["image/jpeg", "image/png", "image/webp"]);
/** Write a stored file (and a photo's thumbnail) under `folder/YYYY/M/`, return its public URL. */
export async function storeFile(buf: Buffer, mime: string, folder: string): Promise<string> {
  const ext = ALLOWED.get(mime);
  if (!ext) throw badRequest("file_type", "unsupported file type");
  const now = new Date();
  const rel = join(folder, `${now.getUTCFullYear()}`, `${now.getUTCMonth() + 1}`);
  const dir = resolve(env.UPLOAD_DIR, rel);
  await mkdir(dir, { recursive: true });
  const id = randomBytes(12).toString("hex");
  if (PHOTO.has(mime)) {
    let out: { full: Buffer; thumb: Buffer };
    try {
      out = await optimizePhoto(buf, mime);
    } catch {
      throw badRequest("invalid_image", "the image could not be read");
    }
    await Promise.all([writeFile(join(dir, `${id}${ext}`), out.full), writeFile(join(dir, `${id}-sm.webp`), out.thumb)]);
  } else {
    await writeFile(join(dir, `${id}${ext}`), buf);
  }
  return `${publicApiUrl()}/uploads/${rel.split("\\").join("/")}/${id}${ext}`;
}

/**
 * Local-disk storage. Swap for S3/R2/ArvanCloud object storage by replacing `storeFile`;
 * callers only depend on the returned public URL.
 */
export async function saveUpload(file: MultipartFile | undefined, folder: string): Promise<string> {
  if (!file) throw badRequest("file_required");
  if (!ALLOWED.has(file.mimetype)) throw badRequest("file_type", "unsupported file type");
  const buf = await file.toBuffer();
  if (file.file.truncated) throw badRequest("file_too_large");
  return storeFile(buf, file.mimetype, folder);
}
