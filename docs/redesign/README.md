# eBay Lister redesign: critique and plan

Screens reviewed on current `main` (390×844, light and dark): Scan home, scan results, listing Price step and Compare list, listing Review form and sticky Publish bar, Collection, Edit CD sheet. Mock data: a CD (Fleetwood Mac, Rumours), since CDs are most of what gets listed.

Skills used: visual-critique:critique-screen (all seven lenses), ui-design:color-palette, ui-design:type-system, ui-design:platform-audit, interaction-design:navigation-patterns.

## 1. Critique (prioritised fix list)

### P1, critical
| Issue | Dimension | Fix |
|---|---|---|
| `--subtle` #8a929e on white is 3.1:1, used for hints, "(optional)", "estimate", "Searched eBay for…" | Colour | New neutral scale, subtle text at 4.7:1 or better in both themes |
| 10–11px text (price "Use" label 10px, Compare meta 11px, "estimate" 11px) | Typography | 12px floor via a type scale; nothing smaller than `caption` |
| Sticky Publish bar stacks 3 rows (guess warning, "Happy with the details? / Add to Collection", Publish), about 22% of the screen, and hides the field being edited | Hierarchy / Density | One row: Collection button + Publish. Guess count moves onto the Review heading |
| Solid teal means "primary button", "selected price tile" and "selected filter chip" at once, so the eye can't tell what to press | Colour / Affordance | Selected = tinted fill + 2px brand outline + check mark. Solid teal is only for the one primary action |

### P2, important
| Issue | Dimension | Fix |
|---|---|---|
| For a CD seller the barcode is the main path, but "Take photo" is the filled hero | Hierarchy | Barcode scan becomes the full-width hero; photo and typed barcode sit under it |
| "How it works" card stays on the home screen forever | Density | Compact one-line Identify → Price → List strip |
| Barcode result titled "Barcode 0075992731324" even when album, artist and cover are known | Hierarchy | Cover art + album title + artist · year as the heading; barcode is metadata |
| Price card explanation is one long sentence ("18 sales, high confidence. Before shipping; assumes you charge…") | Density | Fact chips (18 sales, High confidence, +$4.50 shipping) and a dot strip showing where each sale sits against the 3 prices |
| "Write it again" stays a big filled button after the draft exists, competing with Publish | Hierarchy | Becomes a secondary button once a draft exists |
| Review form is one card with 12 fields of mixed importance | Density | Grouped cards: Basics, Condition, Shipping, Selling options (Promoted %, Best Offer), Item specifics, Description, Photos |
| Touch targets under 48dp: sort chips (28px), filter chips (36px), price "Use" button (40px) | Affordance / Platform | 44–48px minimum |
| Android back button doesn't close the Edit CD sheet (leaves the screen instead) | Platform | Sheet pushes a history entry; back closes it |

### P3, polish
| Issue | Dimension | Fix |
|---|---|---|
| ▾ ▴ ✕ text glyphs next to SVG icons elsewhere | Brand | Same stroke icon set everywhere |
| Inventory value hero is a heavy solid-teal slab | Composition | Surface card, big number, three stats (CDs, average, unpriced) |
| Back arrow is an iOS chevron | Platform | Material ← arrow |
| Ad hoc sizes (0.9375, 1.0625, 1.75, 2.25rem) | Typography | All text on the scale below |

**Overall:** the strongest dimension is brand consistency: tokens, one teal, dark mode and shared components are already in place. The weakest is visual hierarchy on the listing screen, where the selected state, the primary action and a crowded sticky bar all fight for the same attention.

## 2. Palette (ui-design:color-palette)
Neutrals get a slight teal tint so the brand feels intentional. Every text pair is at least 4.5:1.

| Token | Light | Dark | Use |
|---|---|---|---|
| bg | #f5f6f4 | #0c0f0f | page |
| surface / surface-2 | #ffffff / #eef1ef | #151a19 / #1d2322 | cards / wells |
| fg / muted / subtle | #121716 / #56605e / #636d6b | #ebefee / #a3adab / #8a9492 | text levels |
| brand / brand-ink / brand-soft | #0d6b63 / #0a5a53 / #dff2ee | #34d1bc / #6ee5d3 / #0f2c29 | primary / links / selected fill |
| ok, warn, bad (soft + ink) | kept, ink darkened to ≥ 4.5:1 | kept | status, always with an icon or words, never colour alone |

## 3. Type scale (ui-design:type-system)
Ratio about 1.2, 12px floor, rem-based so Android font scaling works.

| Style | Size / line | Weight | Use |
|---|---|---|---|
| display | 28/34 | 700 | screen headline (home), inventory value |
| title | 20/26 | 650 | result heading, sheet title |
| headline | 17/24 | 600 | card headings |
| body | 16/24 | 400 | fields, list titles |
| small | 14/20 | 400–500 | secondary lines, notices |
| caption | 12/16 | 500 | meta, chips, counters |

## 4. Platform and navigation (ui-design:platform-audit, interaction-design:navigation-patterns)
- Keep the 2-destination bottom navigation bar (Scan, Collection): right pattern for 2–5 top-level places on Android. Active state shown by pill + colour + bold label, not colour alone.
- Listing is a pushed detail screen: top app bar with ← back, no bottom nav. Correct hierarchy, kept.
- Bottom sheet closes on Android back, on the scrim and on ✕.
- 48dp targets on all chips and inline actions; 16px field text (no zoom on focus); safe areas respected.
- Geist stays as the brand face (custom font is an allowed departure); all sizes in rem so system text scaling applies.

## 5. Sober restyle (follow-up)
Guillaume asked for "more sober" colours and a style in line with current UI standards. The teal brand is replaced by a neutral palette: greys do the structure, near-black (white in dark mode) is the single action colour, status colours are desaturated. Shapes are flatter: 1px hairline borders, almost no shadow, 12px radius on buttons and fields (chips stay round), lighter headings with tighter tracking, sentence-case labels instead of uppercase eyebrows.

| Token | Light | Dark |
|---|---|---|
| bg / surface / surface-2 | #f7f7f8 / #ffffff / #f2f2f4 | #0b0b0d / #141417 / #1c1c20 |
| line / line-strong | #e6e6ea / #d2d2d8 | #26262b / #3a3a41 |
| fg / muted / subtle | #0d0d10 / #55555e / #66666f | #f4f4f5 / #a6a6b0 / #8d8d97 |
| brand (action) / brand-soft (selected) | #17171b / #ededf0 | #f4f4f5 / #26262b |

All text pairs are 4.5:1 or better. Screenshots: `sober-*.png` (top row teal, bottom row sober).
