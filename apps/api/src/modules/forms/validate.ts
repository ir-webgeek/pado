import type { FormField } from "@shopino/db";
import { normalizeIranPhone } from "@shopino/shared";

/** Validate a submission against the form's field definitions (server-side, never trust the page). */
export function validateSubmission(fields: FormField[], data: Record<string, unknown>) {
  const out: Record<string, string | boolean> = {};
  const errors: Record<string, string> = {};
  for (const f of fields) {
    const v = data[f.key];
    if (f.type === "checkbox") {
      out[f.key] = v === true || v === "true" || v === "on";
      if (f.required && !out[f.key]) errors[f.key] = "required";
      continue;
    }
    const s = typeof v === "string" ? v.trim().slice(0, 2000) : typeof v === "number" ? String(v) : "";
    if (!s) {
      if (f.required) errors[f.key] = "required";
      continue;
    }
    if (f.type === "phone" && !normalizeIranPhone(s)) errors[f.key] = "invalid_phone";
    else if (f.type === "email" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) errors[f.key] = "invalid_email";
    else if (f.type === "number" && !Number.isFinite(Number(s))) errors[f.key] = "invalid_number";
    else if (f.type === "select" && f.options && !f.options.includes(s)) errors[f.key] = "invalid_option";
    else if (f.type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(s)) errors[f.key] = "invalid_date";
    out[f.key] = s;
  }
  return { data: out, errors };
}
