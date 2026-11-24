"use client";

import { useSoldQuotaWarning } from "@/lib/pricing/soldLimit";

/** Under the app bar on every screen: the sold-price lookups are used up, or almost. */
export default function SoldLimitBanner() {
  const warning = useSoldQuotaWarning();
  if (!warning) return null;
  return (
    <div role="alert" className={`notice ${warning.kind === "limit" ? "notice-bad" : "notice-warn"} t-small mx-auto mt-2 flex w-[calc(100%-2rem)] max-w-lg gap-2`}>
      <span>
        {warning.kind === "limit"
          ? "Sold-price lookups for this month are used up. Prices (and Auto) use current listings only until they reset."
          : `Only ${warning.remaining} sold-price ${warning.remaining === 1 ? "lookup" : "lookups"} left this month.`}
      </span>
    </div>
  );
}
