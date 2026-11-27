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

## 5. Sober beige restyle (follow-up)
Guillaume asked for "more sober" colours, a style in line with current UI standards, and beige as the main colour. The teal brand is replaced by warm neutrals with beige as the action colour: primary buttons, the Scan hero and the logo are beige with dark espresso text. Beige is too faint for outlines, so a dark tan (`brand-ink`) marks selected items, focus rings and the price marker. Shapes are flatter: 1px hairline borders, almost no shadow, 12px radius on buttons and fields (chips stay round), lighter headings with tighter tracking, sentence-case labels instead of uppercase eyebrows.

| Token | Light | Dark |
|---|---|---|
| bg / surface / surface-2 | #f6f3ee / #fffdfa / #f0ebe3 | #0f0e0c / #181613 / #211e1a |
| line / line-strong | #e6dfd4 / #d3c9b9 | #2d2924 / #423c34 |
| fg / muted / subtle | #1c1915 / #5c554b / #6b6357 | #f3efe8 / #b0a89b / #978f82 |
| brand (beige) / brand-fg | #d4bf98 / #2a2218 (8.7:1) | #d8c4a0 / #1f1a12 (10.1:1) |
| brand-ink (selected, focus) / brand-soft | #6d5530 / #f1e9da | #e3d2b2 / #2b261e |

All text pairs are 4.5:1 or better. Screenshots: `beige-*.png` (top row teal, bottom row beige).

## Sleek redesign (2026-11-27)

Designed in Sleek (sleek.design, project "eBay Lister") from one brief covering Scan, Listing and Auto, then built
into the app's tokens and components so every screen picks it up. Screenshots: `sleek-light.png`, `sleek-dark.png`.

- Palette: warm off-white page `#f6f2ea`, ivory cards `#fcfaf5` with hairline borders `#e4dccd`, espresso text
  `#2a1f18`. Sand `#e2cfae` (brand) is only for the one main action, with dark text and a `#cdb894` edge. Tan
  `--accent` `#a9824f` outlines selected chips and focus; `brand-ink` `#7a5a2e` is the tan used for text and links.
- Cards and buttons: 12px radius, no shadows. Tab screens open with a large title (`AppBar` without `back`, optional
  `subtitle`); pushed screens keep the sticky bar with a back arrow. Section headings on the listing screen are plain
  titles (no step numbers).
- Bottom navigation: icons scan / list / stack / eye / disc, the active tab is a sand pill with a tan edge.
- Grades: each group is a `.grader` card with its name on a `.grader-tab`; Sealed and Tested are `.switch` rows.
- Scan: full-width "Scan barcode", then "Take photo" and "Type barcode" (opens the barcode field), then "Scan a stack"
  and "Sort a pile" as quiet links. The CD card shows cover, album, artist, year and EAN.
- Listing: the item is a summary card (name, EAN, grades) with "Edit" and "Change grades"; the sticky bar is
  "Add to Collection" and "Publish · $price", side by side.
- Auto: the Pause / Resume bar sits under "Scan a stack" instead of over the tabs; the pile is a `.rail` of cards,
  each with a status dot (icon + word, never colour alone).
