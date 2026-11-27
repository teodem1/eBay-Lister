"use client";

import { canadianSoldForMore } from "@/lib/pricing/canadian";
import { regradeCheck } from "@/lib/pricing/regrade";
import { editionPriceAbove, type EditionPrice } from "@/lib/pricing/edition";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppBar, Icon, Spinner, StepHeading } from "@/components/ui";
import { CONDITIONS, nearestAllowedCondition } from "@/lib/ebay/conditions";
import { TITLE_MAX } from "@/lib/listing/limits";
import type { GeneratedListing, ListingDraft } from "@/lib/listing/types";
import type { ComparableQuery } from "@/lib/ebay/types";
import { conditionComplete, conditionSummary, conditionTitleSuffix } from "@/lib/listing/condition";
import ConditionPicker, { type ConditionDraft } from "./ConditionPicker";
import DescriptionEditor from "./DescriptionEditor";
import PhotoPicker from "./PhotoPicker";
import PriceSuggestionPanel from "./PriceSuggestionPanel";
import SaveToCollection from "./SaveToCollection";
import { batchStore } from "@/lib/batch/store";
import { nextPending, type ListingProgress } from "@/lib/batch/queue";
import { defaultPrice, fetchPriceSuggestion, formatMoney, priceSuggestionBody, type PriceCheck } from "./priceRequest";

type Draft = GeneratedListing["draft"];
type PublishOk = {
  listingId: string;
  offerId: string;
  sku: string;
  url: string;
  env: string;
  promoted?: { percent: number; campaignId: string } | null;
  promotionError?: string;
};

const CONDITION_LABELS: Record<(typeof CONDITIONS)[number], string> = {
  NEW: "New",
  LIKE_NEW: "Like new",
  NEW_OTHER: "New (other / open box)",
  NEW_WITH_DEFECTS: "New with defects",
  CERTIFIED_REFURBISHED: "Certified refurbished",
  EXCELLENT_REFURBISHED: "Refurbished, excellent",
  VERY_GOOD_REFURBISHED: "Refurbished, very good",
  GOOD_REFURBISHED: "Refurbished, good",
  SELLER_REFURBISHED: "Seller refurbished",
  USED_EXCELLENT: "Used, excellent",
  USED_VERY_GOOD: "Used, very good",
  USED_GOOD: "Used, good",
  USED_ACCEPTABLE: "Used, acceptable",
  FOR_PARTS_OR_NOT_WORKING: "For parts / not working",
};

// Guess styling replaces the normal colours (not added on top) via .field-guess in globals.css.
const input = "field";
const field = (guess: boolean) => (guess ? "field field-guess" : input);

function GuessBadge() {
  return (
    <span className="chip ml-2 bg-warn-soft py-0 text-warn-ink">
      <Icon name="alert" size={12} strokeWidth={2.6} />
      guess
    </span>
  );
}

export default function ListingEditor({
  initial,
}: {
  initial: {
    query: string;
    barcode: string;
    price?: number;
    condition?: ConditionDraft;
    /** The CD's entry on the To list tab; progress is saved there as the seller goes. */
    batchId?: string;
    /** Progress saved earlier for this CD (grades, photos, price check, draft). */
    saved?: ListingProgress;
    /** A price check already made for this CD (e.g. on the Sort a pile screen). */
    priceCheck?: PriceCheck;
  };
}) {
  const saved = initial.saved;
  const [query, setQuery] = useState(saved?.query ?? initial.query);
  const [barcode, setBarcode] = useState(saved?.barcode ?? initial.barcode);
  const [notes, setNotes] = useState("");
  // The seller's own condition, asked before Claude writes anything.
  const [cond, setCond] = useState<ConditionDraft>(initial.condition ?? {});
  const condReady = conditionComplete(cond);
  // Graded on the scan screen: no need to ask again here (the picker opens only on "Change").
  const [editCond, setEditCond] = useState(() => !conditionComplete(initial.condition ?? {}));
  // The item's name, barcode and notes show as a summary once known; "Edit" opens the fields.
  const [editItem, setEditItem] = useState(() => !initial.query);
  const [loading, setLoading] = useState<"generate" | "publish" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [generated, setGenerated] = useState<GeneratedListing | null>(saved?.generated ?? null);
  const [draft, setDraft] = useState<Draft | null>(saved?.draft ?? null);
  const [guessed, setGuessed] = useState<Set<string>>(() => new Set(saved?.guessed ?? []));
  const [imageText, setImageText] = useState(saved?.imageText ?? "");
  // "Shipping and offers" starts open when Claude guessed the package size.
  const [moreOpen, setMoreOpen] = useState(false);
  const [published, setPublished] = useState<PublishOk | null>(null);
  // Where to go once published: the next CD of a scanned stack, else the Scan screen.
  const [afterPublish, setAfterPublish] = useState("/");
  // Once published (and saved to the Collection), start fresh for the next CD.
  // A full load, so the previous scan result isn't kept by the router cache.
  useEffect(() => {
    if (!published) return;
    const t = setTimeout(() => window.location.replace(afterPublish), 1500);
    return () => clearTimeout(t);
  }, [published, afterPublish]);
  // The price to list at: from ?price=, a suggestion option, or typed by the user.
  // A check carried from Sort a pile is reused, unless it came back without sold prices
  // (allowance used up then): a fresh check gets them once the allowance resets.
  // A check made before the CD was graded (Sort a pile, or a scan with no grades) is narrowed to
  // copies in the seller's condition on the phone, from the sales it holds: no new lookup.
  const graded = (check: PriceCheck | undefined, c: ConditionDraft) =>
    check && conditionComplete(c) ? regradeCheck(check, c.condition) : check;
  const carriedCheck = graded(initial.priceCheck?.soldLimitReached ? undefined : initial.priceCheck, initial.condition ?? {});
  const firstCheck = graded(saved?.priceCheck, saved?.condition ?? initial.condition ?? {}) ?? carriedCheck;
  const [price, setPrice] = useState<number | undefined>(
    saved?.price ?? initial.price ?? (carriedCheck ? defaultPrice(carriedCheck) : undefined),
  );
  // A saved price check is reused: sold-comps allows 100 checks a month.
  const [priceCheck, setPriceCheck] = useState<PriceCheck | null>(firstCheck ?? null);
  const [priceLoading, setPriceLoading] = useState(
    () => !firstCheck && priceSuggestionBody(initial.query, initial.barcode) !== null,
  );
  // The grades from the scan screen narrow the first price check to copies in that condition.
  const initialCondition = initial.condition?.condition;
  const [priceError, setPriceError] = useState<string | null>(null);
  // Once the user picks or types a price, a (re)loaded suggestion no longer overwrites it.
  const [editionNote, setEditionNote] = useState<(EditionPrice & { applied: boolean }) | null>(null);
  const priceChosen = useRef(initial.price !== undefined || !!saved?.priceChosen);
  const condRef = useRef(cond);
  useEffect(() => {
    condRef.current = cond;
  }, [cond]);
  const priceRequestId = useRef(0);

  function choosePrice(value: number | undefined) {
    priceChosen.current = true;
    setPrice(value);
    setDraft((d) => (d ? { ...d, price: value } : d));
  }

  // Applies a finished price check, ignoring any that a newer request replaced.
  const applySuggestion = useCallback(
    (id: number, result: PriceCheck | { error: string }) => {
      if (id !== priceRequestId.current) return;
      setPriceLoading(false);
      if ("error" in result) {
        setPriceError(result.error);
        return;
      }
      // Graded while the check was loading: narrow it to that condition.
      const c = condRef.current;
      const check = conditionComplete(c) ? regradeCheck(result, c.condition) : result;
      setPriceCheck(check);
      const value = defaultPrice(check);
      if (!priceChosen.current && value !== undefined) {
        setPrice(value);
        setDraft((d) => (d ? { ...d, price: value } : d));
      }
    },
    [],
  );

  const startPriceCheck = useCallback(
    (body: ComparableQuery) => {
      const id = ++priceRequestId.current;
      fetchPriceSuggestion(body).then((result) => applySuggestion(id, result));
    },
    [applySuggestion],
  );

  function refreshSuggestion() {
    const body = priceSuggestionBody(query, barcode, conditionComplete(cond) ? cond.condition : undefined);
    if (!body) {
      setPriceError("Enter the item or a barcode first.");
      return;
    }
    setPriceLoading(true);
    setPriceError(null);
    startPriceCheck(body);
  }

  // Coming from the lookup screen: check prices straight away (unless this CD's check was saved).
  const hasSavedCheck = !!firstCheck;
  useEffect(() => {
    if (hasSavedCheck) return;
    const body = priceSuggestionBody(initial.query, initial.barcode, initialCondition);
    if (body) startPriceCheck(body);
    // Counts toward the price checks shown on the To list tab.
    if (body && initial.batchId) batchStore.update(initial.batchId, (x) => ({ ...x, openedAt: x.openedAt ?? new Date().toISOString() }));
  }, [initial.query, initial.barcode, initial.batchId, initialCondition, startPriceCheck, hasSavedCheck]);

  // Saves the progress on the To list tab as the seller goes, so leaving the app loses nothing.
  useEffect(() => {
    const id = initial.batchId;
    if (!id || published) return;
    const t = setTimeout(() => {
      const item = batchStore.get(id);
      if (!item || item.status !== "pending") return;
      const progress: ListingProgress = {
        query,
        barcode,
        condition: cond,
        imageText,
        price,
        priceChosen: priceChosen.current,
        priceCheck: priceCheck ?? undefined,
        generated: generated ?? undefined,
        draft: draft ?? undefined,
        guessed: [...guessed],
        savedAt: new Date().toISOString(),
      };
      batchStore.update(id, { progress });
    }, 400);
    return () => clearTimeout(t);
  }, [initial.batchId, published, query, barcode, cond, imageText, price, priceCheck, generated, draft, guessed]);

  // No barcode: Claude looks at the front and back photos for a no-barcode pressing,
  // so the automatic write waits for two photos ("Write listing with Claude" still works any time).
  const photoUrls = imageText.split(/\s+/).filter((u) => u.startsWith("https://"));
  const waitForPhotos = !barcode.trim() && photoUrls.length < 2;

  // Claude writes the listing on its own, once: as soon as the CD is graded and the price
  // check is back (its price goes into the listing). "Write it again" stays for a rewrite.
  const autoWritten = useRef(false);
  const generateRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (autoWritten.current || generated || loading !== null || priceLoading) return;
    if (!condReady || !query.trim() || waitForPhotos) return;
    const t = setTimeout(() => {
      autoWritten.current = true;
      generateRef.current();
    }, 600);
    return () => clearTimeout(t);
  }, [condReady, query, priceLoading, generated, loading, waitForPhotos]);

  function update<K extends keyof Draft>(key: K, value: Draft[K], guessKey: string = key as string) {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
    setGuessed((g) => {
      const next = new Set(g);
      next.delete(guessKey);
      return next;
    });
  }

  async function generate() {
    autoWritten.current = true;
    setLoading("generate");
    setError(null);
    setPublished(null);
    try {
      const res = await fetch("/api/listing/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          barcode: barcode || undefined,
          notes: notes || undefined,
          suggestedPrice: price,
          sellerCondition: condReady ? cond : undefined,
          canadianVersion: canadianSoldForMore(priceCheck?.soldItems) || undefined,
          // No barcode: Claude checks the photos taken so far for a no-barcode pressing.
          imageUrls: barcode ? undefined : photoUrls.slice(0, 3),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Generation failed");
      const g = data as GeneratedListing;
      setGenerated(g);
      // A special edition that sold for more sets the price, unless the seller picked one.
      const ep = editionPriceAbove(priceCheck?.soldItems, g.edition, price);
      const editionWins = !!ep && !priceChosen.current;
      if (editionWins) setPrice(ep.price);
      setEditionNote(ep ? { ...ep, applied: editionWins } : null);
      // Keep the price chosen on this screen even if it changed while Claude was writing.
      setDraft({ ...g.draft, price: editionWins ? ep.price : (price ?? g.draft.price) });
      setGuessed(new Set(g.guessedFields));
      setMoreOpen(g.guessedFields.includes("package"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(null);
    }
  }

  // Changing the condition after Claude wrote the listing updates the draft too.
  function changeCondition(next: ConditionDraft) {
    setCond(next);
    // First graded here: narrow an ungraded price check to copies in this condition.
    if (priceCheck && !priceCheck.condition && conditionComplete(next)) {
      const regraded = regradeCheck(priceCheck, next.condition);
      setPriceCheck(regraded);
      const value = defaultPrice(regraded);
      if (!priceChosen.current && value !== undefined) {
        setPrice(value);
        setDraft((d) => (d ? { ...d, price: value } : d));
      }
    }
    if (!draft || !conditionComplete(next)) return;
    const allowed = generated?.conditionsByCategory?.[draft.categoryId] ?? [];
    setDraft((d) =>
      d ? { ...d, condition: nearestAllowedCondition(next.condition, allowed), conditionDescription: conditionSummary(next) } : d,
    );
  }

  async function publish() {
    if (!draft) return;
    setLoading("publish");
    setError(null);
    setProblems([]);
    const imageUrls = imageText
      .split(/\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const dims = draft.packageDimensionsCm;
    const body: Partial<ListingDraft> = {
      ...draft,
      imageUrls,
      // Send a box size only when all three sides are filled in.
      packageDimensionsCm: dims && dims.length > 0 && dims.width > 0 && dims.height > 0 ? dims : undefined,
    };
    try {
      const res = await fetch("/api/listing/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setProblems(data.problems ?? []);
        throw new Error(data.error ?? "Publish failed");
      }
      const ok = data as PublishOk;
      if (initial.batchId) {
        const id = initial.batchId;
        const item = batchStore.get(id);
        batchStore.update(id, (x) => ({
          ...x,
          status: "listed",
          listingId: ok.listingId,
          listingUrl: ok.url,
          doneAt: new Date().toISOString(),
          progress: undefined,
        }));
        // Part of a scanned stack: go straight to the next CD on the To list tab.
        if (item?.origin === "stack" && nextPending(batchStore.all(), id)) setAfterPublish("/to-list?next=1");
      }
      setPublished(ok);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(null);
    }
  }

  useEffect(() => {
    generateRef.current = generate;
  });
  const isGuess = (k: string) => guessed.has(k);
  const guessCount = guessed.size + (draft?.aspects.filter((a) => a.guessed).length ?? 0);

  const errorBox = error && (
    <div role="alert" className="notice notice-bad fade-in">
      <p className="font-medium">{error}</p>
      {problems.length > 0 && (
        <ul className="mt-1 list-disc pl-5">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
    </div>
  );

  const currency = priceCheck?.sold?.currency ?? priceCheck?.current?.currency ?? "CAD";
  const dims = draft?.packageDimensionsCm;
  const optionsSummary = draft
    ? [
        draft.packageWeightKg ? `${Math.round(draft.packageWeightKg * 1000)} g` : "No weight",
        dims && dims.length && dims.width && dims.height ? `${dims.length}×${dims.width}×${dims.height} cm` : null,
        `Promoted ${draft.promotedPercent ?? "default"}${draft.promotedPercent !== undefined ? "%" : ""}`,
        `Offers ${draft.bestOfferMinPercent === 0 ? "off" : draft.bestOfferMinPercent !== undefined ? `≥ ${draft.bestOfferMinPercent}%` : "default"}`,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";

  return (
    <>
      <AppBar
        title="New listing"
        back={initial.batchId ? { href: "/to-list", label: "Back to To list" } : { href: "/", label: "Find another item" }}
      />
      <main className={`page ${draft ? "pb-36" : ""}`}>
        <section className="flex flex-col gap-3">
          {!editItem && query.trim() ? (
            <div className="card flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="t-headline line-clamp-2">{query}</p>
                {barcode && <p className="t-caption mt-0.5 tabular-nums text-muted">EAN {barcode}</p>}
                {condReady && !editCond && (
                  <p className="t-small mt-1 font-medium">{conditionTitleSuffix(cond).replace(/^\(|\)$/g, "").replace(" / ", " · ")}</p>
                )}
                {notes && <p className="t-small mt-0.5 line-clamp-2 text-muted">{notes}</p>}
              </div>
              <div className="flex shrink-0 flex-col items-end">
                <button type="button" className="btn-link min-h-10" onClick={() => setEditItem(true)}>
                  Edit
                </button>
                {condReady && !editCond && (
                  <button type="button" className="btn-link min-h-10" onClick={() => setEditCond(true)}>
                    Change grades
                  </button>
                )}
              </div>
            </div>
          ) : (
          <div className="card space-y-4">
            <label className="block">
              <span className="label">Item</span>
              <input
                className={input}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="e.g. Fleetwood Mac Rumours CD"
              />
            </label>
            <label className="block">
              <span className="label">
                Barcode <span className="font-normal text-muted">(optional)</span>
              </span>
              <input className={input} inputMode="numeric" value={barcode} onChange={(e) => setBarcode(e.target.value)} />
            </label>
            <label className="block">
              <span className="label">
                Other notes <span className="font-normal text-muted">(optional)</span>
              </span>
              <textarea
                className={input}
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Edition, what's included (obi strip, sticker, slipcase)"
              />
            </label>
            {query.trim() && (
              <button type="button" className="btn btn-secondary w-full" onClick={() => setEditItem(false)}>
                Done
              </button>
            )}
          </div>
          )}
        </section>

        {/* Photos first: shoot the CD while prices load and Claude writes the listing. */}
        <PhotoPicker text={imageText} setText={setImageText} />

        <PriceSuggestionPanel
          check={priceCheck}
          loading={priceLoading}
          error={priceError}
          selected={price}
          onPick={choosePrice}
          onRefresh={refreshSuggestion}
        />

        {editionNote && (
          <div className="notice notice-ok t-small fade-in flex items-center gap-3">
            <p className="flex-1">
              {editionNote.applied ? "Priced as a special edition: " : "Special edition: "}
              {editionNote.reason}
              {editionNote.applied ? `, so the price is ${formatMoney(editionNote.price, "CAD")}.` : "."}
            </p>
            {!editionNote.applied && (
              <button
                type="button"
                className="btn btn-secondary t-small min-h-10 px-3"
                onClick={() => {
                  choosePrice(editionNote.price);
                  setEditionNote({ ...editionNote, applied: true });
                }}
              >
                Use {formatMoney(editionNote.price, "CAD")}
              </button>
            )}
          </div>
        )}

        {editCond || !condReady ? (
          <ConditionPicker n={3} value={cond} onChange={changeCondition} />
        ) : (
          editItem && (
            <div className="card flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="t-caption text-muted">Your CD&apos;s condition</p>
                <p className="t-small font-medium">{conditionTitleSuffix(cond).replace(/^\(|\)$/g, "")}</p>
              </div>
              <button type="button" className="btn btn-secondary t-small min-h-10 px-3" onClick={() => setEditCond(true)}>
                Change
              </button>
            </div>
          )
        )}

        {!condReady && (
          <p className="t-small px-1 text-muted">
            Grade the disc and the inlay (or tick sealed). Claude then writes the listing on its own.
          </p>
        )}
        {condReady && waitForPhotos && !draft && loading === null && (
          <p className="t-small px-1 text-muted">
            No barcode scanned: add the front and back photos and Claude writes the listing, checking the back for a
            barcode (a no-barcode pressing is worth more).
          </p>
        )}
        <button
          className={`btn ${draft ? "btn-secondary" : "btn-primary btn-lg"} w-full`}
          disabled={!query.trim() || !condReady || loading !== null}
          onClick={generate}
        >
          {loading === "generate" ? (
            <>
              <Spinner /> Writing listing…
            </>
          ) : (
            <>
              <SparkIcon />{" "}
              {draft ? "Write it again" : condReady && priceLoading ? "Checking prices first…" : "Write listing with Claude"}
            </>
          )}
        </button>

        {error && !draft && errorBox}

        {loading === "generate" && !draft && <DraftSkeleton />}

        {generated && draft && (
          <section className={`flex flex-col gap-3 fade-in ${loading === "generate" ? "opacity-60" : ""}`}>
            <StepHeading
              n={4}
              title="Review"
              action={
                guessCount > 0 ? (
                  <span className="chip shrink-0 bg-warn-soft py-1 text-warn-ink">
                    <Icon name="alert" size={14} strokeWidth={2.4} />
                    {guessCount} to check
                  </span>
                ) : (
                  <span className="chip shrink-0 bg-ok-soft py-1 text-ok-ink">
                    <Icon name="check" size={14} strokeWidth={2.6} />
                    All checked
                  </span>
                )
              }
            />

            {/* Description first, right after the price step's listings. */}
            <div className="card">
              <h3 className="t-headline mb-3 flex items-center">
                Description{isGuess("description") && <GuessBadge />}
              </h3>
              <DescriptionEditor
                html={draft.descriptionHtml}
                fieldClass={field(isGuess("description"))}
                onChange={(html) => update("descriptionHtml", html, "description")}
              />
            </div>

            <div className="card space-y-4">
              <h3 className="t-headline">Basics</h3>
              <label className="block">
                <span className="label flex items-center">
                  <span className="flex-1">
                    Title{isGuess("title") && <GuessBadge />}
                  </span>
                  <span
                    className={`t-caption tabular-nums ${draft.title.length > TITLE_MAX ? "text-bad-ink" : "text-muted"}`}
                  >
                    {draft.title.length}/{TITLE_MAX}
                  </span>
                </span>
                <textarea
                  className={`${field(isGuess("title"))} resize-none`}
                  rows={2}
                  value={draft.title}
                  maxLength={TITLE_MAX}
                  onChange={(e) => update("title", e.target.value.replace(/\n/g, " "))}
                />
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="label">Price ({currency})</span>
                  <input
                    className={`${input} font-semibold tabular-nums`}
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    value={draft.price ?? ""}
                    onChange={(e) => choosePrice(e.target.value ? Number(e.target.value) : undefined)}
                  />
                </label>
                <label className="block">
                  <span className="label">Quantity</span>
                  <input
                    className={input}
                    type="number"
                    inputMode="numeric"
                    min="1"
                    value={draft.quantity}
                    onChange={(e) => update("quantity", Math.max(1, Number(e.target.value) || 1))}
                  />
                </label>
              </div>

              <label className="block">
                <span className="label">Category{isGuess("categoryId") && <GuessBadge />}</span>
                {generated.categorySuggestions.length > 0 ? (
                  <select
                    className={field(isGuess("categoryId"))}
                    value={draft.categoryId}
                    onChange={(e) => {
                      const c = generated.categorySuggestions.find((s) => s.categoryId === e.target.value);
                      update("categoryId", e.target.value);
                      update("categoryName", c?.path, "categoryId");
                      // Keep the condition valid for the new category.
                      const allowed = generated.conditionsByCategory?.[e.target.value] ?? [];
                      const next = nearestAllowedCondition(draft.condition, allowed);
                      if (next !== draft.condition) setDraft((d) => (d ? { ...d, condition: next } : d));
                    }}
                  >
                    {generated.categorySuggestions.map((c) => (
                      <option key={c.categoryId} value={c.categoryId}>
                        {c.path}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    className={input}
                    inputMode="numeric"
                    placeholder="eBay category ID"
                    value={draft.categoryId}
                    onChange={(e) => update("categoryId", e.target.value)}
                  />
                )}
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="label">Brand / label{isGuess("brand") && <GuessBadge />}</span>
                  <input
                    className={field(isGuess("brand"))}
                    value={draft.brand ?? ""}
                    onChange={(e) => update("brand", e.target.value || undefined)}
                  />
                </label>
                <label className="block">
                  <span className="label">SKU</span>
                  <input className={input} value={draft.sku} onChange={(e) => update("sku", e.target.value)} />
                </label>
              </div>
            </div>

            <div className="card space-y-4">
              <h3 className="t-headline">Condition</h3>
              <label className="block">
                <span className="label">Condition{isGuess("condition") && <GuessBadge />}</span>
                <select
                  className={field(isGuess("condition"))}
                  value={draft.condition}
                  onChange={(e) => update("condition", e.target.value as Draft["condition"])}
                >
                  {(generated.conditionsByCategory?.[draft.categoryId] ?? CONDITIONS).map((c) => (
                    <option key={c} value={c}>
                      {CONDITION_LABELS[c]}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="label">Condition notes{isGuess("conditionDescription") && <GuessBadge />}</span>
                <textarea
                  className={field(isGuess("conditionDescription"))}
                  rows={2}
                  value={draft.conditionDescription ?? ""}
                  onChange={(e) => update("conditionDescription", e.target.value || undefined)}
                />
              </label>
            </div>

            <details
              className="card disclosure"
              open={moreOpen}
              onToggle={(e) => setMoreOpen((e.currentTarget as HTMLDetailsElement).open)}
            >
              <summary>
                <span className="min-w-0 flex-1">
                  <span className="t-headline flex items-center">
                    Shipping and offers{isGuess("package") && <GuessBadge />}
                  </span>
                  <span className="t-small block truncate text-muted">{optionsSummary}</span>
                </span>
                <Icon name="chevron" className="chevron text-muted" />
              </summary>

              <div className="mt-3 space-y-4">
                <fieldset>
                  <legend className="label">Package, packed (for calculated shipping)</legend>
                  <div className="grid grid-cols-4 gap-2">
                    <label className="block">
                      <span className="t-caption text-muted">Weight g</span>
                      <input
                        className={`${field(isGuess("package"))} px-2.5`}
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="1"
                        // Stored in kg for eBay; the seller types grams.
                        value={draft.packageWeightKg !== undefined ? Math.round(draft.packageWeightKg * 1000) : ""}
                        onChange={(e) =>
                          update("packageWeightKg", Number(e.target.value) > 0 ? Number(e.target.value) / 1000 : undefined, "package")
                        }
                      />
                    </label>
                    {(["length", "width", "height"] as const).map((dim) => (
                      <label key={dim} className="block">
                        <span className="t-caption text-muted">{dim[0].toUpperCase() + dim.slice(1)} cm</span>
                        <input
                          className={`${field(isGuess("package"))} px-2.5`}
                          type="number"
                          inputMode="decimal"
                          min="0"
                          step="0.1"
                          value={draft.packageDimensionsCm?.[dim] ?? ""}
                          onChange={(e) => {
                            const d = { length: 0, width: 0, height: 0, ...draft.packageDimensionsCm };
                            d[dim] = Number(e.target.value) || 0;
                            update("packageDimensionsCm", d, "package");
                          }}
                        />
                      </label>
                    ))}
                  </div>
                </fieldset>

                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="label">Promoted ad rate %</span>
                    <input
                      className={input}
                      type="number"
                      inputMode="decimal"
                      min="0"
                      max="100"
                      step="0.1"
                      placeholder="Default"
                      value={draft.promotedPercent ?? ""}
                      onChange={(e) => update("promotedPercent", e.target.value === "" ? undefined : Number(e.target.value))}
                    />
                  </label>
                  <label className="block">
                    <span className="label">Best Offer min %</span>
                    <input
                      className={input}
                      type="number"
                      inputMode="decimal"
                      min="0"
                      max="99"
                      step="1"
                      placeholder="Default"
                      value={draft.bestOfferMinPercent ?? ""}
                      onChange={(e) =>
                        update("bestOfferMinPercent", e.target.value === "" ? undefined : Number(e.target.value))
                      }
                    />
                  </label>
                </div>
                <p className="hint -mt-2">
                  0 turns either off. Empty uses your app default.
                  {!!draft.bestOfferMinPercent && draft.price !== undefined && (
                    <>
                      {" "}
                      Offers under{" "}
                      {formatMoney(Math.floor(draft.price * (draft.bestOfferMinPercent / 100) * 100) / 100, "CAD")} are
                      declined automatically; the rest wait for you.
                    </>
                  )}
                </p>
              </div>
            </details>

            <fieldset className="card">
              <legend className="sr-only">Item specifics</legend>
              <h3 className="t-headline mb-3">Item specifics</h3>
              <div className="space-y-2">
                {draft.aspects.map((a, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      className={`${input} w-2/5 t-small px-3`}
                      value={a.name}
                      aria-label="Specific name"
                      onChange={(e) =>
                        update(
                          "aspects",
                          draft.aspects.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)),
                        )
                      }
                    />
                    <input
                      className={`${field(a.guessed)} w-3/5 px-3`}
                      value={a.value}
                      aria-label={`${a.name} value`}
                      placeholder={a.guessed ? "guess, check it" : ""}
                      onChange={(e) =>
                        update(
                          "aspects",
                          draft.aspects.map((x, j) => (j === i ? { ...x, value: e.target.value, guessed: false } : x)),
                        )
                      }
                    />
                    <button
                      className="icon-btn -mr-2"
                      aria-label={`Remove ${a.name}`}
                      onClick={() => update("aspects", draft.aspects.filter((_, j) => j !== i))}
                    >
                      <Icon name="close" size={18} />
                    </button>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex items-center justify-between gap-3">
                <button
                  className="btn btn-secondary t-small min-h-11 px-4"
                  onClick={() => update("aspects", [...draft.aspects, { name: "", value: "", guessed: false }])}
                >
                  <Icon name="plus" size={18} /> Add specific
                </button>
              </div>
            </fieldset>

          </section>
        )}
      </main>

      {generated && draft && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface px-4 pb-[calc(env(safe-area-inset-bottom)+0.625rem)] pt-2.5">
          <div className="mx-auto max-w-lg space-y-2">
            {error && <div className="max-h-[40vh] overflow-y-auto">{errorBox}</div>}
            {published && (
              <div className="notice notice-ok fade-in flex items-start gap-3">
                <CheckIcon />
                <div>
                  <p className="font-semibold">Published{published.env === "sandbox" ? " to the eBay sandbox" : ""}.</p>
                  <p>
                    Listing {published.listingId}:{" "}
                    <a className="font-semibold underline" href={published.url} target="_blank" rel="noreferrer">
                      open on eBay
                    </a>
                  </p>
                  {published.promoted && <p>Promoted at {published.promoted.percent}% ad rate.</p>}
                  {published.promotionError && <p className="text-warn-ink">{published.promotionError}</p>}
                  {afterPublish !== "/" && <p className="font-medium">Opening the next CD…</p>}
                </div>
              </div>
            )}
            <SaveToCollection listing={{ ...draft, priceCheck: priceCheck ?? undefined }} imageText={imageText} query={initial.query} published={!!published}>
              <button className="btn btn-primary btn-lg min-w-0 flex-1" disabled={loading !== null} onClick={publish}>
                {loading === "publish" ? (
                  <>
                    <Spinner /> Publishing…
                  </>
                ) : (
                  <>
                    Publish
                    {draft.price !== undefined && (
                      <span className="tabular-nums opacity-85">· {formatMoney(draft.price, currency)}</span>
                    )}
                  </>
                )}
              </button>
            </SaveToCollection>
          </div>
        </div>
      )}
    </>
  );
}

function DraftSkeleton() {
  return (
    <div className="card space-y-4 fade-in" aria-hidden>
      {[0.5, 0.33, 0.4].map((w, i) => (
        <div key={i} className="space-y-2">
          <div className="skeleton h-3" style={{ width: `${w * 100}%` }} />
          <div className="skeleton h-12" />
        </div>
      ))}
      <div className="skeleton h-32" />
    </div>
  );
}

function SparkIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2l1.9 5.6L19.5 9.5l-5.6 1.9L12 17l-1.9-5.6L4.5 9.5l5.6-1.9zM19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0" aria-hidden>
      <circle cx="12" cy="12" r="9.5" />
      <path d="m8 12.5 2.7 2.7L16 9.8" />
    </svg>
  );
}
