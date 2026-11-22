import { Suspense } from "react";
import ListingEditor from "./ListingEditor";

type SearchParams = PageProps<"/listing">["searchParams"];

// The pricing / scan steps can link here with ?q=...&barcode=...&price=...
async function EditorFromParams({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const price = Number(one(params.price));
  return (
    <ListingEditor
      initial={{
        query: one(params.q),
        barcode: one(params.barcode),
        price: Number.isFinite(price) && price > 0 ? price : undefined,
      }}
    />
  );
}

export default function ListingPage({ searchParams }: PageProps<"/listing">) {
  return (
    <Suspense fallback={<main className="px-4 py-6">Loading…</main>}>
      <EditorFromParams searchParams={searchParams} />
    </Suspense>
  );
}
