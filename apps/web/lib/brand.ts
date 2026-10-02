/** Brand colour new shops are created with (shops.brand_color default); it means "not chosen yet". */
const UNSET_BRAND = "#d9d0b8";
/** Platform accent used on customer pages when the shop has not picked its own colour (AA on white). */
export const PLATFORM_ACCENT = "#0b7a6d";

export const shopAccent = (brand?: string | null) => (brand && brand.toLowerCase() !== UNSET_BRAND ? brand : PLATFORM_ACCENT);
