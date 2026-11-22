"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AppBar, Icon, Spinner, StepHeading } from "@/components/ui";
import { CONDITIONS, nearestAllowedCondition } from "@/lib/ebay/sell";
import { TITLE_MAX, type GeneratedListing, type ListingDraft } from "@/lib/listing/types";
import type { ComparableQuery } from "@/lib/ebay/types";
import PriceSuggestionPanel from "./PriceSuggestionPanel";
import SaveToCollection from "./SaveToCollection";
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

export default function ListingEditor({ initial }: { initial: { query: string; barcode: string; price?: number } }) {
  const [query, setQuery] = useState(initial.query);
  const [barcode, setBarcode] = useState(initial.barcode);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState<"generate" | "publish" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [generated, setGenerated] = useState<GeneratedListing | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [guessed, setGuessed] = useState<Set<string>>(new Set());
  const [imageText, setImageText] = useState("");
  const [showPreview, setShowPreview] = useState(true);
  // "Shipping and offers" starts open when Claude guessed the package size.
  const [moreOpen, setMoreOpen] = useState(false);
  const [published, setPublished] = useState<PublishOk | null>(null);
  // The price to list at: from ?price=, a suggestion option, or typed by the user.
  const [price, setPrice] = useState<number | undefined>(initial.price);
  const [priceCheck, setPriceCheck] = useState<PriceCheck | null>(null);
  const [priceLoading, setPriceLoading] = useState(() => priceSuggestionBody(initial.query, initial.barcode) !== null);
  const [priceError, setPriceError] = useState<string | null>(null);
  // Once the user picks or types a price, a (re)loaded suggestion no longer overwrites it.
  const priceChosen = useRef(initial.price !== undefined);
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
      setPriceCheck(result);
      const value = defaultPrice(result);
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
    const body = priceSuggestionBody(query, barcode);
    if (!body) {
      setPriceError("Enter the item or a barcode first.");
      return;
    }
    setPriceLoading(true);
    setPriceError(null);
    startPriceCheck(body);
  }

  // Coming from the lookup screen: check prices straight away.
  useEffect(() => {
    const body = priceSuggestionBody(initial.query, initial.barcode);
    if (body) startPriceCheck(body);
  }, [initial.query, initial.barcode, startPriceCheck]);

  function update<K extends keyof Draft>(key: K, value: Draft[K], guessKey: string = key as string) {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
    setGuessed((g) => {
      const next = new Set(g);
      next.delete(guessKey);
      return next;
    });
  }

  async function generate() {
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
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Generation failed");
      const g = data as GeneratedListing;
      setGenerated(g);
      // Keep the price chosen on this screen even if it changed while Claude was writing.
      setDraft({ ...g.draft, price: price ?? g.draft.price });
      setGuessed(new Set(g.guessedFields));
      setMoreOpen(g.guessedFields.includes("package"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(null);
    }
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
      setPublished(data as PublishOk);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(null);
    }
  }

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
        draft.packageWeightKg ? `${draft.packageWeightKg} kg` : "No weight",
        dims && dims.length && dims.width && dims.height ? `${dims.length}×${dims.width}×${dims.height} cm` : null,
        `Promoted ${draft.promotedPercent ?? "default"}${draft.promotedPercent !== undefined ? "%" : ""}`,
        `Offers ${draft.bestOfferMinPercent === 0 ? "off" : draft.bestOfferMinPercent !== undefined ? `≥ ${draft.bestOfferMinPercent}%` : "default"}`,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";

  return (
    <>
      <AppBar title="Create listing" back={{ href: "/", label: "Find another item" }} />
      <main className={`page ${draft ? "pb-36" : ""}`}>
        <section className="flex flex-col gap-3">
          <StepHeading n={1} title="Item" hint="What you're selling. Your notes help Claude get it right." />
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
              <span className="label">Your notes</span>
              <textarea
                className={input}
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Condition, what's included, defects"
              />
            </label>
          </div>
        </section>

        <PriceSuggestionPanel
          check={priceCheck}
          loading={priceLoading}
          error={priceError}
          selected={price}
          onPick={choosePrice}
          onRefresh={refreshSuggestion}
        />

        <button
          className={`btn ${draft ? "btn-secondary" : "btn-primary btn-lg"} w-full`}
          disabled={!query.trim() || loading !== null}
          onClick={generate}
        >
          {loading === "generate" ? (
            <>
              <Spinner /> Writing listing…
            </>
          ) : (
            <>
              <SparkIcon /> {draft ? "Write it again" : "Write listing with Claude"}
            </>
          )}
        </button>

        {error && !draft && errorBox}

        {loading === "generate" && !draft && <DraftSkeleton />}

        {generated && draft && (
          <section className={`flex flex-col gap-3 fade-in ${loading === "generate" ? "opacity-60" : ""}`}>
            <StepHeading
              n={3}
              title="Review"
              hint="Amber fields are Claude's guesses."
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

            {(generated.warnings.length > 0 || generated.checks.length > 0) && (
              <div className="notice notice-warn flex gap-2.5">
                <Icon name="alert" className="mt-0.5" />
                <div>
                  <p className="font-semibold">Check before publishing</p>
                  <ul className="mt-1 list-disc pl-5">
                    {[...generated.warnings, ...generated.checks].map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

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
                      <span className="t-caption text-muted">Weight kg</span>
                      <input
                        className={`${field(isGuess("package"))} px-2.5`}
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="0.01"
                        value={draft.packageWeightKg ?? ""}
                        onChange={(e) =>
                          update("packageWeightKg", e.target.value ? Number(e.target.value) : undefined, "package")
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
                          step="1"
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
                      className={`${input} w-2/5 px-3 text-sm`}
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
                  className="btn btn-secondary min-h-11 px-4 text-sm"
                  onClick={() => update("aspects", [...draft.aspects, { name: "", value: "", guessed: false }])}
                >
                  <Icon name="plus" size={18} /> Add specific
                </button>
                <p className="t-caption text-muted">Several values: separate with |</p>
              </div>
            </fieldset>

            <div className="card">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="t-headline flex items-center">
                  Description{isGuess("description") && <GuessBadge />}
                </h3>
                <div className="flex rounded-full bg-surface-2 p-1 text-sm font-semibold" role="group" aria-label="Description view">
                  {[
                    ["Preview", true],
                    ["HTML", false],
                  ].map(([label, value]) => (
                    <button
                      key={String(label)}
                      aria-pressed={showPreview === value}
                      onClick={() => setShowPreview(value as boolean)}
                      className={`min-h-10 rounded-full px-3.5 transition-colors ${
                        showPreview === value ? "bg-surface text-foreground shadow-card" : "text-muted"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {showPreview ? (
                // Preview in a sandboxed iframe so the HTML can't run scripts in the app.
                <iframe
                  title="Description preview"
                  sandbox=""
                  className="h-80 w-full rounded-xl border border-line bg-white"
                  srcDoc={draft.descriptionHtml}
                />
              ) : (
                <textarea
                  className={`${field(isGuess("description"))} font-mono text-sm`}
                  rows={10}
                  value={draft.descriptionHtml}
                  onChange={(e) => update("descriptionHtml", e.target.value, "description")}
                />
              )}
            </div>

            <label className="card block">
              <span className="t-headline mb-3 block">Photos</span>
              <span className="label">Photo URLs, one per line (https)</span>
              <textarea
                className={input}
                rows={3}
                value={imageText}
                onChange={(e) => setImageText(e.target.value)}
                placeholder="https://…"
              />
              <span className="hint block">eBay needs at least one public photo URL. Uploading from the camera comes later.</span>
            </label>
          </section>
        )}
      </main>

      {generated && draft && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line/70 bg-background/90 px-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3 backdrop-blur-xl">
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
                </div>
              </div>
            )}
            <SaveToCollection listing={draft} imageText={imageText} query={initial.query} published={!!published}>
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
