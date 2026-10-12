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
/** Goods receipt code, e.g. RCV-7K3M9Q */
export const receiptCode = () => `RCV-${randomCode(6)}`;

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

/** Sheba (Iranian IBAN): spaces/dashes removed, upper-cased, Persian digits converted. */
export function normalizeSheba(raw: string): string {
  return raw
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[\s-]/g, "")
    .toUpperCase()
    .replace(/^(?=\d{24}$)/, "IR");
}

/** ISO 13616 check: IR + 24 digits and the mod-97 checksum, so a mistyped digit is caught before settlement. */
export function isValidSheba(raw: string): boolean {
  const s = normalizeSheba(raw);
  if (!/^IR\d{24}$/.test(s)) return false;
  const moved = s.slice(4) + "1827" + s.slice(2, 4); // I=18, R=27
  let rem = 0;
  for (const ch of moved) rem = (rem * 10 + Number(ch)) % 97;
  return rem === 1;
}
