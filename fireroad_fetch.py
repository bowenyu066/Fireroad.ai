import requests, json, os

os.makedirs("data/requirements", exist_ok=True)

lists = requests.get("https://fireroad.mit.edu/requirements/list_reqs").json()
print(f"Found {len(lists)} requirement lists")

for list_id in lists:
    r = requests.get(f"https://fireroad.mit.edu/requirements/get_json/{list_id}")
    if r.status_code == 200:
        with open(f"data/requirements/{list_id}.json", "w") as f:
            json.dump(r.json(), f, indent=2, ensure_ascii=False)
        print(f"✓ {list_id}")
    else:
        print(f"✗ {list_id} — {r.status_code}")