"use client";

import { useState } from "react";
import type { Proposal } from "@/lib/listing/types";
import { notes as whyNotes, warnings } from "./batchView";

/**
 * Warnings the seller must see (pending price, short-name sales) always show; the reasoning behind a proposal
 * (engagement, evidence, other notes) stays hidden until the seller taps "Why?".
 */
export default function WhyDetails({ p }: { p: Proposal }) {
  const [open, setOpen] = useState(false);
  const notes = [p.engagement.reason, p.evidence, ...whyNotes(p)].filter(Boolean);
  const warn = warnings(p);
  if (!notes.length && !warn.length) return null;
  return (
    <div className="flex flex-col gap-1">
      {warn.map((w) => (
        <p key={w} className="notice notice-warn t-small">
          {w}
        </p>
      ))}
      {notes.length > 0 && (
        <button type="button" className="link t-caption self-start px-1 py-1" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? "Hide why" : "Why?"}
        </button>
      )}
      {open && (
        <ul className="t-caption flex flex-col gap-1 text-muted">
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
