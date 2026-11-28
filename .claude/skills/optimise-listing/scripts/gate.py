"""Whether to spend plan usage on a CD. Reads JSON on stdin.

{"five_hour": 40, "weekly": 55}  -> stop when either limit is 80% used or more.
{"five_hour": 40, "weekly": 55, "cds": 20}  -> also `batch`: how many CDs fit before the stop.
{"price": 24.99}  -> web research only when the listing's asking price (CAD) is 20 or more.
Below that, the listing and its stored sales are the only sources.
"""
import json
import math
import sys

USAGE_STOP = 80
RESEARCH_MIN_CAD = 20
# Cost per CD from the 5-CD trial (2026-11-28): +5 five-hour and +1 weekly points for 5 CDs.
FIVE_HOUR_PER_CD = 1.0
WEEKLY_PER_CD = 0.2


def _fits(used, per_cd, wanted):
    """How many CDs fit before `used` reaches the stop, at most `wanted`."""
    n = min(wanted, int((USAGE_STOP - used) / per_cd) + 1)
    while n > 0 and used + n * per_cd >= USAGE_STOP - 1e-9:
        n -= 1
    return max(n, 0)


def usage_gate(five_hour, weekly, cds=None):
    """With `cds` (the batch size wanted), also says how many CDs fit before either limit
    would reach the stop, from the trial's cost per CD; `batch` is that number."""
    for value in (five_hour, weekly):
        if (isinstance(value, bool) or not isinstance(value, (int, float))
                or not math.isfinite(value) or not 0 <= value <= 100):
            raise ValueError("Give both usage percentages, each from 0 to 100.")
    usage = f"Plan usage {five_hour}% (five-hour) and {weekly}% (weekly)"
    if cds is None:
        go = five_hour < USAGE_STOP and weekly < USAGE_STOP
        state = "below" if go else "at or above"
        return {"go": go, "reason": f"{usage}: {state} the {USAGE_STOP}% stop."}
    if isinstance(cds, bool) or not isinstance(cds, int) or cds < 1:
        raise ValueError("cds must be a whole number of CDs, 1 or more.")
    batch = min(_fits(five_hour, FIVE_HOUR_PER_CD, cds), _fits(weekly, WEEKLY_PER_CD, cds))
    if batch == 0:
        reason = f"{usage}: even one more CD would reach the {USAGE_STOP}% stop."
    elif batch < cds:
        reason = (f"{usage}: {batch} CDs fit before the {USAGE_STOP}% stop (about {FIVE_HOUR_PER_CD:g} five-hour "
                  f"and {WEEKLY_PER_CD:g} weekly points per CD), so this batch is {batch}, not {cds}.")
    else:
        reason = f"{usage}: a batch of {cds} fits under the {USAGE_STOP}% stop."
    return {"go": batch > 0, "batch": batch, "reason": reason}


def research_needed(price):
    """True when the asking price is a real number of C$20 or more."""
    if isinstance(price, bool) or not isinstance(price, (int, float)) or not math.isfinite(price):
        return False
    return price >= RESEARCH_MIN_CAD


if __name__ == "__main__":
    try:
        data = json.load(sys.stdin)
        if "five_hour" in data or "weekly" in data:
            result = usage_gate(data.get("five_hour"), data.get("weekly"), data.get("cds"))
        else:
            price = data["price"]
            result = {"research": research_needed(price), "price": price}
        print(json.dumps(result))
    except (ValueError, KeyError, TypeError, AttributeError, OSError) as err:
        sys.exit(f"gate.py: {err}")
