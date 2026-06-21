import { describe, expect, it } from "vitest";
import { ALLOWED_AVATAR_TYPES, MAX_AVATAR_BYTES, validateAvatarFile } from "../avatar-storage";
import { getInitials } from "../format";

function makeFile(type: string, size: number): File {
  // Construct a File with a controlled byte length and MIME type.
  const blob = new Blob([new Uint8Array(size)], { type });
  return new File([blob], "photo", { type });
}

describe("validateAvatarFile", () => {
  it("accepts allowed image types within the size limit", () => {
    for (const type of ALLOWED_AVATAR_TYPES) {
      expect(validateAvatarFile(makeFile(type, 1024)).ok).toBe(true);
    }
  });

  it("rejects disallowed mime types", () => {
    const result = validateAvatarFile(makeFile("image/gif", 1024));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/JPEG|PNG|WebP/);
  });

  it("rejects files over the size limit", () => {
    const result = validateAvatarFile(makeFile("image/png", MAX_AVATAR_BYTES + 1));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/too large/i);
  });
});

describe("getInitials", () => {
  it("takes up to two uppercased name initials", () => {
    expect(getInitials("Łukasz Kowalski")).toBe("ŁK");
    expect(getInitials("Madonna")).toBe("M");
    expect(getInitials("  jane   mary  doe ")).toBe("JM");
  });

  it("falls back to the email initial, then '?'", () => {
    expect(getInitials("", "ops@test.local")).toBe("O");
    expect(getInitials(null, null)).toBe("?");
  });
});
