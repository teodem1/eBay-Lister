"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { AppBar, Icon, Spinner } from "@/components/ui";
import { formatMoney } from "@/app/listing/priceRequest";
import { TITLE_MAX } from "@/lib/listing/limits";
import type { BatchRun, Proposal } from "@/lib/listing/types";
import { priceChange, proposalRows, request as call, runLabel, toSend } from "./batchView";
import WhyDetails from "./WhyDetails";

/**
 * Update live listings: starts a batch in a Claude Code cloud session (the optimise-listing
 * skill, on the seller's plan), shows its proposals, and sends the ticked ones to eBay.
 * Nothing changes on eBay until "Update on eBay".
 */

interface BatchState {
  runs: BatchRun[];
  proposals: Proposal[];
  queue: { due: number; nextDue: string | null };
}

const USAGE_KEY = "ebay-lister:batch-usage:v1";
const POLL_MS = 20_000;

const noop = () => () => {};

/** The saved percentages as stored (a string, so React sees a stable value). */
function savedUsageRaw(): string | null {
  try {
    return localStorage.getItem(USAGE_KEY);
  } catch {
    return null;
  }
}

/** The percentages typed today, so a second run the same day needs no retyping (they are checked again on each run). */
function parseUsage(raw: string | null): { fiveHour: string; weekly: string } {
  try {
    const saved = JSON.parse(raw ?? "null") as { day: string; fiveHour: string; weekly: string } | null;
    if (saved && saved.day === new Date().toDateString()) return { fiveHour: saved.fiveHour, weekly: saved.weekly };
  } catch {
    // Unreadable: start empty.
  }
  return { fiveHour: "", weekly: "" };
}

function saveUsage(fiveHour: string, weekly: string) {
  try {
    localStorage.setItem(USAGE_KEY, JSON.stringify({ day: new Date().toDateString(), fiveHour, weekly }));
  } catch {
    // Not remembered; nothing else depends on it.
  }
}

export default function UpdateListingsScreen() {
  const [state, setState] = useState<BatchState | null>(null);
  const saved = parseUsage(useSyncExternalStore(noop, savedUsageRaw, () => null));
  const [typedFiveHour, setFiveHour] = useState<string | null>(null);
  const [typedWeekly, setWeekly] = useState<string | null>(null);
  const fiveHour = typedFiveHour ?? saved.fiveHour;
  const weekly = typedWeekly ?? saved.weekly;
  const [busy, setBusy] = useState<"" | "running" | "updating" | "dismissing">("");
  const [warning, setWarning] = useState("");
  const [error, setError] = useState("");
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [pendingOk, setPendingOk] = useState<Set<string>>(new Set());
  /** The SKUs on screen when Update was tapped: only these can be sent, so nothing arrives unseen. */
  const [confirming, setConfirming] = useState<string[] | null>(null);

  const show = useCallback((res: { ok: boolean; status: number; data: BatchState & { error?: string } }) => {
    if (res.ok) {
      setState(res.data);
      setError("");
    } else setError(res.data.error ?? `Error ${res.status}`);
  }, []);
  const refresh = useCallback(async () => show(await call<BatchState & { error?: string }>("/api/batch")), [show]);

  useEffect(() => {
    let alive = true;
    call<BatchState & { error?: string }>("/api/batch").then((res) => alive && show(res));
    return () => {
      alive = false;
    };
  }, [show]);

  const running = state?.runs.some((r) => r.status === "started") ?? false;
  useEffect(() => {
    // No refresh while confirming: the list stays as the seller saw it.
    if (!running || confirming) return;
    const timer = setInterval(() => {
      call<BatchState & { error?: string }>("/api/batch").then(show);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [running, confirming, show]);

  const { open, recent } = proposalRows(state?.proposals ?? []);
  const chosen = open.filter((p) => !skipped.has(p.sku));
  const toggle = (set: Set<string>, sku: string) => {
    const next = new Set(set);
    if (next.has(sku)) next.delete(sku);
    else next.add(sku);
    return next;
  };

  async function startRun() {
    const five = Number(fiveHour);
    const week = Number(weekly);
    if (fiveHour === "" || weekly === "" || !Number.isFinite(five) || !Number.isFinite(week)) {
      setWarning("Type both percentages from Settings > Usage first.");
      return;
    }
    saveUsage(fiveHour, weekly);
    setBusy("running");
    setWarning("");
    setError("");
    const res = await call<{ run?: BatchRun; note?: string; warning?: string; error?: string }>("/api/batch/run", { fiveHour: five, weekly: week });
    if (res.status === 409) setWarning(res.data.warning ?? "No batch started.");
    else if (!res.ok) setError(res.data.error ?? `Error ${res.status}`);
    else if (res.data.note) setWarning(res.data.note);
    await refresh();
    setBusy("");
  }

  async function update() {
    const skus = toSend(confirming ?? [], open, skipped);
    setConfirming(null);
    if (!skus.length) return;
    setBusy("updating");
    const res = await call<{ error?: string }>("/api/batch/apply", { skus, acceptPending: skus.filter((s) => pendingOk.has(s)) });
    if (!res.ok) setError(res.data.error ?? `Error ${res.status}`);
    await refresh();
    setBusy("");
  }

  async function toReview(sku: string) {
    setBusy("dismissing");
    const res = await call<{ error?: string }>("/api/batch/review", { skus: [sku] });
    if (!res.ok) setError(res.data.error ?? `Error ${res.status}`);
    await refresh();
    setBusy("");
  }

  async function dismiss(sku: string) {
    setBusy("dismissing");
    const res = await call<{ error?: string }>("/api/batch/dismiss", { skus: [sku] });
    if (!res.ok) setError(res.data.error ?? `Error ${res.status}`);
    await refresh();
    setBusy("");
  }

  return (
    <>
      <AppBar title="Update live listings" back={{ href: "/review", label: "Back to Review" }} />
      <main className="page flex flex-col gap-4 pb-28">
        <header className="pt-1">
          <h1 className="t-display">Update live listings</h1>
          <p className="t-small mt-1 text-muted">
            Each run rewrites titles, adds missing details and proposes prices for 20 live listings, on your Claude plan.
            Proposals show here after a few minutes. Nothing changes on eBay until you tap Update.
          </p>
        </header>

        {error && <p className="notice notice-warn t-small">{error}</p>}

        <section className="card flex flex-col gap-3 p-3">
          <p className="t-title">Start a run</p>
          <p className="t-small text-muted">Your usage from Settings &gt; Usage. Runs stop before either reaches 80%.</p>
          <div className="flex gap-2">
            <label className="flex flex-1 flex-col gap-1">
              <span className="t-caption text-muted">Five-hour %</span>
              <input className="field" inputMode="decimal" value={fiveHour} onChange={(e) => setFiveHour(e.target.value)} placeholder="22" />
            </label>
            <label className="flex flex-1 flex-col gap-1">
              <span className="t-caption text-muted">Weekly %</span>
              <input className="field" inputMode="decimal" value={weekly} onChange={(e) => setWeekly(e.target.value)} placeholder="18" />
            </label>
          </div>
          <button type="button" className="btn btn-primary" disabled={!!busy || !state} onClick={startRun}>
            {busy === "running" ? <Spinner /> : <Icon name="search" size={18} />} Run next 20
          </button>
          {warning && <p className="notice notice-warn t-small">{warning}</p>}
          {state && (
            <p className="t-caption text-muted">
              {state.queue.due
                ? `${state.queue.due} listing${state.queue.due === 1 ? "" : "s"} waiting.`
                : state.queue.nextDue
                  ? `Nothing waiting. The next listing comes due on ${state.queue.nextDue.slice(0, 10)}.`
                  : "Nothing waiting."}
            </p>
          )}
        </section>

        {state && state.runs.length > 0 && (
          <section className="card flex flex-col gap-2 p-3">
            <p className="t-title">Runs</p>
            {state.runs.slice(0, 5).map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-2">
                <p className="t-small">
                  {r.status === "started" && <Spinner className="mr-1 inline-block" />}
                  {runLabel(r, new Date())}
                </p>
                {r.sessionUrl && (
                  <a className="link t-small shrink-0" href={r.sessionUrl} target="_blank" rel="noreferrer">
                    Open session
                  </a>
                )}
              </div>
            ))}
          </section>
        )}

        {!state && !error && <p className="t-small text-muted">Loading…</p>}

        {open.length > 0 && <p className="t-title">{open.length} to review</p>}
        <ul className="flex flex-col gap-3">
          {open.map((p) => (
            <ProposalCard
              key={p.sku}
              p={p}
              included={!skipped.has(p.sku)}
              onToggle={() => setSkipped(toggle(skipped, p.sku))}
              pendingAccepted={pendingOk.has(p.sku)}
              onPending={() => setPendingOk(toggle(pendingOk, p.sku))}
              onDismiss={() => dismiss(p.sku)}
              onReview={() => toReview(p.sku)}
              disabled={!!busy}
            />
          ))}
        </ul>

        {recent.length > 0 && (
          <>
            <p className="t-title">Recently done</p>
            <ul className="flex flex-col gap-3">
              {recent.map((p) => (
                <ProposalCard key={p.sku} p={p} />
              ))}
            </ul>
          </>
        )}
      </main>

      {chosen.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-background/95 p-3 pb-[calc(env(safe-area-inset-bottom)+12px)] backdrop-blur">
          <div className="mx-auto flex max-w-lg gap-2">
            {confirming ? (
              <>
                <button type="button" className="btn btn-secondary flex-1" onClick={() => setConfirming(null)}>
                  Cancel
                </button>
                <button type="button" className="btn btn-primary flex-[2]" onClick={update}>
                  Yes, update {toSend(confirming, open, skipped).length} on eBay
                </button>
              </>
            ) : (
              <button type="button" className="btn btn-primary w-full" disabled={!!busy} onClick={() => setConfirming(chosen.map((p) => p.sku))}>
                {busy === "updating" ? <Spinner /> : null} Update {chosen.length} listing{chosen.length === 1 ? "" : "s"} on eBay
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function ProposalCard({
  p,
  included,
  onToggle,
  pendingAccepted,
  onPending,
  onDismiss,
  onReview,
  disabled,
}: {
  p: Proposal;
  included?: boolean;
  onToggle?: () => void;
  pendingAccepted?: boolean;
  onPending?: () => void;
  onDismiss?: () => void;
  onReview?: () => void;
  disabled?: boolean;
}) {
  const [showText, setShowText] = useState(false);
  const price = priceChange(p);
  const titleChanged = p.title !== p.snapshot.title;
  const added = Object.entries(p.addAspects);
  const money = (n: number | null) => (n === null ? "no price" : formatMoney(n, "CAD"));
  return (
    <li className="card flex flex-col gap-2 p-3">
      {titleChanged ? (
        <>
          <p className="t-caption text-muted line-through">{p.snapshot.title}</p>
          <p className="t-headline">
            {p.title} <span className="t-caption font-normal text-muted">({p.title.length}/{TITLE_MAX})</span>
          </p>
        </>
      ) : (
        <p className="t-headline">
          {p.title} <span className="t-caption font-normal text-muted">(title unchanged)</span>
        </p>
      )}
      <p className="t-small">
        {price.from === price.to ? (
          <span className="text-muted">{money(price.to)}, unchanged</span>
        ) : (
          <>
            <span className="text-muted line-through">{money(price.from)}</span> <b>{money(price.to)}</b>
            {price.flag && <span className="chip ml-2 border border-line-strong text-foreground">{price.flag}</span>}
          </>
        )}
      </p>
      {added.length > 0 && (
        <p className="t-small">
          <b>Item specifics added:</b> {added.map(([n, v]) => `${n}: ${v.join(", ")}`).join(" · ")}
        </p>
      )}
      <WhyDetails p={p} />
      {p.result && (
        <p className={`notice t-small ${p.status === "applied" ? "notice-ok" : "notice-warn"}`}>
          {p.status === "applied" && p.result.price !== "failed" ? "Updated on eBay." : p.result.reason}
        </p>
      )}
      {!p.result && p.status !== "open" && <p className="t-caption text-muted">{p.status === "dismissed" ? "Dismissed." : p.status}</p>}
      {onToggle && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="chip-toggle" aria-pressed={!!included} onClick={onToggle} disabled={disabled}>
            {included ? <Icon name="check" size={16} /> : null} Include
          </button>
          {p.pendingPrice !== null && onPending && (
            <button type="button" className="chip-toggle" aria-pressed={!!pendingAccepted} onClick={onPending} disabled={disabled}>
              {pendingAccepted ? <Icon name="check" size={16} /> : null} Use {money(p.pendingPrice)} instead
            </button>
          )}
          {p.appendHtml && (
            <button type="button" className="link t-small px-1 py-1" onClick={() => setShowText(!showText)}>
              {showText ? "Hide added text" : "Show added text"}
            </button>
          )}
          {onReview && (
            <button type="button" className="link t-small px-1 py-1" onClick={onReview} disabled={disabled}>
              Send to Review
            </button>
          )}
          <button type="button" className="link t-small px-1 py-1" onClick={onDismiss} disabled={disabled}>
            Dismiss
          </button>
        </div>
      )}
      {/* White on purpose: eBay shows the description on white, so the preview matches it in dark mode too. */}
      {showText && <iframe title="Text added to the description" sandbox="" className="h-48 w-full rounded-xl border border-line bg-white" srcDoc={p.appendHtml} />}
    </li>
  );
}
