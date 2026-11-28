"use client";

import { useState } from "react";
import type { Proposal } from "@/lib/listing/types";

/** The reasoning behind a proposal (engagement, evidence, notes), hidden until the seller taps "Why?". */
export default function WhyDetails({ p }: { p: Proposal }) {
  const [open, setOpen] = useState(false);
  const notes = [p.engagement.reason, p.evidence, ...p.flags].filter(Boolean);
  if (!notes.length) return null;
  return (
    <div className="flex flex-col gap-1">
      <button type="button" className="link t-caption self-start px-1 py-1" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? "Hide why" : "Why?"}
      </button>
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
