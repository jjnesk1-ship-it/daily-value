"""Pull the store-brand products Daily Value uses out of the Open Food Facts data export.

Input: en.openfoodfacts.org.products.csv.gz from https://static.openfoodfacts.org/data/
(tab-separated despite the name; ~1.3 GB compressed). Open Food Facts data is
(c) Open Food Facts contributors, licensed under the Open Database License (ODbL).

Keeps only products whose nutrition facts are marked complete, in these sets:
  kirkland     brand Kirkland Signature / Kirkland
  trader-joes  brand Trader Joe's
  aldi-us      sold at Aldi in the United States
  costco-us    sold at Costco in the United States
and writes <out_dir>/<set>.json: product objects shaped like the Open Food Facts API
(code, product_name, brands, nutriments {<name>_100g}, ...), read by tools/build_branded.py.

usage: python tools/extract_off.py <export.csv.gz> <out_dir>
"""
import gzip
import json
import os
import re
import sys
from collections import Counter

SRC, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)

KEEP = [
    'code', 'product_name', 'generic_name', 'quantity', 'brands', 'brands_tags', 'categories_tags', 'stores',
    'countries_tags', 'serving_size', 'serving_quantity', 'no_nutrition_data', 'states_tags',
    'data_quality_errors_tags', 'completeness', 'last_modified_t', 'product_quantity',
]
LISTS = {'brands_tags', 'categories_tags', 'countries_tags', 'states_tags', 'data_quality_errors_tags'}
ALDI = re.compile(r'\baldi\b', re.I)
COSTCO = re.compile(r'\bcostco\b', re.I)


def sets_for(row):
    brands = set(row['brands_tags'])  # language prefix already dropped ("xx:kirkland" -> "kirkland")
    out = []
    if 'kirkland-signature' in brands or 'kirkland' in brands:
        out.append('kirkland')
    if any(b.startswith('trader-joe') for b in brands):
        out.append('trader-joes')
    us = 'en:united-states' in row['countries_tags']
    if us and ALDI.search(row['stores']):
        out.append('aldi-us')
    if us and COSTCO.search(row['stores']):
        out.append('costco-us')
    return out


def main():
    stats = Counter()
    found = {name: [] for name in ('kirkland', 'trader-joes', 'aldi-us', 'costco-us')}
    with gzip.open(SRC, 'rt', encoding='utf-8', errors='replace', newline='\n') as f:
        header = f.readline().rstrip('\n').split('\t')
        idx = {h: i for i, h in enumerate(header)}
        nutr = [h for h in header if h.endswith('_100g')]
        width = len(header)
        for line in f:
            stats['rows'] += 1
            if stats['rows'] % 500000 == 0:
                print(stats['rows'], {k: len(v) for k, v in found.items()}, file=sys.stderr, flush=True)
            # Cheap prefilter before splitting 211 columns.
            low = line.lower()
            if 'kirkland' not in low and 'trader' not in low and 'aldi' not in low and 'costco' not in low:
                continue
            cols = line.rstrip('\n').split('\t')
            if len(cols) != width:
                stats['malformed rows'] += 1
                continue
            row = {k: cols[idx[k]] for k in KEEP}
            for k in LISTS:
                row[k] = [t for t in row[k].split(',') if t]
            # Brand tags may carry a language prefix: "xx:kirkland-signature".
            row['brands_tags'] = [t.split(':', 1)[-1] for t in row['brands_tags']]
            names = sets_for(row)
            if not names:
                continue
            if 'en:nutrition-facts-completed' not in row['states_tags']:
                stats['skip: nutrition facts not complete'] += 1
                continue
            nutriments = {}
            for h in nutr:
                v = cols[idx[h]]
                if v != '':
                    nutriments[h] = v
            # Products using Open Food Facts' newer nutrition format have no values in this export.
            if not nutriments:
                stats['skip: no nutrition values in the export'] += 1
                continue
            product = {k: row[k] for k in KEEP}
            product['nutriments'] = nutriments
            for name in names:
                found[name].append(product)
                stats['kept ' + name] += 1
    for name, products in found.items():
        with open(os.path.join(OUT, name + '.json'), 'w', encoding='utf-8') as f:
            json.dump(products, f, ensure_ascii=False)
    for k, v in sorted(stats.items()):
        print(f'{k:40s} {v}')


main()
