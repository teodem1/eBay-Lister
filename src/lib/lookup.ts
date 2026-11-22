/** Shapes shared by the lookup API routes and the page. */
import type { SearchResult } from "./ebay/client";
import type { PhotoIdentification } from "./identify/vision";

export interface LookupResponse {
  source: "barcode" | "photo";
  /** Barcode used for the eBay search, if any. */
  gtin?: string;
  /** Keywords used for the eBay search, if any. */
  query?: string;
  /** Present for photo lookups: what Claude thinks the item is. */
  identification?: PhotoIdentification;
  results: SearchResult;
  /** Things the user should know, e.g. "no exact barcode match, showing keyword results". */
  notes: string[];
}

export interface LookupError {
  error: string;
}
