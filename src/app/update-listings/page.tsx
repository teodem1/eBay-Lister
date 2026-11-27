import type { Metadata } from "next";
import UpdateListingsScreen from "./UpdateListingsScreen";

export const metadata: Metadata = { title: "Update live listings · eBay Lister" };

export default function UpdateListingsPage() {
  return <UpdateListingsScreen />;
}
