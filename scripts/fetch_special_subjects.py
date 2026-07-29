#!/usr/bin/env python3
"""Build the EECS special-subjects overlay (data/special_subjects.json).

Special subjects are the courses whose number carries an ``S`` after the dot
(e.g. ``6.S062``, ``18.S097``). The Fireroad ``/courses/all`` API *does* list
them with real scheduling/units data, but their ``title`` is a generic
placeholder ("Special Subject in Electrical Engineering and Computer Science").
The actual topic for a given term is only published on the EECS subject-updates
page, which is JS-rendered and therefore not reliably scrapable from the raw
URL.

So this script does two things, once per semester:

1.  Pull the canonical course records for EECS special subjects (6.* / 18.*)
    that are offered this term from the Fireroad API.
2.  Overlay the *specific* topic names from ``data/special_subject_names.json``
    (a small, hand-maintained map of ``{ "6.S062": "Topic title" }``). That map
    can be updated by hand, or grown automatically with ``--page <file>`` where
    ``<file>`` is a saved copy (text or HTML) of the EECS subject-updates page.

The result, ``data/special_subjects.json``, is merged into the live catalog by
``server/current/fireroad.js`` so the rest of the app (search, course detail,
agent tools) sees special subjects with real names. There is no frontend code
for this — it is purely a build-time data artifact.

Usage:
    python3 scripts/fetch_special_subjects.py
    python3 scripts/fetch_special_subjects.py --page saved_eecs_page.html
    python3 scripts/fetch_special_subjects.py --term "Fall 2026" --depts 6 18
"""

import argparse
import json
import re
from pathlib import Path
from urllib.request import Request, urlopen

COURSES_URL = "https://fireroad.mit.edu/courses/all?full=true"
ROOT_DIR = Path(__file__).resolve().parents[1]
NAMES_FILE = ROOT_DIR / "data" / "special_subject_names.json"
OUT_FILE = ROOT_DIR / "data" / "special_subjects.json"

# A special subject's number has an "S" immediately after the department dot,
# e.g. 6.S062, 18.S097, 6.S897. Match dept prefix + ".S" + digits.
SPECIAL_RE = re.compile(r"^(?P<dept>\d{1,2})\.S\d", re.IGNORECASE)
# Generic placeholder titles the API hands back when there is no real topic.
GENERIC_TITLE_RE = re.compile(r"special (subject|studies|problems|laboratory)", re.IGNORECASE)


def is_special(subject_id):
    return bool(SPECIAL_RE.match(str(subject_id or "")))


def in_depts(subject_id, depts):
    dept = str(subject_id or "").split(".", 1)[0]
    return dept in depts


def load_names():
    if NAMES_FILE.exists():
        try:
            return json.loads(NAMES_FILE.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            print(f"! {NAMES_FILE.name} is not valid JSON; ignoring it")
    return {}


def save_names(names):
    NAMES_FILE.write_text(
        json.dumps(names, indent=2, ensure_ascii=False, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def extract_names_from_page(text):
    """Best-effort: pull "6.S062 Topic Title" pairs out of saved page text/HTML.

    The live page is JS-rendered, so this is meant for a *saved* copy of the
    rendered page (Save As → text, or copy-paste). Returns { id: title }.
    """
    # Strip tags if this looks like HTML.
    if "<" in text and ">" in text:
        text = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", text, flags=re.S | re.I)
        text = re.sub(r"<[^>]+>", " ", text)
    found = {}
    # "6.S062: Title" or "6.S062 - Title" or "6.S062 Title"
    pattern = re.compile(
        r"\b((?:6|18)\.S\d{2,4}[A-Z]?)\b\s*[:\-–—]?\s*([A-Z][^\n|<>]{4,90})"
    )
    for m in pattern.finditer(text):
        cid = m.group(1).upper()
        title = m.group(2).strip(" .,:;-–—")
        if GENERIC_TITLE_RE.search(title):
            continue
        found.setdefault(cid, title)
    return found


def season_from_term(term):
    """Infer a Fireroad offering flag from a human-readable term label."""
    value = str(term or "").strip().lower()
    if not value:
        return None
    if "fall" in value or "autumn" in value:
        return "fall"
    if "spring" in value:
        return "spring"
    if "iap" in value or "january" in value:
        return "iap"
    if "summer" in value:
        return "summer"
    return None


def fetch_courses():
    request = Request(COURSES_URL, headers={"User-Agent": "Fireroad.ai catalog refresh"})
    with urlopen(request, timeout=60) as response:
        return json.load(response)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--term", default=None, help='Term label, e.g. "Fall 2026" (also selects the offering season)')
    parser.add_argument("--depts", nargs="+", default=["6", "18"], help="Department prefixes to include")
    parser.add_argument("--page", default=None, help="Path to a saved EECS subject-updates page (text/HTML) to mine names from")
    parser.add_argument("--season", choices=["fall", "spring", "iap", "summer"], default=None,
                        help="Only keep subjects offered in this season (default: fall or spring)")
    args = parser.parse_args()

    inferred_season = season_from_term(args.term)
    if args.term and not args.season and not inferred_season:
        parser.error('--term must name Fall, Spring, IAP/January, or Summer (or pass --season explicitly)')
    if args.season and inferred_season and args.season != inferred_season:
        parser.error(f'--term implies {inferred_season!r}, but --season is {args.season!r}')
    effective_season = args.season or inferred_season

    names = load_names()

    # Optionally grow the names map from a saved page.
    if args.page:
        page_text = Path(args.page).read_text(encoding="utf-8", errors="ignore")
        mined = extract_names_from_page(page_text)
        added = 0
        for cid, title in mined.items():
            if cid not in names:
                names[cid] = title
                added += 1
        print(f"Mined {len(mined)} name(s) from {args.page}; {added} new")
        if added:
            save_names(names)
            print(f"Updated {NAMES_FILE.name}")

    print(f"Fetching {COURSES_URL} ...")
    all_courses = fetch_courses()
    print(f"API returned {len(all_courses)} courses")

    depts = set(str(d) for d in args.depts)

    def offered_this_term(c):
        if effective_season:
            suffix = "IAP" if effective_season == "iap" else effective_season
            return bool(c.get(f"offered_{suffix}"))
        return bool(c.get("offered_fall") or c.get("offered_spring"))

    specials = [
        c for c in all_courses
        if is_special(c.get("subject_id"))
        and in_depts(c.get("subject_id"), depts)
        and not c.get("is_historical", False)
        and offered_this_term(c)
    ]
    print(f"Found {len(specials)} EECS special subject(s) offered this term")

    named = 0
    for c in specials:
        cid = str(c.get("subject_id", "")).upper()
        real = names.get(cid)
        if real:
            c["title"] = real
            c["special_topic"] = real
            c["has_real_title"] = True
            named += 1
        else:
            # Keep the generic API title but flag it so the UI/agent can say "topic TBA".
            c["has_real_title"] = not bool(GENERIC_TITLE_RE.search(str(c.get("title", ""))))

    specials.sort(key=lambda c: c.get("subject_id", ""))
    payload = {
        "generated_from": COURSES_URL,
        "term": args.term,
        "season": effective_season,
        "departments": sorted(depts),
        "count": len(specials),
        "named_count": named,
        "subjects": specials,
    }
    OUT_FILE.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {OUT_FILE} — {len(specials)} subjects, {named} with real topic names")
    if named < len(specials):
        missing = [c["subject_id"] for c in specials if not names.get(str(c["subject_id"]).upper())]
        print(f"\n{len(missing)} subject(s) still have generic titles. Add real names to")
        print(f"  {NAMES_FILE}")
        print("  e.g. {\"6.S062\": \"Machine Learning for Systems\"}")
        print("Sample missing:", ", ".join(missing[:12]))


if __name__ == "__main__":
    main()
