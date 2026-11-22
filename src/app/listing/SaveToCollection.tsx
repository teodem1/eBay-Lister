"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { itemFromListing, type ListingSnapshot } from "@/lib/collection/collection";
import { collectionStore, readScanned } from "@/lib/collection/store";

/**
 * Adds the CD to the Collection with the reviewed listing details (album,
 * artist and year from the item specifics, the listing price) plus the cover
 * found at scan time. Runs on tap, and on its own once the listing is published.
 */
export default function SaveToCollection({
  listing,
  imageText,
  query,
  published,
}: {
  listing: ListingSnapshot;
  imageText: string;
  query: string;
  published: boolean;
}) {
  const [saved, setSaved] = useState<{ isNew: boolean; at: string } | null>(null);
  const savedOnPublish = useRef(false);

  function save() {
    const scanned = readScanned(listing.barcode ?? "", query);
    const imageUrls = imageText.split(/\s+/).filter((u) => /^https?:\/\//.test(u));
    const item = itemFromListing({ ...listing, imageUrls }, scanned);
    const result = collectionStore.saveReviewed(item);
    setSaved((prev) => ({ isNew: prev?.isNew ?? result.isNew, at: item.updatedAt }));
  }

  useEffect(() => {
    if (published && !savedOnPublish.current) {
      savedOnPublish.current = true;
      save();
    }
    // save() reads the latest props; only the publish event should trigger it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [published]);

  return (
    <div className="flex min-h-10 items-center justify-between gap-3 text-sm">
      {saved ? (
        <>
          <span className="font-medium text-ok-ink">{saved.isNew ? "Added to your Collection" : "Updated in your Collection"}</span>
          <span className="flex gap-3">
            <button type="button" className="link" onClick={save}>
              Save again
            </button>
            <Link href="/collection" className="link">
              View
            </Link>
          </span>
        </>
      ) : (
        <>
          <span className="text-muted">Happy with the details?</span>
          <button type="button" className="btn btn-secondary min-h-10 px-4 text-sm" onClick={save}>
            Add to Collection
          </button>
        </>
      )}
    </div>
  );
}
