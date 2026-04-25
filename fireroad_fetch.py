import requests, json

# 一次拉完所有数据，存本地
r = requests.get("https://fireroad.mit.edu/courses/all?full=true")
courses = r.json()

# 过滤 + 整理成你们的格式
with open("data/courses.json", "w") as f:
    json.dump(courses, f, indent=2, ensure_ascii=False)

print(f"拿到 {len(courses)} 门课")

reqs = requests.get(
    "https://fireroad.mit.edu/requirements/list_reqs/"
).json()
with open("data/reqs.json", "w") as f:
    json.dump(reqs,f, indent = 2, ensure_ascii=False)

print(f"got {len(reqs)} major requirements")