/**
 * Character folding for Persian search: Arabic-keyboard ye/kaf, heh with hamza, ZWNJ/ZWJ and Persian or
 * Arabic-Indic digits map to one form. Used by the API's search (JS + SQL) and by the expression
 * indexes that back it, so the two strings must stay identical (same length, position by position).
 */
export const FA_FOLD_FROM = "يىكۀ\u200c\u200d۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩";
export const FA_FOLD_TO = "ییکه  01234567890123456789";
