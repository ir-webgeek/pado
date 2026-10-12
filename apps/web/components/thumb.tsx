"use client";

import { useState, type ImgHTMLAttributes } from "react";

/** `<name>-sm.webp` next to a stored photo (written on upload); other URLs are returned unchanged. */
export function thumbUrl(url: string): string {
  return /\/uploads\/.+\.(jpe?g|png|webp)$/i.test(url) && !/-sm\.webp$/i.test(url) ? url.replace(/\.(jpe?g|png|webp)$/i, "-sm.webp") : url;
}

/**
 * Grid and list image: loads the small WebP thumbnail and falls back to the original when there is none
 * (files uploaded before thumbnails existed, or external URLs).
 */
export function Thumb({ src, alt = "", ...props }: ImgHTMLAttributes<HTMLImageElement> & { src: string }) {
  const [failed, setFailed] = useState(false);
  const small = thumbUrl(src);
  return <img {...props} alt={alt} src={failed ? src : small} onError={() => small !== src && setFailed(true)} decoding="async" />;
}
