import { Suspense } from "react";
import { Spinner } from "@/components/ui";
import { conditionFromParams } from "@/lib/listing/condition";
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
        // Disc and inlay grades picked on the scan screen.
        condition: conditionFromParams((k) => one(params[k]) || undefined),
      }}
    />
  );
}

export default function ListingPage({ searchParams }: PageProps<"/listing">) {
  return (
    <Suspense
      fallback={
        <main className="page items-center justify-center text-brand-ink">
          <Spinner />
        </main>
      }
    >
      <EditorFromParams searchParams={searchParams} />
    </Suspense>
  );
}
