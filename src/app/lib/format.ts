export function formatDate(value: string | null | undefined, options?: Intl.DateTimeFormatOptions) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...options,
  }).format(new Date(value));
}

export function formatMoney(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatNumber(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("en-GB").format(value);
}

export function getFullName(firstName?: string | null, lastName?: string | null) {
  return `${firstName ?? ""} ${lastName ?? ""}`.trim() || "Unnamed";
}

export function slugify(value: string) {
  return value.toLowerCase().replace(/\s+/g, "-");
}

/**
 * Up-to-two-letter initials for a user identity. Falls back to the first letter
 * of the email, then "?". Centralizes the inline `split(" ").map(i=>i[0])…` logic.
 */
export function getInitials(name?: string | null, email?: string | null) {
  const fromName = (name ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  if (fromName) return fromName;
  const fromEmail = (email ?? "").trim().charAt(0).toUpperCase();
  return fromEmail || "?";
}
