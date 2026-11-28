import json, os, pathlib, subprocess, sys, unittest
from tests import helpers  # noqa: F401  (adds scripts to the path)
from gate import research_needed, usage_gate

SCRIPT = pathlib.Path(__file__).resolve().parents[1] / "scripts/gate.py"

class UsageGateTest(unittest.TestCase):
    def test_stops_at_80_on_either_limit(self):
        self.assertTrue(usage_gate(79.9, 10)["go"])
        self.assertFalse(usage_gate(80, 10)["go"])
        self.assertFalse(usage_gate(10, 80)["go"])

    def test_rejects_missing_or_impossible_figures(self):
        for bad in (None, -1, 101, "x", True, float("nan")):
            self.assertRaises(ValueError, usage_gate, bad, 10)
            self.assertRaises(ValueError, usage_gate, 10, bad)

class ResearchNeededTest(unittest.TestCase):
    def test_starts_at_20_cad(self):
        self.assertTrue(research_needed(20))
        self.assertTrue(research_needed(45.5))
        self.assertFalse(research_needed(19.99))

    def test_no_price_means_no_research(self):
        for value in (None, "20", True, float("nan")):
            self.assertFalse(research_needed(value), value)

class CommandTest(unittest.TestCase):
    def run_gate(self, payload):
        return subprocess.run([sys.executable, str(SCRIPT)], input=json.dumps(payload), capture_output=True,
                              text=True, env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"})

    def test_usage_and_price(self):
        out = self.run_gate({"five_hour": 12, "weekly": 85})
        self.assertFalse(json.loads(out.stdout)["go"])
        out = self.run_gate({"price": 25})
        self.assertEqual(json.loads(out.stdout), {"research": True, "price": 25})
        out = self.run_gate({"price": None})
        self.assertEqual(json.loads(out.stdout), {"research": False, "price": None})

    def test_bad_input_fails_clearly(self):
        out = self.run_gate({"five_hour": 12})
        self.assertNotEqual(out.returncode, 0)
        self.assertIn("gate.py:", out.stderr)

if __name__ == "__main__":
    unittest.main()
