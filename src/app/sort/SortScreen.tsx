"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { AppBar, Icon, Spinner, TabBar } from "@/components/ui";
import CdCover from "@/components/CdCover";
import { isCancel, pickFileFromInput, takeItemPhoto } from "@/lib/native/camera";
import { resizeImage } from "@/lib/resize-image";
import { fetchPriceSuggestion, formatMoney, priceSuggestionBody } from "@/app/listing/priceRequest";
import { batchStore, autoStore } from "@/lib/batch/store";
import { itemFromSort } from "@/lib/batch/queue";
import { useSoldQuotaWarning } from "@/lib/pricing/soldLimit";
import type { ShelfCd } from "@/lib/listing/types";
import { savedCheckFor } from "@/lib/pricing/savedCheck";
import { CURRENCY } from "@/lib/collection/collection";
import {
  DEFAULT_MIN_NET,
  MAX_PRICE_PER_RUN,
  MIN_NET_CHOICES,
  SORT_FEES,
  checkKey,
  coverFromCheck,
  pricingPlan,
  rankCds,
  sessionFromShelf,
  sortKeywords,
  sortPrice,
  verdict,
  type SortCd,
  type SortVerdict,
} from "@/lib/sort/worth";
import { priceCache, readMinNet, saveMinNet, sortStore } from "@/lib/sort/store";

const noop = () => () => {};
/** Two price checks at a time, like the Auto tab. */
const PARALLEL = 2;

/**
 * Cache key: the search text only. Sort prices by name (one lookup per CD), so a
 * barcode read off a spine isn't part of it; Collection looks it up the same way.
 */
function keyOf(cd: SortCd) {
  return checkKey(sortKeywords(cd));
}

/** A price check already on this phone for this CD: the cache, else To list or Auto (same barcode or name). */
function knownCheck(cd: SortCd) {
  const key = keyOf(cd);
  return priceCache.get(key) ?? savedCheckFor([...batchStore.all(), ...autoStore.all()], { barcode: cd.barcode, key });
}

/**
 * "Sort a pile": one photo of several CDs side by side. Claude names each CD
 * (free), the seller picks which to price (one sold-price lookup each, shown
 * before it runs), and the CDs whose net after fees clears the bar go to the
 * To list tab with their price check, so listing them costs nothing more.
 */
export default function SortScreen() {
  const hydrated = useSyncExternalStore(noop, () => true, () => false);
  const session = sortStore.useSession();
  const [reading, setReading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pricing, setPricing] = useState(false);
  const [minNet, setMinNet] = useState(() => (typeof window === "undefined" ? DEFAULT_MIN_NET : readMinNet(DEFAULT_MIN_NET)));
  const [sentNote, setSentNote] = useState<string | null>(null);
  const stop = useRef(false);
  const paidThisRun = useRef(0);
  const quota = useSoldQuotaWarning();

  const cds = session?.cds ?? [];
  const plan = pricingPlan(cds, (cd) => !!knownCheck(cd));
  const priced = cds.filter((cd) => cd.state === "priced");
  const ranked = rankCds(cds, minNet);
  const worth = ranked.filter((cd) => verdict(cd, minNet) === "worth");
  const toSend = worth.filter((cd) => !cd.sentId);
  const selectedCount = cds.filter((cd) => cd.selected && cd.state !== "priced").length;

  async function readPhoto(fromGallery: boolean) {
    setError(null);
    setSentNote(null);
    let file: File | null;
    try {
      file = fromGallery ? await pickFileFromInput({ accept: "image/*" }) : await takeItemPhoto();
    } catch (err) {
      if (!isCancel(err)) setError(`Camera error: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    if (!file) return;
    setReading("Reading the CDs in your photo…");
    try {
      // Bigger than a single-item photo: spine text is small.
      const blob = await resizeImage(file, 2000, 0.85);
      const form = new FormData();
      form.append("image", blob, "pile.jpg");
      const [res, thumb] = await Promise.all([fetch("/api/lookup/shelf", { method: "POST", body: form }), thumbnail(file)]);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Couldn't read the photo.");
      const found = (data.cds ?? []) as ShelfCd[];
      if (found.length === 0) {
        setError("Claude couldn't read any CDs in that photo. Try closer, with the spines or covers facing the camera.");
        return;
      }
      sortStore.start(sessionFromShelf(found, new Date(), thumb));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't read the photo.");
    } finally {
      setReading(null);
    }
  }

  async function priceOne(cd: SortCd) {
    const known = knownCheck(cd);
    if (known) {
      priceCache.put(keyOf(cd), known);
      sortStore.updateCd(cd.id, { state: "priced", check: known, reused: true, error: undefined });
      return;
    }
    // By name only: a barcode search with few matches makes a second sold-comps call by
    // name, so a barcode would make the "N lookups" count shown before the run wrong.
    const body = priceSuggestionBody(sortKeywords(cd), "");
    if (!body) return;
    // Never more than MAX_PRICE_PER_RUN paid lookups in one run, whatever is ticked.
    if (paidThisRun.current >= MAX_PRICE_PER_RUN) return;
    paidThisRun.current += 1;
    sortStore.updateCd(cd.id, { state: "pricing", error: undefined });
    const result = await fetchPriceSuggestion(body);
    if ("error" in result) {
      sortStore.updateCd(cd.id, { state: "error", error: result.error });
      if (result.soldLimitReached) stop.current = true;
      return;
    }
    // Used up mid-run: no sold prices came back, so stop before spending more calls on listings-only checks.
    // (The cache doesn't keep such a check, so the CD gets real sold prices once the allowance resets.)
    if (result.soldLimitReached) stop.current = true;
    priceCache.put(keyOf(cd), result);
    sortStore.updateCd(cd.id, { state: "priced", check: result, reused: false });
  }

  async function runPricing() {
    stop.current = false;
    paidThisRun.current = 0;
    setPricing(true);
    const queue = [...plan.all];
    const worker = async () => {
      while (queue.length && !stop.current) await priceOne(queue.shift()!);
    };
    await Promise.all(Array.from({ length: PARALLEL }, worker));
    setPricing(false);
  }

  function sendToList() {
    for (const cd of toSend) {
      const item = itemFromSort({ ...cd, keywords: sortKeywords(cd), coverUrl: coverFromCheck(cd.check) });
      batchStore.put(item);
      sortStore.updateCd(cd.id, { sentId: item.id });
    }
    setSentNote(`${toSend.length} CD${toSend.length === 1 ? "" : "s"} added to To list, with their prices saved.`);
  }

  function setBar(n: number) {
    setMinNet(n);
    saveMinNet(n);
  }

  const tooMany = selectedCount > MAX_PRICE_PER_RUN;

  return (
    <>
      <AppBar title="Sort a pile" back={{ href: "/to-list", label: "Back to To list" }} />
      <main className="page page-tabs">
        <header className="pt-1">
          <h1 className="t-display">Which are worth selling?</h1>
          <p className="mt-1 text-muted">
            Photograph several CDs side by side, spines or covers. Claude names each one, then sold prices show what each would
            bring after fees.
          </p>
        </header>

        <section className="flex flex-col gap-3" aria-label="Photo">
          <div className="grid grid-cols-2 gap-3">
            <button type="button" disabled={!!reading || pricing} onClick={() => readPhoto(false)} className="btn btn-primary h-14">
              <Icon name="camera" size={22} strokeWidth={1.8} />
              {session ? "New photo" : "Take photo"}
            </button>
            <button type="button" disabled={!!reading || pricing} onClick={() => readPhoto(true)} className="btn btn-secondary h-14">
              From gallery
            </button>
          </div>
          {reading && (
            <p role="status" className="notice flex items-center gap-3 fade-in">
              <Spinner className="text-brand-ink" />
              {reading}
            </p>
          )}
          {error && (
            <p role="alert" className="notice notice-bad fade-in flex gap-2.5">
              <Icon name="alert" className="mt-0.5" />
              {error}
            </p>
          )}
        </section>

        {!hydrated ? (
          <div className="skeleton h-32" />
        ) : !session ? (
          <section className="card flex flex-col items-center gap-2 py-8 text-center">
            <Icon name="stack" size={36} strokeWidth={1.5} className="text-subtle" />
            <p className="t-title">One photo, a whole pile</p>
            <p className="t-small max-w-xs text-muted">
              Reading the photo is free. Each CD you then price uses one of your sold-price lookups, and you see the count before
              anything runs.
            </p>
          </section>
        ) : (
          <>
            {session.thumb && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={session.thumb} alt="Your pile photo" className="max-h-40 w-full rounded-xl border border-line object-contain bg-surface-2" />
            )}

            <section className="card flex flex-col gap-3" aria-label="Price check">
              <p className="t-headline">
                {cds.length} CD{cds.length === 1 ? "" : "s"} found{priced.length > 0 && `, ${priced.length} priced`}
              </p>
              {plan.all.length > 0 ? (
                <>
                  <p className="t-small text-muted">
                    Pricing {plan.all.length} CD{plan.all.length === 1 ? "" : "s"} uses{" "}
                    <b className="text-foreground">
                      {plan.paid} sold-price lookup{plan.paid === 1 ? "" : "s"}
                    </b>
                    {plan.all.length > plan.paid && ` (${plan.all.length - plan.paid} already checked, free)`}
                    {quota?.kind === "low" && `. ${quota.remaining} left this month`}. Untick the ones you know aren&apos;t worth it.
                  </p>
                  {tooMany && (
                    <p className="notice notice-warn t-small">
                      At most {MAX_PRICE_PER_RUN} per run so one photo can&apos;t use up the month. Untick a few.
                    </p>
                  )}
                  {quota?.kind === "limit" && plan.paid > 0 && (
                    <p className="notice notice-warn t-small">Sold-price lookups are used up this month, so only current listings would show.</p>
                  )}
                  <button type="button" disabled={pricing || tooMany} onClick={runPricing} className="btn btn-primary btn-lg w-full">
                    {pricing ? <Spinner /> : <Icon name="search" />}
                    {pricing ? "Checking prices…" : `Check prices (${plan.paid} lookup${plan.paid === 1 ? "" : "s"})`}
                  </button>
                  {pricing && (
                    <button type="button" className="link t-small self-center px-1 py-1" onClick={() => (stop.current = true)}>
                      Stop after the current CDs
                    </button>
                  )}
                </>
              ) : (
                priced.length === 0 && <p className="t-small text-muted">Tick the CDs you want priced.</p>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <span className="t-small text-muted">Worth it from</span>
                {MIN_NET_CHOICES.map((n) => (
                  <button key={n} type="button" aria-pressed={minNet === n} onClick={() => setBar(n)} className="chip-toggle">
                    {formatMoney(n, CURRENCY)} net
                  </button>
                ))}
              </div>
            </section>

            {worth.length > 0 && (
              <section className="flex flex-col gap-2">
                <button type="button" disabled={toSend.length === 0} onClick={sendToList} className="btn btn-primary btn-lg w-full">
                  <Icon name="stack" />
                  {toSend.length > 0
                    ? `Add ${toSend.length} worth selling to To list`
                    : "All worth selling are on To list"}
                </button>
                {sentNote && (
                  <p role="status" className="notice notice-ok fade-in flex items-center gap-2">
                    <span className="flex-1">{sentNote}</span>
                    <Link href="/to-list" className="link px-1 py-1">
                      Open
                    </Link>
                  </p>
                )}
              </section>
            )}

            <ul className="card divide-y divide-line overflow-hidden p-0" aria-label="CDs in the photo">
              {ranked.map((cd) => (
                <SortRow key={cd.id} cd={cd} minNet={minNet} busy={pricing} />
              ))}
            </ul>

            <FeeNote />
          </>
        )}
      </main>
      <TabBar active="tolist" />
    </>
  );
}

function SortRow({ cd, minNet, busy }: { cd: SortCd; minNet: number; busy: boolean }) {
  const [editing, setEditing] = useState(false);
  const v = verdict(cd, minNet);
  const p = sortPrice(cd.check);
  const cover = coverFromCheck(cd.check);
  const canTick = cd.state !== "priced" && cd.state !== "pricing";

  return (
    <li className="flex flex-col gap-2 p-3">
      <div className="flex items-center gap-3">
        {canTick ? (
          <button
            type="button"
            aria-pressed={cd.selected}
            aria-label={cd.selected ? "Don't price this CD" : "Price this CD"}
            disabled={busy}
            onClick={() => sortStore.updateCd(cd.id, { selected: !cd.selected })}
            className="chip-toggle h-10 w-10 shrink-0 justify-center rounded-full p-0"
          >
            {cd.selected && <Icon name="check" size={18} strokeWidth={2.6} />}
          </button>
        ) : (
          <CdCover item={{ coverUrl: cover }} small />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{cd.album || "Unknown album"}</p>
          <p className="t-small truncate text-muted">
            {[cd.artist, cd.year, cd.edition].filter(Boolean).join(" · ")}
            {cd.confidence !== "high" && ` · ${cd.confidence === "low" ? "hard to read" : "check the name"}`}
          </p>
          {cd.state === "error" && <p className="t-small text-bad-ink">{cd.error}</p>}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1 text-right">
          {cd.state === "pricing" && <Spinner className="text-brand-ink" />}
          {p && <span className="t-title">{formatMoney(p.price, CURRENCY)}</span>}
          {v && <VerdictChip verdict={v} net={p?.net} />}
          {cd.state !== "priced" && cd.state !== "pricing" && (
            <button type="button" className="link t-small px-1 py-1" disabled={busy} onClick={() => setEditing((e) => !e)}>
              {editing ? "Done" : "Fix name"}
            </button>
          )}
        </div>
      </div>
      {p && (
        <p className="t-small text-muted">
          {p.from === "sold" ? `From ${p.count} sold` : `No sales found, from ${p.count} listed`}
          {cd.reused && " · already checked, no lookup used"}
          {cd.sentId && " · on To list"}
        </p>
      )}
      {v === "none" && <p className="t-small text-muted">No copies of this CD on eBay.ca, sold or listed.</p>}
      {editing && (
        <div className="grid grid-cols-2 gap-2 fade-in">
          <input
            aria-label="Artist"
            className="field h-11"
            value={cd.artist}
            placeholder="Artist"
            onChange={(e) => sortStore.updateCd(cd.id, { artist: e.target.value, confidence: "high" })}
          />
          <input
            aria-label="Album"
            className="field h-11"
            value={cd.album}
            placeholder="Album"
            onChange={(e) => sortStore.updateCd(cd.id, { album: e.target.value, confidence: "high" })}
          />
        </div>
      )}
    </li>
  );
}

function VerdictChip({ verdict: v, net }: { verdict: SortVerdict; net?: number }) {
  if (v === "none") return <span className="chip bg-surface-2 text-muted">No data</span>;
  const label = `${formatMoney(net ?? 0, CURRENCY)} net`;
  return v === "worth" ? (
    <span className="chip bg-ok-soft text-ok-ink">
      <Icon name="check" size={12} strokeWidth={2.6} />
      {label}
    </span>
  ) : (
    <span className="chip bg-warn-soft text-warn-ink">{label}</span>
  );
}

function FeeNote() {
  const f = SORT_FEES;
  return (
    <p className="t-small flex gap-2 px-1 text-muted">
      <Icon name="alert" size={16} className="mt-0.5" />
      <span>
        Net is the price minus eBay&apos;s {f.finalValuePercent}% fee and the {f.promotedPercent}% promoted fee (both on price plus{" "}
        {formatMoney(f.shippingCharged, CURRENCY)} shipping), the order fee and {formatMoney(f.packaging, CURRENCY)} for the mailer. The
        shipping the buyer pays is taken to cover the label. Prices are for a used copy in any condition.
      </span>
    </p>
  );
}

/** ~400px JPEG data URL of the photo, small enough to keep on the phone. */
async function thumbnail(file: File): Promise<string | undefined> {
  try {
    const blob = await resizeImage(file, 400, 0.7);
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : undefined);
      reader.onerror = () => resolve(undefined);
      reader.readAsDataURL(blob);
    });
  } catch {
    return undefined;
  }
}
