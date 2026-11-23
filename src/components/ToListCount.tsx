"use client";

import { useBatch } from "@/lib/batch/store";

/** Badge on the To list tab: how many scanned CDs still wait to be listed. */
export default function ToListCount() {
  const pending = useBatch().filter((x) => x.status === "pending").length;
  if (!pending) return null;
  return (
    <span
      className="absolute -top-1 right-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1 text-xs font-bold tabular-nums text-brand-fg"
      aria-label={`${pending} to list`}
    >
      {pending > 99 ? "99+" : pending}
    </span>
  );
}
