"use client";

import { useEffect, useState } from "react";
import { Icon, Spinner } from "@/components/ui";
import { formatMoney } from "@/app/listing/priceRequest";
import { priceChange, proposalRows, request } from "@/app/update-listings/batchView";
import { TITLE_MAX } from "@/lib/listing/limits";
import type { ApplyOutcome, Proposal } from "@/lib/listing/types";
import { AskClaude, SalesList } from "./ProposalExtras";
import WhyDetails from "@/app/update-listings/WhyDetails";

/**
 * Review tab: batch proposals the seller sent here from "Update live listings". Each keeps the
 * proposed title, price, added details and evidence; the seller can change the title and price,
 * then send it to eBay (same checks and re-read as the batch screen) or dismiss it.
 */
export default function BatchReviewSection() {
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [error, setError] = useState("");

  const fetchReview = () => request<{ proposals?: Proposal[]; error?: string }>("/api/batch");
  const show = (res: Awaited<ReturnType<typeof fetchReview>>) => {
    if (res.ok) {
      setError("");
      setProposals(proposalRows(res.data.proposals ?? []).review);
    } else if (res.status !== 503) setError(res.data.error ?? `Error ${res.status}`);
  };

  useEffect(() => {
    let alive = true;
    fetchReview().then((res) => alive && show(res));
    return () => {
      alive = false;
    };
    // Loaded once when Review opens; cards reload it after a change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!proposals?.length && !error) return null;
  return (
    <section className="flex flex-col gap-2" aria-label="Proposals from Update live listings">
      <h2 className="t-headline px-1">From Update live listings ({proposals?.length ?? 0})</h2>
      {error && <p className="notice notice-warn t-small">{error}</p>}
      <ul className="flex flex-col gap-3">
        {proposals?.map((p) => (
          <ReviewProposalCard key={p.sku} p={p} onChanged={async () => show(await fetchReview())} />
        ))}
      </ul>
    </section>
  );
}

function ReviewProposalCard({ p, onChanged }: { p: Proposal; onChanged: () => Promise<void> }) {
  const [title, setTitle] = useState(p.title);
  const [price, setPrice] = useState(p.price === null ? "" : p.price.toFixed(2));
  const [busy, setBusy] = useState<"" | "saving" | "sending" | "dismissing">("");
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState("");
  const [asked, setAsked] = useState(p.asked);
  const [usePending, setUsePending] = useState(false);
  const edited = title !== p.title || price !== (p.price === null ? "" : p.price.toFixed(2));
  const typed = Number(price);
  const change = priceChange(p, price.trim() && Number.isFinite(typed) && typed > 0 ? typed : p.price);
  // Ask Claude's price replaces the pending one on the server; until it is saved, a changed price does too.
  const pending = p.pendingPrice !== null && !edited ? p.pendingPrice : null;
  const money = (n: number | null | undefined) => (n == null ? "no price" : formatMoney(n, "CAD"));

  async function save(): Promise<boolean> {
    const value = Number(price);
    if (!title.trim() || !Number.isFinite(value) || value <= 0) {
      setMessage("Give a title and a price above 0.");
      return false;
    }
    setBusy("saving");
    const res = await request<{ error?: string }>("/api/batch/edit", { sku: p.sku, title: title.trim(), price: value });
    setBusy("");
    if (!res.ok) {
      setMessage(res.data.error ?? `Error ${res.status}`);
      return false;
    }
    setMessage("Saved.");
    return true;
  }

  async function send() {
    setConfirming(false);
    if (edited && !(await save())) return;
    setBusy("sending");
    const res = await request<{ results?: ApplyOutcome[]; error?: string }>("/api/batch/apply", {
      skus: [p.sku],
      acceptPending: pending !== null && usePending ? [p.sku] : [],
    });
    setBusy("");
    const r = res.data.results?.[0];
    setMessage(!res.ok ? (res.data.error ?? `Error ${res.status}`) : r?.status === "applied" ? "Updated on eBay." : (r?.result?.reason ?? "Not sent."));
    await onChanged();
  }

  async function dismiss() {
    setBusy("dismissing");
    const res = await request<{ error?: string }>("/api/batch/dismiss", { skus: [p.sku] });
    setBusy("");
    if (!res.ok) setMessage(res.data.error ?? `Error ${res.status}`);
    await onChanged();
  }

  return (
    <li className="card flex flex-col gap-2 p-3">
      <p className="t-caption text-muted">Live now: {p.snapshot.title} · {money(p.snapshot.price)}</p>
      <label className="flex flex-col gap-1">
        <span className="t-caption text-muted">
          Title ({title.length}/{TITLE_MAX})
        </span>
        <input className="field" value={title} maxLength={TITLE_MAX} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="t-caption text-muted">
          Price (CAD)
          {change.flag && <span className="chip ml-2 border border-line-strong text-foreground">{change.flag} from the live price</span>}
        </span>
        <input className="field" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
      </label>
      {pending !== null && (
        <button type="button" className="chip-toggle self-start" aria-pressed={usePending} onClick={() => setUsePending(!usePending)} disabled={!!busy}>
          {usePending ? <Icon name="check" size={16} /> : null} Use {money(pending)} instead
        </button>
      )}
      {Object.keys(p.addAspects).length > 0 && (
        <p className="t-small">
          <b>Item specifics added:</b> {Object.entries(p.addAspects).map(([n, v]) => `${n}: ${v.join(", ")}`).join(" · ")}
        </p>
      )}
      <WhyDetails p={p} />
      <SalesList sku={p.sku} matching={asked?.matching ?? []} />
      <AskClaude
        sku={p.sku}
        asked={asked}
        onAnswer={(a) => {
          setAsked(a);
          if (a.price !== null) setPrice(a.price.toFixed(2));
          setMessage(a.price !== null && a.price !== a.previousPrice ? "Price re-proposed from your details. Check it, then send." : "");
        }}
        onUse={(a) => {
          if (a.title) setTitle(a.title);
          setMessage("Title filled in from Claude's answer. Save or send when you're happy with it.");
        }}
      />
      {message && <p className="notice t-small">{message}</p>}
      {confirming ? (
        <div className="flex gap-2">
          <button type="button" className="btn btn-secondary flex-1" onClick={() => setConfirming(false)}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary flex-[2]" onClick={send}>
            Yes, update on eBay
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => setConfirming(true)}>
            {busy === "sending" ? <Spinner /> : <Icon name="check" size={18} />} Send to eBay
          </button>
          {edited && (
            <button type="button" className="btn btn-secondary" disabled={!!busy} onClick={save}>
              {busy === "saving" ? <Spinner /> : null} Save
            </button>
          )}
          <button type="button" className="link t-small px-1 py-1" disabled={!!busy} onClick={dismiss}>
            Dismiss
          </button>
        </div>
      )}
    </li>
  );
}
