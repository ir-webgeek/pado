// Crockford-ish alphabet without look-alikes (0/O, 1/I/L)
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

export function randomCode(length = 10): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

/** Human-facing order code, e.g. SHP-7K3M9QW2XZ */
export const orderCode = () => `SHP-${randomCode(10)}`;
/** Human-facing booking code, e.g. BK-4H8QZ2N7 */
export const bookingCode = () => `BK-${randomCode(8)}`;

export function normalizeIranPhone(input: string): string | null {
  const digits = input
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/\D/g, "");
  let n = digits;
  if (n.startsWith("0098")) n = n.slice(4);
  else if (n.startsWith("98")) n = n.slice(2);
  else if (n.startsWith("0")) n = n.slice(1);
  return /^9\d{9}$/.test(n) ? `+98${n}` : null;
}
