import type { Metadata } from "next";
import SortScreen from "./SortScreen";

export const metadata: Metadata = { title: "Sort a pile · eBay Lister" };

export default function SortPage() {
  return <SortScreen />;
}
