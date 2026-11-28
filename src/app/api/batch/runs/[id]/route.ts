/**
 * GET /api/batch/runs/[id] (session): the run and the listings it reserved.
 * POST /api/batch/runs/[id] {status: "done" | "failed", release?, reason?} (session): closes the
 * run; listings it gives back, and any it reserved but never proposed, return to the queue.
 */
import { z } from "zod";
import { release } from "@/lib/liveBatch/queue";
import { readRun, saveRun, updateIndex } from "@/lib/liveBatch/store";
import { batchStore, readState, storageError } from "../../shared";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  const { id } = await params;
  const b = batchStore();
  if (b instanceof Response) return b;
  try {
    const run = await readRun(b, id);
    return run ? Response.json({ run }) : Response.json({ error: "No such run." }, { status: 404 });
  } catch (err) {
    return storageError(err);
  }
}

const Body = z.object({
  status: z.enum(["done", "failed"]),
  release: z.array(z.string().max(100)).max(50).optional(),
  reason: z.string().max(1000).optional(),
});

export async function POST(request: Request, { params }: Ctx) {
  const { id } = await params;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid run update." }, { status: 400 });
  const b = batchStore();
  if (b instanceof Response) return b;
  try {
    const now = new Date();
    const { runs } = await readState(b, now);
    const run = runs.find((r) => r.id === id);
    if (!run) return Response.json({ error: "No such run." }, { status: 404 });
    let leftovers: string[] = [];
    await updateIndex(b, (index) => {
      leftovers = run.skus.filter((s) => index[s]?.status === "in_progress" && index[s]?.runId === id);
      return leftovers.length ? release(index, leftovers) : undefined;
    });
    const closed = { ...run, status: parsed.data.status, reason: parsed.data.reason, finishedAt: now.toISOString() };
    await saveRun(b, closed);
    return Response.json({ run: closed, released: leftovers });
  } catch (err) {
    return storageError(err);
  }
}
