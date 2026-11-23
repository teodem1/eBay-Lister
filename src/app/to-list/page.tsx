import { Suspense } from "react";
import type { Metadata } from "next";
import ToListScreen from "./ToListScreen";

export const metadata: Metadata = { title: "To list · eBay Lister" };

export default function ToListPage() {
  return (
    <Suspense>
      <ToListScreen />
    </Suspense>
  );
}
