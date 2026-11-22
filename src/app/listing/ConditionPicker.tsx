"use client";

import { Icon, StepHeading } from "@/components/ui";
import { CD_CONDITIONS, GRADES, PARTS, type PartKey, type SellerCondition } from "@/lib/listing/condition";

export type ConditionDraft = Partial<SellerCondition>;

/** Asks the seller how their CD looks before Claude writes anything. */
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
  const set = (patch: ConditionDraft) => onChange({ ...value, ...patch });

  return (
    <section className="flex flex-col gap-3">
      <StepHeading n={n} title="Your CD's condition" hint="Claude uses only what you pick here, never other listings." />
      <div className="card space-y-5">
        <fieldset>
          <legend className="label">Overall (eBay condition)</legend>
          <div className="grid grid-cols-2 gap-2">
            {CD_CONDITIONS.map((c) => (
              <button
                key={c.value}
                type="button"
                aria-pressed={value.condition === c.value}
                className="choice flex min-h-12 items-center justify-between gap-2 px-3 text-left text-sm font-medium"
                onClick={() =>
                  // A sealed CD has no part grades or play test.
                  set(
                    c.value === "NEW"
                      ? { condition: c.value, disc: undefined, case: undefined, booklet: undefined, tested: undefined }
                      : { condition: c.value },
                  )
                }
              >
                {c.label}
                {value.condition === c.value && <Icon name="check" size={16} strokeWidth={2.6} className="text-brand-ink" />}
              </button>
            ))}
          </div>
        </fieldset>

        {value.condition && !sealed && (
          <>
            {PARTS.map((p) => (
              <GradeRow
                key={p.key}
                part={p.key}
                label={p.label}
                required={p.key === "disc"}
                value={value[p.key]}
                onPick={(g) => set({ [p.key]: g } as ConditionDraft)}
              />
            ))}
            <button
              type="button"
              aria-pressed={!!value.tested}
              className="chip-toggle"
              onClick={() => set({ tested: !value.tested })}
            >
              {value.tested && <Icon name="check" size={16} strokeWidth={2.6} />}
              Tested, plays without skips
            </button>
          </>
        )}

        {value.condition && (
          <label className="block">
            <span className="label">
              Defects or details <span className="font-normal text-muted">(optional)</span>
            </span>
            <textarea
              className="field"
              rows={2}
              maxLength={600}
              value={value.notes ?? ""}
              onChange={(e) => set({ notes: e.target.value || undefined })}
              placeholder="e.g. light scuffs on disc, cracked hinge, obi strip included"
            />
          </label>
        )}
      </div>
    </section>
  );
}

function GradeRow({
  part,
  label,
  required,
  value,
  onPick,
}: {
  part: PartKey;
  label: string;
  required: boolean;
  value: string | undefined;
  onPick: (grade: string | undefined) => void;
}) {
  const options: string[] = part === "disc" ? [...GRADES] : [...GRADES, "Missing"];
  return (
    <fieldset>
      <legend className="label">
        {label} {!required && <span className="font-normal text-muted">(optional)</span>}
      </legend>
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {options.map((g) => (
          <button
            key={g}
            type="button"
            aria-pressed={value === g}
            className="chip-toggle"
            // Tapping the chosen grade again clears an optional one.
            onClick={() => onPick(value === g && !required ? undefined : g)}
          >
            {value === g && <Icon name="check" size={16} strokeWidth={2.6} />}
            {g}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
