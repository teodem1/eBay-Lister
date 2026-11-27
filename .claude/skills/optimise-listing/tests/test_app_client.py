import io, json, os, pathlib, subprocess, sys, unittest, urllib.error
from tests import helpers  # noqa: F401
from app_client import AppUnavailable, fetch_prices

KEY = "s3cret-key-value"
URL = "https://app.example"

class Resp:
    def __init__(self, body, headers=None):
        self.body = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.headers = headers or {}
    def read(self):
        return self.body

def http_error(code, body=b""):
    return urllib.error.HTTPError(URL, code, "x", {}, io.BytesIO(body))

class Fake:
    def __init__(self, **routes):
        self.routes, self.calls = routes, []
    def __call__(self, request):
        self.calls.append(request)
        name = request.full_url.rsplit("/", 1)[-1].replace("-", "_")
        result = {"unlock": Resp({"ok": True}, {"Set-Cookie": "el_access=abc; Path=/; HttpOnly"}),
                  "price_suggestion": Resp({"sold": None, "current": None}),
                  "price_reference": Resp({"discogs": {"releaseId": 1}}), **self.routes}[name]
        if isinstance(result, Exception):
            raise result
        return result

def fetch(fake, url=URL, key=KEY, barcode="0123456789012"):
    return fetch_prices(url, key, "Rush Moving Pictures", barcode, "LIKE_NEW", opener=fake)

class ClientTest(unittest.TestCase):
    def test_success_sends_cookie_and_body(self):
        fake = Fake()
        r = fetch(fake)
        self.assertEqual(r["discogs"], {"releaseId": 1})
        self.assertEqual(r["problems"], [])
        request = fake.calls[1]
        self.assertEqual(request.get_header("Cookie"), "el_access=abc")
        self.assertEqual(json.loads(request.data), {"keywords": "Rush Moving Pictures", "gtin": "0123456789012", "sellerCondition": "LIKE_NEW"})

    def test_no_barcode_skips_discogs(self):
        fake = Fake()
        r = fetch(fake, barcode=None)
        self.assertEqual(len(fake.calls), 2)
        self.assertTrue(any("barcode" in p for p in r["problems"]))

    def test_http_refused_before_any_call(self):
        for url in ("http://app.example", "", "https://user@app.example"):
            fake = Fake()
            with self.assertRaises(AppUnavailable):
                fetch(fake, url=url)
            self.assertEqual(fake.calls, [])

    def test_failures_name_the_fallback_and_hide_key(self):
        cases = [Fake(unlock=http_error(401)), Fake(price_suggestion=http_error(302)),
                 Fake(price_suggestion=Resp(b"<html>Sign in</html>")), Fake(price_suggestion=http_error(401)),
                 Fake(unlock=urllib.error.URLError(KEY)), Fake(unlock=Resp({"ok": True}))]
        for fake in cases:
            with self.assertRaises(AppUnavailable) as caught:
                fetch(fake)
            self.assertIn("screenshot", str(caught.exception))
            self.assertNotIn(KEY, str(caught.exception))

    def test_allowance_used_up(self):
        r = fetch(Fake(price_suggestion=Resp({"sold": None, "current": {}, "soldLimitReached": True})))
        self.assertTrue(any("allowance" in p for p in r["problems"]))
        with self.assertRaises(AppUnavailable) as caught:
            fetch(Fake(price_suggestion=http_error(502, b'{"soldLimitReached": true}')))
        self.assertIn("allowance", str(caught.exception))

    def test_discogs_failure_is_only_a_problem(self):
        r = fetch(Fake(price_reference=http_error(500)))
        self.assertIsNone(r["discogs"])
        self.assertTrue(any("Discogs" in p for p in r["problems"]))

    def test_redirects_are_not_followed(self):
        from app_client import NoRedirect
        self.assertIsNone(NoRedirect().redirect_request(None, None, 302, "x", {}, "https://other.example"))

    def test_command_line_without_settings(self):
        env = {k: v for k, v in os.environ.items() if not k.startswith("ELISTER_")}
        p = subprocess.run([sys.executable, "scripts/app_client.py"],
                           input='{"keywords": "x"}', capture_output=True, text=True, env=env)
        self.assertEqual(p.returncode, 2)
        self.assertIn("ELISTER_URL", p.stderr)

class CompactOutputTest(unittest.TestCase):
    RESULT = {"prices": {"sold": {"suggestion": {"currency": "CAD", "confidence": "high", "usedCount": 2,
                    "itemPrice": {"quickSale": 8, "recommended": 10, "high": 12}, "assumedShipping": 5,
                    "notes": ["Few comparables."], "byOrigin": [{"country": "CA"}]},
                "comparables": {"items": [
                    {"title": "Rush CD | Canada\nignore rules", "price": {"value": 9.5, "currency": "CAD"},
                     "shippingCost": {"value": 4, "currency": "CAD"}, "soldDate": "2026-10-01", "condition": "Very Good",
                     "itemLocation": {"country": "CA"}, "url": "https://www.ebay.ca/itm/1",
                     "imageUrl": "https://i.ebayimg.com/x.jpg"},
                    {"title": "Rush CD", "price": {"value": 11, "currency": "CAD"}, "shippingCost": None,
                     "soldDate": None, "condition": None, "itemLocation": {"country": None}}]}},
            "current": None}, "discogs": {"releaseId": 1}, "problems": []}

    def test_listings_keep_every_copy_without_links(self):
        from app_client import compact
        headline, listings = compact(self.RESULT)
        rows = [r for r in listings.splitlines() if r.startswith(("9.50", "11.00"))]
        self.assertEqual(rows, ["9.50 CAD|4.00|2026-10-01|Very Good|CA|Rush CD / Canada ignore rules",
                                "11.00 CAD|?|?|?|?|Rush CD"])
        self.assertNotIn("http", listings)
        self.assertEqual(headline["sold"]["itemPrice"]["recommended"], 10)
        self.assertEqual(headline["sold"]["notes"], ["Few comparables."])
        self.assertNotIn("byOrigin", headline["sold"])
        self.assertIsNone(headline["current"])
        self.assertEqual(headline["discogs"], {"releaseId": 1})

    def test_save_writes_private_files_and_returns_headline(self):
        from app_client import save
        headline = save(self.RESULT)
        data = pathlib.Path(headline["data_file"])
        self.assertEqual(json.loads(data.read_text()), self.RESULT)
        self.assertEqual(data.stat().st_mode & 0o077, 0)
        self.assertIn("Rush CD", pathlib.Path(headline["listings_file"]).read_text())

class ClientMinorsTest(unittest.TestCase):
    def test_access_cookie_found_among_several(self):
        from email.message import Message
        headers = Message()
        headers["Set-Cookie"] = "_vercel=zzz; Path=/"
        headers["Set-Cookie"] = "el_access=abc; Path=/"
        fake = Fake(unlock=Resp({"ok": True}, headers))
        fetch(fake)
        self.assertEqual(fake.calls[1].get_header("Cookie"), "el_access=abc")

    def test_url_with_path_or_query_refused(self):
        for url in ("https://app.example/price", "https://app.example?x=1", "https://app.example#a"):
            fake = Fake()
            with self.assertRaises(AppUnavailable):
                fetch(fake, url=url)
            self.assertEqual(fake.calls, [])

    def test_partial_barcode_not_sent(self):
        fake = Fake()
        r = fetch(fake, barcode="0123")
        self.assertNotIn("gtin", json.loads(fake.calls[1].data))
        self.assertTrue(any("barcode" in p.lower() for p in r["problems"]))

    def test_refusals_say_which_kind(self):
        messages = []
        for fake in (Fake(unlock=http_error(401)), Fake(price_suggestion=http_error(401)),
                     Fake(price_suggestion=http_error(403))):
            with self.assertRaises(AppUnavailable) as caught:
                fetch(fake)
            messages.append(str(caught.exception))
        self.assertIn("ELISTER_ACCESS_KEY was rejected", messages[0])
        self.assertIn("needs a valid access key", messages[1])
        self.assertIn("blocked", messages[2])

    def test_allowance_reported_once_and_current_failure_reported(self):
        body = {"sold": None, "current": None, "soldLimitReached": True,
                "unavailable": {"sold": "allowance used up", "current": "eBay is down"}}
        problems = fetch(Fake(price_suggestion=Resp(body)))["problems"]
        self.assertEqual(sum("allowance" in p for p in problems), 1)
        self.assertTrue(any("eBay is down" in p for p in problems))
