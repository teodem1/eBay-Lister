"""The plugin's reads from the e-bay-lister app, sold results stored first.

    listings.py check    -> {"reachable", "authorised"} and nothing else
    listings.py list     -> every live listing, saved to a private file; prints the count and path
    listings.py read     stdin {"sku"} -> the listing in full, saved privately; prints a headline
    listings.py sold     stdin {"listing_file" | "listing", "refresh"?} -> sold sales, saved privately
    listings.py engagement stdin {"listing_file", "sold_file"} -> copies listed now against the sales pace:
                         {"level": high|normal|low, "sold", "listed", "days", "months_of_supply", "reason"}
    listings.py import   stdin: the Collection backup -> stores its price checks as partial lookups
    listings.py batch-start  stdin {"runId"} -> the phone run's reserved listings, read and saved privately
    listings.py batch-save   stdin {"runId", "proposals": [...]} -> saves them on the run (open on the phone)
    listings.py batch-finish stdin {"runId", "status": "done"|"failed", "release"?, "reason"?} -> closes the run

Settings: ELISTER_URL (the app's https address). The key normally rides in a network
secret outside the session; ELISTER_ACCESS_KEY is only a fallback. The key is never
printed or written. Exit code 2: the app could not be used (message on stderr).

A sold lookup costs a sold-comps.com call, so `sold` reads the stored result first and
looks up only when none exists (or on refresh). Storage that cannot be read stops it,
and a paid lookup is never repeated, even when saving it failed.
"""
import json
import os
import re
import sys
import urllib.parse
import tempfile

from app_client import ALLOWANCE, App, AppUnavailable

IMPORT_BATCH = 300


def _private_file(name, data):
    folder = tempfile.mkdtemp(prefix="elister-")  # readable by this user only
    path = os.path.join(folder, name)
    with open(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w", encoding="utf-8") as handle:
        json.dump(data, handle)
    return path


def check(app):
    """Whether the app answers and lets this session in. A GET on the POST-only price route reads nothing."""
    try:
        app.get("/api/price-suggestion")
        return {"reachable": True, "authorised": True}
    except AppUnavailable as err:
        if err.status is None:
            return {"reachable": False, "authorised": False}
        return {"reachable": True, "authorised": err.status == 405}


def list_live(app):
    found, offset = [], 0
    while offset is not None:
        page = app.get("/api/listing/refresh", {"offset": offset})
        found.extend({k: l.get(k) for k in ("sku", "listingId", "title", "price")} for l in page.get("listings", []))
        offset = page.get("nextOffset")
    return {"count": len(found), "data_file": _private_file("listings.json", found)}


def read(app, sku):
    listing = app.get("/api/listing/refresh/read", {"sku": sku})
    head = {k: listing.get(k) for k in ("sku", "title", "price", "currency", "barcode", "query")}
    grades = listing.get("sellerCondition") or {}
    head.update({k: grades.get(k) for k in ("condition", "disc", "booklet")})
    head["data_file"] = _private_file("listing.json", listing)
    return head


def _digits(barcode):
    d = "".join(c for c in (barcode or "") if c.isdigit())
    return d if 8 <= len(d) <= 14 else ""


def search_name(query):
    """The name sold searches use: no "Various Artists" prefix, no (...) or [...] parts and no
    subtitle after a colon, which eBay titles rarely carry in full. The full name when nothing is left."""
    short = re.sub(r"\([^)]*\)|\[[^\]]*\]", " ", query or "")
    short = short.split(":", 1)[0]
    short = re.sub(r"^\s*various artists\b", " ", short, flags=re.I)
    short = " ".join(short.split()).strip(" -,")
    return short if re.search(r"\w", short) else (query or "")


def _result(source, lookup, filtered, query):
    """`short_name`: the sales came from a by-name search under a shortened name, so they
    may include cheaper copies of other releases; a price never goes down on them alone."""
    queries = lookup.get("queries") or [{}]
    short = queries[-1].get("by") == "keywords" and search_name(query) != (query or "")
    return {"source": source, "partial": bool(lookup.get("partial")), "saved_at": lookup.get("savedAt"),
            "short_name": short,
            "data_file": _private_file("sold.json", {"lookup": lookup, "filtered": filtered})}


def sold(app, listing, refresh=False):
    """Sold sales for a live listing: the stored result, else exactly one paid lookup."""
    condition = (listing.get("sellerCondition") or {}).get("condition")
    name = search_name(listing.get("query"))
    params = {"barcode": _digits(listing.get("barcode")), "name": name, "condition": condition}
    # Raises on 400 (no usable key), 502 (unreadable) or 503 (no storage): never looks up blind.
    before = app.get("/api/comps", params)
    if not before.get("found") and not params["barcode"] and name != listing.get("query"):
        # Stored before names were shortened: read it under the full name too, so it is not bought again.
        before = app.get("/api/comps", {**params, "name": listing.get("query")})
    if before.get("found") and not refresh:
        return _result("stored", before["lookup"], before["filtered"], listing.get("query"))
    old_saved_at = before["lookup"].get("savedAt") if before.get("found") else None

    body = {"keywords": name, "gtin": params["barcode"], "sellerCondition": condition}
    answer = app.post("/api/price-suggestion", {k: v for k, v in body.items() if v})
    if answer.get("soldLimitReached"):
        raise AppUnavailable(ALLOWANCE)
    if not answer.get("sold") and (answer.get("unavailable") or {}).get("sold"):
        raise AppUnavailable(f"Sold search failed: {answer['unavailable']['sold']}")

    # The lookup is paid for: from here on, nothing raises or looks up again.
    try:
        after = app.get("/api/comps", params)
    except AppUnavailable:
        after = {"found": False}
    if after.get("found") and after["lookup"].get("savedAt") != old_saved_at:
        return _result("lookup", after["lookup"], after["filtered"], listing.get("query"))
    # Not saved: the answer's sales, which the app already narrowed to CDs in this grade.
    comparables = (answer.get("sold") or {}).get("comparables") or {}
    items = comparables.get("items") or []
    ids = [i.get("itemId") for i in items]
    lookup = {"version": 1, "savedAt": None, "partial": False, "barcode": params["barcode"] or None,
              "name": name, "condition": condition,
              "queries": [{"by": comparables.get("matchedBy") or "keywords", "items": items}]}
    return _result("lookup_unsaved", lookup, {"cdOnly": ids, "sameGrade": ids, "detail": {}}, listing.get("query"))


def engagement(app, listing, sold_file):
    """Engagement for a listing: copies listed now (eBay, no sold-comps lookup) against
    the pace of the stored CD sales (any grade) in its sold file."""
    from reprice import engagement_level
    with open(sold_file, encoding="utf-8") as handle:
        stored = json.load(handle)
    keep = set(stored["filtered"]["cdOnly"])
    sales = [i for i in stored["lookup"]["queries"][-1]["items"] if i.get("itemId") in keep]
    params = {"barcode": _digits(listing.get("barcode")), "name": search_name(listing.get("query"))}
    now = app.get("/api/comps/current", params)
    saved_at = stored["lookup"].get("savedAt") or _now()
    return engagement_level(sales, saved_at, int(now.get("count", 0)), bool(now.get("capped")))


def _now():
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


def batch_start(app, run_id):
    """Job H: the listings a phone run reserved, each read and saved privately.
    A listing that is no longer live goes in `not_live` (release it with batch-finish)."""
    run = app.get(f"/api/batch/runs/{urllib.parse.quote(run_id, safe='')}")["run"]
    files, not_live = {}, []
    for sku in run.get("skus", []):
        try:
            files[sku] = read(app, sku)["data_file"]
        except AppUnavailable as err:
            if err.status != 404:
                raise
            not_live.append(sku)
    return {"runId": run_id, "skus": list(files), "files": files, "not_live": not_live}


def batch_save(app, run_id, proposals):
    """Job H: saves up to 20 proposals on the phone run (they show on the phone as open)."""
    return app.post("/api/batch/proposals", {"runId": run_id, "proposals": proposals})


def batch_finish(app, run_id, status, release=None, reason=None):
    """Job H: closes the run; listings it gives back, or never proposed, return to the queue."""
    body = {"status": status}
    if release:
        body["release"] = release
    if reason:
        body["reason"] = reason
    return app.post(f"/api/batch/runs/{urllib.parse.quote(run_id, safe='')}", body)


def _sale_ok(s):
    price = s.get("price") if isinstance(s, dict) else None
    return (isinstance(price, dict) and s.get("itemId") and s.get("title")
            and isinstance(price.get("value"), (int, float)) and price.get("currency"))


def import_backup(app, backup):
    """Sends the backup's price checks that have sold sales, at most 300 per call; sums the answers."""
    entries = backup.get("items", []) if isinstance(backup, dict) else backup
    items, not_sent = [], 0
    for e in entries if isinstance(entries, list) else []:
        check_ = (e or {}).get("priceCheck") or {}
        sales = [s for s in check_.get("soldItems") or [] if _sale_ok(s)]
        if not sales or not e.get("priceCheckedAt") or not check_.get("keywords"):
            not_sent += 1
            continue
        pc = {"keywords": check_["keywords"], "condition": check_.get("condition"), "soldItems": sales}
        item = {"barcode": e.get("barcode"), "priceCheckedAt": e["priceCheckedAt"],
                "priceCheck": {k: v for k, v in pc.items() if v}}
        items.append({k: v for k, v in item.items() if v})
    totals = {"saved": 0, "kept": 0, "skipped": 0}
    for i in range(0, len(items), IMPORT_BATCH):
        answer = app.post("/api/comps/import", {"items": items[i:i + IMPORT_BATCH]})
        for k in totals:
            totals[k] += int(answer.get(k, 0))
    return {**totals, "sent": len(items), "not_sent": not_sent}


def main(command, stdin):
    if command not in ("check", "list", "read", "sold", "engagement", "import", "batch-start", "batch-save", "batch-finish"):
        sys.exit("usage: listings.py check|list|read|sold|engagement|import|batch-start|batch-save|batch-finish  (JSON on stdin)")
    app = App(os.environ.get("ELISTER_URL"), os.environ.get("ELISTER_ACCESS_KEY"))
    if command == "check":
        return check(app)
    if command == "list":
        return list_live(app)
    data = json.loads(stdin or "{}")
    if command == "read":
        return read(app, str(data["sku"]))
    if command == "sold":
        listing = data.get("listing")
        if listing is None:
            with open(data["listing_file"], encoding="utf-8") as handle:
                listing = json.load(handle)
        return sold(app, listing, refresh=bool(data.get("refresh")))
    if command == "batch-start":
        return batch_start(app, str(data["runId"]))
    if command == "batch-save":
        return batch_save(app, str(data["runId"]), data["proposals"])
    if command == "batch-finish":
        return batch_finish(app, str(data["runId"]), data["status"], data.get("release"), data.get("reason"))
    if command == "engagement":
        with open(data["listing_file"], encoding="utf-8") as handle:
            listing = json.load(handle)
        return engagement(app, listing, data["sold_file"])
    return import_backup(app, data)


if __name__ == "__main__":
    try:
        command = sys.argv[1] if len(sys.argv) > 1 else ""
        stdin = "" if command in ("check", "list") else sys.stdin.read()
        print(json.dumps(main(command, stdin), separators=(",", ":")))
    except AppUnavailable as err:
        print(f"listings.py: {err}", file=sys.stderr)
        sys.exit(2)
    except (ValueError, KeyError, OSError) as err:
        sys.exit(f"listings.py: bad input: {err}")
