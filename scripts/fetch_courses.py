#!/usr/bin/env python3
import json
from pathlib import Path

import requests


COURSES_URL = "https://fireroad.mit.edu/courses/all?full=true"
ROOT_DIR = Path(__file__).resolve().parents[1]
OUT_FILE = ROOT_DIR / "data" / "courses.json"


def main():
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)

    response = requests.get(COURSES_URL, timeout=30)
    response.raise_for_status()
    all_courses = response.json()
    print(f"原始数据: {len(all_courses)} 门课")

    courses = [
        course
        for course in all_courses
        if not course.get("is_historical", False)
        and (course.get("offered_fall") or course.get("offered_spring"))
    ]
    print(f"过滤后: {len(courses)} 门课")

    with OUT_FILE.open("w", encoding="utf-8") as file:
        json.dump(courses, file, indent=2, ensure_ascii=False)

    print(f"写入: {OUT_FILE}")


if __name__ == "__main__":
    main()
