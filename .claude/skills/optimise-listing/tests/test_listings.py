import io, json, os, pathlib, subprocess, sys, unittest, urllib.error, urllib.parse
from tests import helpers  # noqa: F401
from app_client import App, AppUnavailable
import listings

KEY = "s3cret-key-value"
URL = "https://app.example"

LISTING = {
    "sku": "BC-075678154323-ABCDE",
    "title": "Genesis Wind & Wuthering CD (Disc: Near Mint / Inlay: Near Mint)",
    "price": 17.5,
    "currency": "CAD",
    "barcode": "075678154323",
    "query": "Genesis Wind & Wuthering",
    "sellerCondition": {"condition": "LIKE_NEW", "disc": "Near Mint"},
}


def sale(item_id, value):
    return {"itemId": item_id, "title": "Genesis Wind & Wuthering CD", "price": {"value": value, "currency": "CAD"}}


def stored(saved_at="2026-11-20T00:00:00.000Z", partial=False):
    return {"found": True,
            "lookup": {"version": 1, "savedAt": saved_at, "partial": partial, "barcode": "075678154323",
                       "name": "Genesis Wind & Wuthering", "queries": [{"by": "barcode", "items": [sale("a", 12)]}],
                       "filtered": {"cdOnly": ["a"], "sameGrade": ["a"], "detail": {}}},
            "filtered": {"cdOnly": ["a"], "sameGrade": ["a"], "detail": {"canadian": []}}}


ANSWER = {"sold": {"suggestion": {}, "comparables": {"matchedBy": "barcode", "items": [sale("x", 15), sale("y", 16)]}},
          "current": None, "unavailable": {}}


class Resp:
    def __init__(self, body, headers=None):
        self.body = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.headers = headers or {}

    def read(self):
        return self.body


def http_error(code, body=b"{}"):
    return urllib.error.HTTPError(URL, code, "x", {}, io.BytesIO(body))


class Fake:
    """Answers by path; a list answers in turn (the last one repeats)."""

    def __init__(self, **routes):
        self.routes, self.calls = routes, []

    def __call__(self, request):
        self.calls.append(request)
        path = urllib.parse.urlsplit(request.full_url).path
        name = path.replace("/api/", "").replace("/", "_").replace("-", "_")
        default = {"unlock": Resp({"ok": True}, {"Set-Cookie": "el_access=abc; Path=/; HttpOnly"})}
        result = self.routes.get(name, default.get(name))
        if isinstance(result, list):
            result = result.pop(0) if len(result) > 1 else result[0]
        if result is None:
            raise AssertionError(f"unexpected call {path}")
        if isinstance(result, Exception):
            raise result
        return result if isinstance(result, Resp) else Resp(result)

    def paths(self):
        return [urllib.parse.urlsplit(r.full_url).path for r in self.calls]

    def lookups(self):
        return self.paths().count("/api/price-suggestion")


def run_sold(fake, refresh=False, key=None, listing=LISTING):
    return listings.sold(App(URL, key, opener=fake), listing, refresh=refresh)


class AppTest(unittest.TestCase):
    def test_without_a_key_sends_no_cookie_and_never_unlocks(self):
        fake = Fake(comps=stored())
        run_sold(fake)
        self.assertNotIn("/api/unlock", fake.paths())
        self.assertTrue(all(r.get_header("Cookie") is None for r in fake.calls))

    def test_with_a_key_unlocks_once_and_sends_the_cookie(self):
        fake = Fake(comps=[{"found": False}, {"found": False}], price_suggestion=ANSWER)
        run_sold(fake, key=KEY)
        self.assertEqual(fake.paths().count("/api/unlock"), 1)
        self.assertTrue(all(r.get_header("Cookie") == "el_access=abc" for r in fake.calls[1:]))

    def test_get_sends_params_and_refuses_a_bad_url(self):
        fake = Fake(comps=stored())
        App(URL, None, opener=fake).get("/api/comps", {"barcode": "1", "name": None})
        self.assertEqual(urllib.parse.urlsplit(fake.calls[0].full_url).query, "barcode=1")
        with self.assertRaises(AppUnavailable):
            App("http://app.example", None, opener=fake).get("/api/comps")

    def test_errors_carry_the_status(self):
        with self.assertRaises(AppUnavailable) as caught:
            App(URL, None, opener=Fake(comps=http_error(503))).get("/api/comps")
        self.assertEqual(caught.exception.status, 503)


class SoldTest(unittest.TestCase):
    def test_stored_result_makes_no_lookup(self):
        fake = Fake(comps=stored())
        out = run_sold(fake)
        self.assertEqual(fake.lookups(), 0)
        self.assertEqual(out["source"], "stored")
        self.assertEqual(out["saved_at"], "2026-11-20T00:00:00.000Z")
        self.assertFalse(out["partial"])
        data = pathlib.Path(out["data_file"])
        self.assertEqual(data.stat().st_mode & 0o077, 0)
        body = json.loads(data.read_text())
        self.assertEqual(set(body), {"lookup", "filtered"})
        self.assertEqual(body["filtered"]["detail"], {"canadian": []})

    def test_reads_by_barcode_name_and_grade(self):
        fake = Fake(comps=stored())
        run_sold(fake)
        query = dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(fake.calls[0].full_url).query))
        self.assertEqual(query, {"barcode": "075678154323", "name": "Genesis Wind & Wuthering", "condition": "LIKE_NEW"})

    def test_missing_result_is_looked_up_once_then_read_back(self):
        fake = Fake(comps=[{"found": False}, stored("2026-11-28T01:00:00.000Z")], price_suggestion=ANSWER)
        out = run_sold(fake)
        self.assertEqual(fake.lookups(), 1)
        self.assertEqual(fake.paths(), ["/api/comps", "/api/price-suggestion", "/api/comps"])
        self.assertEqual(out["source"], "lookup")
        self.assertEqual(out["saved_at"], "2026-11-28T01:00:00.000Z")
        body = json.loads(fake.calls[1].data)
        self.assertEqual(body, {"keywords": "Genesis Wind & Wuthering", "gtin": "075678154323",
                                "sellerCondition": "LIKE_NEW"})

    def test_storage_errors_stop_before_any_lookup(self):
        for code in (502, 503, 400):
            fake = Fake(comps=http_error(code), price_suggestion=ANSWER)
            with self.assertRaises(AppUnavailable):
                run_sold(fake)
            self.assertEqual(fake.lookups(), 0, code)

    def test_lookup_not_saved_uses_the_answer_once(self):
        fake = Fake(comps=[{"found": False}, {"found": False}], price_suggestion=ANSWER)
        out = run_sold(fake)
        self.assertEqual(fake.lookups(), 1)
        self.assertEqual(out["source"], "lookup_unsaved")
        self.assertIsNone(out["saved_at"])
        body = json.loads(pathlib.Path(out["data_file"]).read_text())
        self.assertEqual([i["itemId"] for i in body["lookup"]["queries"][-1]["items"]], ["x", "y"])
        self.assertEqual(body["filtered"]["sameGrade"], ["x", "y"])

    def test_read_back_failing_after_a_lookup_is_not_repeated(self):
        fake = Fake(comps=[{"found": False}, http_error(502)], price_suggestion=ANSWER)
        out = run_sold(fake)
        self.assertEqual(fake.lookups(), 1)
        self.assertEqual(out["source"], "lookup_unsaved")

    def test_allowance_used_up_raises(self):
        for answer in ({**ANSWER, "soldLimitReached": True}, http_error(502, b'{"soldLimitReached": true}')):
            with self.assertRaises(AppUnavailable) as caught:
                run_sold(Fake(comps=[{"found": False}], price_suggestion=answer))
            self.assertIn("allowance", str(caught.exception))

    def test_failed_sold_search_raises(self):
        answer = {"sold": None, "current": None, "unavailable": {"sold": "Sold search failed: boom"}}
        with self.assertRaises(AppUnavailable) as caught:
            run_sold(Fake(comps=[{"found": False}], price_suggestion=answer))
        self.assertIn("boom", str(caught.exception))

    def test_refresh_looks_up_once_even_when_stored(self):
        fake = Fake(comps=[stored(), stored("2026-11-28T01:00:00.000Z")], price_suggestion=ANSWER)
        out = run_sold(fake, refresh=True)
        self.assertEqual(fake.lookups(), 1)
        self.assertEqual(out["source"], "lookup")

    def test_refresh_whose_save_failed_is_unsaved(self):
        fake = Fake(comps=[stored(), stored()], price_suggestion=ANSWER)
        out = run_sold(fake, refresh=True)
        self.assertEqual(fake.lookups(), 1)
        self.assertEqual(out["source"], "lookup_unsaved")

    def test_short_barcode_is_not_sent_as_gtin(self):
        fake = Fake(comps=[{"found": False}, stored("2026-11-28T01:00:00.000Z")], price_suggestion=ANSWER)
        run_sold(fake, listing={**LISTING, "barcode": "0123"})
        self.assertNotIn("gtin", json.loads(fake.calls[1].data))

    def test_no_output_holds_the_key(self):
        fake = Fake(comps=[{"found": False}, {"found": False}], price_suggestion=ANSWER)
        out = run_sold(fake, key=KEY)
        self.assertNotIn(KEY, json.dumps(out))
        self.assertNotIn(KEY, pathlib.Path(out["data_file"]).read_text())
        with self.assertRaises(AppUnavailable) as caught:
            run_sold(Fake(unlock=urllib.error.URLError(KEY)), key=KEY)
        self.assertNotIn(KEY, str(caught.exception))


class CheckTest(unittest.TestCase):
    def test_check_reports_only_reachable_and_authorised(self):
        cases = [(http_error(405), {"reachable": True, "authorised": True}),
                 (http_error(401), {"reachable": True, "authorised": False}),
                 (urllib.error.URLError("down"), {"reachable": False, "authorised": False})]
        for answer, expected in cases:
            self.assertEqual(listings.check(App(URL, None, opener=Fake(price_suggestion=answer))), expected)


class ReadTest(unittest.TestCase):
    def test_read_saves_the_listing_privately(self):
        fake = Fake(listing_refresh_read=LISTING)
        out = listings.read(App(URL, None, opener=fake), LISTING["sku"])
        self.assertEqual(urllib.parse.parse_qs(urllib.parse.urlsplit(fake.calls[0].full_url).query),
                         {"sku": [LISTING["sku"]]})
        self.assertEqual(out["sku"], LISTING["sku"])
        self.assertEqual(out["price"], 17.5)
        self.assertEqual((out["condition"], out["disc"], out["booklet"]), ("LIKE_NEW", "Near Mint", None))
        path = pathlib.Path(out["data_file"])
        self.assertEqual(path.stat().st_mode & 0o077, 0)
        self.assertEqual(json.loads(path.read_text()), LISTING)


class ImportTest(unittest.TestCase):
    def test_import_sends_only_checks_with_sold_items(self):
        backup = [
            {"title": "A", "barcode": "075678154323", "priceCheckedAt": "2026-10-01T00:00:00.000Z",
             "priceCheck": {"keywords": "Genesis Wind & Wuthering", "condition": "LIKE_NEW",
                            "soldItems": [sale("a", 12), {"title": "no id"}], "currentItems": [sale("c", 20)]}},
            {"title": "B", "priceCheckedAt": "2026-10-01T00:00:00.000Z",
             "priceCheck": {"keywords": "Rush", "soldItems": []}},
            {"title": "C"},
        ]
        fake = Fake(comps_import={"saved": 1, "kept": 0, "skipped": 0})
        out = listings.import_backup(App(URL, None, opener=fake), {"items": backup})
        self.assertEqual(out, {"saved": 1, "kept": 0, "skipped": 0, "sent": 1, "not_sent": 2})
        sent = json.loads(fake.calls[0].data)["items"]
        self.assertEqual(sent, [{"barcode": "075678154323", "priceCheckedAt": "2026-10-01T00:00:00.000Z",
                                 "priceCheck": {"keywords": "Genesis Wind & Wuthering", "condition": "LIKE_NEW",
                                                "soldItems": [sale("a", 12)]}}])

    def test_import_sends_at_most_300_per_call(self):
        check = {"title": "A", "priceCheckedAt": "2026-10-01T00:00:00.000Z",
                 "priceCheck": {"keywords": "Rush", "soldItems": [sale("a", 1)]}}
        fake = Fake(comps_import={"saved": 1, "kept": 0, "skipped": 0})
        out = listings.import_backup(App(URL, None, opener=fake), [check] * 301)
        self.assertEqual([len(json.loads(r.data)["items"]) for r in fake.calls], [300, 1])
        self.assertEqual(out["saved"], 2)


class CommandLineTest(unittest.TestCase):
    def test_without_settings_exits_2(self):
        env = {k: v for k, v in os.environ.items() if not k.startswith("ELISTER_")}
        p = subprocess.run([sys.executable, "scripts/listings.py", "check"], input="{}",
                           capture_output=True, text=True, env=env)
        self.assertEqual(p.returncode, 2)
        self.assertIn("ELISTER_URL", p.stderr)

    def test_unknown_command_is_refused(self):
        p = subprocess.run([sys.executable, "scripts/listings.py", "publish"], input="{}",
                           capture_output=True, text=True)
        self.assertNotEqual(p.returncode, 0)
