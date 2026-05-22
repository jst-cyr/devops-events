#!/usr/bin/env python3
import json

d = json.load(open('data/events.json'))
print("Serverless events:")
for r in d['records']:
    if 'Serverless' in r.get('name','') or 'serverless' in r.get('event_url','').lower():
        print(f"  ID: {r.get('id','N/A')}")
        print(f"  Name: {r.get('name')}")
        print(f"  URL: {r.get('event_url')}")
        print(f"  CFP: {r.get('cfp', {}).get('cfp_url')}")
        print()
