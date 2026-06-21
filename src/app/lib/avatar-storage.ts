// User-avatar storage helper (Task batch 10D).
//
// Uses the existing publishable-key `supabase` client — no second HTTP layer,
// no service-role key. The bucket `user-avatars` is PUBLIC, so reads resolve to a
// stable public URL synchronously (no signing/expiry). We only ever store the
// object PATH in the DB (users.avatar_path); the URL is derived at render time.
//
// Storage RLS (see 20260619_user_avatars.sql) enforces that a user may only write
// inside their own folder `avatars/{user_id}/…`, except admin-tier users.

import { supabase } from "./supabase";

export const AVATAR_BUCKET = "user-avatars";
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024; // 5 MB — matches the bucket limit.
export const ALLOWED_AVATAR_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

const EXTENSION_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export type AvatarValidation = { ok: true } | { ok: false; message: string };

/** Client-side guardrail. The bucket also enforces type/size server-side. */
export function validateAvatarFile(file: File): AvatarValidation {
  if (!(ALLOWED_AVATAR_TYPES as readonly string[]).includes(file.type)) {
    return { ok: false, message: "Use a JPEG, PNG, or WebP image." };
  }
  if (file.size > MAX_AVATAR_BYTES) {
    return { ok: false, message: "Image is too large (max 5 MB)." };
  }
  return { ok: true };
}

function ensureStorage() {
  if (!supabase) {
    throw new Error("Supabase is not configured.");
  }
  return supabase.storage.from(AVATAR_BUCKET);
}

/**
 * Validate + upload an avatar for `userId`. Returns the stored object path.
 * Filename is a generated UUID (never the user-provided name).
 * Throws on validation failure or upload error — the caller writes the DB only
 * after a successful upload.
 */
export async function uploadUserAvatar(userId: string, file: File): Promise<string> {
  const validation = validateAvatarFile(file);
  if (!validation.ok) {
    throw new Error(validation.message);
  }

  const ext = EXTENSION_BY_TYPE[file.type] ?? "jpg";
  const path = `avatars/${userId}/${crypto.randomUUID()}.${ext}`;

  const { error } = await ensureStorage().upload(path, file, {
    contentType: file.type,
    upsert: false,
  });
  if (error) {
    throw new Error(error.message || "Avatar upload failed.");
  }

  return path;
}

/** Best-effort delete of a previous avatar object. Never throws. */
export async function removeAvatarObject(path: string | null | undefined): Promise<void> {
  if (!path || !supabase) return;
  try {
    await supabase.storage.from(AVATAR_BUCKET).remove([path]);
  } catch {
    // Stale object cleanup is non-critical; the DB no longer references it.
  }
}

/**
 * Public URL for an avatar path. No cache-busting needed: each upload uses a
 * fresh UUID filename, so a changed photo is always a new URL. Returns null
 * when there is no path.
 */
export function getAvatarPublicUrl(path: string | null | undefined): string | null {
  if (!path || !supabase) return null;
  const { data } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path);
  return data?.publicUrl ?? null;
}
