"use client";

import { useState } from "react";
import { editableToHtml, htmlToEditable } from "@/lib/listing/descriptionText";

/**
 * The description as plain text the seller edits directly ("Edit"), or as
 * eBay will show it ("Preview"). The text is turned into simple HTML on each change.
 */
export default function DescriptionEditor({
  html,
  fieldClass,
  onChange,
}: {
  html: string;
  fieldClass: string;
  onChange: (html: string) => void;
}) {
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [text, setText] = useState(() => htmlToEditable(html));
  // A new draft (or Claude rewriting it) replaces the text; the seller's own edits don't.
  const [synced, setSynced] = useState(html);
  if (html !== synced) {
    setSynced(html);
    setText(htmlToEditable(html));
  }

  return (
    <>
      <div className="-mt-1 mb-3 flex rounded-full bg-surface-2 p-1 text-sm font-semibold" role="group" aria-label="Description view">
        {(
          [
            ["edit", "Edit text"],
            ["preview", "Preview"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={mode === value}
            onClick={() => setMode(value)}
            className={`min-h-10 flex-1 rounded-full px-3.5 transition-colors ${
              mode === value ? "bg-surface text-foreground shadow-card" : "text-muted"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {mode === "preview" ? (
        // Preview in a sandboxed iframe so the HTML can't run scripts in the app.
        <iframe title="Description preview" sandbox="" className="h-80 w-full rounded-xl border border-line bg-white" srcDoc={html} />
      ) : (
        <>
          <textarea
            className={`${fieldClass} min-h-80 leading-relaxed`}
            rows={14}
            value={text}
            aria-label="Description"
            onChange={(e) => {
              setText(e.target.value);
              const next = editableToHtml(e.target.value);
              setSynced(next);
              onChange(next);
            }}
          />
          <p className="t-caption mt-1.5 text-muted">
            &quot;## &quot; starts a heading, &quot;- &quot; a bullet, **word** is bold. Leave a blank line between paragraphs.
          </p>
        </>
      )}
    </>
  );
}
