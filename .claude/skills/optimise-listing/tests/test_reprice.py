import json, os, pathlib, subprocess, sys, tempfile, unittest
from tests import helpers  # noqa: F401  (adds scripts to the path)
from reprice import reprice


def sale(value, title="Genesis Wind & Wuthering CD", currency="CAD"):
    return {"itemId": f"{title}{value}", "title": title, "price": {"value": value, "currency": currency}}


def plain(*values):
    return [sale(v) for v in values]


def canadian(*values):
    return [sale(v, "Genesis Wind & Wuthering CD Canada") for v in values]


def no_barcode(*values):
    return [sale(v, "Genesis Wind & Wuthering CD no barcode") for v in values]


class BaseTest(unittest.TestCase):
    def test_typical_price_of_3_sales(self):
        r = reprice(18, plain(10, 12, 14), [])
        self.assertEqual((r["base"], r["count"], r["proposed"]), (12, 3, 12))
        self.assertIsNone(r["applied_detail"])
        self.assertIsNone(r["pending"])

    def test_fewer_than_3_sales_keeps_the_price(self):
        r = reprice(18, plain(10, 12), [])
        self.assertIsNone(r["base"])
        self.assertEqual(r["proposed"], 18)
        self.assertFalse(r["over_50"])

    def test_non_cad_sales_are_ignored(self):
        r = reprice(18, plain(10, 12) + [sale(14, currency="USD")], [])
        self.assertEqual((r["base"], r["count"], r["proposed"]), (None, 2, 18))

    def test_missing_current_price_proposes_nothing(self):
        r = reprice(None, plain(10, 12, 14), [])
        self.assertEqual(r["base"], 12)
        self.assertIsNone(r["proposed"])
        self.assertFalse(r["over_50"])


class DetailTest(unittest.TestCase):
    def test_two_matching_sales_set_the_price_and_flag_a_big_change(self):
        r = reprice(10, plain(10, 11, 12) + canadian(20, 22), ["canadian"])
        self.assertEqual(r["proposed"], 21)
        self.assertEqual(r["applied_detail"], "canadian")
        self.assertTrue(r["over_50"])
        self.assertIn("Canadian", r["reason"])

    def test_one_matching_sale_is_only_pending(self):
        r = reprice(12, plain(10, 11, 12) + canadian(30), ["canadian"])
        self.assertEqual(r["proposed"], 11.5)
        self.assertIsNone(r["applied_detail"])
        self.assertEqual(r["pending"], {"detail": "canadian", "price": 30})

    def test_several_details_take_the_highest_not_the_sum(self):
        r = reprice(15, plain(10, 11, 12) + canadian(20, 22) + no_barcode(24, 26), ["canadian", "no_barcode"])
        self.assertEqual(r["proposed"], 25)
        self.assertEqual(r["applied_detail"], "no_barcode")

    def test_matching_sales_not_higher_are_ignored(self):
        r = reprice(12, plain(10, 11, 12) + canadian(9, 10), ["canadian"])
        self.assertIsNone(r["applied_detail"])
        self.assertEqual(r["proposed"], 10)

    def test_every_sale_matching_is_the_album_name_not_a_detail(self):
        r = reprice(12, canadian(10, 12, 14), ["canadian"])
        self.assertIsNone(r["applied_detail"])
        self.assertIsNone(r["pending"])
        self.assertEqual(r["proposed"], 12)

    def test_unconfirmed_detail_is_ignored(self):
        r = reprice(10, plain(10, 11, 12) + canadian(20, 22), [])
        self.assertIsNone(r["applied_detail"])
        self.assertEqual(r["proposed"], 12)

    def test_no_detail_raise_without_a_base(self):
        r = reprice(10, canadian(20, 22), ["canadian"])
        self.assertIsNone(r["base"])
        self.assertEqual(r["proposed"], 10)
        self.assertIsNone(r["applied_detail"])
        self.assertIsNone(r["pending"])

    def test_pending_only_when_above_the_proposed_price(self):
        r = reprice(15, plain(10, 11, 12) + canadian(20, 22) + no_barcode(16), ["canadian", "no_barcode"])
        self.assertEqual(r["proposed"], 21)
        self.assertIsNone(r["pending"])

    def test_change_of_exactly_50_percent_is_not_flagged(self):
        self.assertFalse(reprice(8, plain(10, 12, 14), [])["over_50"])
        self.assertTrue(reprice(7.99, plain(10, 12, 14), [])["over_50"])
        self.assertTrue(reprice(30, plain(10, 12, 14), [])["over_50"])

    def test_unknown_detail_name_is_refused(self):
        with self.assertRaises(ValueError):
            reprice(10, plain(10, 11, 12), ["rare"])


class KeepIfLowerTest(unittest.TestCase):
    def test_short_name_sales_never_lower_the_price(self):
        r = reprice(12.99, plain(4, 5, 6), [], keep_if_lower=True)
        self.assertEqual((r["base"], r["proposed"], r["over_50"]), (5, 12.99, False))
        self.assertIn("short name", r["reason"])

    def test_the_lower_price_is_offered_separately(self):
        r = reprice(12.99, plain(4, 5, 6), [], keep_if_lower=True)
        self.assertEqual(r["lower"], {"price": 5, "over_50": True})
        self.assertIsNone(reprice(8, plain(10, 12, 14), [], keep_if_lower=True)["lower"])
        self.assertIsNone(reprice(12.99, plain(4, 5, 6), [])["lower"])

    def test_short_name_sales_may_still_raise_it(self):
        self.assertEqual(reprice(8, plain(10, 12, 14), [], keep_if_lower=True)["proposed"], 12)

    def test_without_the_flag_a_lower_price_is_proposed(self):
        self.assertEqual(reprice(12.99, plain(4, 5, 6), [])["proposed"], 5)


class CommandTest(unittest.TestCase):
    def test_reads_only_the_same_grade_sales_of_a_sold_file(self):
        items = plain(10, 12, 14) + [sale(99, "Genesis Wind & Wuthering CD Good")]
        stored = {"lookup": {"queries": [{"by": "keywords", "items": items}]},
                  "filtered": {"sameGrade": [i["itemId"] for i in items[:3]]}}
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, "sold.json")
            pathlib.Path(path).write_text(json.dumps(stored))
            out = subprocess.run([sys.executable, "scripts/reprice.py"], capture_output=True, text=True,
                                 input=json.dumps({"current": 18, "data_file": path, "details": []}),
                                 env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"})
        self.assertEqual(json.loads(out.stdout)["proposed"], 12)


if __name__ == "__main__":
    unittest.main()
