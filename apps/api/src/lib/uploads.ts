import type { MultipartFile } from "@fastify/multipart";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { env, publicApiUrl } from "../config";
import { badRequest } from "./errors";

const ALLOWED = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"],
  ["application/pdf", ".pdf"],
]);

/**
 * Local-disk storage. Swap for S3/R2/ArvanCloud object storage by replacing this function;
 * callers only depend on the returned public URL.
 */
export async function saveUpload(file: MultipartFile | undefined, folder: string): Promise<string> {
  if (!file) throw badRequest("file_required");
  const ext = ALLOWED.get(file.mimetype);
  if (!ext) throw badRequest("file_type", "only images and PDF files are accepted");
  const buf = await file.toBuffer();
  if (file.file.truncated) throw badRequest("file_too_large");
  const now = new Date();
  const rel = join(folder, `${now.getUTCFullYear()}`, `${now.getUTCMonth() + 1}`);
  const dir = resolve(env.UPLOAD_DIR, rel);
  await mkdir(dir, { recursive: true });
  const name = `${randomBytes(12).toString("hex")}${ext || extname(file.filename)}`;
  await writeFile(join(dir, name), buf);
  return `${publicApiUrl()}/uploads/${rel.split("\\").join("/")}/${name}`;
}
