# Where sold-price data comes from

| Source | What it gives | Access | Used as |
|---|---|---|---|
| Marketplace Insights API `item_sales/search` | Items **sold** in the last 90 days: sold price, sold date, quantity, item location, shipping options | Limited Release. eBay must approve the app (business case) before the `buy.marketplace.insights` scope works | "Last sold" price |
| Browse API `item_summary/search` | **Active** listings: asking price, item location, shipping cost to a chosen destination | Open to every keyset | "Current listings" price (no discount) |
| sold-comps.com `GET /v1/scrape` (third party) | Sold items from eBay's public sold search, any of 8 eBay sites incl. ebay.ca: sold price, currency, shipping, end date, item location | API key (`SOLD_COMPS_API_KEY`). Free 100 requests/month, $9/month for 2,000 (Nov 2026). The provider scrapes eBay; not an official eBay source | "Last sold" price when Insights is refused and a key is set |
| Finding API `findCompletedItems` | Used to return sold items | Decommissioned by eBay in 2025 | Not used |
| Terapeak (Seller Hub › Research) | Up to 3 years of sold data | Web UI only, no public API | Manual check |
| Scraping eBay "Sold items" search | Sold prices | Against eBay's user agreement, fragile | Not used |

## Two prices on the listing screen

`/api/price-suggestion` runs both searches side by side (`findBothComparables`)
and returns a `current` and a `sold` suggestion. The listing screen shows both
and prefills the last-sold recommended price, or the current one when sold data
is missing. Sold data comes from Marketplace Insights when approved, else from
sold-comps.com when `SOLD_COMPS_API_KEY` is set (`src/lib/ebay/soldComps.ts`).
With neither, the "Last sold" card says so and only the current price is filled.

Why sold-comps.com: of the third-party sold-data APIs compared in Nov 2026
(SoldComps.io, CompSniper, Trawl, CompsAPI, Soldgraph, Apify actors), only it
and CompSniper document ebay.ca, and it has a free tier with no card. Not yet
tested against the live API: no GTIN parameter is documented, so a barcode is
sent as the keyword only when there is no item text.

## Shipping destination

eBay does not tell you where a sold item was actually shipped. What we can get
is the shipping cost **to a destination we choose**, by sending
`X-EBAY-C-ENDUSERCTX: contextualLocation=country=CA,zip=M5V3L9`. So
"destination" in the data is the buyer location we asked about, and "origin"
is the listing's `itemLocation`.

## Applying for Marketplace Insights

In the eBay Developer Program, open *Application Keys* and request access to
the Buy APIs / Marketplace Insights (Limited Release). Until it is approved,
the app runs on the Browse fallback and tells the user so.

## Code

- `src/lib/ebay/client.ts`: OAuth app token + GET helper (mockable `fetch`).
- `src/lib/ebay/comparables.ts`: queries both APIs, normalises results (`findBothComparables` for the two prices, `findComparables` for sold-with-fallback).
- `src/lib/pricing/suggestPrice.ts`: outlier removal, weighting, suggestion.
- `src/app/api/price-suggestion/route.ts`: `POST` endpoint for the phone UI.
