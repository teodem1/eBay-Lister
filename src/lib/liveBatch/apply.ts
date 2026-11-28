/**
 * Checks a batch proposal against the live listing and applies it: title, item specifics and
 * description first (old specifics plus the additions, old description plus the appended text,
 * no price), then the price alone. The same rules as the skill's changes.py: nothing the
 * listing says is dropped, grades never change, a listing changed since the proposal is skipped.
 */
import { applyCollectionEdit } from "../ebay/listingEdits";
import { applyRefresh, readListing, type LiveDetail } from "../ebay/refreshListings";
import type { EbaySellClient } from "../ebay/sell";
import { TITLE_MAX } from "../listing/limits";
import type { EntryStatus, Proposal } from "./types";

/** Grade words as the title writes them (long form) and their short form, as the skill's title.py. */
const SHORT: Record<string, string> = {
  mint: "M",
  "near mint": "NM",
  "very good+": "VG+",
  "very good": "VG",
  good: "G",
  fair: "F",
  poor: "P",
  missing: "Missing",
};
const LONG_OF_SHORT = Object.fromEntries(Object.entries(SHORT).map(([long, short]) => [short.toLowerCase(), long]));

type Grades = readonly string[] | null;

function gradeKey(text: string): string | undefined {
  const t = text.trim().replace(/\s+/g, " ").toLowerCase();
  return t in SHORT ? t : LONG_OF_SHORT[t];
}

/** The title without its grade suffix, and the grades: ["sealed"], [disc, inlay] or null. */
export function titleGrades(title: string): { rest: string; grades: Grades } {
  const m = /\s*\(([^()]*)\)\s*$/.exec(title);
  if (!m) return { rest: title, grades: null };
  const inner = m[1].trim();
  const rest = title.slice(0, m.index);
  if (inner.toLowerCase() === "sealed") return { rest, grades: ["sealed"] };
  const labelled = /^(?:disc:\s*([^/]+?))?\s*\/?\s*(?:inlay:\s*(.+?))?$/i.exec(inner);
  if (labelled && (labelled[1] || labelled[2])) {
    const disc = labelled[1] ? gradeKey(labelled[1]) : undefined;
    const inlay = labelled[2] ? gradeKey(labelled[2]) : undefined;
    if ((labelled[1] && !disc) || (labelled[2] && !inlay)) return { rest: title, grades: null };
    return { rest, grades: [disc ?? "", inlay ?? ""] };
  }
  const short = /^([A-Za-z+]+)\s*\/\s*([A-Za-z+]+)$/.exec(inner);
  if (short && gradeKey(short[1]) && gradeKey(short[2])) return { rest, grades: [gradeKey(short[1])!, gradeKey(short[2])!] };
  return { rest: title, grades: null };
}

function ownGrades(live: LiveDetail): Grades {
  const sc = live.sellerCondition;
  if (!sc?.disc) return sc?.condition === "NEW" ? ["sealed"] : null;
  const disc = gradeKey(sc.disc);
  const inlay = sc.booklet ? gradeKey(sc.booklet) : "";
  return disc && inlay !== undefined ? [disc, inlay] : null;
}

const same = (a: Grades, b: Grades) => JSON.stringify(a) === JSON.stringify(b);
const words = (t: string) => new Set(t.toLowerCase().match(/[a-z0-9']+/g) ?? []);
const positive = (n: number | null) => n === null || (Number.isFinite(n) && n > 0);

/** What is wrong with a proposal for this live listing; empty when it may be sent. */
export function checkProposal(live: LiveDetail, p: Proposal): string[] {
  const problems: string[] = [];
  if (p.sku !== live.sku) problems.push("The proposal is for another listing.");
  if (!p.title.trim()) problems.push("The new title is empty.");
  if (p.title.length > TITLE_MAX) problems.push(`The new title has ${p.title.length} characters, over ${TITLE_MAX}.`);
  const before = titleGrades(live.title);
  const after = titleGrades(p.title);
  const addingOwn = before.grades === null && after.grades !== null && same(after.grades, ownGrades(live));
  if (!same(before.grades, after.grades) && !addingOwn) problems.push("The grades in the title changed; grades and condition never change.");
  const kept = words(after.rest);
  const missing = [...words(before.rest)].filter((w) => !kept.has(w)).sort();
  if (missing.length) problems.push(`The new title drops words the old one has: ${missing.join(", ")}.`);
  const have = new Set(Object.keys(live.aspects).map((k) => k.trim().toLowerCase()));
  for (const [name, values] of Object.entries(p.addAspects)) {
    if (have.has(name.trim().toLowerCase())) problems.push(`Item specific ${name} already exists; values the listing has are never changed.`);
    if (!values.length || values.some((v) => !v.trim())) problems.push(`Item specific ${name} needs one or more values.`);
  }
  if (!positive(p.price)) problems.push("The price must be a positive number.");
  if (!positive(p.pendingPrice)) problems.push("The pending price must be a positive number.");
  return problems;
}

const samePrice = (a: number | null | undefined, b: number | null | undefined) =>
  a == null || b == null ? a == null && b == null : Math.abs(a - b) < 0.005;
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

type Outcome = { status: EntryStatus; result: { text: string; price: string; reason: string } };

export async function applyProposal(
  client: EbaySellClient,
  p: Proposal,
  acceptPending: boolean,
  opts: { bestOfferMinPercent?: number; currency: string },
): Promise<Outcome> {
  const skipped = (status: EntryStatus, reason: string): Outcome => ({ status, result: { text: "skipped", price: "skipped", reason } });
  const live = await readListing(client, p.sku);
  if (!live) return skipped("stale", "The listing is no longer live (it sold or ended).");
  if (live.title !== p.snapshot.title || !samePrice(live.price, p.snapshot.price)) {
    return skipped("stale", "The listing's title or price changed since the proposal. It goes back in the queue.");
  }
  const problems = checkProposal(live, p);
  if (problems.length) return skipped("failed", `Refused: ${problems.join(" ")}`);

  const reasons: string[] = [];
  let text: string;
  if (p.title === live.title && !Object.keys(p.addAspects).length && !p.appendHtml.trim()) {
    text = "unchanged";
  } else {
    try {
      const done = await applyRefresh(client, p.sku, live.title, {
        title: p.title,
        aspects: { ...live.aspects, ...p.addAspects },
        descriptionHtml: live.descriptionHtml + p.appendHtml,
      });
      text = done.status === "updated" ? "updated" : "skipped";
      if (done.status === "skipped") reasons.push(`Text skipped: ${done.reason}`);
    } catch (err) {
      text = "failed";
      reasons.push(`Text failed: ${message(err)}`);
    }
  }
  if (text === "skipped" || text === "failed") {
    reasons.push("Price not sent, since the text was not saved.");
    return { status: text === "skipped" ? "stale" : "failed", result: { text, price: "skipped", reason: reasons.join(" ") } };
  }

  const target = acceptPending && p.pendingPrice !== null ? p.pendingPrice : p.price;
  let price: string;
  if (live.price == null) {
    price = "skipped";
    reasons.push("The listing has no price, so no price was sent.");
  } else if (target === null || samePrice(target, live.price)) {
    price = "unchanged";
  } else {
    try {
      const done = await applyCollectionEdit(
        client,
        { sku: p.sku, before: { title: "-", artist: "-", price: live.price }, after: { title: "-", artist: "-", price: target } },
        opts,
      );
      price = done.status === "updated" ? "updated" : done.status === "unchanged" ? "unchanged" : "failed";
      if (done.status === "not_found") reasons.push(`Price failed: ${done.reason}`);
    } catch (err) {
      price = "failed";
      reasons.push(`Price failed: ${message(err)}`);
    }
  }
  // A price that did not go through is a failure even when the text did: the listing comes back in the queue.
  const status: EntryStatus = price === "failed" ? "failed" : "applied";
  return { status, result: { text, price, reason: reasons.join(" ") } };
}
