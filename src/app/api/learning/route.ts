/**
 * GET /api/learning?level= : the learned price position for an engagement level, from the seller's recorded
 * sales (the average percentile they reached, once the level has 5+ sales). Read by the skill when it reprices
 * live listings. 200 { position: {percentile, n} | null } · 400 bad level · 502 storage unreadable.
 */
import { blobBackend } from "@/lib/comps/store";
import { learnedPosition } from "@/lib/learning/outcomes";
import { readOutcomes } from "@/lib/learning/store";
import type { EngagementLevel } from "@/lib/liveBatch/types";

const LEVELS: EngagementLevel[] = ["high", "normal", "low"];

export async function GET(request: Request) {
  const level = new URL(request.url).searchParams.get("level") as EngagementLevel | null;
  if (!level || !LEVELS.includes(level)) return Response.json({ error: "level must be high, normal or low." }, { status: 400 });
  const b = blobBackend();
  if (!b) return Response.json({ position: null });
  try {
    return Response.json({ position: learnedPosition(await readOutcomes(b), level) });
  } catch (err) {
    console.error("reading sale records failed", err);
    return Response.json({ error: "Sale records could not be read." }, { status: 502 });
  }
}
