# optimise-listing

`/optimise-listing` writes and prices one eBay CD listing. It reads price data from your e-bay-lister app and publishes nothing.
Use the plain `/optimise-listing`, not an `ebay-cd-optimiser:` entry from the account plugin, which is an older copy.

## Install
Nothing to install: this folder and `.claude/agents/` are part of the eBay Lister repository, so a normal Claude Code cloud session on it loads them (not a thread inside a Claude Code project). Not yet confirmed here; plan Task 0 checks it.

## Use
`/optimise-listing Pink Floyd, The Dark Side of the Moon, barcode ..., disc Near mint, inlay Very good+, bought in Canada` (add photos if you have them).

## What it spends
- Asks for your five-hour and weekly percentages (Settings > Usage) and stops at 80% of either; asks again every 5 CDs.
- Researches only CDs whose sold price is C$40 or more (3+ CAD sales; a special or Canadian edition counts with 3+ sales). Others get the figures and stop, unless you ask for that CD anyway.
- Never calls the app's Claude features, so no API credits. Keep usage credits off to avoid charges beyond your plan.

## Settings (where Claude runs; never in chat)
| Name | Value |
|---|---|
| `ELISTER_URL` | The app's https address |
| `ELISTER_ACCESS_KEY` | Leave unset in a cloud session: a network secret sends the app's `APP_ACCESS_KEY` as the `x-elister-key` header. Only a setup without network secrets uses this variable |

Without a working connection the skill asks for a paste or screenshot of the app's price screen. Python 3 is required for the scripts.

## Model routing
Haiku collects source leads. Sonnet handles standard CDs. Opus replaces Sonnet for special editions, uncertain or conflicting evidence, fewer than 8 sales, or prices of 25 CAD or more. Where agents are unavailable, the session model does everything.

## Limits
- Price caps (Discogs 10%, edition 10%, demand 7%, supply 5%, collector 5%, combined 25%) are untested starting values.
- The app's sold prices can include Best Offer sales at the asking price.
- Item prices assume the shipping amount the app reports.
- Not yet tested against the live app; tests use simulated responses.
- Each price check uses your SoldComps allowance, including for CDs then judged not worth researching.
- The usage stop relies on the percentages you type; the plugin cannot read them. The chat itself uses some usage even when it stops.
- Each run saves price data (no key) in a temporary folder readable only by your user.
- Token savings are estimated from simulated price data; real use has not been measured.

## Test
From this folder: `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests`

## Credit
Listing structure adapted from the free eBay Listing Generator scaffold by Halil İbrahim Tütüncü.
