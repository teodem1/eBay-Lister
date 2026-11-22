import type { Metadata } from "next";
import CollectionScreen from "./CollectionScreen";

export const metadata: Metadata = { title: "Collection · eBay Lister" };

export default function CollectionPage() {
  return <CollectionScreen />;
}
