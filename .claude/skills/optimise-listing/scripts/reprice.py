"""A listing's price from its stored same-grade sales (CAD item prices).

    reprice(current, items, details, demand="normal")
      current: the listing's price now (None when it has none)
      items:   the same-grade sold sales (the stored lookup's `filtered.sameGrade`)
      details: edition names confirmed on the seller's copy (by the listing or the seller)
      demand:  how much interest the CD draws, set by the writer with evidence:
               high (collected artist or pressing, sought-after edition), low (common,
               recent, widely available), normal otherwise

Penny sales (under C$1) and sales under a third of the median are left out as junk. Needs 3 CAD sales, else the price stays. Where the price lands in those sales follows
demand: high = 75th percentile, normal = median, low = 25th percentile (to help it sell).
A price may go up or down; a lowered price is listed at target / 0.85, so a typical Best Offer
lands on the target (`target` is the sales-based price). Changes over 50% either way are flagged,
and nothing is sent without the seller's approval. A confirmed detail counts when its sales' median is above
the other sales' median: 2 or more such sales set the price when higher (several details:
the highest, never added together); exactly 1 is only `pending`, applied when the seller
accepts it by name. No detail raises a price without 3 sales.
"""
import json
import re
import statistics
import sys

from pricing import EDITIONS

MIN_BASE = 3
MIN_SALE = 1.0
OFFER_SHARE = 0.85
HIGH_MONTHS = 3
LOW_MONTHS = 12
SPAN_MIN_DAYS = 30
SPAN_NO_DATES = 365
DEMAND = {"low": 0, "normal": 1, "high": 2}  # index into the quartiles
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


def _sane(sales):
    """Leaves out penny sales (under C$1) and sales under a third of the median: junk, not prices."""
    kept = [(t, v) for t, v in sales if v >= MIN_SALE]
    if kept:
        floor = statistics.median([v for _, v in kept]) / 3
        kept = [(t, v) for t, v in kept if v >= floor]
    return kept, len(sales) - len(kept)


def engagement_level(sales, saved_at, listed, capped=False):
    """Engagement from data: copies listed now against how fast copies sold.

    sales: the CD's sold copies (any grade), each with `soldDate`; saved_at: when they were saved.
    The pace covers the oldest sale to saved_at (at least 30 days; a year when no dates).
    Months of supply = listed / sales per month: 3 or less is high, 12 or more is low.
    """
    from datetime import datetime
    end = datetime.fromisoformat(saved_at.replace("Z", "+00:00")).date()
    dates = [datetime.fromisoformat(d["soldDate"][:10]).date() for d in sales if d.get("soldDate")]
    days = max(SPAN_MIN_DAYS, (end - min(dates)).days) if dates else SPAN_NO_DATES
    sold = len(sales)
    per_month = sold / (days / 30)
    supply = round(listed / per_month, 1) if per_month else None
    if sold == 0:
        level = "low" if listed else "normal"
    elif supply <= HIGH_MONTHS:
        level = "high"
    elif supply >= LOW_MONTHS:
        level = "low"
    else:
        level = "normal"
    shown = f"{listed}{' or more' if capped else ''}"
    reason = (f"{sold} sold in {days} days, {shown} listed now"
              + (f": {supply:g} months of supply" if supply is not None else "") + f", so {level} engagement.")
    return {"level": level, "sold": sold, "listed": listed, "capped": capped, "days": days,
            "months_of_supply": supply, "reason": reason}


def _money(value):
    return f"C${value:.2f}"


def reprice(current, items, details, demand="normal"):
    if demand not in DEMAND:
        raise ValueError(f"Unknown demand: {demand!r}. Use high, normal or low.")
    unknown = [d for d in details if d not in EDITIONS]
    if unknown:
        raise ValueError(f"Unknown detail: {', '.join(unknown)}")
    sales, left_out = _sane(_cad(items))
    values = [v for _, v in sales]
    base = round(statistics.median(values), 2) if len(values) >= MIN_BASE else None
    target = (round(statistics.quantiles(values, n=4, method="inclusive")[DEMAND[demand]], 2)
              if base is not None else None)
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
    else:
        where = {"low": "lower quarter", "normal": "median", "high": "upper quarter"}[demand]
        reason = (f"{len(values)} sales in this grade, median {_money(base)}; {demand} interest, "
                  f"so the {where}: {_money(target)}.")
        proposed = target
        if applied and applied[1] > target:
            proposed = applied[1]
            reason += f" {applied[2]} {LABEL[applied[0]]} sales, median {_money(applied[1])}, set it higher."
        else:
            applied = None
    # Best Offer: buyers offer below the listed price, so a lowered price leaves room for a typical
    # 85% offer to land on the sales-based target (seller, 2026-11-28). Raises stay as they are.
    target = proposed
    if current is not None and proposed is not None and proposed < current:
        proposed = min(round(float(current), 2), round(target / OFFER_SHARE, 2))
        reason += (f" Listed at {_money(proposed)} so a typical offer ({OFFER_SHARE:.0%}) lands near the "
                   f"{_money(target)} the sales support.")
    if left_out:
        reason += f" {left_out} sale{'s' if left_out != 1 else ''} under C$1 or under a third of the median left out."
    if pending and (proposed is None or pending[1] <= proposed):
        pending = None
    over_50 = bool(current and proposed is not None and abs(proposed - current) / current > FLAG_CHANGE)
    return {"base": base, "count": len(values), "proposed": proposed,
            "applied_detail": applied[0] if applied else None,
            "pending": {"detail": pending[0], "price": pending[1]} if pending else None,
            "demand": demand,
            "target": target,
            "over_50": over_50, "reason": reason}


if __name__ == "__main__":
    # stdin {"current", "data_file" (a listings.py sold file) | "items", "details", "demand"}
    try:
        data = json.load(sys.stdin)
        items = data.get("items")
        if items is None:
            with open(data["data_file"], encoding="utf-8") as handle:
                stored = json.load(handle)
            keep = set(stored["filtered"]["sameGrade"])
            items = [i for i in stored["lookup"]["queries"][-1]["items"] if i.get("itemId") in keep]
        print(json.dumps(reprice(data.get("current"), items, data.get("details") or [],
                                 demand=data.get("demand") or "normal")))
    except (ValueError, KeyError, TypeError, IndexError, OSError) as err:
        sys.exit(f"reprice.py: {err}")
