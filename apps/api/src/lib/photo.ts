import sharp from "sharp";

export const MAX_IMAGE_PX = 1600;
export const THUMB_PX = 480;

/**
 * Photos are made web-sized before they are stored: EXIF orientation applied, metadata (camera, GPS)
 * dropped, longest side at most 1600px, recompressed in the same format (JPEG stays JPEG so Instagram
 * attachments and other consumers keep working). A 480px WebP thumbnail for grids is written next to
 * it as `<name>-sm.webp` (see `thumbUrl` in the web app). GIFs are kept as they are (animation).
 */
export async function optimizePhoto(buf: Buffer, mime: string): Promise<{ full: Buffer; thumb: Buffer }> {
  const img = sharp(buf, { failOn: "error", limitInputPixels: 50_000_000 }).rotate();
  const sized = img.clone().resize(MAX_IMAGE_PX, MAX_IMAGE_PX, { fit: "inside", withoutEnlargement: true });
  const encoded =
    mime === "image/png" ? sized.png({ compressionLevel: 9, palette: true }) : mime === "image/webp" ? sized.webp({ quality: 82 }) : sized.jpeg({ quality: 82, mozjpeg: true });
  const [full, thumb] = await Promise.all([
    encoded.toBuffer(),
    img.clone().resize(THUMB_PX, THUMB_PX, { fit: "inside", withoutEnlargement: true }).webp({ quality: 74 }).toBuffer(),
  ]);
  // always the re-encoded bytes, even when slightly larger: the original may carry location metadata
  return { full, thumb };
}
