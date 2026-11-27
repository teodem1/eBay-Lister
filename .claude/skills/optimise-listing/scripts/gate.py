"""Whether to spend plan usage on a CD. Reads JSON on stdin.

{"five_hour": 40, "weekly": 55}  -> stop when either limit is 80% used or more.
{"data_file" | "prices", "edition", "bought_in_canada"} -> research only when the
sold price is 40 CAD or more: adjustments are capped at 25%, so a cheaper CD
cannot gain 10 CAD. Same test as the app's src/lib/pricing/research.ts.
"""
import json
import math
import sys

from pricing import EDITIONS, MIN_SALES, edition_price

USAGE_STOP = 80
RESEARCH_MIN_CAD = 40


def usage_gate(five_hour, weekly):
    for value in (five_hour, weekly):
        if (isinstance(value, bool) or not isinstance(value, (int, float))
                or not math.isfinite(value) or not 0 <= value <= 100):
            raise ValueError("Give both usage percentages, each from 0 to 100.")
    go = five_hour < USAGE_STOP and weekly < USAGE_STOP
    state = "below" if go else "at or above"
    return {"go": go, "reason": f"Plan usage {five_hour}% (five-hour) and {weekly}% (weekly): {state} the {USAGE_STOP}% stop."}


def research_gate(prices, edition, bought_in_canada):
    sold = prices.get("sold") or {}
    suggestion = sold.get("suggestion") or {}
    count = suggestion.get("usedCount") or 0
    typical = (suggestion.get("itemPrice") or {}).get("recommended")
    if suggestion.get("currency") != "CAD" or count < MIN_SALES or not typical:
        return {"go": False, "price": None, "evidence": f"Fewer than {MIN_SALES} sold copies in CAD."}
    price, evidence = typical, f"{count} sales, typical C${typical:.2f}"
    items = [i for i in (sold.get("comparables") or {}).get("items", [])
             if (i.get("price") or {}).get("currency") == "CAD"]
    stated = edition if edition in EDITIONS else None  # free text or "none": the typical price decides
    editions = [stated, "canadian" if bought_in_canada else None]
    for name in dict.fromkeys(filter(None, editions)):
        found = edition_price(items, name)
        # Every copy matching means the word is in the album's name, not an edition.
        if found and MIN_SALES <= found["count"] < len(items) and found["price"] > price:
            price = found["price"]
            evidence = f"{found['count']} {name} sales, typical C${price:.2f}"
    return {"go": price >= RESEARCH_MIN_CAD, "price": price, "evidence": evidence}


if __name__ == "__main__":
    try:
        data = json.load(sys.stdin)
        if "five_hour" in data or "weekly" in data:
            result = usage_gate(data.get("five_hour"), data.get("weekly"))
        else:
            if data.get("data_file"):
                with open(data["data_file"], encoding="utf-8") as handle:
                    data["prices"] = json.load(handle)["prices"]
            result = research_gate(data["prices"], data.get("edition"), bool(data.get("bought_in_canada")))
        print(json.dumps(result))
    except (ValueError, KeyError, TypeError, AttributeError, OSError) as err:
        sys.exit(f"gate.py: {err}")
