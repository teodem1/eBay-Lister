import json, os, pathlib, subprocess, sys, tempfile, unittest
from tests import helpers  # noqa: F401  (adds scripts to the path)
from gate import research_gate, usage_gate

SCRIPT = pathlib.Path(__file__).resolve().parents[1] / "scripts/gate.py"

def item(value, title="Rush 2112 CD", currency="CAD"):
    return {"title": title, "price": {"value": value, "currency": currency}}

def prices(recommended, used=6, currency="CAD", items=()):
    return {"sold": {"suggestion": {"currency": currency, "usedCount": used,
            "itemPrice": {"quickSale": recommended - 2, "recommended": recommended, "high": recommended + 2}},
            "comparables": {"items": list(items)}}, "current": None}

def gate(*args, **kw):
    return research_gate(prices(*args, **kw), None, True)

class UsageGateTest(unittest.TestCase):
    def test_stops_at_80_on_either_limit(self):
        self.assertTrue(usage_gate(79.9, 10)["go"])
        self.assertFalse(usage_gate(80, 10)["go"])
        self.assertFalse(usage_gate(10, 80)["go"])

    def test_rejects_missing_or_impossible_figures(self):
        for bad in (None, -1, 101, "x", True, float("nan")):
            self.assertRaises(ValueError, usage_gate, bad, 10)
            self.assertRaises(ValueError, usage_gate, 10, bad)

class ResearchGateTest(unittest.TestCase):
    def test_starts_at_40(self):
        self.assertTrue(gate(40)["go"])
        self.assertFalse(gate(39.99)["go"])

    def test_needs_3_cad_sales(self):
        self.assertFalse(gate(50, used=2)["go"])
        self.assertFalse(gate(50, currency="USD")["go"])
        self.assertFalse(research_gate({"sold": None}, None, True)["go"])
        self.assertFalse(research_gate({"sold": None, "current": prices(90)["sold"]}, None, True)["go"])

    def test_edition_sales_count_from_3_copies(self):
        others = [item(17), item(17), item(17)]
        canada = [item(45, "Rush 2112 CD Canada")] * 3
        three = prices(20, items=others + canada)
        self.assertEqual(research_gate(three, None, True)["price"], 45)
        self.assertFalse(research_gate(three, None, False)["go"])
        self.assertFalse(research_gate(prices(20, items=others + canada[:2]), None, True)["go"])
        promo = prices(20, items=others + [item(60, "Rush 2112 Promo CD")] * 3)
        self.assertEqual(research_gate(promo, "promo", False)["price"], 60)
        usd = prices(20, items=others + [item(45, "Rush 2112 CD Canada", "USD")] * 3)
        self.assertFalse(research_gate(usd, None, True)["go"])

class EditionInputTest(unittest.TestCase):
    def test_unknown_edition_text_falls_back_to_the_typical_price(self):
        for text in ("Japanese pressing", "", None, "none"):
            self.assertTrue(research_gate(prices(50), text, True)["go"], text)

    def test_an_edition_every_copy_matches_is_ignored(self):
        japan = prices(20, items=[item(60, "Made in Japan CD")] * 4)
        self.assertFalse(research_gate(japan, "japan", False)["go"])

class CommandTest(unittest.TestCase):
    def run_gate(self, payload):
        return subprocess.run([sys.executable, str(SCRIPT)], input=json.dumps(payload), capture_output=True,
                              text=True, env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"})

    def test_usage_and_data_file(self):
        out = self.run_gate({"five_hour": 12, "weekly": 85})
        self.assertFalse(json.loads(out.stdout)["go"])
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, "data.json")
            pathlib.Path(path).write_text(json.dumps({"prices": prices(55)}))
            out = self.run_gate({"data_file": path, "edition": "none", "bought_in_canada": True})
        self.assertEqual(json.loads(out.stdout)["price"], 55)

    def test_bad_input_fails_clearly(self):
        out = self.run_gate({"five_hour": 12})
        self.assertNotEqual(out.returncode, 0)
        self.assertIn("gate.py:", out.stderr)

if __name__ == "__main__":
    unittest.main()
