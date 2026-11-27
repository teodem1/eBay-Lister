"""Applies capped, evidenced adjustments to e-bay-lister price suggestions.

Reads JSON on stdin ({data_file | prices + discogs, grade, signals, edition}) and prints a report.
"""
import json
import math
import re
import statistics
import sys

CAPS = {"discogs": 10, "edition": 10, "demand": 7, "supply": 5, "collector": 5}
COMBINED_CAP = 25
MIN_SALES = 3
TIERS = {"quick": "quickSale", "fair": "recommended", "patient": "high"}
# Copied from the app's src/lib/pricing/edition.ts.
EDITIONS = {
    "canadian": r"\b(canad(a|ian)|cdn)\b",
    "no_barcode": r"\bno[\s-]*(upc|bar[\s-]*code)\b|\bbarcode[\s-]*less\b|\bwithout (a )?(upc|bar[\s-]*code)\b",
    "early_press": r"\b(early|first|1st|original|orig\.?) (press(ing)?|issue|edition)\b|\btarget cd\b|\bwest germany\b",
    "promo": r"\bpromo(tional)?\b",
    "club": r"\b(club edition|record club|music club|bmg (direct|music service|club)|columbia house|crc)\b",
    "limited": r"\b(limited|ltd\.?|numbered)( edition)?\b",
    "japan": r"\bjapan(ese)?\b|\bobi\b",
}
DISCOGS_CONDITION = {
    "mint": "Mint (M)", "near mint": "Near Mint (NM or M-)", "very good+": "Very Good Plus (VG+)",
    "very good": "Very Good (VG)", "good": "Good (G)", "fair": "Fair (F)", "poor": "Poor (P)",
}


def edition_price(items, edition):
    """Median of sold copies titled as the edition, only when above the other copies."""
    if not edition or edition == "none":
        return None
    if edition not in EDITIONS:
        raise ValueError(f"Unknown edition: {edition}")
    same, others = [], []
    for item in items:
        value = (item.get("price") or {}).get("value") or 0
        if value > 0:
            match = re.search(EDITIONS[edition], item.get("title", ""), re.I)
            (same if match else others).append(value)
    if not same:
        return None
    price = round(statistics.median(same), 2)
    if others and price <= statistics.median(others):
        return None
    return {"price": price, "count": len(same)}


def charm(value):
    """The app's charmPrice (suggestPrice.ts): ends a price in .99."""
    if value < 1:
        return value
    whole = math.floor(value)
    return whole + 0.99 if value - whole >= 0.5 else max(0.99, whole - 1 + 0.99)


def _complete(suggestion):
    tiers = (suggestion or {}).get("itemPrice") or {}
    return bool(suggestion and suggestion.get("currency")
                and all(isinstance(tiers.get(key), (int, float)) for key in TIERS.values()))


def _supported(signal):
    evidence = [e for e in signal.get("evidence", []) if e.get("source")]
    if signal["name"] != "collector":
        return bool(evidence)
    dated = [e for e in evidence if e.get("date")]
    return len({(e.get("url") or e["source"]) for e in dated}) >= 2


def price_report(prices, discogs_price, discogs_currency, signals, edition):
    sold = (prices.get("sold") or {}).get("suggestion")
    current = (prices.get("current") or {}).get("suggestion")
    notes = []
    if sold and not _complete(sold):
        notes.append("Sold figures are incomplete and were ignored.")
        sold = None
    if current and not _complete(current):
        notes.append("Current figures are incomplete and were ignored.")
        current = None
    if sold and sold.get("usedCount", 0) > 0:
        basis, base = "sold", sold
    elif current and current.get("usedCount", 0) > 0:
        basis, base = "current", current
    else:
        basis, base = "none", None

    usable_discogs = discogs_price
    foreign = bool(base and discogs_price and discogs_currency != base["currency"])
    if foreign:
        usable_discogs = None
        notes.append(f"Discogs price is in {discogs_currency}, not {base['currency']}: "
                     "left out of the adjustments and price limits.")
    items = ((prices.get("sold") or {}).get("comparables") or {}).get("items", [])
    special = edition_price(items, edition)
    thin = base is None or base.get("usedCount", 0) < MIN_SALES

    adjustments, seen = [], set()
    for signal in signals:
        name, pct = signal.get("name"), signal.get("pct")
        if name not in CAPS or name in seen:
            raise ValueError(f"Unknown or repeated signal: {name}")
        if not isinstance(pct, (int, float)) or not math.isfinite(pct):
            raise ValueError(f"Signal {name} needs a number for pct")
        seen.add(name)
        applied, reason = max(-CAPS[name], min(CAPS[name], pct)), "applied"
        if thin:
            applied, reason = 0, "fewer than 3 comparable copies"
        elif not _supported(signal):
            applied, reason = 0, "not enough evidence"
        elif name == "discogs" and not usable_discogs:
            applied, reason = 0, "different currency" if foreign else "no Discogs price for this grade"
        elif name == "supply" and basis == "current":
            applied, reason = 0, "asking prices are already the base"
        elif name == "edition" and special:
            applied, reason = 0, "edition sold price already used"
        adjustments.append({"name": name, "proposed_pct": pct, "applied_pct": applied,
                            "reason": reason, "evidence": signal.get("evidence", [])})

    total = max(-COMBINED_CAP, min(COMBINED_CAP, sum(a["applied_pct"] for a in adjustments)))
    result = None
    if not thin:
        low = max(0.99, base["itemPrice"]["quickSale"] * 0.85)
        high = max(low, base["itemPrice"]["high"] * 1.15, (usable_discogs or 0) * 1.15)
        result = {}
        for tier, key in TIERS.items():
            value = base["itemPrice"][key]
            if total:
                # The ending may not reverse the adjustment or carry it past the combined cap.
                ended = charm(value * (1 + total / 100))
                floor, ceiling = ((value, value * (1 + COMBINED_CAP / 100)) if total > 0
                                  else (value * (1 - COMBINED_CAP / 100), value))
                value = min(ceiling, max(floor, ended))
            value = min(high, max(low, value))
            if special:
                value = max(value, special["price"])
            result[tier] = round(value, 2)
        if special:
            notes.append(f"Edition price {special['price']:.2f} from {special['count']} sold copies sets the minimum.")
    else:
        notes.append("Not enough comparable copies for a price. Do not state a price; show the reference figures with their sources.")
    if basis == "current":
        notes.append("No sold copies: based on asking prices.")
    if basis == "sold":
        notes.append("Sold prices may include Best Offer sales shown at the asking price, so they can run high.")

    reference = {}
    if sold:
        reference["sold"] = sold
    if current:
        reference["current"] = current
    if discogs_price:
        reference["discogs"] = {"price": discogs_price, "currency": discogs_currency}
    if special:
        reference["edition"] = special
    confidence = "low" if thin or basis != "sold" else base.get("confidence", "low")
    return {"basis": basis, "confidence": confidence, "currency": base["currency"] if base else None,
            "prices": result, "adjustments": adjustments, "total_pct": total,
            "reference": reference, "notes": notes}


if __name__ == "__main__":
    try:
        data = json.load(sys.stdin)
        if data.get("data_file"):
            with open(data["data_file"], encoding="utf-8") as handle:
                saved = json.load(handle)
            data.update(prices=saved["prices"], discogs=saved.get("discogs"))
        discogs = data.get("discogs") or {}
        given = (data.get("grade") or "").strip().lower()
        given = "good" if given == "missing" else given  # the app counts a missing inlay as Good
        if given and given not in DISCOGS_CONDITION:
            raise ValueError(f"Unknown grade: {data['grade']}")
        grade = DISCOGS_CONDITION.get(given)
        print(json.dumps(price_report(
            data["prices"], (discogs.get("suggestions") or {}).get(grade),
            discogs.get("suggestionCurrency"), data.get("signals", []), data.get("edition")), indent=2))
    except (ValueError, KeyError, TypeError, OSError) as err:
        sys.exit(f"pricing.py: {err}")
