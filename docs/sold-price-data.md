# Where sold-price data comes from

| Source | What it gives | Access | Used as |
|---|---|---|---|
| Marketplace Insights API `item_sales/search` | Items **sold** in the last 90 days: sold price, sold date, quantity, item location, shipping options | Limited Release. eBay must approve the app (business case) before the `buy.marketplace.insights` scope works | Primary |
| Browse API `item_summary/search` | **Active** listings: asking price, item location, shipping cost to a chosen destination | Open to every keyset | Automatic fallback, discounted 15% (a guess) |
| Finding API `findCompletedItems` | Used to return sold items | Decommissioned by eBay in 2025 | Not used |
| Terapeak (Seller Hub › Research) | Up to 3 years of sold data | Web UI only, no public API | Manual check |
| Scraping eBay "Sold items" search | Sold prices | Against eBay's user agreement, fragile | Not used |

## Shipping destination

eBay does not tell you where a sold item was actually shipped. What we can get
is the shipping cost **to a destination we choose**, by sending
`X-EBAY-C-ENDUSERCTX: contextualLocation=country=FR,zip=75001`. So
"destination" in the data is the buyer location we asked about, and "origin"
is the listing's `itemLocation`.

## Applying for Marketplace Insights

In the eBay Developer Program, open *Application Keys* and request access to
the Buy APIs / Marketplace Insights (Limited Release). Until it is approved,
the app runs on the Browse fallback and tells the user so.

## Code

- `src/lib/ebay/client.ts`: OAuth app token + GET helper (mockable `fetch`).
- `src/lib/ebay/comparables.ts`: queries both APIs, normalises results, falls back.
- `src/lib/pricing/suggestPrice.ts`: outlier removal, weighting, suggestion.
- `src/app/api/price-suggestion/route.ts`: `POST` endpoint for the phone UI.
