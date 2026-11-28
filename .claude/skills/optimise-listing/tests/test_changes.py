import io, json, os, pathlib, subprocess, sys, tempfile, unittest, urllib.error, urllib.parse
from tests import helpers  # noqa: F401
from app_client import App
import changes

URL = "https://app.example"
OLD_TITLE = "Genesis Wind & Wuthering RARE CD (Disc: Near Mint / Inlay: Very Good)"

SNAPSHOT = {
    "sku": "BC-075678154323-ABCDE",
    "title": OLD_TITLE,
    "price": 17.5,
    "currency": "CAD",
    "barcode": "075678154323",
    "aspects": {"Artist": ["Genesis"], "Release Title": ["Wind & Wuthering"], "Format": ["CD"]},
    "descriptionHtml": "<p>old</p>",
}

NEW_TITLE = "Genesis Wind & Wuthering Rare 1976 CD (Disc: Near Mint / Inlay: Very Good)"


def proposal(**over):
    base = {"sku": SNAPSHOT["sku"], "title": NEW_TITLE, "add_aspects": {"Record Label": ["Atlantic"]},
            "append_html": "<p>Made in Canada.</p>", "price": 21.0, "pending_price": None}
    return {**base, **over}


class Resp:
    def __init__(self, body):
        self.body = json.dumps(body).encode()
        self.headers = {}

    def read(self):
        return self.body


def http_error(code, body=b"{}"):
    return urllib.error.HTTPError(URL, code, "x", {}, io.BytesIO(body))


class Fake:
    def __init__(self, **routes):
        self.routes, self.calls = routes, []

    def __call__(self, request):
        self.calls.append(request)
        path = urllib.parse.urlsplit(request.full_url).path
        name = path.replace("/api/", "").replace("/", "_").replace("-", "_")
        defaults = {"listing_refresh_read": SNAPSHOT,
                    "listing_refresh_apply": {"status": "updated", "sku": SNAPSHOT["sku"]},
                    "listing_update_details": {"status": "updated", "sku": SNAPSHOT["sku"], "changed": ["price"]}}
        result = self.routes.get(name, defaults.get(name))
        if result is None:
            raise AssertionError(f"unexpected call {path}")
        if isinstance(result, Exception):
            raise result
        return Resp(result)

    def sent(self, path):
        return [json.loads(r.data) for r in self.calls if urllib.parse.urlsplit(r.full_url).path == path]

    def writes(self):
        return [urllib.parse.urlsplit(r.full_url).path for r in self.calls if r.get_method() == "POST"]


def apply(fake, prop=None, accept_pending=False, snapshot=SNAPSHOT):
    return changes.apply(App(URL, None, opener=fake), snapshot, prop or proposal(), accept_pending=accept_pending)


class CheckTest(unittest.TestCase):
    def test_a_good_proposal_has_no_problems(self):
        self.assertEqual(changes.check(SNAPSHOT, proposal()), [])

    def test_title_over_80_characters(self):
        long = "Genesis Wind & Wuthering Rare " + "x" * 40 + " CD (Disc: Near Mint / Inlay: Very Good)"
        self.assertTrue(any("80" in p for p in changes.check(SNAPSHOT, proposal(title=long))))

    def test_a_word_of_the_old_title_missing(self):
        dropped = "Genesis Wind & Wuthering 1976 CD (Disc: Near Mint / Inlay: Very Good)"
        problems = changes.check(SNAPSHOT, proposal(title=dropped))
        self.assertTrue(any("rare" in p.lower() for p in problems), problems)

    def test_changed_grades(self):
        worse = NEW_TITLE.replace("Inlay: Very Good", "Inlay: Good")
        self.assertTrue(any("grade" in p.lower() for p in changes.check(SNAPSHOT, proposal(title=worse))))
        gone = "Genesis Wind & Wuthering Rare 1976 CD"
        self.assertTrue(any("grade" in p.lower() for p in changes.check(SNAPSHOT, proposal(title=gone))))

    def test_short_form_of_the_same_grades_is_allowed(self):
        short = "Genesis Wind & Wuthering Rare Canada 1976 Atlantic Records Prog CD (NM/VG)"
        self.assertEqual(changes.check(SNAPSHOT, proposal(title=short)), [])

    def test_an_added_specific_that_already_exists(self):
        problems = changes.check(SNAPSHOT, proposal(add_aspects={"artist": ["Genesis"]}))
        self.assertTrue(any("Artist" in p or "artist" in p for p in problems), problems)

    def test_a_price_that_is_not_positive(self):
        self.assertTrue(changes.check(SNAPSHOT, proposal(price=0)))
        self.assertTrue(changes.check(SNAPSHOT, proposal(pending_price=-1)))

    def test_grades_may_be_added_when_they_are_the_listings_own(self):
        bare = {**SNAPSHOT, "title": "Genesis Wind & Wuthering RARE CD",
                "sellerCondition": {"condition": "USED_VERY_GOOD", "disc": "Near mint", "booklet": "Very good"}}
        self.assertEqual(changes.check(bare, proposal()), [])
        other = NEW_TITLE.replace("Inlay: Very Good", "Inlay: Mint")
        self.assertTrue(any("grade" in p.lower() for p in changes.check(bare, proposal(title=other))))
        unknown = {**bare, "sellerCondition": None}
        self.assertTrue(any("grade" in p.lower() for p in changes.check(unknown, proposal())))

    def test_a_lower_price_field_is_refused(self):
        self.assertTrue(any("lower_price" in p for p in changes.check(SNAPSHOT, proposal(lower_price=12.0))))

    def test_another_sku_is_refused(self):
        self.assertTrue(changes.check(SNAPSHOT, proposal(sku="OTHER")))


class ApplyTest(unittest.TestCase):
    def test_text_goes_without_price_then_price_alone(self):
        fake = Fake()
        out = apply(fake)
        self.assertEqual((out["text"], out["price"]), ("updated", "updated"))
        [text] = fake.sent("/api/listing/refresh/apply")
        self.assertEqual(text, {"sku": SNAPSHOT["sku"], "expectedTitle": OLD_TITLE,
                                "after": {"title": NEW_TITLE,
                                          "aspects": {**SNAPSHOT["aspects"], "Record Label": ["Atlantic"]},
                                          "descriptionHtml": "<p>old</p><p>Made in Canada.</p>"}})
        [price] = fake.sent("/api/listing/update-details")
        self.assertEqual(price, {"sku": SNAPSHOT["sku"],
                                 "before": {"title": "-", "artist": "-", "price": 17.5},
                                 "after": {"title": "-", "artist": "-", "price": 21.0}})
        self.assertEqual(fake.writes(), ["/api/listing/refresh/apply", "/api/listing/update-details"])

    def test_a_listing_changed_since_reading_is_skipped_entirely(self):
        for live in ({**SNAPSHOT, "title": "Edited on eBay"}, {**SNAPSHOT, "price": 15}):
            fake = Fake(listing_refresh_read=live)
            out = apply(fake)
            self.assertEqual((out["text"], out["price"]), ("skipped", "skipped"))
            self.assertEqual(fake.writes(), [])

    def test_a_specific_added_on_ebay_since_reading_is_not_duplicated(self):
        live = {**SNAPSHOT, "aspects": {**SNAPSHOT["aspects"], "record label": ["Atlantic"]}}
        fake = Fake(listing_refresh_read=live)
        out = apply(fake)
        self.assertEqual((out["text"], out["price"]), ("skipped", "skipped"))
        self.assertEqual(fake.writes(), [])

    def test_a_listing_no_longer_live_is_skipped(self):
        fake = Fake(listing_refresh_read=http_error(404))
        out = apply(fake)
        self.assertEqual((out["text"], out["price"]), ("skipped", "skipped"))
        self.assertEqual(fake.writes(), [])

    def test_a_proposal_with_problems_sends_nothing(self):
        fake = Fake()
        out = apply(fake, proposal(title="Genesis CD"))
        self.assertEqual((out["text"], out["price"]), ("skipped", "skipped"))
        self.assertEqual(fake.calls, [])

    def test_pending_price_only_when_accepted(self):
        fake = Fake()
        apply(fake, proposal(pending_price=30.0))
        self.assertEqual(fake.sent("/api/listing/update-details")[0]["after"]["price"], 21.0)
        fake = Fake()
        apply(fake, proposal(pending_price=30.0), accept_pending=True)
        self.assertEqual(fake.sent("/api/listing/update-details")[0]["after"]["price"], 30.0)

    def test_price_error_after_text_reports_both(self):
        fake = Fake(listing_update_details=http_error(502))
        out = apply(fake)
        self.assertEqual((out["text"], out["price"]), ("updated", "failed"))
        self.assertIn("price", out["reason"].lower())

    def test_text_skipped_by_the_app_makes_no_price_call(self):
        fake = Fake(listing_refresh_apply={"status": "skipped", "sku": SNAPSHOT["sku"], "reason": "changed"})
        out = apply(fake)
        self.assertEqual((out["text"], out["price"]), ("skipped", "skipped"))
        self.assertEqual(fake.sent("/api/listing/update-details"), [])

    def test_text_failing_makes_no_price_call(self):
        fake = Fake(listing_refresh_apply=http_error(502))
        out = apply(fake)
        self.assertEqual((out["text"], out["price"]), ("failed", "skipped"))
        self.assertEqual(fake.sent("/api/listing/update-details"), [])

    def test_nothing_to_change_sends_nothing(self):
        fake = Fake()
        out = apply(fake, proposal(title=OLD_TITLE, add_aspects={}, append_html="", price=17.5))
        self.assertEqual((out["text"], out["price"]), ("unchanged", "unchanged"))
        self.assertEqual(fake.writes(), [])

    def test_a_listing_without_a_price_gets_no_price_call(self):
        unpriced = {**SNAPSHOT, "price": None}
        fake = Fake(listing_refresh_read=unpriced)
        out = apply(fake, snapshot=unpriced)
        self.assertEqual((out["text"], out["price"]), ("updated", "skipped"))
        self.assertEqual(fake.sent("/api/listing/update-details"), [])
        self.assertIn("no price", out["reason"])

    def test_price_only_change_skips_the_text_route(self):
        fake = Fake()
        out = apply(fake, proposal(title=OLD_TITLE, add_aspects={}, append_html="", price=19.0))
        self.assertEqual((out["text"], out["price"]), ("unchanged", "updated"))
        self.assertEqual(fake.writes(), ["/api/listing/update-details"])


class BatchTest(unittest.TestCase):
    def test_only_approved_skus_are_sent(self):
        fake = Fake()
        other = {**SNAPSHOT, "sku": "BC-2"}
        items = [{"snapshot": SNAPSHOT, "proposal": proposal()},
                 {"snapshot": other, "proposal": proposal(sku="BC-2")}]
        out = changes.apply_batch(App(URL, None, opener=fake), items, approved=[SNAPSHOT["sku"]], accept_pending=[])
        self.assertEqual([(r["sku"], r["text"]) for r in out], [(SNAPSHOT["sku"], "updated"), ("BC-2", "skipped")])
        self.assertTrue(all(json.loads(r.data)["sku"] == SNAPSHOT["sku"]
                            for r in fake.calls if r.get_method() == "POST"))

    def test_accept_pending_is_per_sku(self):
        fake = Fake()
        items = [{"snapshot": SNAPSHOT, "proposal": proposal(pending_price=30.0)}]
        changes.apply_batch(App(URL, None, opener=fake), items, approved=[SNAPSHOT["sku"]], accept_pending=["BC-2"])
        self.assertEqual(fake.sent("/api/listing/update-details")[0]["after"]["price"], 21.0)


class CommandLineTest(unittest.TestCase):
    def test_check_reads_snapshot_files(self):
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, "listing.json")
            pathlib.Path(path).write_text(json.dumps(SNAPSHOT))
            payload = {"items": [{"snapshot_file": path, "proposal": proposal(title="Genesis CD")}]}
            p = subprocess.run([sys.executable, "scripts/changes.py", "check"], input=json.dumps(payload),
                               capture_output=True, text=True, env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"})
        [row] = json.loads(p.stdout)
        self.assertEqual(row["sku"], SNAPSHOT["sku"])
        self.assertTrue(row["problems"])

    def test_apply_without_settings_exits_2_and_sends_nothing(self):
        env = {k: v for k, v in os.environ.items() if not k.startswith("ELISTER_")}
        payload = {"items": [{"snapshot": SNAPSHOT, "proposal": proposal()}], "approved": [SNAPSHOT["sku"]]}
        p = subprocess.run([sys.executable, "scripts/changes.py", "apply"], input=json.dumps(payload),
                           capture_output=True, text=True, env={**env, "PYTHONDONTWRITEBYTECODE": "1"})
        self.assertEqual(p.returncode, 2)
