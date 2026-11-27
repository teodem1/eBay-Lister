"use client";

import { useEffect, useEffectEvent, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { AppBar, Icon, Spinner, TabBar } from "@/components/ui";
import {
  CURRENCY,
  allCategories,
  cleanCategory,
  filterItems,
  isSold,
  markSold,
  mergeBackup,
  NOT_SOLD,
  parseBackup,
  soldTotal,
  today,
  totalValue,
  withCategory,
  type CollectionItem,
  type SortKey,
  type StatusFilter,
} from "@/lib/collection/collection";
import { collectionStore, useCollection } from "@/lib/collection/store";
import { pushEditToEbay, type EbaySync } from "./pushEditToEbay";
import CollectionSoldPrices from "./CollectionSoldPrices";
import { saveTextFile } from "@/lib/native/share";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "recent", label: "Recently added" },
  { key: "sold", label: "Recently sold" },
  { key: "artist", label: "Artist A–Z" },
  { key: "title", label: "Album A–Z" },
  { key: "year", label: "Release year" },
  { key: "price", label: "Price, high to low" },
];

const noop = () => () => {};

export default function CollectionScreen() {
  const items = useCollection();
  // The collection lives on the device, so wait for the browser before showing "empty".
  const hydrated = useSyncExternalStore(noop, () => true, () => false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | undefined>();
  const [sort, setSort] = useState<SortKey>("recent");
  const [status, setStatus] = useState<StatusFilter>("unsold");
  const [editing, setEditing] = useState<string | null>(null);

  const soldCount = useMemo(() => items.filter(isSold).length, [items]);
  const inStock = useMemo(() => items.filter((i) => !isSold(i)), [items]);
  const categories = useMemo(() => allCategories(items), [items]);
  const shown = useMemo(() => filterItems(items, { query, category, sort, status }), [items, query, category, sort, status]);
  const inView = status === "all" ? items.length : status === "sold" ? soldCount : inStock.length;
  const filtered = query.trim() !== "" || !!category;

  function pickStatus(next: StatusFilter) {
    setStatus(next);
    // Sold CDs read best newest sale first; the other views by when they were added.
    if (next === "sold" && sort === "recent") setSort("sold");
    if (next !== "sold" && sort === "sold") setSort("recent");
  }
  const editItem = items.find((i) => i.id === editing);

  return (
    <>
      <AppBar title="Collection" />
      <main className="page page-tabs">
        {!hydrated ? (
          <div className="skeleton h-32" />
        ) : items.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            <ValueSummary all={inStock} sold={items.filter(isSold)} shown={filtered && status === "unsold" ? shown : undefined} />

            <div className="flex flex-col gap-3">
              {soldCount > 0 && (
                <div className="flex gap-2" role="group" aria-label="Show in stock or sold CDs">
                  <FilterChip on={status === "unsold"} onClick={() => pickStatus("unsold")}>
                    In stock · {inStock.length}
                  </FilterChip>
                  <FilterChip on={status === "sold"} onClick={() => pickStatus("sold")}>
                    Sold · {soldCount}
                  </FilterChip>
                  <FilterChip on={status === "all"} onClick={() => pickStatus("all")}>
                    All · {items.length}
                  </FilterChip>
                </div>
              )}

              <div className="relative">
                <label htmlFor="collection-search" className="sr-only">
                  Search the collection
                </label>
                <Icon name="search" size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
                <input
                  id="collection-search"
                  type="search"
                  placeholder="Search album, artist, year, category"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="field h-12 pl-11"
                />
              </div>

              {categories.length > 0 && (
                <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]" role="group" aria-label="Filter by category">
                  <FilterChip on={!category} onClick={() => setCategory(undefined)}>
                    Any category
                  </FilterChip>
                  {categories.map((c) => (
                    <FilterChip
                      key={c.name}
                      on={category?.toLowerCase() === c.name.toLowerCase()}
                      onClick={() => setCategory(category?.toLowerCase() === c.name.toLowerCase() ? undefined : c.name)}
                    >
                      {c.name} · {c.count}
                    </FilterChip>
                  ))}
                </div>
              )}

              <div className="flex items-center justify-between gap-3 px-1">
                <span className="t-small text-muted">
                  {shown.length} {shown.length === 1 ? "CD" : "CDs"}
                  {filtered && ` of ${inView}`}
                  {status === "sold" ? " sold" : status === "unsold" && soldCount > 0 ? " in stock" : ""}
                </span>
                <label className="flex items-center gap-2 text-sm text-muted">
                  <span className="sr-only">Sort by</span>
                  <select
                    value={sort}
                    onChange={(e) => setSort(e.target.value as SortKey)}
                    className="field min-h-11 w-auto py-1 pl-4 text-sm font-medium"
                  >
                    {SORTS.map((s) => (
                      <option key={s.key} value={s.key}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            {shown.length === 0 ? (
              <p className="card t-small text-center text-muted">
                {inView === 0
                  ? status === "unsold"
                    ? "Every CD here is sold. Tap Sold to see them."
                    : "No CDs here yet."
                  : "No CDs match. Try another search or category."}
              </p>
            ) : (
              <ul className="card divide-y divide-line overflow-hidden p-0">
                {shown.map((item) => (
                  <li key={item.id}>
                    <CdCard item={item} onOpen={() => setEditing(item.id)} />
                  </li>
                ))}
              </ul>
            )}

          </>
        )}
        {/* Outside the branches above so a restore on an empty collection keeps its message. */}
        {hydrated && <Backup items={items} />}
      </main>
      <TabBar active="collection" />
      {editItem && (
        <EditSheet
          key={editItem.id}
          item={editItem}
          allCategories={categories.map((c) => c.name)}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function ValueSummary({ all, sold, shown }: { all: CollectionItem[]; sold: CollectionItem[]; shown?: CollectionItem[] }) {
  const priced = all.filter((i) => i.price !== undefined);
  const unpriced = all.length - priced.length;
  const average = priced.length ? totalValue(priced) / priced.length : undefined;
  const stats = [
    { label: all.length === 1 ? "CD" : "CDs", value: String(all.length) },
    { label: "Average", value: average !== undefined ? money(average) : "—" },
    { label: "No price", value: String(unpriced) },
  ];
  return (
    <section className="card" aria-label="Inventory value">
      <p className="eyebrow">Inventory value</p>
      <p className="t-display mt-1 text-[2.25rem] leading-none tabular-nums">{money(totalValue(all))}</p>
      <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-line pt-3">
        {stats.map((s) => (
          <div key={s.label}>
            <dt className="t-caption text-muted">{s.label}</dt>
            <dd className="font-semibold tabular-nums">{s.value}</dd>
          </div>
        ))}
      </dl>
      {sold.length > 0 && (
        <p className="t-small mt-3 text-muted">
          Sold: {sold.length} {sold.length === 1 ? "CD" : "CDs"} for{" "}
          <span className="font-semibold text-foreground tabular-nums">{money(soldTotal(sold))}</span>
        </p>
      )}
      {shown && (
        <p className="chip mt-3 bg-brand-soft px-3 py-1 text-sm text-brand-ink">
          Showing {money(totalValue(shown))} in {shown.length} {shown.length === 1 ? "CD" : "CDs"}
        </p>
      )}
    </section>
  );
}

function CdCard({ item, onOpen }: { item: CollectionItem; onOpen: () => void }) {
  const sold = isSold(item);
  const price = sold ? (item.soldPrice ?? item.price) : item.price;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 p-3 text-left transition-colors active:bg-surface-2"
    >
      <div className={sold ? "opacity-60 grayscale" : undefined}>
        <Cover item={item} size="h-16 w-16" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <p className="truncate font-semibold">{item.title}</p>
        <p className="t-small truncate text-muted">
          {item.artist || "Unknown artist"}
          {item.year ? ` · ${item.year}` : ""}
        </p>
        {item.categories.length > 0 && (
          <div className="mt-1 flex gap-1 overflow-hidden">
            {item.categories.slice(0, 3).map((c) => (
              <span key={c} className="chip shrink-0 bg-surface-2 text-muted">
                {c}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end">
        <span className={`text-base font-bold tabular-nums tracking-tight ${sold ? "text-muted" : ""}`}>
          {price !== undefined ? money(price) : "—"}
        </span>
        {sold ? (
          <span className="chip mt-0.5 bg-ok-soft text-ok-ink">
            <Icon name="check" size={14} strokeWidth={2.4} /> Sold {shortDate(item.soldAt!)}
          </span>
        ) : (
          item.priceSource === "estimate" && <span className="t-caption text-muted">Estimate</span>
        )}
      </div>
    </button>
  );
}

/** Album cover with a fallback image, then a disc placeholder. */
function Cover({ item, size }: { item: CollectionItem; size: string }) {
  const [failed, setFailed] = useState(0);
  const src = [item.coverUrl, item.fallbackCoverUrl].filter(Boolean)[failed];
  if (!src) {
    return (
      <div className={`${size} flex shrink-0 items-center justify-center rounded-xl bg-surface-2 text-muted`}>
        <Icon name="disc" size={30} strokeWidth={1.5} />
      </div>
    );
  }
  return (
    // Covers come from several hosts (Cover Art Archive, eBay, the user's photo), so a plain img.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      loading="lazy"
      onError={() => setFailed((n) => n + 1)}
      className={`${size} shrink-0 rounded-xl bg-surface-2 object-cover`}
    />
  );
}

function FilterChip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className="chip-toggle">
      {on && <Icon name="check" size={16} strokeWidth={2.4} />}
      {children}
    </button>
  );
}

function EditSheet({ item, allCategories, onClose }: { item: CollectionItem; allCategories: string[]; onClose: () => void }) {
  const [title, setTitle] = useState(item.title);
  const [artist, setArtist] = useState(item.artist);
  const [year, setYear] = useState(item.year ? String(item.year) : "");
  const [price, setPrice] = useState(item.price !== undefined ? item.price.toFixed(2) : "");
  const [cats, setCats] = useState(item.categories);
  const [newCat, setNewCat] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [sync, setSync] = useState<EbaySync | null>(null);

  const priceNum = price.trim() === "" ? undefined : Number(price);
  const priceValid = priceNum === undefined || (Number.isFinite(priceNum) && priceNum >= 0);
  const yearNum = year.trim() === "" ? undefined : Number(year);
  const yearValid = yearNum === undefined || (Number.isInteger(yearNum) && yearNum > 1800 && yearNum < 2200);
  const suggestions = allCategories.filter((c) => !cats.some((x) => x.toLowerCase() === c.toLowerCase()));

  // Android back button (and browser back) closes the sheet instead of leaving
  // the screen: opening adds a history entry, back pops it.
  const onBack = useEffectEvent(() => onClose());
  useEffect(() => {
    window.history.pushState({ ...window.history.state, cdSheet: true }, "");
    // Closing a sale's detail sheet on top lands back on this entry: stay open.
    const onPop = () => {
      if (!window.history.state?.cdSheet) onBack();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  function close() {
    if (window.history.state?.cdSheet) window.history.back();
    else onClose();
  }

  function addCat(c: string) {
    setCats((list) => withCategory(list, c));
    setNewCat("");
  }

  async function save() {
    const priceChanged = priceNum !== item.price;
    const pending = cleanCategory(newCat);
    const after = {
      title: title.trim() || item.title,
      artist: artist.trim(),
      year: yearNum,
      price: priceNum === undefined ? undefined : Math.round(priceNum * 100) / 100,
    };
    collectionStore.update(item.id, {
      ...after,
      priceSource: priceNum === undefined ? undefined : priceChanged ? "manual" : item.priceSource,
      categories: pending ? withCategory(cats, pending) : cats,
    });
    // Album, artist, year and price also change the live eBay listing.
    const onEbay =
      (item.sku || item.barcode) &&
      (after.title !== item.title || after.artist !== item.artist || after.year !== item.year || (after.price !== undefined && after.price !== item.price));
    if (!onEbay) return close();
    setSync({ state: "working" });
    const result = await pushEditToEbay(item, after);
    setSync(result);
    if (result.state === "done") setTimeout(close, 1200);
  }

  const listing = new URLSearchParams();
  listing.set("q", [artist, title].filter((s) => s.trim()).join(" ") + " CD");
  if (item.barcode) listing.set("barcode", item.barcode);
  if (priceNum) listing.set("price", String(priceNum));

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/45 fade-in" onClick={close}>
      <div
        role="dialog"
        aria-modal
        aria-labelledby="edit-cd-title"
        className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-line bg-background p-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-line-strong" aria-hidden />
        <div className="flex items-center gap-3">
          <Cover item={item} size="h-20 w-20" />
          <div className="min-w-0 flex-1">
            <p className="eyebrow">Edit CD</p>
            <h2 id="edit-cd-title" className="t-title truncate">
              {item.title}
            </h2>
            {item.barcode && <p className="t-caption text-muted">Barcode {item.barcode}</p>}
          </div>
          <button type="button" onClick={close} aria-label="Close" className="icon-btn -mr-2 self-start">
            <Icon name="close" />
          </button>
        </div>

        <form
          className="mt-4 flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (priceValid && yearValid) save();
          }}
        >
          <label className="block">
            <span className="label">Album</span>
            <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="block">
            <span className="label">Artist or group</span>
            <input className="field" value={artist} onChange={(e) => setArtist(e.target.value)} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="label">Release year</span>
              <input
                className="field"
                inputMode="numeric"
                value={year}
                onChange={(e) => setYear(e.target.value.replace(/\D/g, "").slice(0, 4))}
                aria-invalid={!yearValid}
              />
            </label>
            <label className="block">
              <span className="label">Sale price ({CURRENCY})</span>
              <input
                className="field"
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value.replace(",", "."))}
                aria-invalid={!priceValid}
              />
            </label>
          </div>
          {item.priceSource === "estimate" && price === (item.price?.toFixed(2) ?? "") && (
            <p className="hint -mt-2">Estimated from current eBay listings when you scanned it. Change it to set your own.</p>
          )}
          {!isSold(item) && <CollectionSoldPrices item={item} price={priceValid ? priceNum : undefined} onPick={(p) => setPrice(p.toFixed(2))} />}

          <fieldset>
            <legend className="label">Categories</legend>
            {cats.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {cats.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCats((list) => list.filter((x) => x !== c))}
                    className="chip-toggle"
                    aria-pressed
                    aria-label={`Remove category ${c}`}
                  >
                    {c}
                    <Icon name="close" size={14} strokeWidth={2.4} />
                  </button>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <input
                className="field"
                placeholder="Add a category, e.g. Jazz"
                value={newCat}
                list="category-suggestions"
                onChange={(e) => setNewCat(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addCat(newCat);
                  }
                }}
              />
              <button type="button" className="btn btn-secondary shrink-0" disabled={!newCat.trim()} onClick={() => addCat(newCat)}>
                Add
              </button>
            </div>
            <datalist id="category-suggestions">
              {suggestions.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            {suggestions.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {suggestions.slice(0, 8).map((c) => (
                  <button key={c} type="button" onClick={() => addCat(c)} className="chip-toggle text-muted">
                    <Icon name="plus" size={14} strokeWidth={2.4} />
                    {c}
                  </button>
                ))}
              </div>
            )}
          </fieldset>

          <SoldSection item={item} listedPrice={priceNum} />

          {sync && sync.state !== "working" && (
            <p role="status" className={`notice t-small ${sync.state === "done" ? "notice-ok" : sync.state === "failed" ? "notice-bad" : "notice-warn"}`}>
              {sync.message}
            </p>
          )}
          {sync && sync.state !== "working" && sync.state !== "done" ? (
            <button type="button" className="btn btn-primary btn-lg" onClick={close}>
              Close
            </button>
          ) : (
            <button type="submit" className="btn btn-primary btn-lg" disabled={!priceValid || !yearValid || sync?.state === "working"}>
              {sync?.state === "working" ? (
                <>
                  <Spinner /> Updating eBay…
                </>
              ) : sync?.state === "done" ? (
                <>
                  <Icon name="check" size={18} /> Saved
                </>
              ) : (
                "Save"
              )}
            </button>
          )}
          <Link href={`/listing?${listing}`} className="btn btn-secondary">
            Create eBay listing
            <Icon name="arrow" size={18} />
          </Link>
          <button
            type="button"
            className={`btn ${confirmRemove ? "bg-bad-soft text-bad-ink" : "text-bad-ink"}`}
            onClick={() => {
              if (!confirmRemove) return setConfirmRemove(true);
              collectionStore.remove(item.id);
              close();
            }}
          >
            {confirmRemove ? "Tap again to remove" : "Remove from collection"}
          </button>
        </form>
      </div>
    </div>
  );
}

/** Mark the CD sold (date + optional price) or back to in stock. Saves at once, on this phone only. */
function SoldSection({ item, listedPrice }: { item: CollectionItem; listedPrice?: number }) {
  const sold = isSold(item);
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(item.soldAt ?? today());
  const start = item.soldPrice ?? listedPrice ?? item.price;
  const [price, setPrice] = useState(start !== undefined ? start.toFixed(2) : "");
  const priceNum = price.trim() === "" ? undefined : Number(price);
  const priceValid = priceNum === undefined || (Number.isFinite(priceNum) && priceNum >= 0);
  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(date);

  function save() {
    collectionStore.update(item.id, markSold(date, priceNum));
    setOpen(false);
  }

  if (sold && !open) {
    const amount = item.soldPrice ?? item.price;
    return (
      <section className="notice notice-ok flex flex-col gap-2" aria-label="Sold">
        <p className="t-small font-semibold">
          Sold {longDate(item.soldAt!)}
          {amount !== undefined && ` for ${money(amount)}`}
        </p>
        <div className="flex gap-2">
          <button type="button" className="btn btn-secondary flex-1" onClick={() => setOpen(true)}>
            Edit sale
          </button>
          <button type="button" className="btn btn-secondary flex-1" onClick={() => collectionStore.update(item.id, NOT_SOLD)}>
            Back in stock
          </button>
        </div>
      </section>
    );
  }
  if (!open) {
    return (
      <button type="button" className="btn btn-secondary" onClick={() => setOpen(true)}>
        <Icon name="check" size={18} /> Mark as sold
      </button>
    );
  }
  return (
    <fieldset className="card flex flex-col gap-3 p-3">
      <legend className="sr-only">Mark as sold</legend>
      <p className="t-headline">{sold ? "Edit sale" : "Mark as sold"}</p>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="label">Sold on</span>
          <input className="field" type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} aria-invalid={!dateValid} />
        </label>
        <label className="block">
          <span className="label">Sold for ({CURRENCY})</span>
          <input
            className="field"
            inputMode="decimal"
            value={price}
            placeholder="Optional"
            onChange={(e) => setPrice(e.target.value.replace(",", "."))}
            aria-invalid={!priceValid}
          />
        </label>
      </div>
      <p className="hint -mt-1">Only changes your collection. eBay ends the listing itself when it sells.</p>
      <div className="flex gap-2">
        <button type="button" className="btn btn-secondary flex-1" onClick={() => setOpen(false)}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary flex-1" disabled={!priceValid || !dateValid} onClick={save}>
          {sold ? "Save sale" : "Mark sold"}
        </button>
      </div>
    </fieldset>
  );
}

function EmptyState() {
  return (
    <section className="card flex flex-col items-center gap-3 py-10 text-center fade-in">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-soft text-brand-ink">
        <Icon name="disc" size={34} strokeWidth={1.6} />
      </span>
      <h1 className="t-title">No CDs yet</h1>
      <p className="t-small max-w-xs text-muted">
        Scan a CD, review its listing, then tap Add to Collection (or publish it). It lands here with its cover, artist, year and your price.
        Reinstalled the app? Restore your backup below.
      </p>
      <Link href="/" className="btn btn-primary mt-1">
        Scan a CD
      </Link>
    </section>
  );
}

/** Backup file, since the collection is stored on this device only. */
function Backup({ items }: { items: CollectionItem[] }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const [saving, setSaving] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState("");
  // A fresh install has nothing to save yet, only something to restore.
  const empty = items.length === 0;

  async function exportFile() {
    const name = `cd-collection-${new Date().toISOString().slice(0, 10)}.json`;
    setSaving(true);
    setMessage(null);
    try {
      const result = await saveTextFile(name, JSON.stringify({ version: 1, items }, null, 2), "CD collection backup");
      const text = {
        shared: `Backup ready (${name}). Keep it somewhere safe, like Google Drive or an email to yourself.`,
        downloaded: `Backup saved to your downloads as ${name}.`,
        copied: "Backup copied. Paste it into a note or an email to yourself. To restore, use \"Paste a backup\" below.",
        cancelled: null,
      }[result];
      if (text) setMessage({ ok: true, text });
    } catch (err) {
      setMessage({ ok: false, text: `Couldn't save the backup: ${(err as Error).message}` });
    } finally {
      setSaving(false);
    }
  }

  function restore(json: string) {
    try {
      const imported = parseBackup(json);
      const merged = mergeBackup(collectionStore.all(), imported);
      const added = merged.length - collectionStore.all().length;
      collectionStore.replace(merged);
      setMessage({ ok: true, text: `Imported ${added} ${added === 1 ? "CD" : "CDs"}.` });
      return true;
    } catch (err) {
      setMessage({ ok: false, text: `Couldn't read that backup: ${(err as Error).message}` });
      return false;
    }
  }

  async function importFile(file: File) {
    restore(await file.text());
  }

  return (
    <section className="card flex flex-col gap-3">
      <div>
        <h2 className="t-headline">{empty ? "Restore a backup" : "Backup"}</h2>
        <p className="t-small text-muted">
          {empty
            ? "Have a backup file from before the app was reinstalled? Restore it to bring your CDs back."
            : "Your collection is saved on this phone. Save a backup file now and then so you don't lose it if the app is reinstalled."}
        </p>
      </div>
      {empty ? (
        <button type="button" className="btn btn-secondary" onClick={() => fileRef.current?.click()}>
          Restore from backup
        </button>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="btn btn-secondary" onClick={exportFile} disabled={saving}>
            {saving ? "Saving…" : "Save backup"}
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => fileRef.current?.click()}>
            Restore
          </button>
        </div>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) importFile(f);
          e.target.value = "";
        }}
      />
      <button type="button" className="link self-start t-small" onClick={() => setPasting((p) => !p)} aria-expanded={pasting}>
        Paste a backup
      </button>
      {pasting && (
        <div className="flex flex-col gap-2">
          <label htmlFor="paste-backup" className="sr-only">
            Backup text
          </label>
          <textarea
            id="paste-backup"
            className="field min-h-24 font-mono t-caption"
            placeholder="Paste the backup text here"
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
          />
          <button
            type="button"
            className="btn btn-secondary"
            disabled={!pasted.trim()}
            onClick={() => {
              if (restore(pasted)) {
                setPasted("");
                setPasting(false);
              }
            }}
          >
            Restore from pasted text
          </button>
        </div>
      )}
      {message && (
        <p role="status" className={`notice ${message.ok ? "notice-ok" : "notice-bad"}`}>
          {message.text}
        </p>
      )}
    </section>
  );
}

function shortDate(iso: string) {
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-CA", { month: "short", day: "numeric" });
}

function longDate(iso: string) {
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" });
}

function money(n: number) {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: CURRENCY }).format(n);
}
