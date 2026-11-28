# optimise-listing

`/optimise-listing` rewrites and reprices your live eBay CD listings in batches of 20 from stored sold results, sending only the changes you approve. It can also write and price one unlisted CD, which it never publishes.
Use the plain `/optimise-listing`, not an `ebay-cd-optimiser:` entry from the account plugin, which is an older copy.

## Install
Nothing to install: this folder and `.claude/agents/` are part of the eBay Lister repository, so a normal Claude Code cloud session on it loads them (not a thread inside a Claude Code project). Confirmed on 2026-11-28 (plan Task 0).

## Use
- `/optimise-listing update my live listings`: reads each listing and its stored sold results, rewrites the title, adds missing verified information and proposes a price, then shows one table per 5 listings. Nothing is sent until you say which SKUs to send.
- `/optimise-listing Pink Floyd, The Dark Side of the Moon, barcode ..., disc Near mint, inlay Very good+, bought in Canada` (add photos if you have them): one unlisted CD.

## From the phone
The app's "Update live listings" screen can start a batch with no chat: it fires a Claude Code scheduled task (prompt in `references/headless-prompt.md`), which runs job H in a cloud session on your plan and saves proposals to the app. You approve and send them on the phone.

## What it spends
- Asks for your five-hour and weekly percentages (Settings > Usage) and stops at 80% of either; asks again before each batch of 20, and shrinks a batch that would cross 80% (the 5-CD trial used about 1 five-hour and 0.2 weekly points per CD).
- Web research only for CDs asking C$20 or more. The rest are rewritten from the listing and its stored sales.
- Sold results come from the app's store first; a SoldComps lookup is made only when none is stored (or when you ask for fresh ones), once per CD.
- Haiku looks for sources once per artist, Sonnet writes in groups of 5 (4 calls per batch of 20), Opus only when evidence conflicts.
- Never calls the app's Claude features, so no API credits. Keep usage credits off to avoid charges beyond your plan.

## Settings (where Claude runs; never in chat)
| Name | Value |
|---|---|
| `ELISTER_URL` | The app's https address |
| `ELISTER_ACCESS_KEY` | Leave unset in a cloud session: a network secret sends the app's `APP_ACCESS_KEY` as the `x-elister-key` header. Only a setup without network secrets uses this variable |

Without a working connection the skill asks for a paste or screenshot of the app's price screen. Python 3 is required for the scripts.

## Model routing
Haiku collects source leads, once per artist where possible. Sonnet writes every listing. Opus is used only when evidence conflicts (an uncertain pressing or contradicting sources). Where agents are unavailable, the session model does everything.

## Prices for live listings
From stored sales in the same grade, leaving out junk sales under C$1 or under a third of the median (needs 3, else the price stays). Where the price lands follows the CD's engagement, measured from data: copies listed on eBay now against how fast copies sold (months of supply: 3 or less is high, 12 or more is low). High takes the upper quarter of those sales, normal the median, low the lower quarter, to help it sell. The writer can override it only with evidence, such as a rare collected pressing. Prices go up or down; changes over 50% are flagged. A detail of your copy (Canadian, no barcode...) sets the price with 2 or more matching sales that went higher; with 1 it is shown as pending, applied only if you accept it by name. Nothing is sent until you approve the SKU.

## Limits
- Price caps (Discogs 10%, edition 10%, demand 7%, supply 5%, collector 5%, combined 25%) are untested starting values.
- The app's sold prices can include Best Offer sales at the asking price.
- Item prices assume the shipping amount the app reports.
- Tests use simulated responses; the live flow is first tried in a 5-CD trial.
- Each SoldComps lookup uses your allowance; stored results are reused instead, and never expire (their date is shown).
- The usage stop relies on the percentages you type; the plugin cannot read them. The chat itself uses some usage even when it stops.
- Each run saves price data (no key) in a temporary folder readable only by your user.
- Token savings are estimated from simulated price data; real use has not been measured.

## Test
From this folder: `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests`

## Credit
Listing structure adapted from the free eBay Listing Generator scaffold by Halil İbrahim Tütüncü.
