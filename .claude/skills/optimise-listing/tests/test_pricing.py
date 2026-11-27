import json, os, subprocess, sys, tempfile, unittest
from tests import helpers  # noqa: F401
from pricing import price_report

def side(q=10, f=20, h=30, used=10, items=(), confidence="medium"):
    return {"suggestion": {"currency": "CAD", "confidence": confidence, "usedCount": used,
                           "itemPrice": {"quickSale": q, "recommended": f, "high": h}},
            "comparables": {"items": [{"title": t, "price": {"value": v, "currency": "CAD"}} for t, v in items]}}

def sig(name, pct, sources=2):
    return {"name": name, "pct": pct,
            "evidence": [{"source": f"s{i}", "url": f"https://x/{i}", "date": "2026-11-01"} for i in range(sources)]}

def run(sold=None, current=None, dp=None, cur="CAD", signals=(), edition=None):
    return price_report({"sold": sold, "current": current}, dp, cur if dp else None, list(signals), edition)

class PricingTest(unittest.TestCase):
    def test_single_cap(self):
        self.assertEqual(run(side(), dp=20, signals=[sig("discogs", 40)])["total_pct"], 10)

    def test_combined_cap(self):
        names = ["discogs", "edition", "demand", "supply", "collector"]
        self.assertEqual(run(side(), signals=[sig(n, 99) for n in names])["total_pct"], 25)
        self.assertEqual(run(side(), signals=[sig(n, -99) for n in names])["total_pct"], -25)

    def test_applies_percentage(self):
        r = run(side(), dp=20, signals=[sig("discogs", 10)])
        self.assertEqual(r["prices"], {"quick": 10.99, "fair": 21.99, "patient": 32.99})
        self.assertEqual(r["basis"], "sold")

    def test_app_bounds_hold(self):
        r = run(side(), signals=[sig("discogs", 10), sig("edition", 10), sig("demand", 7)])
        self.assertEqual(r["prices"]["patient"], 34.5)

    def test_no_evidence_is_zero(self):
        self.assertEqual(run(side(), signals=[sig("demand", 7, 0)])["total_pct"], 0)

    def test_collector_needs_two_dated_distinct_sources(self):
        self.assertEqual(run(side(), signals=[sig("collector", 5, 1)])["total_pct"], 0)
        s = sig("collector", 5)
        s["evidence"][1]["date"] = ""
        self.assertEqual(run(side(), signals=[s])["total_pct"], 0)
        s = sig("collector", 5)
        s["evidence"][1] = dict(s["evidence"][0])
        self.assertEqual(run(side(), signals=[s])["total_pct"], 0)

    def test_thin_data(self):
        r = run(side(used=2), signals=[sig("collector", 5)])
        self.assertIsNone(r["prices"])
        self.assertEqual(r["confidence"], "low")
        self.assertEqual(r["total_pct"], 0)
        self.assertIn("sold", r["reference"])

    def test_current_only(self):
        r = run(None, side(confidence="high"))
        self.assertEqual((r["basis"], r["confidence"]), ("current", "low"))

    def test_nothing_found(self):
        r = run(None, None, dp=18)
        self.assertEqual(r["basis"], "none")
        self.assertIsNone(r["prices"])
        self.assertEqual(r["reference"]["discogs"]["price"], 18)

    def test_foreign_discogs_skipped(self):
        r = run(side(), dp=100, cur="USD", signals=[sig("discogs", 10), sig("edition", 10), sig("demand", 7)])
        self.assertEqual(r["total_pct"], 17)
        self.assertEqual(r["prices"]["patient"], 34.5)
        self.assertTrue(any("USD" in n for n in r["notes"]))

    def test_edition_price_wins(self):
        items = [("CD Canadian", 30), ("CD", 15), ("CD", 15)]
        r = run(side(items=items), signals=[sig("edition", 10)], edition="canadian")
        self.assertTrue(all(v >= 30 for v in r["prices"].values()))
        self.assertEqual(r["total_pct"], 0)

    def test_bad_input_rejected(self):
        for signals in ([sig("hype", 1)], [sig("demand", 1), sig("demand", 1)], [sig("demand", float("nan"))]):
            with self.assertRaises(ValueError):
                run(side(), signals=signals)

    def test_command_line_picks_grade_price(self):
        data = {"prices": {"sold": side(), "current": None}, "grade": "Near mint",
                "discogs": {"suggestions": {"Near Mint (NM or M-)": 40}, "suggestionCurrency": "CAD"},
                "signals": [sig("discogs", 10), sig("edition", 10), sig("demand", 5)]}
        p = subprocess.run([sys.executable, "scripts/pricing.py"],
                           input=json.dumps(data), capture_output=True, text=True)
        self.assertEqual(json.loads(p.stdout)["prices"]["patient"], 37.5)

    def test_discogs_signal_needs_a_discogs_price(self):
        r = run(side(), signals=[sig("discogs", 10)])
        self.assertEqual(r["total_pct"], 0)

    def cli(self, grade):
        data = {"prices": {"sold": side(), "current": None}, "grade": grade, "signals": [sig("discogs", 10)],
                "discogs": {"suggestions": {"Good (G)": 20}, "suggestionCurrency": "CAD"}}
        return subprocess.run([sys.executable, "scripts/pricing.py"],
                              input=json.dumps(data), capture_output=True, text=True)

    def test_missing_inlay_grade_is_good(self):
        self.assertEqual(json.loads(self.cli("Missing").stdout)["total_pct"], 10)

    def test_unrecognised_grade_rejected(self):
        p = self.cli("VG+")
        self.assertNotEqual(p.returncode, 0)
        self.assertIn("grade", p.stderr)

    def test_no_price_note_forbids_inventing_one(self):
        self.assertTrue(any("Do not state a price" in n for n in run(None, None, dp=30)["notes"]))

class PricingMinorsTest(unittest.TestCase):
    def test_unadjusted_prices_stay_as_the_app_gave_them(self):
        self.assertEqual(run(side(8.5, 10.25, 12))["prices"], {"quick": 8.5, "fair": 10.25, "patient": 12})

    def test_adjusted_price_endings_respect_limits(self):
        r = run(side(), signals=[sig("edition", 10), sig("demand", 7)])
        self.assertEqual(r["prices"], {"quick": 11.99, "fair": 22.99, "patient": 34.5})

    def test_supply_not_counted_twice_on_asking_prices(self):
        r = run(None, side(), signals=[sig("supply", 5)])
        self.assertEqual(r["total_pct"], 0)
        self.assertEqual(run(side(), signals=[sig("supply", 5)])["total_pct"], 5)

    def test_incomplete_pasted_side_is_ignored_with_a_note(self):
        broken = {"suggestion": {"currency": "CAD", "usedCount": 5, "itemPrice": {"recommended": 10}}}
        r = run(broken, side())
        self.assertEqual(r["basis"], "current")
        self.assertTrue(any("incomplete" in n for n in r["notes"]))
        self.assertEqual(run(broken)["basis"], "none")

    def test_command_line_reads_the_saved_data_file(self):
        saved = {"prices": {"sold": side(), "current": None},
                 "discogs": {"suggestions": {"Good (G)": 20}, "suggestionCurrency": "CAD"}}
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as handle:
            json.dump(saved, handle)
        self.addCleanup(os.unlink, handle.name)
        data = {"data_file": handle.name, "grade": "Good", "signals": [sig("discogs", 10)]}
        p = subprocess.run([sys.executable, "scripts/pricing.py"],
                           input=json.dumps(data), capture_output=True, text=True)
        self.assertEqual(json.loads(p.stdout)["total_pct"], 10, p.stderr)

class RoundingLimitTest(unittest.TestCase):
    def test_price_ending_never_exceeds_the_combined_cap(self):
        names = ["discogs", "edition", "demand"]
        r = run(side(2.99, 2.99, 2.99), dp=9, signals=[sig("discogs", 10), sig("demand", 7), sig("edition", 1)])
        self.assertLessEqual(r["prices"]["fair"], round(2.99 * 1.25, 2))

    def test_price_ending_never_reverses_the_adjustment(self):
        up = run(side(12.25, 12.25, 12.25), signals=[sig("demand", 1)])["prices"]["fair"]
        down = run(side(12.75, 12.75, 12.75), signals=[sig("demand", -1)])["prices"]["fair"]
        self.assertGreaterEqual(up, 12.25)
        self.assertLessEqual(down, 12.75)
