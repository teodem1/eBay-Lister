import json, os, pathlib, subprocess, sys, tempfile, unittest
from tests import helpers  # noqa: F401  (adds scripts to the path)
from reprice import engagement_level, reprice


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
        self.assertEqual((r["base"], r["count"], r["target"]), (12, 3, 12))
        self.assertEqual(r["proposed"], 14.12)  # room for an 85% offer
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
        self.assertEqual((r["target"], r["proposed"]), (11.5, 12))
        self.assertIsNone(r["applied_detail"])
        self.assertEqual(r["pending"], {"detail": "canadian", "price": 30})

    def test_several_details_take_the_highest_not_the_sum(self):
        r = reprice(15, plain(10, 11, 12) + canadian(20, 22) + no_barcode(24, 26), ["canadian", "no_barcode"])
        self.assertEqual(r["proposed"], 25)
        self.assertEqual(r["applied_detail"], "no_barcode")

    def test_matching_sales_not_higher_are_ignored(self):
        r = reprice(12, plain(10, 11, 12) + canadian(9, 10), ["canadian"])
        self.assertIsNone(r["applied_detail"])
        self.assertEqual((r["target"], r["proposed"]), (10, 11.76))

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


class DemandTest(unittest.TestCase):
    def test_interest_sets_where_in_the_range_the_price_lands(self):
        sales = plain(10, 12, 14, 16)
        self.assertEqual(reprice(13, sales, [])["target"], 13)  # normal: median
        self.assertEqual(reprice(13, sales, [], demand="low")["target"], 11.5)
        self.assertEqual(reprice(13, sales, [], demand="high")["target"], 14.5)
        self.assertEqual(reprice(13, sales, [], demand="high")["proposed"], 14.5)
        self.assertEqual(reprice(13, sales, [], demand="high")["demand"], "high")

    def test_a_lower_price_is_proposed_like_any_other(self):
        r = reprice(12.99, plain(4, 5, 6), [], demand="low")
        self.assertEqual((r["target"], r["proposed"]), (4.5, 5.29))
        self.assertTrue(r["over_50"])
        self.assertNotIn("lower", r)

    def test_interest_needs_3_sales_like_the_base(self):
        self.assertEqual(reprice(12, plain(10, 30), [], demand="high")["proposed"], 12)

    def test_penny_and_far_too_low_sales_are_left_out(self):
        r = reprice(12.99, plain(0.01, 4.43, 5.0, 5.74, 6.0, 21.36), [], demand="low")
        self.assertEqual(r["count"], 5)
        self.assertGreaterEqual(r["proposed"], 4.43)
        self.assertIn("left out", r["reason"])
        self.assertEqual(reprice(10, plain(1.5, 9, 10, 11), [])["count"], 3)  # under a third of the median

    def test_unknown_interest_is_refused(self):
        with self.assertRaises(ValueError):
            reprice(12, plain(10, 12, 14), [], demand="huge")


def dated(*days_ago, saved="2026-11-28T00:00:00.000Z"):
    import datetime
    end = datetime.datetime(2026, 11, 28)
    return [{"soldDate": (end - datetime.timedelta(days=d)).date().isoformat()} for d in days_ago], saved


class EngagementTest(unittest.TestCase):
    def test_few_listed_against_steady_sales_is_high(self):
        sales, saved = dated(5, 20, 40, 60, 80, 100)        # 6 sales over 100 days: 1.8 a month
        r = engagement_level(sales, saved, listed=3)
        self.assertEqual(r["level"], "high")
        self.assertEqual((r["sold"], r["listed"], r["days"]), (6, 3, 100))
        self.assertAlmostEqual(r["months_of_supply"], 1.7, places=1)

    def test_many_listed_against_slow_sales_is_low(self):
        sales, saved = dated(30, 200, 360)                   # 3 sales a year
        self.assertEqual(engagement_level(sales, saved, listed=40)["level"], "low")

    def test_in_between_is_normal(self):
        sales, saved = dated(10, 40, 70, 100, 130, 160)      # about 1.1 a month
        self.assertEqual(engagement_level(sales, saved, listed=8)["level"], "normal")

    def test_none_listed_with_sales_is_high_and_none_sold_with_listings_is_low(self):
        sales, saved = dated(10, 50)
        self.assertEqual(engagement_level(sales, saved, listed=0)["level"], "high")
        self.assertEqual(engagement_level([], saved, listed=5)["level"], "low")

    def test_no_data_is_normal(self):
        self.assertEqual(engagement_level([], "2026-11-28T00:00:00.000Z", listed=0)["level"], "normal")

    def test_a_short_span_counts_as_30_days(self):
        sales, saved = dated(1, 2)
        self.assertEqual(engagement_level(sales, saved, listed=1)["days"], 30)

    def test_sales_without_dates_count_over_a_year(self):
        r = engagement_level([{"soldDate": None}] * 6, "2026-11-28T00:00:00.000Z", listed=1)
        self.assertEqual(r["days"], 365)

    def test_a_capped_count_is_said(self):
        sales, saved = dated(5, 20, 40)
        self.assertIn("or more", engagement_level(sales, saved, listed=200, capped=True)["reason"])


class BestOfferTest(unittest.TestCase):
    def test_a_drop_leaves_room_for_an_85_percent_offer(self):
        r = reprice(28.99, plain(10, 11.4, 12), [])
        self.assertEqual(r["target"], 11.4)
        self.assertEqual(r["proposed"], 13.41)
        self.assertIn("offer", r["reason"])

    def test_room_for_offers_never_goes_above_todays_price(self):
        r = reprice(12, plain(10, 11, 12), [])
        self.assertEqual((r["target"], r["proposed"]), (11, 12))

    def test_a_raise_is_unchanged(self):
        r = reprice(8, plain(10, 12, 14), [])
        self.assertEqual((r["target"], r["proposed"]), (12, 12))

    def test_over_50_is_judged_on_the_price_listed(self):
        self.assertFalse(reprice(20, plain(8, 9, 10), [])["over_50"])  # 9 / 0.85 = 10.59: a 47% drop


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
        self.assertEqual(json.loads(out.stdout)["target"], 12)


if __name__ == "__main__":
    unittest.main()
