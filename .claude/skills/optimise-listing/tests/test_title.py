import json, subprocess, sys, unittest
from tests import helpers  # noqa: F401
from title import build_title

NM = "Near mint"

class TitleTest(unittest.TestCase):
    def test_short_grades_when_they_rescue_a_term(self):
        r = build_title("Pink Floyd The Dark Side of the Moon", NM, NM, extras=["1973"])
        self.assertEqual(r["title"], "Pink Floyd The Dark Side of the Moon 1973 CD (NM/NM)")
        self.assertTrue(r["short_grades"])
        self.assertEqual(r["dropped"], [])

    def test_long_grades_when_term_already_fits(self):
        r = build_title("Pink Floyd Wish You Were Here", NM, NM, extras=["1975"])
        self.assertTrue(r["title"].endswith("1975 CD (Disc: Near Mint / Inlay: Near Mint)"))
        self.assertFalse(r["short_grades"])

    def test_shorter_variant_fitting_long_keeps_long(self):
        r = build_title("Pink Floyd Wish You Were Here", NM, NM, extras=["Rare Canadian Press||Canada"])
        self.assertIn("Canada CD (Disc:", r["title"])
        self.assertFalse(r["short_grades"])

    def test_one_grade_never_shortens(self):
        r = build_title("A" * 55, NM, None, extras=["Remastered"])
        self.assertFalse(r["short_grades"])
        self.assertEqual(r["dropped"], ["Remastered"])

    def test_missing_inlay_short_form(self):
        r = build_title("Pink Floyd The Dark Side of the Moon", NM, "Missing", extras=["Remastered 1973"])
        self.assertIn("(NM/Missing)", r["title"])

    def test_album_needing_short_form_is_not_cut(self):
        album = "B" * 60
        r = build_title(album, NM, NM)
        self.assertTrue(r["short_grades"])
        self.assertTrue(r["title"].startswith(album))
        self.assertLessEqual(len(r["title"]), 80)

    def test_overlong_album_reports_no_fit(self):
        r = build_title("C" * 81, NM, NM)
        self.assertFalse(r["fits"])
        self.assertIn("C" * 81, r["title"])

    def test_sealed_and_multi_disc(self):
        r = build_title("The Beatles", None, None, sealed=True, discs=2)
        self.assertEqual(r["title"], "The Beatles 2CD (Sealed)")

    def test_rare_once_and_no_repeats(self):
        r = build_title("Rush Moving Pictures", NM, NM, extras=["Rare Promo", "Rare Club", "Rush", "Rare"])
        self.assertEqual(r["title"].lower().count("rare"), 1)
        self.assertEqual(r["title"].count("Rush"), 1)

    def test_unknown_grade_rejected(self):
        with self.assertRaises(ValueError):
            build_title("X", "Excellent", NM)

    def test_short_form_never_trades_away_a_higher_term(self):
        extras = ["Rare Canadian First Pressing Limited Run||Canada", "Anthem Recs", "1981"]
        r = build_title("Rush Moving Pictures", NM, NM, extras=extras)
        self.assertTrue("Anthem Recs" in r["title"] or r["short_grades"] is False)

    def test_trailing_format_word_not_doubled(self):
        for album in ("Rush Moving Pictures CD", "Rush Moving Pictures - Compact Disc"):
            self.assertTrue(build_title(album, NM, NM)["title"].startswith("Rush Moving Pictures CD ("))

    def test_command_line_json(self):
        p = subprocess.run([sys.executable, "scripts/title.py"],
                           input=json.dumps({"album": "X", "disc": NM, "booklet": NM}), capture_output=True, text=True)
        self.assertEqual(json.loads(p.stdout)["title"], "X CD (Disc: Near Mint / Inlay: Near Mint)")

class TitleMinorsTest(unittest.TestCase):
    def test_disc_count_as_text(self):
        self.assertIn("2CD", build_title("X", NM, NM, discs="2")["title"])

    def test_bad_disc_count_rejected_clearly(self):
        for discs in ("two", 0, 1.5):
            with self.assertRaises(ValueError):
                build_title("X", NM, NM, discs=discs)

    def test_conflicting_disc_term_is_reported(self):
        self.assertEqual(build_title("X", NM, NM, extras=["2CD"])["dropped"], ["2CD"])
        self.assertEqual(build_title("X", NM, NM, extras=["2CD"], discs=2)["dropped"], [])
