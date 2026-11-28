"""Checks a proposed listing change and applies the approved ones through the app.

    changes.py check   stdin {"items": [{"snapshot" | "snapshot_file", "proposal"}]}
                       -> [{"sku", "problems"}]
    changes.py apply   stdin {"items": [...], "approved": [sku], "accept_pending": [sku], "accept_lower": [sku]}
                       -> [{"sku", "text", "price", "reason"}]

A snapshot is the listing as `listings.py read` saved it. A proposal is
{"sku", "title", "add_aspects", "append_html", "price", "pending_price", "lower_price"}: nothing in it
removes anything. Title, item specifics and description go to /api/listing/refresh/apply
(old specifics plus the additions, old description plus `append_html`, no price);
the price goes alone to /api/listing/update-details by SKU. A listing whose title or
price changed since the snapshot is skipped. Only SKUs in `approved` are sent.
"""
import json
import os
import re
import sys

from app_client import App, AppUnavailable
from title import SHORT, TITLE_MAX

LONG_OF_SHORT = {v.lower(): k for k, v in SHORT.items()}
SUFFIX = re.compile(r"\s*\(([^()]*)\)\s*$")


def _grade_key(text):
    t = " ".join(text.split()).lower()
    if t in SHORT:
        return t
    return LONG_OF_SHORT.get(t)


def grades(title):
    """(title without the grade suffix, grades) — grades is ("sealed",), (disc, inlay) or None."""
    m = SUFFIX.search(title or "")
    if not m:
        return title or "", None
    inner = m.group(1).strip()
    rest = title[:m.start()]
    if inner.lower() == "sealed":
        return rest, ("sealed",)
    labelled = re.fullmatch(r"(?:disc:\s*([^/]+?))?\s*/?\s*(?:inlay:\s*(.+?))?", inner, re.I)
    if labelled and (labelled.group(1) or labelled.group(2)):
        disc = _grade_key(labelled.group(1)) if labelled.group(1) else None
        inlay = _grade_key(labelled.group(2)) if labelled.group(2) else None
        if (labelled.group(1) and not disc) or (labelled.group(2) and not inlay):
            return title, None
        return rest, (disc, inlay)
    short = re.fullmatch(r"([A-Za-z+]+)\s*/\s*([A-Za-z+]+)", inner)
    if short and _grade_key(short.group(1)) and _grade_key(short.group(2)):
        return rest, (_grade_key(short.group(1)), _grade_key(short.group(2)))
    return title, None


def own_grades(snapshot):
    """The listing's grades from its condition text, in the title's form; None when unknown."""
    sc = snapshot.get("sellerCondition") or {}
    if not sc.get("disc"):
        return ("sealed",) if sc.get("condition") == "NEW" else None
    disc = _grade_key(sc["disc"])
    inlay = _grade_key(sc["booklet"]) if sc.get("booklet") else None
    return (disc, inlay) if disc and (inlay or not sc.get("booklet")) else None


def _words(text):
    return set(re.findall(r"[a-z0-9']+", text.lower()))


def _positive(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and value > 0


def check(snapshot, proposal):
    problems = []
    title = proposal.get("title") or ""
    if proposal.get("sku") != snapshot.get("sku"):
        problems.append("The proposal is for another listing.")
    if not title.strip():
        problems.append("The new title is empty.")
    if len(title) > TITLE_MAX:
        problems.append(f"The new title has {len(title)} characters, over {TITLE_MAX}.")
    old_rest, old_grades = grades(snapshot.get("title") or "")
    new_rest, new_grades = grades(title)
    # A title without grades may gain them, only as the listing's own grades (from its condition text).
    adding_own = old_grades is None and new_grades is not None and new_grades == own_grades(snapshot)
    if old_grades != new_grades and not adding_own:
        problems.append("The grades in the title changed; grades and condition never change.")
    missing = sorted(_words(old_rest) - _words(new_rest))
    if missing:
        problems.append(f"The new title drops words the old one has: {', '.join(missing)}.")
    have = {k.strip().lower() for k in (snapshot.get("aspects") or {})}
    for name, values in (proposal.get("add_aspects") or {}).items():
        if name.strip().lower() in have:
            problems.append(f"Item specific {name} already exists; values the listing has are never changed.")
        if not isinstance(values, list) or not values or not all(isinstance(v, str) and v.strip() for v in values):
            problems.append(f"Item specific {name} needs one or more values.")
    if not isinstance(proposal.get("append_html") or "", str):
        problems.append("append_html must be text.")
    for key in ("price", "pending_price", "lower_price"):
        if proposal.get(key) is not None and not _positive(proposal.get(key)):
            problems.append(f"{key} must be a positive number.")
    lower, price = proposal.get("lower_price"), proposal.get("price")
    if _positive(lower) and _positive(price) and lower >= price:
        problems.append("lower_price must be below price.")
    return problems


def _same_price(a, b):
    return a is not None and b is not None and abs(float(a) - float(b)) < 0.005


def apply(app, snapshot, proposal, accept_pending=False, accept_lower=False):
    """A pending (higher) or lower price is sent only when the seller accepted it for this SKU."""
    sku = snapshot.get("sku")
    out = {"sku": sku, "text": "skipped", "price": "skipped", "reason": ""}
    problems = check(snapshot, proposal)
    if problems:
        out["reason"] = "Refused: " + " ".join(problems)
        return out
    try:
        live = app.get("/api/listing/refresh/read", {"sku": sku})
    except AppUnavailable as err:
        out["reason"] = ("The listing is no longer live." if err.status == 404
                         else f"The listing could not be read again: {err}")
        return out
    if live.get("title") != snapshot.get("title") or not (
            _same_price(live.get("price"), snapshot.get("price"))
            or (live.get("price") is None and snapshot.get("price") is None)):
        out["reason"] = "The listing's title or price changed since it was read. Read it again."
        return out
    problems = check(live, proposal)  # specifics or description may have changed on eBay since the read
    if problems:
        out["reason"] = "Refused after reading it again: " + " ".join(problems)
        return out

    reasons = []
    additions = proposal.get("add_aspects") or {}
    append = proposal.get("append_html") or ""
    if proposal["title"] == live["title"] and not additions and not append.strip():
        out["text"] = "unchanged"
    else:
        body = {"sku": sku, "expectedTitle": live["title"],
                "after": {"title": proposal["title"],
                          "aspects": {**(live.get("aspects") or {}), **additions},
                          "descriptionHtml": (live.get("descriptionHtml") or "") + append}}
        try:
            answer = app.post("/api/listing/refresh/apply", body)
            out["text"] = "updated" if answer.get("status") == "updated" else "skipped"
            if out["text"] == "skipped":
                reasons.append(f"Text skipped: {answer.get('reason') or 'the app did not update it'}.")
        except AppUnavailable as err:
            out["text"] = "failed"
            reasons.append(f"Text failed: {err}")
    if out["text"] in ("skipped", "failed"):
        reasons.append("Price not sent, since the text was not saved.")
        out["reason"] = " ".join(reasons)
        return out

    if live.get("price") is None:
        out["price"] = "skipped"
        reasons.append("The listing has no price, so no price was sent.")
        out["reason"] = " ".join(reasons)
        return out
    pending, lower = proposal.get("pending_price"), proposal.get("lower_price")
    if accept_pending and pending is not None and accept_lower and lower is not None:
        out["price"] = "skipped"
        reasons.append("Both the pending (higher) and the lower price were accepted; accept one, then apply again.")
        out["reason"] = " ".join(reasons)
        return out
    if accept_lower and lower is not None:
        target = lower
    elif accept_pending and pending is not None:
        target = pending
    else:
        target = proposal.get("price")
    if target is None or _same_price(target, live.get("price")):
        out["price"] = "unchanged"
    else:
        body = {"sku": sku, "before": {"title": "-", "artist": "-", "price": live.get("price")},
                "after": {"title": "-", "artist": "-", "price": round(float(target), 2)}}
        try:
            answer = app.post("/api/listing/update-details", body)
            status = answer.get("status")
            out["price"] = {"updated": "updated", "unchanged": "unchanged"}.get(status, "failed")
            if out["price"] == "failed":
                reasons.append(f"Price failed: {answer.get('reason') or status}.")
        except AppUnavailable as err:
            out["price"] = "failed"
            reasons.append(f"Price failed: {err}")
    out["reason"] = " ".join(reasons)
    return out


def apply_batch(app, items, approved, accept_pending, accept_lower=()):
    results = []
    for item in items:
        snapshot, proposal = item["snapshot"], item["proposal"]
        if snapshot.get("sku") not in approved:
            results.append({"sku": snapshot.get("sku"), "text": "skipped", "price": "skipped",
                            "reason": "Not approved."})
            continue
        sku = snapshot.get("sku")
        results.append(apply(app, snapshot, proposal, accept_pending=sku in accept_pending,
                             accept_lower=sku in accept_lower))
    return results


def _load(items):
    for item in items:
        if "snapshot" not in item:
            with open(item["snapshot_file"], encoding="utf-8") as handle:
                item["snapshot"] = json.load(handle)
    return items


if __name__ == "__main__":
    try:
        command = sys.argv[1] if len(sys.argv) > 1 else ""
        if command not in ("check", "apply"):
            sys.exit("usage: changes.py check|apply  (JSON on stdin)")
        data = json.load(sys.stdin)
        items = _load(data["items"])
        if command == "check":
            result = [{"sku": i["snapshot"].get("sku"), "problems": check(i["snapshot"], i["proposal"])} for i in items]
        else:
            app = App(os.environ.get("ELISTER_URL"), os.environ.get("ELISTER_ACCESS_KEY"))
            result = apply_batch(app, items, set(data.get("approved") or []), set(data.get("accept_pending") or []),
                                 set(data.get("accept_lower") or []))
        print(json.dumps(result))
    except AppUnavailable as err:
        print(f"changes.py: {err}", file=sys.stderr)
        sys.exit(2)
    except (ValueError, KeyError, TypeError, OSError) as err:
        sys.exit(f"changes.py: bad input: {err}")
