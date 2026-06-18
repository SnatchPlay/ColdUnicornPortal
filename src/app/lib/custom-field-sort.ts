import type { ClientCustomFieldType } from "../types/core";

/**
 * Centralized sort-value derivation for client custom fields (3G).
 *
 * Returns a comparable primitive for a field's raw stored value:
 *   - number / currency → parsed numeric amount (numeric sort)
 *   - droplist          → option index (sorts by configured option order)
 *   - checkbox          → 1 (checked) / 0 (unchecked)
 *   - text / link       → normalized lowercase string (natural/locale sort)
 *   - empty / invalid   → null  ⇒ the mega-table comparator sorts these LAST
 *
 * Parsing is only ever applied to number/currency fields — plain text fields
 * stay text (no accidental "8000 zl" → 8000 coercion on a text column).
 */
export type CustomFieldSortValue = string | number | null;

/**
 * Parse a numeric amount out of a free-form value, tolerant of currency
 * symbols/codes and EU/US thousands & decimal separators.
 *
 *   "8000"        → 8000      "8000 zl"     → 8000
 *   "8000 zł"     → 8000      "10000 PLN"   → 10000
 *   "12 000 zł"   → 12000     "12,000 PLN"  → 12000
 *   "1,234.56"    → 1234.56   "1.234,56 €"  → 1234.56
 *   "$1,000"      → 1000      "abc"         → null
 *
 * Known limitation: a dot-only thousands grouping ("12.000" meaning 12000) is
 * read as a decimal (12). The client's currency inputs use spaces/commas, so
 * this is the safe default — it keeps ordinary decimals ("8.50") correct.
 */
export function parseNumericValue(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;

  // First numeric-looking chunk (digits with internal spaces/commas/dots).
  const match = trimmed.match(/-?\d[\d\s.,]*\d|-?\d/);
  if (!match) return null;

  // Spaces are always thousands separators here.
  let token = match[0].replace(/\s+/g, "");
  const hasComma = token.includes(",");
  const hasDot = token.includes(".");

  if (hasComma && hasDot) {
    // The last-occurring separator is the decimal point; the other is grouping.
    if (token.lastIndexOf(",") > token.lastIndexOf(".")) {
      token = token.replace(/\./g, "").replace(",", ".");
    } else {
      token = token.replace(/,/g, "");
    }
  } else if (hasComma) {
    const parts = token.split(",");
    const last = parts[parts.length - 1];
    // 3-digit trailing group or multiple commas ⇒ thousands grouping; else decimal.
    if (parts.length > 2 || last.length === 3) {
      token = token.replace(/,/g, "");
    } else {
      token = token.replace(",", ".");
    }
  }

  const n = Number(token);
  return Number.isFinite(n) ? n : null;
}

interface SortableField {
  field_type: ClientCustomFieldType;
  options?: string[] | null;
}

export function getCustomFieldSortValue(
  field: SortableField,
  raw: string | null | undefined,
): CustomFieldSortValue {
  const value = raw == null ? "" : String(raw).trim();

  switch (field.field_type) {
    case "checkbox":
      if (value === "") return null;
      return value === "true" ? 1 : 0;

    case "droplist": {
      if (value === "") return null;
      const opts = field.options ?? [];
      const idx = opts.indexOf(value);
      // Unknown option sorts after known options but before empty/null.
      return idx === -1 ? opts.length : idx;
    }

    case "number":
    case "currency":
      if (value === "") return null;
      return parseNumericValue(value);

    case "link":
    case "text":
    default:
      if (value === "") return null;
      return value.toLowerCase();
  }
}
