"use client";

import { Icon, StepHeading } from "@/components/ui";
import {
  GRADES,
  conditionLabel,
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
  value,
  onChange,
}: {
  n: number;
  value: ConditionDraft;
  onChange: (next: ConditionDraft) => void;
}) {
  const sealed = value.condition === "NEW";
  // Every grade change recomputes the eBay condition.
  const setGrades = (patch: ConditionDraft) => {
    const next = { ...value, ...patch };
    onChange({ ...next, condition: ebayConditionFromGrades(next.disc, next.booklet) });
  };

  return (
    <section className="flex flex-col gap-3">
      <StepHeading n={n} title="Your CD's condition" hint="Claude uses only what you pick here, never other listings." />
      <div className="card space-y-5">
        <button
          type="button"
          aria-pressed={sealed}
          className="chip-toggle"
          onClick={() =>
            onChange(
              sealed
                ? { notes: value.notes }
                : { condition: "NEW", notes: value.notes },
            )
          }
        >
          {sealed && <Icon name="check" size={16} strokeWidth={2.6} />}
          New, still sealed
        </button>

        {!sealed && (
          <>
            <GradeRow
              label="Disc condition"
              value={value.disc}
              onPick={(g) => setGrades({ disc: g as Grade })}
            />
            <GradeRow
              label="Inlay condition"
              hint="Front booklet and back inlay"
              value={value.booklet}
              withMissing
              onPick={(g) => setGrades({ booklet: g as Grade | "Missing" })}
            />
            <GradeRow
              label="Case"
              optional
              value={value.case}
              withMissing
              onPick={(g) => onChange({ ...value, case: g as Grade | "Missing" | undefined })}
            />
            <button
              type="button"
              aria-pressed={!!value.tested}
              className="chip-toggle"
              onClick={() => onChange({ ...value, tested: !value.tested })}
            >
              {value.tested && <Icon name="check" size={16} strokeWidth={2.6} />}
              Tested, plays without skips
            </button>
          </>
        )}

        <label className="block">
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

        {value.condition && (sealed || (value.disc && value.booklet)) && (
          <p className="t-small text-muted">
            eBay condition: <span className="font-semibold text-foreground">{conditionLabel(value.condition)}</span>
            {!sealed && " (from the weaker of disc and inlay)"}
          </p>
        )}
      </div>
    </section>
  );
}

function GradeRow({
  label,
  hint,
  optional = false,
  withMissing = false,
  value,
  onPick,
}: {
  label: string;
  hint?: string;
  optional?: boolean;
  withMissing?: boolean;
  value: string | undefined;
  onPick: (grade: string | undefined) => void;
}) {
  const options: string[] = withMissing ? [...GRADES, "Missing"] : [...GRADES];
  return (
    <fieldset>
      <legend className="label">
        {label} {optional && <span className="font-normal text-muted">(optional)</span>}
        {hint && <span className="block font-normal text-muted">{hint}</span>}
      </legend>
      <div className="flex flex-wrap gap-2">
        {options.map((g) => (
          <button
            key={g}
            type="button"
            aria-pressed={value === g}
            className="chip-toggle"
            // Tapping the chosen grade again clears an optional one.
            onClick={() => onPick(value === g && optional ? undefined : g)}
          >
            {value === g && <Icon name="check" size={16} strokeWidth={2.6} />}
            {g}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
