"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { AppBar, Icon, TabBar } from "@/components/ui";
import { formatMoney } from "@/app/listing/priceRequest";
import EditPublishedSheet from "@/app/auto/EditPublishedSheet";
import SoldComparison from "./SoldComparison";
import { autoState, priceGrade } from "@/lib/auto/auto";
import { batchItemName, type BatchItem } from "@/lib/batch/queue";
import { autoStore, useAuto } from "@/lib/batch/store";

const noop = () => () => {};

/**
 * "Review": the listings the Auto tab published, newest first, to check what
 * Claude wrote and priced. "Edit" changes title, price or description and
 * pushes the change to the live eBay listing; "Done" takes it off this screen.
 */
export default function ReviewScreen() {
  const items = useAuto();
  const hydrated = useSyncExternalStore(noop, () => true, () => false);
  const [editing, setEditing] = useState<string | null>(null);
  const published = items
    .filter((x) => autoState(x).stage === "published")
    .sort((a, b) => (b.doneAt ?? "").localeCompare(a.doneAt ?? ""));
  const editItem = published.find((x) => x.id === editing);

  return (
    <>
      <AppBar title="Review" />
      <main className="page page-tabs">
        <header className="pt-1">
          <h1 className="t-display">Review</h1>
        </header>

        {!hydrated ? (
          <div className="skeleton h-32" />
        ) : published.length === 0 ? (
          <section className="card flex flex-col items-center gap-2 py-8 text-center">
            <Icon name="check" size={36} strokeWidth={1.5} className="text-subtle" />
            <p className="t-title">Nothing to review yet</p>
            <p className="t-small max-w-xs text-muted">CDs listed from the Auto tab show here once they are published.</p>
            <Link href="/auto" className="link t-small mt-1 px-1 py-1">
              Go to Auto
            </Link>
          </section>
        ) : (
          <section className="flex flex-col gap-2" aria-label="Published listings">
            <div className="flex items-center justify-between px-1">
              <h2 className="t-headline">{published.length} published</h2>
              <button
                type="button"
                className="link t-small px-1 py-1"
                onClick={() => autoStore.replace(autoStore.all().filter((x) => autoState(x).stage !== "published"))}
              >
                Clear list
              </button>
            </div>
            <ul className="flex flex-col gap-3">
              {published.map((item) => (
                <ReviewCard key={item.id} item={item} onEdit={() => setEditing(item.id)} onDone={() => autoStore.remove(item.id)} />
              ))}
            </ul>
            <p className="t-small px-1 text-muted">Done and Clear list only remove listings from this screen; they stay on eBay.</p>
          </section>
        )}
        {editItem && <EditPublishedSheet item={editItem} onClose={() => setEditing(null)} />}
      </main>
      <TabBar active="review" />
    </>
  );
}

/** One published listing: its photos, title and price, with Edit, eBay and Done (removes it from Review). */
function ReviewCard({ item, onEdit, onDone }: { item: BatchItem; onEdit: () => void; onDone: () => void }) {
  const a = autoState(item);
  const d = a.draft;
  return (
    <li className="card flex flex-col gap-3 p-3">
      {a.photos.length > 0 && (
        <div className="grid grid-cols-4 gap-2">
          {a.photos.map((u, i) => (
            // eslint-disable-next-line @next/next/no-img-element -- eBay-hosted photo
            <img key={u} src={u} alt={i === 0 ? "Front cover" : i === 1 ? "Back cover" : `Photo ${i + 1}`} className="aspect-square w-full rounded-lg border border-line bg-surface-2 object-cover" />
          ))}
        </div>
      )}
      <div>
        <p className="font-semibold leading-snug">{d?.title ?? batchItemName(item)}</p>
        <p className="t-small mt-1">
          <b className="tabular-nums">{d ? formatMoney(d.price, "CAD") : ""}</b>
          {a.revisedAt && <span className="chip ml-2 bg-brand-soft py-0 text-brand-ink">Edited</span>}
        </p>
      </div>
      {d && <SoldComparison price={d.price} check={a.priceCheck} discogs={a.discogs} grade={priceGrade(item.condition)} />}
      {a.promotionError && <p className="notice notice-warn t-small">{a.promotionError}</p>}
      <div className="flex gap-2">
        <button type="button" className="btn btn-secondary flex-1" onClick={onEdit}>
          Edit
        </button>
        {item.listingUrl && (
          <a href={item.listingUrl} target="_blank" rel="noreferrer" className="btn btn-secondary flex-1">
            eBay <Icon name="external" size={16} />
          </a>
        )}
        <button type="button" className="btn btn-primary flex-1" onClick={onDone}>
          <Icon name="check" size={18} /> Done
        </button>
      </div>
    </li>
  );
}
