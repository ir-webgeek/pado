import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { MAX_IMAGE_PX, THUMB_PX, optimizePhoto } from "./photo";

const photo = (w: number, h: number) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 120, b: 40 } } })
    .jpeg({ quality: 95 })
    .withExif({ IFD0: { Make: "PhoneCam", Model: "X1" } })
    .toBuffer();

describe("optimizePhoto", () => {
  it("caps the size, keeps JPEG, drops metadata and writes a WebP thumbnail", async () => {
    const src = await photo(4000, 3000);
    expect((await sharp(src).metadata()).exif).toBeDefined();
    const { full, thumb } = await optimizePhoto(src, "image/jpeg");
    const m = await sharp(full).metadata();
    expect(m.format).toBe("jpeg");
    expect(Math.max(m.width!, m.height!)).toBe(MAX_IMAGE_PX);
    expect(m.exif).toBeUndefined();
    expect(full.length).toBeLessThan(src.length);
    const t = await sharp(thumb).metadata();
    expect(t.format).toBe("webp");
    expect(Math.max(t.width!, t.height!)).toBe(THUMB_PX);
  });
  it("never enlarges a small image and keeps PNG as PNG", async () => {
    const png = await sharp({ create: { width: 300, height: 200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    const { full } = await optimizePhoto(png, "image/png");
    const m = await sharp(full).metadata();
    expect(m.format).toBe("png");
    expect(m.width).toBe(300);
    expect(m.hasAlpha).toBe(true);
  });
  it("rejects bytes that are not an image", async () => {
    await expect(optimizePhoto(Buffer.from("not an image"), "image/jpeg")).rejects.toThrow();
  });
});
