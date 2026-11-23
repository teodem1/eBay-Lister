import type { Metadata } from "next";
import ReviewScreen from "./ReviewScreen";

export const metadata: Metadata = { title: "Review · eBay Lister" };

export default function ReviewPage() {
  return <ReviewScreen />;
}
