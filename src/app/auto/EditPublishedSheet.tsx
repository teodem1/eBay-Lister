"use client";

import { useEffect, useEffectEvent, useState } from "react";
import { createPortal } from "react-dom";
import { Icon, Spinner } from "@/components/ui";
import { TITLE_MAX } from "@/lib/listing/limits";
import { autoState } from "@/lib/auto/auto";
import type { BatchItem } from "@/lib/batch/queue";
import { autoStore } from "@/lib/batch/store";
import DescriptionEditor from "@/app/listing/DescriptionEditor";
import { saveToCollection } from "./useAutoRun";

/**
 * Bottom sheet to change a listing the Auto tab published: title, price and
 * description. "Save to eBay" updates the live listing (same SKU, no relisting).
 */
export default function EditPublishedSheet({ item, onClose }: { item: BatchItem; onClose: () => void }) {
  const a = autoState(item);
  const original = a.draft!;
  const [title, setTitle] = useState(original.title);
  const [priceText, setPriceText] = useState(original.price.toFixed(2));
  const [html, setHtml] = useState(original.descriptionHtml);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const price = Number(priceText.replace(",", "."));
  const priceOk = Number.isFinite(price) && price > 0;
  const changed = title !== original.title || (priceOk && price !== original.price) || html !== original.descriptionHtml;

  // Android back (and browser back) closes the sheet instead of leaving the screen.
  const onBack = useEffectEvent(() => onClose());
  useEffect(() => {
    window.history.pushState({ ...window.history.state, editSheet: true }, "");
    const onPop = () => onBack();
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  function close() {
    if (window.history.state?.editSheet) window.history.back();
    else onClose();
  }

  async function save() {
    if (!priceOk || !title.trim()) return;
    const draft = { ...original, title: title.trim(), price: Math.round(price * 100) / 100, descriptionHtml: html };
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/listing/revise", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error([data.error ?? "Couldn't update the listing", ...(data.problems ?? [])].join(" "));
      autoStore.update(item.id, (x) => ({
        ...x,
        auto: { ...autoState(x), draft, price: draft.price, revisedAt: new Date().toISOString() },
      }));
      const updated = autoStore.get(item.id);
      if (updated) saveToCollection(updated);
      setSaved(true);
      setTimeout(close, 900);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 fade-in" onClick={close}>
      <div
        role="dialog"
        aria-modal
        aria-labelledby="edit-title"
        className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-line bg-background p-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-line-strong" aria-hidden />
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="eyebrow">Live on eBay</p>
            <h2 id="edit-title" className="t-headline">
              Edit listing
            </h2>
          </div>
          <button type="button" onClick={close} aria-label="Close" className="icon-btn -mr-2">
            <Icon name="close" />
          </button>
        </div>

        <div className="mt-3 flex flex-col gap-4">
          <label className="block">
            <span className="label flex justify-between">
              Title
              <span className={`font-normal tabular-nums ${title.length > TITLE_MAX ? "text-bad-ink" : "text-muted"}`}>
                {title.length}/{TITLE_MAX}
              </span>
            </span>
            <textarea className="field" rows={2} value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="block">
            <span className="label">Price (CAD)</span>
            <input className="field" inputMode="decimal" value={priceText} onChange={(e) => setPriceText(e.target.value)} />
            {a.priceBasis && <span className="hint">{a.priceBasis}</span>}
          </label>
          <div>
            <span className="label">Description</span>
            <DescriptionEditor html={html} fieldClass="field" onChange={setHtml} />
          </div>
        </div>

        {error && (
          <p role="alert" className="notice notice-bad mt-3">
            {error}
          </p>
        )}

        <div className="sticky -bottom-6 -mx-4 mt-4 border-t border-line bg-background px-4 pb-2 pt-3">
          <button
            type="button"
            className="btn btn-primary btn-lg w-full"
            disabled={!changed || saving || saved || !priceOk || !title.trim() || title.length > TITLE_MAX}
            onClick={save}
          >
            {saving ? (
              <>
                <Spinner /> Updating eBay…
              </>
            ) : saved ? (
              <>
                <Icon name="check" /> Updated on eBay
              </>
            ) : (
              "Save to eBay"
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
