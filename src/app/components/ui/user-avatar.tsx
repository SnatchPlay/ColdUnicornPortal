import { memo } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "./avatar";
import { cn } from "./utils";
import { getInitials } from "../../lib/format";
import { getAvatarPublicUrl } from "../../lib/avatar-storage";

interface UserAvatarProps {
  name?: string | null;
  email?: string | null;
  /** Storage object path in the user-avatars bucket; null/undefined → initials. */
  avatarPath?: string | null;
  /** Size + extra classes for the avatar circle (e.g. "size-10"). */
  className?: string;
  /** Extra classes for the initials fallback (font size, etc.). */
  fallbackClassName?: string;
}

/**
 * Single source of truth for rendering a user's photo with initials fallback.
 * Radix's Avatar renders the fallback automatically when the image is absent or
 * fails to load, so a deleted/broken avatar_path degrades to initials for free.
 *
 * Memoised — props are primitives, so a shallow compare keeps it from rebuilding
 * the public URL on every parent re-render (matters for long user lists).
 */
export const UserAvatar = memo(function UserAvatar({
  name,
  email,
  avatarPath,
  className,
  fallbackClassName,
}: UserAvatarProps) {
  const url = getAvatarPublicUrl(avatarPath);
  const initials = getInitials(name, email);
  const label = name?.trim() || email?.trim() || "User";

  return (
    <Avatar className={cn("size-10", className)}>
      {url ? <AvatarImage src={url} alt={label} className="object-cover" /> : null}
      <AvatarFallback className={cn("bg-fuchsia-500 text-sm text-white", fallbackClassName)}>
        {initials}
      </AvatarFallback>
    </Avatar>
  );
});
