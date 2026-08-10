#!/usr/bin/env python3
"""Build the term-specific EECS special-subject overlay.

Fireroad provides canonical catalog records for subjects such as ``6.S057``,
but those records often have a generic title and description. MIT EECS
publishes the actual topic, description, instructors, units, prerequisites,
schedule, and degree attributes on its Subject Updates page each semester.

With ``--term``, this script discovers the official EECS Subject Updates page,
follows its public EECSIS data feed, and overlays those term-specific facts on
the Fireroad catalog records. ``--page`` remains available for a saved HTML/text
copy, and ``data/special_subject_names.json`` remains a curated fallback when
the official page has no matching entry.

Usage:
    python3 scripts/fetch_special_subjects.py --term "Fall 2026"
    python3 scripts/fetch_special_subjects.py --term "Fall 2026" --eecs-url URL
    python3 scripts/fetch_special_subjects.py --page saved_eecs_page.html --no-eecs
"""

import argparse
import html
import json
import re
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin
from urllib.request import Request, urlopen

COURSES_URL = "https://fireroad.mit.edu/courses/all?full=true"
EECS_UPDATES_INDEX_URL = "https://www.eecs.mit.edu/academics/subject-updates/"
ROOT_DIR = Path(__file__).resolve().parents[1]
NAMES_FILE = ROOT_DIR / "data" / "special_subject_names.json"
OUT_FILE = ROOT_DIR / "data" / "special_subjects.json"
USER_AGENT = "Fireroad.ai special-subject refresh"

# A special subject's number has an "S" immediately after the department dot,
# e.g. 6.S062, 18.S097, 6.S897. Match dept prefix + ".S" + digits.
SPECIAL_RE = re.compile(r"^(?P<dept>\d{1,2})\.S\d", re.IGNORECASE)
SPECIAL_ID_RE = re.compile(r"\b(?:6|18)\.S\d{2,4}[A-Z]?\b", re.IGNORECASE)
GENERIC_TITLE_RE = re.compile(r"special (subject|studies|problems|laboratory)", re.IGNORECASE)


class _TextExtractor(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []

    def handle_data(self, data):
        self.parts.append(data)


def clean_text(value):
    """Convert a small HTML fragment into normalized plain text."""
    parser = _TextExtractor()
    parser.feed(str(value or ""))
    text = html.unescape("".join(parser.parts)).replace("\xa0", " ")
    return " ".join(text.split())


def fetch_text(url):
    request = Request(url, headers={"User-Agent": USER_AGENT})
    with urlopen(request, timeout=60) as response:
        charset = response.headers.get_content_charset() or "utf-8"
        return response.read().decode(charset, errors="replace")


def fetch_json(url):
    return json.loads(fetch_text(url))


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
    """Best-effort fallback for copied text or old saved Subject Updates pages."""
    if "<" in text and ">" in text:
        text = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", text, flags=re.S | re.I)
        text = re.sub(r"<[^>]+>", " ", text)
    found = {}
    pattern = re.compile(
        r"\b((?:6|18)\.S\d{2,4}[A-Z]?)\b\s*[:\-–—]?\s*([A-Z][^\n|<>]{4,90})"
    )
    for match in pattern.finditer(text):
        course_id = match.group(1).upper()
        title = match.group(2).strip(" .,:;-–—")
        if GENERIC_TITLE_RE.search(title):
            continue
        found.setdefault(course_id, title)
    return found


def extract_term_page_url(index_html, term):
    """Find the official WordPress Subject Updates page for a term."""
    target = f"subject updates {term}".casefold()
    for match in re.finditer(r"<a\b[^>]*href=[\"']([^\"']+)[\"'][^>]*>(.*?)</a>", index_html, re.I | re.S):
        if clean_text(match.group(2)).casefold() == target:
            return urljoin(EECS_UPDATES_INDEX_URL, html.unescape(match.group(1)))
    raise ValueError(f"Could not find an EECS Subject Updates page for {term!r}")


def extract_feed_url(term_page_html):
    """Extract the public EECSIS HTML feed loaded by the WordPress page."""
    match = re.search(
        r"https://eecsis\.mit\.edu/plugins/subj_[A-Za-z0-9_-]+\.html",
        term_page_html,
        re.I,
    )
    if not match:
        raise ValueError("The EECS Subject Updates page did not expose its EECSIS feed URL")
    return html.unescape(match.group(0))


def discover_eecs_sources(term):
    index_html = fetch_text(EECS_UPDATES_INDEX_URL)
    term_page_url = extract_term_page_url(index_html, term)
    term_page_html = fetch_text(term_page_url)
    return term_page_url, extract_feed_url(term_page_html)


def parse_units_total(value):
    text = re.sub(r"[–—−]", "-", str(value or ""))
    triplet = re.search(
        r"(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)",
        text,
    )
    if triplet:
        total = sum(float(part) for part in triplet.groups())
    else:
        number = re.search(r"\d+(?:\.\d+)?", text)
        if not number:
            return None
        total = float(number.group(0))
    return int(total) if total.is_integer() else total


def parse_level(value):
    level = str(value or "").casefold()
    has_undergraduate = "undergraduate" in level
    has_graduate = "graduate" in level.replace("undergraduate", "")
    if has_undergraduate and has_graduate:
        return "U/G"
    if level in {"u/g", "ug"}:
        return "U/G"
    if has_undergraduate or level == "u":
        return "U"
    if has_graduate or level == "g":
        return "G"
    return None


def parse_eecs_subjects(page_html, page_url=None, term=None):
    """Parse current special-subject records from an EECSIS Subject Updates feed.

    Only headings whose *current* number begins with 6.S/18.S are included.
    This deliberately ignores permanent courses described as "was 6.S...".
    """
    headings = list(re.finditer(r"<h6\b[^>]*>(.*?)</h6>", page_html, re.I | re.S))
    subjects = {}

    for index, heading_match in enumerate(headings):
        heading = clean_text(heading_match.group(1)).replace(" §", "").strip()
        if not SPECIAL_RE.match(heading):
            continue

        parts = heading.split(maxsplit=1)
        if len(parts) < 2:
            continue
        number_token, title = parts
        course_ids = [course_id.upper() for course_id in SPECIAL_ID_RE.findall(number_token)]
        if not course_ids or not title:
            continue

        block_end = headings[index + 1].start() if index + 1 < len(headings) else len(page_html)
        block = page_html[heading_match.end():block_end]
        metadata = {}
        row_pattern = re.compile(
            r"<tr\b[^>]*>\s*<td\b[^>]*>(.*?)</td>\s*<td\b[^>]*>(.*?)</td>",
            re.I | re.S,
        )
        for row in row_pattern.finditer(block):
            label = clean_text(row.group(1)).rstrip(":").casefold()
            value = clean_text(row.group(2))
            if label and value:
                metadata[label] = value

        description_matches = re.findall(
            r"<div\b[^>]*style=[\"'][^\"']*white-space\s*:\s*pre-line[^\"']*[\"'][^>]*>(.*?)</div>",
            block,
            re.I | re.S,
        )
        description = clean_text(description_matches[0]) if description_matches else ""

        for course_id in course_ids:
            anchor = course_id.replace(".", "_")
            subjects[course_id] = {
                "course_id": course_id,
                "title": title,
                "description": description,
                "metadata": metadata,
                "source_url": f"{page_url}#{anchor}" if page_url else None,
                "term": term,
            }

    return subjects


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


def offering_flag(season):
    return "offered_IAP" if season == "iap" else f"offered_{season}"


def apply_eecs_details(course, details, season=None):
    """Overlay official term-specific facts on one canonical catalog record."""
    result = dict(course or {})
    course_id = details["course_id"]
    metadata = details.get("metadata") or {}
    result.setdefault("subject_id", course_id)
    result.setdefault("public", True)
    result.setdefault("is_historical", False)

    result["title"] = details["title"]
    result["special_topic"] = details["title"]
    result["has_real_title"] = True
    if details.get("description"):
        result["description"] = details["description"]
        result["has_real_description"] = True

    units = parse_units_total(metadata.get("units"))
    if units is not None:
        result["total_units"] = units
    level = parse_level(metadata.get("level"))
    if level:
        result["level"] = level
    prerequisites = metadata.get("prereqs") or metadata.get("prerequisites")
    instructors = metadata.get("instructors") or metadata.get("instructor")
    if prerequisites:
        result["prerequisites"] = prerequisites
    if instructors:
        result["instructors"] = [instructors]
    if metadata.get("schedule"):
        result["eecs_schedule"] = metadata["schedule"]
    if metadata.get("satisfies"):
        result["eecs_satisfies"] = metadata["satisfies"]
    if season:
        result[offering_flag(season)] = True

    result["special_subject_term"] = details.get("term")
    result["special_subject_source_url"] = details.get("source_url")
    result["special_subject_details"] = metadata
    return result


def fetch_courses():
    return fetch_json(COURSES_URL)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--term", default=None, help='Term label, e.g. "Fall 2026" (also selects the offering season)')
    parser.add_argument("--depts", nargs="+", default=["6", "18"], help="Department prefixes to include")
    parser.add_argument("--page", default=None, help="Path to a saved EECS Subject Updates page (text/HTML)")
    parser.add_argument("--eecs-url", default=None, help="Direct official EECSIS subject-updates feed URL override")
    parser.add_argument("--no-eecs", action="store_true", help="Skip the live EECS fetch and use saved/curated fallbacks")
    parser.add_argument(
        "--season",
        choices=["fall", "spring", "iap", "summer"],
        default=None,
        help="Only keep subjects offered in this season (default: fall or spring)",
    )
    args = parser.parse_args()

    inferred_season = season_from_term(args.term)
    if args.term and not args.season and not inferred_season:
        parser.error('--term must name Fall, Spring, IAP/January, or Summer (or pass --season explicitly)')
    if args.season and inferred_season and args.season != inferred_season:
        parser.error(f'--term implies {inferred_season!r}, but --season is {args.season!r}')
    if args.eecs_url and args.no_eecs:
        parser.error("--eecs-url cannot be combined with --no-eecs")
    effective_season = args.season or inferred_season

    names = load_names()
    official_details = {}
    official_source_url = None
    official_feed_url = None

    if args.page:
        page_text = Path(args.page).read_text(encoding="utf-8", errors="ignore")
        saved_details = parse_eecs_subjects(page_text, term=args.term)
        official_details.update(saved_details)
        mined = extract_names_from_page(page_text)
        added = 0
        for course_id, title in mined.items():
            if course_id not in names:
                names[course_id] = title
                added += 1
        print(f"Parsed {len(saved_details)} detailed subject(s) and mined {len(mined)} name(s) from {args.page}; {added} new")
        if added:
            save_names(names)
            print(f"Updated {NAMES_FILE.name}")

    should_fetch_eecs = not args.no_eecs and bool(args.term or args.eecs_url)
    if should_fetch_eecs:
        if args.eecs_url:
            official_feed_url = args.eecs_url
            official_source_url = args.eecs_url
        else:
            official_source_url, official_feed_url = discover_eecs_sources(args.term)
        print(f"Fetching official EECS subjects from {official_feed_url} ...")
        live_details = parse_eecs_subjects(
            fetch_text(official_feed_url),
            page_url=official_source_url,
            term=args.term,
        )
        if not live_details:
            raise RuntimeError("The official EECS feed returned no current 6.S/18.S subjects; refusing to replace the overlay")
        official_details.update(live_details)
        print(f"Official EECS feed returned {len(live_details)} current special subject(s)")

    print(f"Fetching {COURSES_URL} ...")
    all_courses = fetch_courses()
    print(f"API returned {len(all_courses)} courses")

    depts = set(str(dept) for dept in args.depts)
    catalog_by_id = {
        str(course.get("subject_id", "")).upper(): course
        for course in all_courses
        if is_special(course.get("subject_id"))
        and in_depts(course.get("subject_id"), depts)
        and not course.get("is_historical", False)
    }

    if official_details:
        specials = []
        for course_id, details in sorted(official_details.items()):
            if not in_depts(course_id, depts):
                continue
            course = catalog_by_id.get(course_id, {"subject_id": course_id, "public": True})
            specials.append(apply_eecs_details(course, details, effective_season))
        missing_catalog_ids = sorted(set(official_details) - set(catalog_by_id))
        if missing_catalog_ids:
            print("! Official EECS subjects missing from Fireroad; emitted from EECS metadata only:", ", ".join(missing_catalog_ids))
    else:
        def offered_this_term(course):
            if effective_season:
                return bool(course.get(offering_flag(effective_season)))
            return bool(course.get("offered_fall") or course.get("offered_spring"))

        specials = [dict(course) for course in catalog_by_id.values() if offered_this_term(course)]
        for course in specials:
            course_id = str(course.get("subject_id", "")).upper()
            curated_title = names.get(course_id)
            if curated_title:
                course["title"] = curated_title
                course["special_topic"] = curated_title
                course["has_real_title"] = True
            else:
                course["has_real_title"] = not bool(GENERIC_TITLE_RE.search(str(course.get("title", ""))))

    specials.sort(key=lambda course: course.get("subject_id", ""))
    named_count = sum(bool(course.get("has_real_title")) for course in specials)
    description_count = sum(bool(course.get("has_real_description")) for course in specials)
    payload = {
        "generated_from": COURSES_URL,
        "official_source": official_source_url,
        "official_feed": official_feed_url,
        "term": args.term,
        "season": effective_season,
        "departments": sorted(depts),
        "count": len(specials),
        "named_count": named_count,
        "description_count": description_count,
        "subjects": specials,
    }
    OUT_FILE.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(
        f"Wrote {OUT_FILE} — {len(specials)} subjects, "
        f"{named_count} with real topic names, {description_count} with official descriptions"
    )
    if named_count < len(specials):
        missing = [course["subject_id"] for course in specials if not course.get("has_real_title")]
        print(f"\n{len(missing)} subject(s) still have generic titles. Add real names to {NAMES_FILE}")
        print("Sample missing:", ", ".join(missing[:12]))


if __name__ == "__main__":
    main()
