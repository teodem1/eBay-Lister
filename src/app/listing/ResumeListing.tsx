"use client";

import { useSyncExternalStore, type ComponentProps } from "react";
import { Spinner } from "@/components/ui";
import { batchStore } from "@/lib/batch/store";
import { conditionComplete } from "@/lib/listing/condition";
import ListingEditor from "./ListingEditor";

const noop = () => () => {};

/**
 * Listing screen for a CD on the To list tab: waits for the browser (the
 * list lives in localStorage), then opens the editor where the seller left
 * off: grades, photos, price check and Claude's draft.
 */
export default function ResumeListing({ initial }: ComponentProps<typeof ListingEditor>) {
  const hydrated = useSyncExternalStore(noop, () => true, () => false);
  if (!hydrated) {
    return (
      <main className="page items-center justify-center text-brand-ink">
        <Spinner />
      </main>
    );
  }
  const item = initial.batchId ? batchStore.get(initial.batchId) : undefined;
  const saved = item?.status === "pending" ? item.progress : undefined;
  // Grades just picked on the scan screen win over older saved ones.
  const condition = conditionComplete(initial.condition ?? {}) ? initial.condition : (saved?.condition ?? item?.condition);
  // A price check made before (sorting a pile photo) is reused, so it costs no second lookup.
  const priceCheck = item?.status === "pending" ? item.priceCheck : undefined;
  return <ListingEditor initial={{ ...initial, condition, saved, priceCheck }} />;
}
