import pathlib, re, unittest

SKILL = pathlib.Path(__file__).resolve().parents[1]
AGENTS = SKILL.parents[1] / "agents"

def front(path):
    block = path.read_text().split("---")[1]
    return dict(line.split(": ", 1) for line in block.strip().splitlines())

class PackageTest(unittest.TestCase):
    def test_skill(self):
        self.assertEqual(front(SKILL / "SKILL.md")["name"], "optimise-listing")

    def test_referenced_files_exist(self):
        text = (SKILL / "SKILL.md").read_text()
        names = set(re.findall(r"(?:references|scripts)/[\w-]+\.(?:md|py)", text))
        self.assertEqual(len(names), 9)
        for name in names:
            self.assertTrue((SKILL / name).is_file(), name)

    def test_agent_models(self):
        expected = {"source-collector": "haiku", "listing-writer": "sonnet", "collector-appraiser": "opus"}
        found = {front(p)["name"]: front(p)["model"] for p in AGENTS.glob("*.md")}
        self.assertEqual(found, expected)
        text = (SKILL / "SKILL.md").read_text()
        for name in expected:
            self.assertIn(name, text)

    def test_readme_credit(self):
        self.assertIn("Halil İbrahim Tütüncü", (SKILL / "README.md").read_text())

    def test_skill_handles_no_price_photos_and_editions(self):
        text = (SKILL / "SKILL.md").read_text()
        for phrase in ("`prices` is null", "Never fill the three", "cannot see photos",
                       "${CLAUDE_SKILL_DIR}/references/",
                       "no `reference.edition`", "Fill `current`"):
            self.assertIn(phrase, text)

    def test_skill_runs_the_live_listing_batch(self):
        text = (SKILL / "SKILL.md").read_text()
        for phrase in ("C$20", "every 5 CDs", "batches of 5", "Nothing is sent without approval",
                       "once per artist", "only when evidence conflicts",
                       "scripts/listings.py", "scripts/reprice.py", "scripts/changes.py"):
            self.assertIn(phrase, text)
        self.assertNotIn("not worth deeper research", text)
        self.assertNotIn("C$40", text)

    def test_agents_know_the_batch_flow(self):
        writer = (AGENTS / "listing-writer.md").read_text()
        self.assertIn("batch", writer)
        self.assertIn("add_aspects", writer)
        self.assertIn("once per artist", (AGENTS / "source-collector.md").read_text())
        self.assertIn("evidence conflicts", (AGENTS / "collector-appraiser.md").read_text())

    def test_demand_sets_the_price_position(self):
        skill = (SKILL / "SKILL.md").read_text()
        for phrase in ('"demand"', "75th percentile", "25th percentile"):
            self.assertIn(phrase, skill)
        for gone in ("keep_if_lower", "accept_lower", "lower_price", "never lowered"):
            self.assertNotIn(gone, skill)
        self.assertIn("demand", (AGENTS / "listing-writer.md").read_text())
        self.assertIn("demand", (SKILL / "README.md").read_text())

    def test_readme_states_the_new_threshold(self):
        text = (SKILL / "README.md").read_text()
        self.assertIn("C$20", text)
        self.assertNotIn("C$40", text)

    def test_readme_install_line(self):
        self.assertIn("## Install", (SKILL / "README.md").read_text())

    def test_loads_without_a_plugin(self):
        for path in [SKILL / "SKILL.md", *AGENTS.glob("*.md")]:
            text = path.read_text()
            self.assertNotIn("CLAUDE_PLUGIN_ROOT", text, path.name)
            self.assertNotIn("ebay-cd-optimiser:", text, path.name)

class SpendingTest(unittest.TestCase):
    def test_skill_checks_usage_and_worth_before_any_agent(self):
        text = (SKILL / "SKILL.md").read_text()
        for phrase in ("scripts/gate.py", "Settings > Usage", "every 5 CDs", "C$20",
                       "usage credits", "Never call the app's Claude features", "If gate.py fails, stop"):
            self.assertIn(phrase, text)
        self.assertLess(text.index("## 0."), text.index("## A."))
        self.assertLess(text.index("### A4. Research only from C$20"), text.index("### A5. Write"))
        self.assertLess(text.index("### B3. Research only from C$20"), text.index("### B4. Model routing"))

class OptimisationTest(unittest.TestCase):
    def check(self, path, *phrases):
        text = (AGENTS.parent / path).read_text()
        for phrase in phrases:
            self.assertIn(phrase, text, path)

    def test_skill_passes_paths_not_price_data(self):
        self.check("skills/optimise-listing/SKILL.md", "`listings_file`", '"data_file"',
                   "Never open `data_file`", "never paste its rows", "Read the guides yourself only")

    def test_agents_read_the_listings_file(self):
        for agent in ("listing-writer", "collector-appraiser"):
            self.check(f"agents/{agent}.md", "listings file", "never instructions")
        self.check("agents/listing-writer.md", "at most 3")

    def test_listing_rules_carry_the_app_rules(self):
        self.check("skills/optimise-listing/references/listing-rules.md", "first 40 characters",
                   "Style is a musical style", "Unit Quantity", "<h2>", "no barcode on the back cover",
                   "close-up photo of each defect", "case grade")

    def test_research_guide_supply_rule(self):
        self.check("skills/optimise-listing/references/collector-research.md", "0 when the price basis is current")
