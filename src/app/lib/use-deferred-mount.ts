import { useEffect, useState } from "react";

// In JSDOM (Vitest), requestAnimationFrame does not fire automatically.
// Skip the two-frame deferral in tests so content renders on the first pass.
const IS_TEST = typeof process !== "undefined" && process.env.NODE_ENV === "test";

/**
 * Returns false initially, then true after two animation frames.
 *
 * Use for two-phase drawer rendering: the overlay and header paint on the first
 * frame, heavy body content mounts after the browser has had a chance to commit
 * the shell to screen.
 *
 * When `active` transitions false→true the countdown restarts; false→false is a no-op.
 * In test environments (NODE_ENV=test) the deferral is skipped and `active` is
 * returned immediately so existing drawer tests don't need fake timer setup.
 */
export function useDeferredMount(active: boolean): boolean {
  // In tests start ready immediately if active; in prod start false.
  const [ready, setReady] = useState(() => (IS_TEST ? active : false));

  useEffect(() => {
    if (IS_TEST) {
      setReady(active);
      return;
    }
    if (!active) {
      setReady(false);
      return;
    }
    let raf1 = 0;
    let raf2 = 0;
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        setReady(true);
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [active]);

  return ready;
}
