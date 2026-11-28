/** The seller's sale records in the private Blob store: one file, newest sale first, at most 2,000. */
import type { Backend } from "../comps/store";
import type { SaleOutcome } from "./outcomes";

const PATH = "learning/outcomes.json";
const KEEP = 2000;

export async function readOutcomes(b: Backend): Promise<SaleOutcome[]> {
  const text = await b.read(PATH);
  if (text === null) return [];
  const v = JSON.parse(text) as unknown;
  if (!Array.isArray(v)) throw new Error(`${PATH} is not readable.`);
  return v as SaleOutcome[];
}

/** Adds the record; the same CD and sale date replaces the earlier one (an edited sale). */
export async function recordOutcome(b: Backend, outcome: SaleOutcome): Promise<void> {
  const rest = (await readOutcomes(b)).filter((o) => !(o.key === outcome.key && o.soldAt === outcome.soldAt));
  const all = [outcome, ...rest].sort((x, y) => y.soldAt.localeCompare(x.soldAt));
  await b.write(PATH, JSON.stringify(all.slice(0, KEEP)));
}
