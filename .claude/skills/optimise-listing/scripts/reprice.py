"""A listing's price from its stored same-grade sales (CAD item prices).

    reprice(current, items, details)
      current: the listing's price now (None when it has none)
      items:   the same-grade sold sales (the stored lookup's `filtered.sameGrade`)
      details: edition names confirmed on the seller's copy (by the listing or the seller)

Base: the median of the CAD sales; needs 3, else the price stays. A confirmed detail
counts when its sales' median is above the other sales' median: 2 or more such sales
set the price (several details: the highest, never added together); exactly 1 is only
`pending`, applied when the seller accepts it by name. No cap: changes over 50% either
way are flagged. No detail raises a price without a base.
"""
import json
import re
import statistics
import sys

from pricing import EDITIONS

MIN_BASE = 3
MIN_DETAIL = 2
FLAG_CHANGE = 0.5
LABEL = {"canadian": "Canadian", "no_barcode": "no-barcode", "early_press": "early press", "promo": "promo",
         "club": "club edition", "limited": "limited edition", "japan": "Japan"}


def _cad(items):
    out = []
    for item in items or []:
        price = (item or {}).get("price") or {}
        value = price.get("value")
        if price.get("currency") == "CAD" and isinstance(value, (int, float)) and value > 0:
            out.append((item.get("title") or "", float(value)))
    return out


def _money(value):
    return f"C${value:.2f}"


def reprice(current, items, details, keep_if_lower=False):
    """keep_if_lower: the sales came from a shortened-name search; buyers search the full name,
    so the price is never lowered on them (it may still go up)."""
    unknown = [d for d in details if d not in EDITIONS]
    if unknown:
        raise ValueError(f"Unknown detail: {', '.join(unknown)}")
    sales = _cad(items)
    values = [v for _, v in sales]
    base = round(statistics.median(values), 2) if len(values) >= MIN_BASE else None
    applied, pending = None, None
    if base is not None:
        for name in dict.fromkeys(details):
            same = [v for t, v in sales if re.search(EDITIONS[name], t, re.I)]
            others = [v for t, v in sales if not re.search(EDITIONS[name], t, re.I)]
            # Every sale matching: the word is in the album's name, not a detail of this copy.
            if not same or not others:
                continue
            price = round(statistics.median(same), 2)
            if price <= statistics.median(others):
                continue
            if len(same) >= MIN_DETAIL:
                if not applied or price > applied[1]:
                    applied = (name, price, len(same))
            elif not pending or price > pending[1]:
                pending = (name, price)

    if current is None:
        proposed, reason = None, "The listing has no price."
    elif base is None:
        proposed = round(float(current), 2)
        reason = f"Only {len(values)} CAD sale{'s' if len(values) != 1 else ''} in this grade: price kept."
    elif applied:
        proposed = applied[1]
        reason = (f"{applied[2]} {LABEL[applied[0]]} sales, median {_money(applied[1])} "
                  f"(all {len(values)} sales: {_money(base)}).")
    else:
        proposed, reason = base, f"{len(values)} sales in this grade, median {_money(base)}."
    lower = None
    if keep_if_lower and current is not None and proposed is not None and proposed < current:
        reason = (f"{reason} Those sales came from a short name search and went lower, so the price stays at "
                  f"{_money(float(current))} (buyers search the full name); {_money(proposed)} is offered "
                  f"as `lower`, sent only if the seller accepts it.")
        lower = {"price": proposed, "over_50": abs(proposed - current) / current > FLAG_CHANGE}
        proposed, applied = round(float(current), 2), None
    if pending and (proposed is None or pending[1] <= proposed):
        pending = None
    over_50 = bool(current and proposed is not None and abs(proposed - current) / current > FLAG_CHANGE)
    return {"base": base, "count": len(values), "proposed": proposed,
            "applied_detail": applied[0] if applied else None,
            "pending": {"detail": pending[0], "price": pending[1]} if pending else None,
            "lower": lower,
            "over_50": over_50, "reason": reason}


if __name__ == "__main__":
    # stdin {"current", "data_file" (a listings.py sold file) | "items", "details"}
    try:
        data = json.load(sys.stdin)
        items = data.get("items")
        if items is None:
            with open(data["data_file"], encoding="utf-8") as handle:
                stored = json.load(handle)
            keep = set(stored["filtered"]["sameGrade"])
            items = [i for i in stored["lookup"]["queries"][-1]["items"] if i.get("itemId") in keep]
        print(json.dumps(reprice(data.get("current"), items, data.get("details") or [],
                                 keep_if_lower=bool(data.get("keep_if_lower")))))
    except (ValueError, KeyError, TypeError, IndexError, OSError) as err:
        sys.exit(f"reprice.py: {err}")
