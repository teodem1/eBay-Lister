---
name: optimise-listing
description: Use when the user runs /optimise-listing or asks to optimise, write or price an eBay CD listing - title, description, item specifics and quick, fair and patient prices from e-bay-lister, Discogs and collector research.
---

# Optimise an eBay CD listing

Produce a ready-to-paste listing and an evidenced price for ONE CD. Never publish, revise or send anything to eBay, and never change the app.

Scripts live in `${CLAUDE_SKILL_DIR}/`. Each reads JSON on stdin. Pass JSON through a quoted heredoc or a file, never by pasting user text into a command line.

## 0. Plan usage
Before anything else, ask for the two percentages shown in Settings > Usage (five-hour and weekly) unless given in this chat within the last 5 CDs. Run `scripts/gate.py` with `{"five_hour": 0, "weekly": 0}` using their figures. When `go` is false, show `reason` and stop: no lookups, no agents. Ask again after every 5 CDs. Never guess a percentage. Remind them once to keep usage credits off, so nothing is charged beyond the plan.
Never call the app's Claude features (`/api/listing/generate`, `/api/listing/refresh/preview`, `/api/lookup/cover`, `/api/lookup/shelf`, `/api/lookup/photo`): they spend API credits.

## 1. Intake
Collect from the message, photos or an existing draft:
- artist, album, barcode, catalogue number, matrix code, label, year, pressing country, edition, disc count
- disc and inlay grades (Mint, Near mint, Very good+, Very good, Good, Fair, Poor; inlay may be Missing), case, sealed, tested, defects
- whether bought in Canada; any group posts the user pastes

Ask ONE question only if the pressing cannot be identified or the condition is unknown. Never infer a grade.

## 2. Prices
Condition code from the weaker of disc and inlay: sealed=NEW; Mint/Near mint=LIKE_NEW; Very good+/Very good=USED_VERY_GOOD; Good (or missing inlay)=USED_GOOD; Fair/Poor=USED_ACCEPTABLE.

Run `scripts/app_client.py` with `{"keywords": "Artist Album", "barcode": "...", "condition": "..."}`. One run per CD: each spends the SoldComps allowance. Report every entry in `problems`.

It prints a headline (suggested prices, counts, Discogs, `problems`) and two paths: `data_file` for the pricing script and `listings_file`, one line per compared copy, for whoever researches the CD. Never open `data_file`. Open `listings_file` only if you do that work yourself.

Exit code 2: show its message and ask for a paste or screenshot of the app's price screen. Rebuild only what is visible, in this shape, then continue:
`{"sold": {"suggestion": {"currency", "confidence", "usedCount", "itemPrice": {"quickSale", "recommended", "high"}}, "comparables": {"items": [{"title", "price": {"value"}}]}}, "current": null}`
Fill `current` in the same shape when the current-listings panel is visible. If a count or any of the three prices is not visible, set that side to null.
Never request, display or store the access key.

## 2b. Worth researching?
Run `scripts/gate.py` with `{"data_file": "<path from step 2>", "edition": "<edition from intake, or none>", "bought_in_canada": false}`; send true only when intake says the copy was bought in Canada. `edition` is one of `none|canadian|no_barcode|early_press|promo|club|limited|japan`, never free text. If gate.py fails, stop and show its message. After a screenshot fallback send `"prices"` instead of `"data_file"`, with the visible sold titles and prices in `comparables`.
When `go` is false, reply with the app's prices, `evidence` and "not worth deeper research" (under C$40 even a 25% adjustment gains less than C$10), then stop: no agents, no web search. Continue only if they then ask for this CD anyway.

## 3. Model routing
Delegate as below using this repository's agents. Give each agent all facts it needs; it sees nothing else. Scripts do the arithmetic, so never spend a model on it. Give the writer or appraiser the headline and the `listings_file` path; never paste its rows into a prompt. After a screenshot fallback there is no file, so pass the rebuilt figures. Read the guides yourself only when you do that work yourself.

Agents cannot see photos pasted in chat. Read them yourself first and pass what you read as text: barcode digits, catalogue number, matrix code, label, "whole back cover visible: yes/no", "barcode printed: yes/no", visible defects (for the open checks only, never as seller condition). Pass image paths only when the files exist on disk.
Pass the writer or appraiser both guide paths, expanded: `${CLAUDE_SKILL_DIR}/references/listing-rules.md` and `${CLAUDE_SKILL_DIR}/references/collector-research.md`.

| Work | Agent | Model | When |
|---|---|---|---|
| Find candidate collector and pressing sources | `source-collector` | Haiku | every CD, once |
| Verify sources, propose signals, write the listing | `listing-writer` | Sonnet | standard CD |
| Same work, deeper judgment | `collector-appraiser` | Opus | any trigger below |

Opus triggers: special or rare edition; pressing uncertain or evidence conflicting; fewer than 8 sold copies; fair (or recommended) app price of 25 CAD or more. Check them against the intake and headline before dispatching, and use Opus INSTEAD of Sonnet. Only if `listing-writer` reports an uncertain pressing or conflicting evidence, send the case to `collector-appraiser` once, with the writer's findings and opened sources so they are not searched again.

If subagents are unavailable, do the work in this session and say which model split did not apply.

## 4. Research and signals
Follow `references/collector-research.md`. Haiku output is a lead list, not evidence: the writer or appraiser opens each source before using it.

## 5. Price
Run `scripts/pricing.py` with `{"data_file": "<path from step 2>", "grade": "<weaker grade; Mint if sealed>", "signals": [...], "edition": "<none|canadian|no_barcode|early_press|promo|club|limited|japan>"}`.
Use `canadian` only when the copy was bought in Canada and Canadian-titled sold copies went higher. Use `no_barcode` only when the whole back cover shows none. After a screenshot fallback, send `"prices"` and `"discogs"` instead of `"data_file"`. The script's numbers are final.
If the result has no `reference.edition`, remove any "Canadian Version" phrase from the title extras, item specifics and description, and list it under open checks. "Rare No Barcode" depends on the back cover, not on this.

## 6. Title and text
Follow `references/listing-rules.md`. Build graded or sealed titles ONLY with `scripts/title.py`:
`{"album": "Artist Album", "disc": "...", "booklet": "...", "sealed": false, "discs": 1, "extras": ["edition||shorter form", "year", "label"]}`
If `fits` is false, shorten the album name yourself (subtitle first) and rerun. Report `dropped` terms.

## 7. Accuracy gate
Before replying, check every claim in title, specifics and description against the intake or an opened source. Remove or mark `NEEDS CONFIRMATION` anything else. Confirm no grade, extra or accessory was added.

## 8. Reply
1. Title with character count
2. Prices (quick, fair, patient), confidence, currency, assumed shipping, and a table of adjustments with sources. When `prices` is null, write "No price: not enough comparable copies" and show `reference` as separately labelled figures with their sources. Never fill the three price tiers yourself.
3. Item specifics
4. Description as HTML in one code block
5. Photo order
6. Before/after scorecard when a draft existed: search terms, collector hook, completeness, accuracy (state what changed; no invented percentages or engagement promises)
7. Open checks (at most 4), problems, and which models were used
