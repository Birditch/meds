"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Keeps an open page on the latest data. A change made in another tab or on another device shows
 * up as soon as this page is looked at again, and at least every minute while it is in view. The
 * refresh merges in place: open dialogs and what is typed in them stay as they are.
 */
export function LiveRefresh({ every = 60_000 }: { every?: number }) {
  const router = useRouter();
  useEffect(() => {
    let last = Date.now();
    const refresh = () => {
      if (document.visibilityState !== "visible" || Date.now() - last < 5_000) return;
      last = Date.now();
      router.refresh();
    };
    const timer = setInterval(refresh, every);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
    };
  }, [router, every]);
  return null;
}
