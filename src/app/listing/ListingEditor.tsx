"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CONDITIONS } from "@/lib/ebay/sell";
import { TITLE_MAX, type GeneratedListing, type ListingDraft } from "@/lib/listing/types";
import type { ComparableQuery } from "@/lib/ebay/types";
import PriceSuggestionPanel from "./PriceSuggestionPanel";
import { defaultPrice, fetchPriceSuggestion, priceSuggestionBody, type PriceCheck } from "./priceRequest";

type Draft = GeneratedListing["draft"];
type PublishOk = { listingId: string; offerId: string; sku: string; url: string; env: string };

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

const fieldBase = "w-full rounded-lg border px-3 py-2 text-base";
const input = `${fieldBase} border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-900`;
// Replaces the normal colours (not added on top) so Tailwind class order can't hide the highlight.
const guessField = `${fieldBase} border-amber-400 bg-amber-50 dark:border-amber-500 dark:bg-amber-950/40`;
const field = (guess: boolean) => (guess ? guessField : input);
const button =
  "w-full rounded-full bg-zinc-900 px-5 py-3 font-semibold text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900";

function GuessBadge() {
  return (
    <span className="ml-2 rounded bg-amber-200 px-1.5 py-0.5 text-xs font-medium text-amber-900">guess, check it</span>
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
  const [showPreview, setShowPreview] = useState(false);
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
    const body: Partial<ListingDraft> = { ...draft, imageUrls };
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

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-6 font-sans">
      <Link href="/" className="mb-2 inline-block text-sm font-medium text-blue-600 dark:text-blue-400">
        ← Find another item
      </Link>
      <h1 className="mb-4 text-2xl font-semibold">Create listing</h1>

      <section className="space-y-3">
        <label className="block">
          <span className="text-sm font-medium">Item</span>
          <input
            className={input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. Nintendo Switch OLED white"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Barcode (optional)</span>
          <input className={input} inputMode="numeric" value={barcode} onChange={(e) => setBarcode(e.target.value)} />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Your notes: condition, what&apos;s included, defects</span>
          <textarea className={input} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <PriceSuggestionPanel
          check={priceCheck}
          loading={priceLoading}
          error={priceError}
          selected={price}
          onPick={choosePrice}
          onRefresh={refreshSuggestion}
        />
        <button className={button} disabled={!query.trim() || loading !== null} onClick={generate}>
          {loading === "generate" ? "Writing listing…" : draft ? "Write it again" : "Write listing with Claude"}
        </button>
      </section>

      {error && (
        <div className="mt-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950/40 dark:text-red-200">
          <p>{error}</p>
          {problems.length > 0 && (
            <ul className="mt-1 list-disc pl-5">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {generated && draft && (
        <section className="mt-6 space-y-4">
          {(generated.warnings.length > 0 || generated.checks.length > 0) && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
              <p className="font-medium">Check before publishing</p>
              <ul className="mt-1 list-disc pl-5">
                {[...generated.warnings, ...generated.checks].map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
          )}

          <label className="block">
            <span className="text-sm font-medium">
              Title{isGuess("title") && <GuessBadge />}
              <span
                className={`float-right ${draft.title.length > TITLE_MAX ? "text-red-600" : "text-zinc-500"}`}
              >
                {draft.title.length}/{TITLE_MAX}
              </span>
            </span>
            <input
              className={field(isGuess("title"))}
              value={draft.title}
              maxLength={TITLE_MAX}
              onChange={(e) => update("title", e.target.value)}
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-sm font-medium">Price ({priceCheck?.sold?.currency ?? priceCheck?.current?.currency ?? "CAD"})</span>
              <input
                className={input}
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={draft.price ?? ""}
                onChange={(e) => choosePrice(e.target.value ? Number(e.target.value) : undefined)}
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium">Quantity</span>
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
            <span className="text-sm font-medium">
              Category{isGuess("categoryId") && <GuessBadge />}
            </span>
            {generated.categorySuggestions.length > 0 ? (
              <select
                className={field(isGuess("categoryId"))}
                value={draft.categoryId}
                onChange={(e) => {
                  const c = generated.categorySuggestions.find((s) => s.categoryId === e.target.value);
                  update("categoryId", e.target.value);
                  update("categoryName", c?.path, "categoryId");
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

          <label className="block">
            <span className="text-sm font-medium">
              Condition{isGuess("condition") && <GuessBadge />}
            </span>
            <select
              className={field(isGuess("condition"))}
              value={draft.condition}
              onChange={(e) => update("condition", e.target.value as Draft["condition"])}
            >
              {CONDITIONS.map((c) => (
                <option key={c} value={c}>
                  {CONDITION_LABELS[c]}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-sm font-medium">
              Condition notes{isGuess("conditionDescription") && <GuessBadge />}
            </span>
            <textarea
              className={field(isGuess("conditionDescription"))}
              rows={2}
              value={draft.conditionDescription ?? ""}
              onChange={(e) => update("conditionDescription", e.target.value || undefined)}
            />
          </label>

          <fieldset>
            <legend className="mb-1 text-sm font-medium">Item specifics</legend>
            <div className="space-y-2">
              {draft.aspects.map((a, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    className={`${input} w-2/5`}
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
                    className={`${field(a.guessed)} w-3/5`}
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
                    className="px-2 text-zinc-500"
                    aria-label={`Remove ${a.name}`}
                    onClick={() => update("aspects", draft.aspects.filter((_, j) => j !== i))}
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                className="text-sm font-medium text-blue-700 dark:text-blue-400"
                onClick={() => update("aspects", [...draft.aspects, { name: "", value: "", guessed: false }])}
              >
                + Add specific
              </button>
            </div>
            <p className="mt-1 text-xs text-zinc-500">Several values: separate with |</p>
          </fieldset>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-sm font-medium">
                Description{isGuess("description") && <GuessBadge />}
              </span>
              <button className="text-sm text-blue-700 dark:text-blue-400" onClick={() => setShowPreview((p) => !p)}>
                {showPreview ? "Edit HTML" : "Preview"}
              </button>
            </div>
            {showPreview ? (
              // Preview in a sandboxed iframe so the HTML can't run scripts in the app.
              <iframe
                title="Description preview"
                sandbox=""
                className="h-80 w-full rounded-lg border border-zinc-300 bg-white"
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

          <label className="block">
            <span className="text-sm font-medium">Photo URLs (one per line, https)</span>
            <textarea
              className={input}
              rows={3}
              value={imageText}
              onChange={(e) => setImageText(e.target.value)}
              placeholder="https://…"
            />
            <span className="text-xs text-zinc-500">
              eBay needs at least one public photo URL. Uploading from the camera comes later.
            </span>
          </label>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <label className="block">
              <span className="font-medium">Brand{isGuess("brand") && <GuessBadge />}</span>
              <input
                className={field(isGuess("brand"))}
                value={draft.brand ?? ""}
                onChange={(e) => update("brand", e.target.value || undefined)}
              />
            </label>
            <label className="block">
              <span className="font-medium">SKU</span>
              <input className={input} value={draft.sku} onChange={(e) => update("sku", e.target.value)} />
            </label>
          </div>

          <button className={button} disabled={loading !== null} onClick={publish}>
            {loading === "publish" ? "Publishing…" : "Publish to eBay"}
          </button>
          {guessCount > 0 && (
            <p className="text-center text-xs text-amber-700 dark:text-amber-300">
              {guessCount} field{guessCount > 1 ? "s are" : " is"} still marked as a guess.
            </p>
          )}

          {published && (
            <div className="rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-900 dark:bg-green-950/40 dark:text-green-100">
              <p className="font-medium">Published{published.env === "sandbox" ? " to the eBay sandbox" : ""}.</p>
              <p>
                Listing {published.listingId}:{" "}
                <a className="underline" href={published.url} target="_blank" rel="noreferrer">
                  open on eBay
                </a>
              </p>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
