"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { itemFromListing, type ListingSnapshot } from "@/lib/collection/collection";
import { collectionStore, readScanned } from "@/lib/collection/store";
import { Icon } from "@/components/ui";

/**
 * Adds the CD to the Collection with the reviewed listing details (album,
 * artist and year from the item specifics, the listing price) plus the cover
 * found at scan time. Runs on tap, and on its own once the listing is published.
 * Renders as the left button of the sticky Publish row; `children` is the
 * Publish button.
 */
export default function SaveToCollection({
  listing,
  imageText,
  query,
  published,
  children,
}: {
  listing: ListingSnapshot;
  imageText: string;
  query: string;
  published: boolean;
  children: ReactNode;
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
    <>
      {saved && (
        <p className="t-small flex min-h-8 items-center gap-1.5 px-1 font-medium text-ok-ink fade-in" role="status">
          <Icon name="check" size={16} strokeWidth={2.6} />
          <span className="flex-1">{saved.isNew ? "Added to your Collection" : "Updated in your Collection"}</span>
          <Link href="/collection" className="link px-1 py-1">
            View
          </Link>
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          className="btn btn-secondary btn-lg shrink-0 px-4"
          onClick={save}
          aria-label={saved ? "Save to Collection again" : "Add to Collection"}
        >
          <Icon name={saved ? "check" : "discAdd"} size={22} strokeWidth={saved ? 2.4 : 1.9} />
          <span>{saved ? "Saved" : "Collection"}</span>
        </button>
        {children}
      </div>
    </>
  );
}
