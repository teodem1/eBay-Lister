"use client";

import { useState } from "react";
import { Icon, Spinner } from "@/components/ui";
import ComparableSheet from "@/app/listing/ComparableSheet";
import { formatMoney } from "@/app/listing/priceRequest";
import { followUpNote, request } from "@/app/update-listings/batchView";
import type { Comparable } from "@/lib/ebay/types";
import type { Proposal } from "@/lib/listing/types";

type Asked = NonNullable<Proposal["asked"]>;

/**
 * Under a proposal in Review: the stored sales it was priced from (tap one for photos and details;
 * sales Claude found matching the seller's copy are marked and listed first), and "Ask Claude".
 */
export function SalesList({ sku, matching }: { sku: string; matching: string[] }) {
  const [state, setState] = useState<{ sales: Comparable[]; savedAt: string | null; partial: boolean } | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState<Comparable | null>(null);

  async function toggle() {
    if (open) return setOpen(false);
    setOpen(true);
    if (state) return;
    setLoading(true);
    const res = await request<{ sales?: Comparable[]; savedAt?: string | null; partial?: boolean; error?: string }>(
      `/api/batch/sales?sku=${encodeURIComponent(sku)}`,
    );
    setLoading(false);
    if (res.ok) setState({ sales: res.data.sales ?? [], savedAt: res.data.savedAt ?? null, partial: !!res.data.partial });
    else setError(res.data.error ?? `Error ${res.status}`);
  }

  const match = new Set(matching);
  const sales = [...(state?.sales ?? [])].sort((a, b) => Number(match.has(b.itemId)) - Number(match.has(a.itemId)));
  return (
    <div className="flex flex-col gap-2">
      <button type="button" className="link t-small self-start px-1 py-1" onClick={toggle}>
        {open ? "Hide the sales" : `Show the sales${state ? ` (${state.sales.length})` : ""}`}
      </button>
      {open && loading && <Spinner />}
      {open && error && <p className="notice notice-warn t-small">{error}</p>}
      {open && state && (
        <>
          <p className="t-caption text-muted">
            {state.sales.length
              ? `Sold copies in your grade${state.savedAt ? `, saved ${state.savedAt.slice(0, 10)}` : ""}${state.partial ? " (latest sales only)" : ""}. Tap one to compare.`
              : "No stored sales for this listing."}
          </p>
          <ul className="flex flex-col gap-2">
            {sales.map((s) => (
              <li key={s.itemId}>
                <button
                  type="button"
                  className={`flex w-full items-center gap-3 rounded-xl border p-2 text-left ${match.has(s.itemId) ? "border-accent bg-surface-2" : "border-line"}`}
                  onClick={() => setDetail(s)}
                >
                  {s.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- eBay-hosted photo
                    <img src={s.imageUrl} alt="" className="h-12 w-12 shrink-0 rounded-lg border border-line bg-surface-2 object-cover" />
                  ) : (
                    <span className="h-12 w-12 shrink-0 rounded-lg border border-line bg-surface-2" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="t-small block truncate">{s.title}</span>
                    <span className="t-caption text-muted">
                      {formatMoney(s.price.value, s.price.currency)}
                      {s.soldDate ? ` · ${s.soldDate.slice(0, 10)}` : ""}
                      {s.condition ? ` · ${s.condition}` : ""}
                      {match.has(s.itemId) ? " · matches your copy" : ""}
                    </span>
                  </span>
                  <Icon name="chevron" size={16} className="text-subtle" />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {detail && <ComparableSheet item={detail} sold onClose={() => setDetail(null)} />}
    </div>
  );
}

export function AskClaude({
  sku,
  asked,
  onAnswer,
  onUse,
}: {
  sku: string;
  asked?: Asked;
  onAnswer: (a: Asked) => void;
  onUse: (a: Asked) => void;
}) {
  const [note, setNote] = useState(asked?.note ?? "");
  const [replies, setReplies] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const money = (n: number | null) => (n === null ? "no change" : formatMoney(n, "CAD"));

  async function ask(text = note) {
    if (!text.trim()) return setError("Write what you know about your copy first.");
    setBusy(true);
    setError("");
    const res = await request<{ asked?: Asked; error?: string }>("/api/batch/ask", { sku, note: text.trim() });
    setBusy(false);
    if (res.ok && res.data.asked) {
      setReplies({});
      onAnswer(res.data.asked);
    } else setError(res.data.error ?? `Error ${res.status}`);
  }

  async function answerAndAsk(questions: string[]) {
    const next = followUpNote(note, questions.map((q) => ({ question: q, answer: replies[q] ?? "" })));
    if (next === note.trim()) return setError("Answer at least one question first.");
    setNote(next);
    await ask(next);
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line p-2">
      <label className="flex flex-col gap-1">
        <span className="t-caption text-muted">Ask Claude: add details about your copy (extras, pressing, defects)</span>
        <textarea className="field min-h-16" maxLength={600} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Working LED spine, booklet included" />
      </label>
      <button type="button" className="btn btn-secondary self-start" disabled={busy} onClick={() => ask()}>
        {busy ? <Spinner /> : <Icon name="search" size={18} />} Ask Claude
      </button>
      {error && <p className="notice notice-warn t-small">{error}</p>}
      {asked && (
        <div className="flex flex-col gap-1">
          <p className="t-small">{asked.answer}</p>
          <p className="t-caption text-muted">
            {asked.matching.length} matching sale{asked.matching.length === 1 ? "" : "s"} · price re-proposed {money(asked.price)}
            {asked.previousPrice !== null && asked.previousPrice !== asked.price ? ` (was ${money(asked.previousPrice)})` : ""}
            {asked.target !== null && asked.price !== asked.target ? ` · sales support ${money(asked.target)}` : ""}
            {asked.basis === "estimate" ? " · estimate: fewer than 2 sales match" : ""}
            {asked.title ? ` · title: ${asked.title}` : ""}
          </p>
          {asked.title && (
            <button type="button" className="link t-small self-start px-1 py-1" onClick={() => onUse(asked)}>
              Use this title
            </button>
          )}
          {(asked.questions?.length ?? 0) > 0 && (
            <div className="flex flex-col gap-2">
              <p className="t-caption text-muted">For a more accurate price, Claude needs to know:</p>
              {asked.questions!.map((q) => (
                <label key={q} className="flex flex-col gap-1">
                  <span className="t-small">{q}</span>
                  <input
                    className="field"
                    maxLength={200}
                    value={replies[q] ?? ""}
                    onChange={(e) => setReplies({ ...replies, [q]: e.target.value })}
                  />
                </label>
              ))}
              <button type="button" className="btn btn-secondary self-start" disabled={busy} onClick={() => answerAndAsk(asked.questions!)}>
                {busy ? <Spinner /> : null} Answer and ask again
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
