"use client";

import { Icon, StepHeading } from "@/components/ui";
import {
  GRADES,
  ebayConditionFromGrades,
  type Grade,
  type SellerCondition,
} from "@/lib/listing/condition";

export type ConditionDraft = Partial<SellerCondition>;

/**
 * Asks how the seller's CD looks before Claude writes anything: the disc and
 * the inlay are graded separately. The eBay condition follows from the worse
 * of the two (or "New" for a sealed CD).
 */
export default function ConditionPicker({
  n,
  hint,
  compact = false,
  value,
  onChange,
}: {
  /** Step number; without one a plain heading is shown. */
  n?: number;
  hint?: string;
  /** Only disc, inlay and sealed (the scan screen); case, tested and defects come later. */
  compact?: boolean;
  value: ConditionDraft;
  onChange: (next: ConditionDraft) => void;
}) {
  const sealed = value.condition === "NEW";
  // Every grade change recomputes the eBay condition.
  const setGrades = (patch: ConditionDraft) => {
    const next = { ...value, ...patch };
    onChange({
      ...next,
      condition: ebayConditionFromGrades(next.disc, next.booklet),
    });
  };

  return (
    <section className="flex flex-col gap-4">
      {n !== undefined ? (
        <StepHeading n={n} title="Your CD's condition" hint={hint} />
      ) : (
        <div className="px-1">
          <h3 className="t-headline">Your CD&apos;s condition</h3>
          {hint && <p className="t-small text-muted">{hint}</p>}
        </div>
      )}
      {!sealed && (
        <>
          <GradeRow label="Disc" value={value.disc} onPick={(g) => setGrades({ disc: g as Grade })} />
          <GradeRow
            label="Inlay"
            value={value.booklet}
            withMissing
            onPick={(g) => setGrades({ booklet: g as Grade | "Missing" })}
          />
          {!compact && (
            <GradeRow
              label="Case"
              optional
              value={value.case}
              withMissing
              onPick={(g) => onChange({ ...value, case: g as Grade | "Missing" | undefined })}
            />
          )}
        </>
      )}

      <div className="card flex flex-col gap-1 py-1">
        <SwitchRow
          label="New, still sealed"
          on={sealed}
          onToggle={() => onChange(sealed ? { notes: value.notes } : { condition: "NEW", notes: value.notes })}
        />
        {!compact && !sealed && (
          <SwitchRow
            label="Tested, plays without skips"
            on={!!value.tested}
            onToggle={() => onChange({ ...value, tested: !value.tested })}
          />
        )}
      </div>

      {!compact && (
        <label className="card block">
          <span className="label">
            Defects or details <span className="font-normal text-muted">(optional)</span>
          </span>
          <textarea
            className="field"
            rows={2}
            maxLength={600}
            value={value.notes ?? ""}
            onChange={(e) => onChange({ ...value, notes: e.target.value || undefined })}
            placeholder="e.g. light scuffs on disc, cracked hinge, obi strip included"
          />
        </label>
      )}
    </section>
  );
}

/** A yes/no line with a switch, e.g. "New, still sealed". */
function SwitchRow({ label, on, onToggle }: { label: string; on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onToggle}
      className="flex min-h-12 w-full items-center justify-between gap-3 text-left font-medium"
    >
      {label}
      <span className="switch" aria-hidden />
    </button>
  );
}

/** One grade group: its name on the card's tab, then a chip per grade. */
function GradeRow({
  label,
  optional = false,
  withMissing = false,
  value,
  onPick,
}: {
  label: string;
  optional?: boolean;
  withMissing?: boolean;
  value: string | undefined;
  onPick: (grade: string | undefined) => void;
}) {
  const options: string[] = withMissing ? [...GRADES, "Missing"] : [...GRADES];
  return (
    <fieldset className="grader">
      <legend className="grader-tab">
        {label}
        {optional && <span className="ml-1 font-normal text-muted">(optional)</span>}
      </legend>
      <div className="flex flex-wrap gap-2">
        {options.map((g) => (
          <button
            key={g}
            type="button"
            aria-pressed={value === g}
            aria-label={`${label}: ${g}`}
            className="chip-toggle"
            // Tapping the chosen grade again clears an optional one.
            onClick={() => onPick(value === g && optional ? undefined : g)}
          >
            {value === g && <Icon name="check" size={16} strokeWidth={2.4} />}
            {g}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
