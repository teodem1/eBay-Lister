"""Whether to spend plan usage on a CD. Reads JSON on stdin.

{"five_hour": 40, "weekly": 55}  -> stop when either limit is 80% used or more.
{"price": 24.99}  -> web research only when the listing's asking price (CAD) is 20 or more.
Below that, the listing and its stored sales are the only sources.
"""
import json
import math
import sys

USAGE_STOP = 80
RESEARCH_MIN_CAD = 20


def usage_gate(five_hour, weekly):
    for value in (five_hour, weekly):
        if (isinstance(value, bool) or not isinstance(value, (int, float))
                or not math.isfinite(value) or not 0 <= value <= 100):
            raise ValueError("Give both usage percentages, each from 0 to 100.")
    go = five_hour < USAGE_STOP and weekly < USAGE_STOP
    state = "below" if go else "at or above"
    return {"go": go, "reason": f"Plan usage {five_hour}% (five-hour) and {weekly}% (weekly): {state} the {USAGE_STOP}% stop."}


def research_needed(price):
    """True when the asking price is a real number of C$20 or more."""
    if isinstance(price, bool) or not isinstance(price, (int, float)) or not math.isfinite(price):
        return False
    return price >= RESEARCH_MIN_CAD


if __name__ == "__main__":
    try:
        data = json.load(sys.stdin)
        if "five_hour" in data or "weekly" in data:
            result = usage_gate(data.get("five_hour"), data.get("weekly"))
        else:
            price = data["price"]
            result = {"research": research_needed(price), "price": price}
        print(json.dumps(result))
    except (ValueError, KeyError, TypeError, AttributeError, OSError) as err:
        sys.exit(f"gate.py: {err}")
