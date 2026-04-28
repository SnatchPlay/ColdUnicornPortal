const PASSTHROUGH_ROLES = new Set(["anon", "authenticated", "service_role"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function base64UrlDecode(input: string) {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function resolvePassthroughRole(rawRole: unknown) {
  if (typeof rawRole !== "string") return "authenticated";
  return PASSTHROUGH_ROLES.has(rawRole) ? rawRole : "authenticated";
}

export function parseJwtClaims(token: string) {
  const parts = token.split(".");
  if (parts.length < 2) {
    throw new Error("Malformed bearer token.");
  }

  const payload = base64UrlDecode(parts[1]);
  const parsed = JSON.parse(payload);

  if (!isRecord(parsed)) {
    throw new Error("JWT payload is invalid.");
  }

  return parsed;
}

export function extractBearerToken(request: Request) {
  const authHeader = request.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    throw new Error("Missing bearer token.");
  }
  const token = authHeader.slice(7).trim();
  if (!token) {
    throw new Error("Missing bearer token.");
  }
  return token;
}
