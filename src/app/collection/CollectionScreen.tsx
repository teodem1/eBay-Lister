"use client";

import { useEffect, useEffectEvent, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { AppBar, Icon, TabBar } from "@/components/ui";
import {
  CURRENCY,
  allCategories,
  cleanCategory,
  filterItems,
  mergeBackup,
  parseBackup,
  totalValue,
  withCategory,
  type CollectionItem,
  type SortKey,
} from "@/lib/collection/collection";
import { collectionStore, useCollection } from "@/lib/collection/store";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "recent", label: "Recently added" },
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
  const [editing, setEditing] = useState<string | null>(null);

  const categories = useMemo(() => allCategories(items), [items]);
  const shown = useMemo(() => filterItems(items, { query, category, sort }), [items, query, category, sort]);
  const filtered = query.trim() !== "" || !!category;
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
            <ValueSummary all={items} shown={filtered ? shown : undefined} />

            <div className="flex flex-col gap-3">
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
                    All · {items.length}
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
                  {filtered && ` of ${items.length}`}
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
              <p className="card t-small text-center text-muted">No CDs match. Try another search or category.</p>
            ) : (
              <ul className="card divide-y divide-line overflow-hidden p-0">
                {shown.map((item) => (
                  <li key={item.id}>
                    <CdCard item={item} onOpen={() => setEditing(item.id)} />
                  </li>
                ))}
              </ul>
            )}

            <Backup items={items} />
          </>
        )}
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

function ValueSummary({ all, shown }: { all: CollectionItem[]; shown?: CollectionItem[] }) {
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
      {shown && (
        <p className="chip mt-3 bg-brand-soft px-3 py-1 text-sm text-brand-ink">
          Showing {money(totalValue(shown))} in {shown.length} {shown.length === 1 ? "CD" : "CDs"}
        </p>
      )}
    </section>
  );
}

function CdCard({ item, onOpen }: { item: CollectionItem; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 p-3 text-left transition-colors active:bg-surface-2"
    >
      <Cover item={item} size="h-16 w-16" />
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
        <span className="text-base font-bold tabular-nums tracking-tight">{item.price !== undefined ? money(item.price) : "—"}</span>
        {item.priceSource === "estimate" && <span className="t-caption text-muted">Estimate</span>}
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
    const onPop = () => onBack();
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

  function save() {
    const priceChanged = priceNum !== item.price;
    const pending = cleanCategory(newCat);
    collectionStore.update(item.id, {
      title: title.trim() || item.title,
      artist: artist.trim(),
      year: yearNum,
      price: priceNum === undefined ? undefined : Math.round(priceNum * 100) / 100,
      priceSource: priceNum === undefined ? undefined : priceChanged ? "manual" : item.priceSource,
      categories: pending ? withCategory(cats, pending) : cats,
    });
    close();
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

          <button type="submit" className="btn btn-primary btn-lg" disabled={!priceValid || !yearValid}>
            Save
          </button>
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

function EmptyState() {
  return (
    <section className="card flex flex-col items-center gap-3 py-10 text-center fade-in">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-soft text-brand-ink">
        <Icon name="disc" size={34} strokeWidth={1.6} />
      </span>
      <h1 className="t-title">No CDs yet</h1>
      <p className="t-small max-w-xs text-muted">
        Scan a CD, review its listing, then tap Add to Collection (or publish it). It lands here with its cover, artist, year and your price.
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

  async function exportFile() {
    const name = `cd-collection-${new Date().toISOString().slice(0, 10)}.json`;
    const file = new File([JSON.stringify({ version: 1, items }, null, 2)], name, { type: "application/json" });
    // The Android app can't download files, but it can share them (Drive, email...).
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: "CD collection backup" });
        return;
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
      }
    }
    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function importFile(file: File) {
    try {
      const imported = parseBackup(await file.text());
      const merged = mergeBackup(collectionStore.all(), imported);
      const added = merged.length - collectionStore.all().length;
      collectionStore.replace(merged);
      setMessage({ ok: true, text: `Imported ${added} ${added === 1 ? "CD" : "CDs"}.` });
    } catch (err) {
      setMessage({ ok: false, text: `Couldn't read that file: ${(err as Error).message}` });
    }
  }

  return (
    <section className="card flex flex-col gap-3">
      <div>
        <h2 className="t-headline">Backup</h2>
        <p className="t-small text-muted">
          Your collection is saved on this phone. Save a backup file now and then so you don&apos;t lose it if the app is
          reinstalled.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="btn btn-secondary" onClick={exportFile}>
          Save backup
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => fileRef.current?.click()}>
          Restore
        </button>
      </div>
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
      {message && <p className={`notice ${message.ok ? "notice-ok" : "notice-bad"}`}>{message.text}</p>}
    </section>
  );
}

function money(n: number) {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: CURRENCY }).format(n);
}
