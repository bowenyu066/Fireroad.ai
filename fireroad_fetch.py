import requests
import json
import os
import time

BASE_URL = "https://fireroad.mit.edu/catalogs/requirements/{}.reql"
REQS_FILE = "data/reqs.json"
OUT_FILE = "data/requirements_raw.json"
OUT_DIR = "data/requirements"

os.makedirs(OUT_DIR, exist_ok=True)

with open(REQS_FILE) as f:
    reqs = json.load(f)

keys = list(reqs.keys())
print(f"Fetching {len(keys)} programs...\n")

raw = {}
failed = []

for i, key in enumerate(keys, 1):
    url = BASE_URL.format(key)
    try:
        r = requests.get(url, timeout=10)
        if r.status_code == 200:
            raw[key] = r.text
            # also save individual file for easy inspection
            with open(os.path.join(OUT_DIR, f"{key}.reql"), "w") as f:
                f.write(r.text)
            print(f"[{i:3}/{len(keys)}] ✓  {key}")
        else:
            failed.append((key, r.status_code))
            print(f"[{i:3}/{len(keys)}] ✗  {key}  (HTTP {r.status_code})")
    except requests.RequestException as e:
        failed.append((key, str(e)))
        print(f"[{i:3}/{len(keys)}] ✗  {key}  ({e})")
    time.sleep(0.1)  # be polite to the server

with open(OUT_FILE, "w") as f:
    json.dump(raw, f, indent=2)

print(f"\nDone. {len(raw)} succeeded, {len(failed)} failed.")
print(f"Combined output → {OUT_FILE}")
print(f"Individual files → {OUT_DIR}/")

if failed:
    print("\nFailed:")
    for key, reason in failed:
        print(f"  {key}: {reason}")
