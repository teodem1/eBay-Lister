"use client";

import { useState } from "react";
import type { BatchItem } from "@/lib/batch/queue";
import { Icon } from "./ui";

/** A queued CD's cover (from the scan, else its first photo), or a disc placeholder. */
export default function CdCover({ item, small = false, src }: { item: Pick<BatchItem, "coverUrl">; small?: boolean; src?: string }) {
  const size = small ? "h-10 w-10" : "h-14 w-14";
  const [failed, setFailed] = useState(false);
  const url = src ?? item.coverUrl;
  if (url && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt=""
        onError={() => setFailed(true)}
        className={`${size} shrink-0 rounded-lg border border-line bg-surface-2 object-cover`}
      />
    );
  }
  return (
    <div className={`${size} flex shrink-0 items-center justify-center rounded-lg bg-surface-2 text-subtle`}>
      <Icon name="disc" size={small ? 20 : 26} strokeWidth={1.5} />
    </div>
  );
}

