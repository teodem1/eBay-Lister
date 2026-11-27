"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { AppBar, Icon, Spinner } from "@/components/ui";
import { formatMoney } from "@/app/listing/priceRequest";
import type { ApplyResult, LiveListing, PriceCheck, RefreshPreview } from "@/lib/listing/types";
import { autoStore, batchStore } from "@/lib/batch/store";
import { liveChangeForSku } from "@/lib/auto/auto";
import { collectionStore } from "@/lib/collection/store";
import { canadianSoldForMore } from "@/lib/pricing/canadian";
import { editionPriceAbove, type EditionPrice } from "@/lib/pricing/edition";
import { savedCheckFor } from "@/lib/pricing/savedCheck";

const KEY = "ebay-lister:refresh:v1";
const noop = () => () => {};

interface Row {
  listing: LiveListing;
  preview?: RefreshPreview;
  previewError?: string;
  include: boolean;
  /** A special edition that sold for more than the listing's price: the price to raise it to. */
  raise?: EditionPrice;
  result?: ApplyResult | { status: "failed"; reason: string };
}

function load(): Row[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Row[]) : [];
  } catch {
    return [];
  }
}

function save(rows: Row[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(rows));
  } catch {
    // Full or blocked storage: the screen still works, it just won't remember.
  }
}

async function call<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, body === undefined ? undefined : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Error ${res.status}`);
  return data as T;
}

/**
 * The price check already saved on the phone for a live listing (no new lookup):
 * on its Collection CD, Auto or To list entry by SKU, else any saved check for its barcode.
 */
function savedCheck(sku: string): PriceCheck | undefined {
  return savedCheckFor([...autoStore.all(), ...batchStore.all()], { sku }, collectionStore.all());
}

/** Runs `work` on each item, two at a time, until done or stopped. */
async function twoAtATime<T>(items: T[], work: (x: T) => Promise<void>, stopped: () => boolean) {
  const queue = [...items];
  const worker = async () => {
    while (queue.length && !stopped()) await work(queue.shift()!);
  };
  await Promise.all([worker(), worker()]);
}

/**
 * Rewrites the live eBay listings with the current listing rules: Claude writes a
 * new title, item specifics and description for each (preview, nothing sent),
 * the seller checks them, then "Update on eBay" replaces only those three.
 * Price, Best Offer, shipping, promotion and photos stay as they are.
 */
export default function UpdateListingsScreen() {
  const hydrated = useSyncExternalStore(noop, () => true, () => false);
  const [stored, setRows] = useState<Row[] | null>(null);
  // Read the phone's saved previews once, after hydration (the server has none).
  if (hydrated && stored === null) setRows(load());
  const rows = stored ?? [];
  const [busy, setBusy] = useState<"" | "finding" | "previewing" | "updating">("");
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const stop = useRef(false);

  const update = (fn: (rows: Row[]) => Row[]) =>
    setRows((prev) => {
      const next = fn(prev ?? []);
      save(next);
      return next;
    });
  const patch = (sku: string, p: Partial<Row>) => update((rs) => rs.map((r) => (r.listing.sku === sku ? { ...r, ...p } : r)));

  async function find() {
    setBusy("finding");
    setError("");
    try {
      const found: LiveListing[] = [];
      let offset: number | undefined = 0;
      while (offset !== undefined) {
        const page: { listings: LiveListing[]; nextOffset?: number } = await call(`/api/listing/refresh?offset=${offset}`);
        found.push(...page.listings);
        offset = page.nextOffset;
      }
      // Keep previews already made for listings that are still live with the same title.
      update((old) =>
        found.map((listing) => {
          const had = old.find((r) => r.listing.sku === listing.sku && r.listing.title === listing.title);
          return had ? { ...had, listing } : { listing, include: true };
        }),
      );
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy("");
  }

  async function previewAll(limit?: number) {
    setBusy("previewing");
    stop.current = false;
    const todo = rows.filter((r) => !r.preview && !r.result).slice(0, limit);
    await twoAtATime(
      todo,
      async (r) => {
        try {
          // Every CD was bought in Canada: say so when copies titled Canadian sold for more.
          const check = savedCheck(r.listing.sku);
          const canadianVersion = canadianSoldForMore(check?.soldItems) || undefined;
          const preview = await call<RefreshPreview>("/api/listing/refresh/preview", { sku: r.listing.sku, canadianVersion });
          // A special edition that sold for more than this listing's price raises it.
          const raise = r.listing.price === undefined ? undefined : (editionPriceAbove(check?.soldItems, preview.edition, r.listing.price) ?? undefined);
          patch(r.listing.sku, { preview, previewError: undefined, raise });
        } catch (err) {
          patch(r.listing.sku, { previewError: (err as Error).message, include: false });
        }
      },
      () => stop.current,
    );
    setBusy("");
  }

  async function applyAll() {
    setConfirming(false);
    setBusy("updating");
    stop.current = false;
    const todo = rows.filter((r) => r.include && r.preview && r.result?.status !== "updated");
    await twoAtATime(
      todo,
      async (r) => {
        try {
          const result = await call<ApplyResult>("/api/listing/refresh/apply", {
            sku: r.listing.sku,
            expectedTitle: r.preview!.before.title,
            after: r.preview!.after,
            price: r.raise?.price,
          });
          patch(r.listing.sku, { result });
          if (result.status === "updated") {
            // Review's "Edit" re-sends the Auto draft whole: keep it in step with what eBay now has.
            const change = { ...r.preview!.after, price: r.raise?.price };
            for (const { id, item } of liveChangeForSku(autoStore.all(), r.listing.sku, change)) autoStore.update(id, () => item);
          }
        } catch (err) {
          patch(r.listing.sku, { result: { status: "failed", reason: (err as Error).message } });
        }
      },
      () => stop.current,
    );
    setBusy("");
  }

  const previewed = rows.filter((r) => r.preview);
  const waiting = rows.filter((r) => !r.preview && !r.result);
  const ready = rows.filter((r) => r.include && r.preview && r.result?.status !== "updated");
  const updated = rows.filter((r) => r.result?.status === "updated");

  return (
    <>
      <AppBar title="Update live listings" back={{ href: "/review", label: "Back to Review" }} />
      <main className="page flex flex-col gap-4 pb-28">
        <header className="pt-1">
          <h1 className="t-display">Update live listings</h1>
          <p className="t-small mt-1 text-muted">
            Claude rewrites the title, item specifics and description of each live listing with the current listing rules.
            The price only goes up when your CD is a special edition (no barcode, Canadian...) whose copies sold for more,
            using the sold prices saved on this phone. Shipping, promotion, photos and condition stay as they are. Nothing
            changes on eBay until you tap Update.
          </p>
        </header>

        {error && <p className="notice notice-warn t-small">{error}</p>}

        <section className="card flex flex-col gap-3 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="t-title">
              {rows.length ? `${rows.length} live listing${rows.length === 1 ? "" : "s"}` : "Live listings"}
            </p>
            <button type="button" className="btn btn-secondary" disabled={!!busy} onClick={find}>
              {busy === "finding" ? <Spinner /> : <Icon name="search" size={18} />} {rows.length ? "Find again" : "Find"}
            </button>
          </div>
          {rows.length > 0 && (
            <p className="t-small text-muted">
              {previewed.length} previewed{waiting.length ? `, ${waiting.length} to preview` : ""}
              {updated.length ? `, ${updated.length} updated on eBay` : ""}.
            </p>
          )}
          {waiting.length > 0 && (
            <div className="flex gap-2">
              {previewed.length === 0 && waiting.length > 3 && (
                <button type="button" className="btn btn-secondary flex-1" disabled={!!busy} onClick={() => previewAll(3)}>
                  Preview 3
                </button>
              )}
              <button type="button" className="btn btn-secondary flex-1" disabled={!!busy} onClick={() => previewAll()}>
                {busy === "previewing" ? <Spinner /> : null} Preview {waiting.length === rows.length ? "all" : "the rest"} ({waiting.length})
              </button>
            </div>
          )}
          {busy && busy !== "finding" && (
            <button type="button" className="link t-small self-start px-1 py-1" onClick={() => (stop.current = true)}>
              Stop after the current ones
            </button>
          )}
        </section>

        <ul className="flex flex-col gap-3">
          {rows
            .filter((r) => r.preview || r.previewError || r.result)
            .map((r) => (
              <PreviewCard key={r.listing.sku} row={r} onToggle={() => patch(r.listing.sku, { include: !r.include })} />
            ))}
        </ul>
      </main>

      {ready.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-background/95 p-3 pb-[calc(env(safe-area-inset-bottom)+12px)] backdrop-blur">
          <div className="mx-auto flex max-w-lg gap-2">
            {confirming ? (
              <>
                <button type="button" className="btn btn-secondary flex-1" onClick={() => setConfirming(false)}>
                  Cancel
                </button>
                <button type="button" className="btn btn-primary flex-[2]" onClick={applyAll}>
                  Yes, update {ready.length} on eBay
                </button>
              </>
            ) : (
              <button type="button" className="btn btn-primary w-full" disabled={!!busy} onClick={() => setConfirming(true)}>
                {busy === "updating" ? <Spinner /> : null} Update {ready.length} listing{ready.length === 1 ? "" : "s"} on eBay
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function PreviewCard({ row, onToggle }: { row: Row; onToggle: () => void }) {
  const [open, setOpen] = useState(false);
  const p = row.preview;
  const result = row.result;
  return (
    <li className="card flex flex-col gap-2 p-3">
      <div className="flex gap-3">
        {row.listing.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- eBay-hosted photo
          <img src={row.listing.imageUrl} alt="" className="h-16 w-16 shrink-0 rounded-lg border border-line bg-surface-2 object-cover" />
        )}
        <div className="min-w-0 flex-1">
          <p className="t-caption text-muted line-through">{p?.before.title || row.listing.title}</p>
          {p && (
            <p className="t-headline mt-1">
              {p.after.title} <span className="t-caption font-normal text-muted">({p.after.title.length}/80)</span>
            </p>
          )}
          {row.listing.price !== undefined &&
            (row.raise ? (
              <p className="t-small mt-1">
                <span className="text-muted line-through">{formatMoney(row.listing.price, "CAD")}</span>{" "}
                <b>{formatMoney(row.raise.price, "CAD")}</b> <span className="text-muted">({row.raise.reason})</span>
              </p>
            ) : (
              <p className="t-caption mt-1 text-muted">{formatMoney(row.listing.price, "CAD")}, unchanged</p>
            ))}
        </div>
      </div>
      {row.previewError && <p className="notice notice-warn t-small">{row.previewError}</p>}
      {p && p.changedAspects.length > 0 && (
        <p className="t-small">
          <b>Item specifics added:</b> {p.changedAspects.map((n) => `${n}: ${p.after.aspects[n]?.join(", ")}`).join(" · ")}
        </p>
      )}
      {p && (p.conflicts?.length ?? 0) > 0 && (
        <p className="t-small">
          <b>Left as is, but Claude disagrees:</b> {p.conflicts.join(" · ")}
        </p>
      )}
      {p && p.checks.length > 0 && (
        <p className="t-small text-muted">
          <b>To confirm:</b> {p.checks.join(" · ")}
        </p>
      )}
      {result && (
        <p className={`notice t-small ${result.status === "updated" ? "notice-ok" : "notice-warn"}`}>
          {result.status === "updated" ? "Updated on eBay." : result.reason}
        </p>
      )}
      {p && (
        <div className="flex items-center gap-2">
          <button type="button" className="chip-toggle" aria-pressed={row.include} onClick={onToggle} disabled={result?.status === "updated"}>
            {row.include ? <Icon name="check" size={16} /> : null} Include
          </button>
          <button type="button" className="link t-small px-1 py-1" onClick={() => setOpen(!open)}>
            {open ? "Hide description" : "Show description"}
          </button>
        </div>
      )}
      {p && open && (
        <iframe title="New description" sandbox="" className="h-80 w-full rounded-xl border border-line bg-white" srcDoc={p.after.descriptionHtml} />
      )}
    </li>
  );
}
