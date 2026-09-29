"""Stream the USDA FoodData Central Branded Foods JSON download into a compact JSONL.

The download is ~3.3 GB of JSON with one food object per line. This keeps only the
fields the app needs (plus a few used to deduplicate), so later build steps can
iterate quickly.

usage: python tools/extract_branded.py <branded_json.zip> <out.jsonl>
"""
import io
import json
import sys
import zipfile
from collections import Counter

src, out_path = sys.argv[1], sys.argv[2]
z = zipfile.ZipFile(src)
member = [i for i in z.infolist() if i.filename.endswith('.json')][0]
f = io.TextIOWrapper(z.open(member), encoding='utf-8')

keys = Counter()
count = 0
bad = 0
with open(out_path, 'w', encoding='utf-8') as out:
    for line in f:
        line = line.strip()
        if not line.startswith('{"foodClass"') and not line.startswith('{'):
            continue
        if line.startswith('{"BrandedFoods"'):
            continue
        if line.endswith(','):
            line = line[:-1]
        try:
            d = json.loads(line)
        except Exception:
            # The last food is followed by the wrapper's closing "]}".
            try:
                d = json.loads(line[:-2]) if line.endswith(']}') else None
            except Exception:
                d = None
            if d is None:
                bad += 1
                continue
        count += 1
        keys.update(d.keys())
        nut = {}
        for fn in d.get('foodNutrients') or []:
            nu = fn.get('nutrient') or {}
            nid = nu.get('id')
            amt = fn.get('amount')
            if nid is None or amt is None:
                continue
            nut[str(nid)] = amt
        lab = {}
        for k, v in (d.get('labelNutrients') or {}).items():
            if isinstance(v, dict) and v.get('value') is not None:
                lab[k] = v['value']
        rec = {
            'id': d.get('fdcId'),
            'd': d.get('description') or '',
            'o': d.get('brandOwner') or '',
            'b': d.get('brandName') or '',
            'sb': d.get('subbrandName') or '',
            'u': d.get('gtinUpc') or '',
            'ss': d.get('servingSize'),
            'su': d.get('servingSizeUnit') or '',
            'hh': d.get('householdServingFullText') or '',
            'c': d.get('brandedFoodCategory') or '',
            'mc': d.get('marketCountry') or '',
            'dd': d.get('discontinuedDate') or '',
            'md': d.get('modifiedDate') or '',
            'ad': d.get('availableDate') or '',
            'pd': d.get('publicationDate') or '',
            'ds': d.get('dataSource') or '',
            'pw': d.get('packageWeight') or '',
            'ps': d.get('preparationStateCode') or '',
            'tc': d.get('tradeChannels') or [],
            'sd': d.get('shortDescription') or '',
            'l': lab,
            'n': nut,
        }
        out.write(json.dumps(rec, separators=(',', ':'), ensure_ascii=False) + '\n')
        if count % 50000 == 0:
            print(count, file=sys.stderr, flush=True)

print('foods', count, 'bad', bad)
for k, v in keys.most_common():
    print(k, v)
