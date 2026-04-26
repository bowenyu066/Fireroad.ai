import requests, json, os

os.makedirs("data", exist_ok=True)

# Fetch all courses
r = requests.get("https://fireroad.mit.edu/courses/all?full=true")
all_courses = r.json()
print(f"Raw: {len(all_courses)} courses")

# RELEVANT_PREFIXES = ['6.', '18.', '9.', '1.', '2.', '7.']

courses = [c for c in all_courses if
    not c.get('is_historical', False) and
    (c.get('offered_fall') or c.get('offered_spring')) and
    c.get('description') and
    'S' not in c['subject_id'].split('.')[1] 
]
print(f"Filtered: {len(courses)} courses")

with open("data/courses.json", "w") as f:
    json.dump(courses, f, indent=2, ensure_ascii=False)