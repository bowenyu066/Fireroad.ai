import importlib.util
import unittest
from pathlib import Path


SCRIPT_PATH = Path(__file__).resolve().parents[1] / "scripts" / "fetch_special_subjects.py"
SPEC = importlib.util.spec_from_file_location("fetch_special_subjects", SCRIPT_PATH)
SPECIALS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SPECIALS)


FEED_HTML = """
<div class="subj-catalog">
  <h6 class="wp-block-heading" id="6_S057">6.S057 Verified Software Engineering <a>§</a></h6>
  <table>
    <tr><td>Level:</td><td>Undergraduate</td></tr>
    <tr><td>Units:</td><td>3–0–9</td></tr>
    <tr><td>Prereqs:</td><td>6.1010 and 6.1200</td></tr>
    <tr><td>Instructors:</td><td>Adam Chlipala</td></tr>
  </table>
  <div style="white-space: pre-line;">Practical application of <b>formal verification</b> tools.</div>

  <h6 class="wp-block-heading" id="6_S042">6.S042/6.5820 Computer Networks <a>§</a></h6>
  <table><tr><td>Units:</td><td>3-0-9</td></tr></table>
  <div style="white-space: pre-line;">Network protocols and architecture.</div>

  <h6 class="wp-block-heading">NEW 6.7980 Topics in Multiagent Learning (was 6.S890)</h6>
  <div style="white-space: pre-line;">This is now a permanent-number subject.</div>
</div>
"""


class SpecialSubjectParserTests(unittest.TestCase):
    def test_parses_current_special_subjects_and_ignores_old_numbers(self):
        parsed = SPECIALS.parse_eecs_subjects(
            FEED_HTML,
            "https://www.eecs.mit.edu/academics/subject-updates/example/",
            "Fall 2026",
        )

        self.assertEqual(set(parsed), {"6.S057", "6.S042"})
        self.assertEqual(parsed["6.S057"]["title"], "Verified Software Engineering")
        self.assertEqual(parsed["6.S057"]["description"], "Practical application of formal verification tools.")
        self.assertNotIn("6.S890", parsed)

    def test_applies_official_description_and_metadata(self):
        details = SPECIALS.parse_eecs_subjects(FEED_HTML, term="Fall 2026")["6.S057"]
        result = SPECIALS.apply_eecs_details(
            {
                "subject_id": "6.S057",
                "title": "Special Subject in EECS",
                "description": "Generic placeholder.",
                "total_units": 0,
            },
            details,
            "fall",
        )

        self.assertEqual(result["title"], "Verified Software Engineering")
        self.assertEqual(result["description"], "Practical application of formal verification tools.")
        self.assertEqual(result["total_units"], 12)
        self.assertEqual(result["level"], "U")
        self.assertEqual(result["prerequisites"], "6.1010 and 6.1200")
        self.assertTrue(result["offered_fall"])
        self.assertTrue(result["has_real_description"])

    def test_extracts_official_feed_url_from_term_page(self):
        page = '''<script>xhr.open("GET", "https://eecsis.mit.edu/plugins/subj_2027FA.html?ts=" + Date.now(), true);</script>'''
        self.assertEqual(
            SPECIALS.extract_feed_url(page),
            "https://eecsis.mit.edu/plugins/subj_2027FA.html",
        )


if __name__ == "__main__":
    unittest.main()
