import "server-only";
import { EbayClient } from "./client";
import { readEbayConfig } from "./config";

let shared: EbayClient | undefined;

/** One client per server process so the app token is reused between requests. */
export function getEbayClient(): EbayClient {
  shared ??= new EbayClient(readEbayConfig());
  return shared;
}

export * from "./client";
export * from "./config";
