"""Build the brand-name food files for Daily Value (data/b/).

Sources
  USDA FoodData Central Branded Foods, December 2025 (JSON download, reduced first by
  tools/extract_branded.py).
  Open Food Facts products for Kirkland Signature, Trader Joe's, Aldi and Costco, pulled from
  its data export by tools/extract_off.py. (c) Open Food Facts contributors, Open Database
  License (ODbL).

usage: python tools/build_branded.py <branded_min.jsonl> <off_dir> <out_dir>

Products are sorted by brand, then name, and numbered by that order ("line"). All files
are plain UTF-8 text (the artifact host serves no compressed files), fetched by
js/branded.js only when someone searches or looks up a barcode:

  meta.json    version, counts, key list, part/shard sizes, category names, sources
  brands.txt   <brand>\t<first line>\t<count>
  i<k>.txt     search index, part k:  <name>\t<kcal per serving>\t<serving label>\t<serving g>
  r<nnn>.txt   nutrients and servings, RECORDS_PER_SHARD lines each:
               <id>\t<src B|O>\t<category index>\t<values>\t<portions>
               (name and brand live only in the index and brand table, to keep the files small)
  u<d>.txt     barcodes ending in digit d:  <barcode without leading zeros>\t<line>

<values> are per 100 g (or 100 ml, treated as grams) in the order of BKEYS, comma separated,
empty = not on the label; trailing empties are dropped. <portions> are "label~grams|...".
The index text is kept to ASCII plus ¼ ½ ¾ so browsers can hold it compactly.
"""

import json
import math
import os
import re
import shutil
import sys
import unicodedata
from collections import Counter, defaultdict

BRANDED_JSONL, OFF_DIR, OUT = sys.argv[1], sys.argv[2], sys.argv[3]

VERSION = 1
PARTS = 8
RECORDS_PER_SHARD = 4000
UPC_SHARDS = 10

# Nutrient order for brand-name records (most often present first, so rows end early).
# Must match BKEYS in js/fooddb.js for this VERSION.
BKEYS = [
    'kcal', 'prot', 'fat', 'carbs', 'na', 'sugars', 'sat', 'chol', 'fiber', 'trans', 'fe', 'ca', 'k',
    'vitC', 'vitD', 'mono', 'poly', 'vitA', 'b3', 'b1', 'b2', 'b6', 'folate', 'mg', 'p', 'b12', 'zn',
    'b5', 'mn', 'cu', 'se', 'vitK', 'vitE', 'choline', 'caffeine', 'alcohol', 'water',
]

# FDC nutrient ids per key (first present wins). Vitamin A in IU is left out: converting IU to
# µg RAE depends on whether it came from retinol or carotenoids, which labels don't say.
USDA_IDS = {
    'kcal': [1008], 'prot': [1003], 'fat': [1004], 'carbs': [1005], 'na': [1093], 'sugars': [2000, 1063],
    'sat': [1258], 'chol': [1253], 'fiber': [1079], 'trans': [1257], 'fe': [1089], 'ca': [1087],
    'k': [1092], 'vitC': [1162], 'mono': [1292], 'poly': [1293], 'vitA': [1106], 'b3': [1167],
    'b1': [1165], 'b2': [1166], 'b6': [1175], 'mg': [1090], 'p': [1091], 'b12': [1178], 'zn': [1095],
    'b5': [1170], 'mn': [1101], 'cu': [1098], 'se': [1103], 'vitK': [1185], 'vitE': [1109, 2068, 1158],
    'choline': [1180], 'caffeine': [1057], 'alcohol': [1018], 'water': [1051],
}

# Upper limits per 100 g; a value above these is a data-entry error and is dropped.
LIMITS = {
    'kcal': 902, 'prot': 100, 'fat': 100, 'carbs': 100, 'sugars': 100, 'fiber': 100, 'sat': 100,
    'mono': 100, 'poly': 100, 'trans': 100, 'alcohol': 100, 'water': 100, 'na': 39500, 'chol': 3500,
    'k': 16000, 'ca': 7500, 'fe': 450, 'mg': 1800, 'p': 3000, 'zn': 150, 'cu': 60, 'mn': 150,
    'se': 3000, 'vitC': 20000, 'vitD': 250, 'vitA': 30000, 'vitE': 1000, 'vitK': 5000,
    'b1': 500, 'b2': 500, 'b3': 2000, 'b5': 1000, 'b6': 500, 'b12': 5000, 'folate': 20000,
    'choline': 5000, 'caffeine': 5000,
}


# ---------------------------------------------------------------------------
# Numbers

def fmt_num(v):
    """3 significant digits (integers from 100 up), no trailing zeros, no leading 0."""
    if v is None:
        return ''
    if v == 0:
        return '0'
    a = abs(v)
    if a >= 100:
        s = str(int(round(v)))
    else:
        digits = max(0, min(3 - int(math.floor(math.log10(a))) - 1, 6))
        s = f'{v:.{digits}f}'
        if '.' in s:
            s = s.rstrip('0').rstrip('.')
    if s.startswith('0.'):
        s = s[1:]
    return s or '0'


def fmt_values(vals):
    out = [fmt_num(vals.get(k)) for k in BKEYS]
    while out and out[-1] == '':
        out.pop()
    return ','.join(out)


def num(x):
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    return v if math.isfinite(v) else None


# ---------------------------------------------------------------------------
# Text

PUNCT = {
    '’': "'", '‘': "'", '“': '"', '”': '"', '–': '-', '—': '-',
    '®': '', '™': '', '©': '', ' ': ' ', '…': '...', '½': ' 1/2',
    '¼': ' 1/4', '¾': ' 3/4', '⅓': ' 1/3', '⅔': ' 2/3', '°': ' deg',
    '�': "'",  # mis-encoded curly apostrophe in some Open Food Facts names ("Trader Joe�s")
}


def ascii_text(s):
    s = ''.join(PUNCT.get(ch, ch) for ch in str(s))
    s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode('ascii')
    s = s.replace('""', '"').replace('\t', ' ').replace('|', '/').replace('~', '-')
    return ' '.join(s.split())


SMALL = {'a', 'an', 'and', 'or', 'of', 'with', 'in', 'on', 'the', 'for', 'to', 'by', 'at', 'from', 'n', 'w/', 'de', 'la', 'del', 'con', 'y'}
UPPER = {
    'bbq', 'usa', 'ny', 'nyc', 'pb', 'pb&j', 'blt', 'xl', 'xxl', 'ii', 'iii', 'iv', 'dha', 'epa', 'mct',
    'gmo', 'uht', 'ipa', 'tv', 'oj', 'b12', 'b6', 'd3', 'k2', 'rtd', 'acv', 'cbd', 'usda', 'kfc',
    'tgi', 'ihop', 'xo', 'vsop', 'hfcs', 'bpa', 'ph', 'nfl', 'nba', 'mlb', 'hbo', 'diy', 'bltr', 'aa',
    'aaa', 'ss', 'ak', 'ca', 'nj', 'nc', 'sc', 'tx', 'va', 'wv', 'pa', 'bff', 'ufc', 'nsa', 'lf', 'ff',
    'ksa', 'bcaa', 'bcaas', 'mcts', 'omg', 'ok', 'jr', 'sr', 'dr',
}
UPPER_EXACT = {'jr': 'Jr', 'sr': 'Sr', 'dr': 'Dr', 'ok': 'OK'}
UNITS = {'oz', 'fl', 'lb', 'lbs', 'g', 'kg', 'mg', 'ml', 'l', 'ct', 'pk', 'qt', 'pt', 'gal', 'in', 'cal', 'kcal', 'mcg'}


def cap_word(w, first):
    lw = w.lower()
    core = re.sub(r'^[^a-z0-9]+|[^a-z0-9&/]+$', '', lw)
    if not core:
        return lw
    if core in UPPER_EXACT:
        return lw.replace(core, UPPER_EXACT[core], 1)
    if core in UPPER:
        return lw.replace(core, core.upper(), 1)
    if not first and (core in SMALL or core in UNITS):
        return lw
    if re.search(r'\d', core):
        return lw  # 12oz, 2%, 100-calorie
    if '-' in core and len(core) > 2:
        return '-'.join(cap_word(p, True) if p else p for p in lw.split('-'))
    # Capitalise the first letter, keep letters after an apostrophe lower case (Joe's).
    out = []
    done = False
    for i, ch in enumerate(lw):
        if not done and ch.isalpha():
            out.append(ch.upper())
            done = True
        else:
            out.append(ch)
    s = ''.join(out)
    m = re.match(r"^(\W*)Mc([a-z])(\w+)", s)
    if m and len(m.group(3)) >= 2:
        s = m.group(1) + 'Mc' + m.group(2).upper() + m.group(3) + s[m.end():]
    return s


def title_case(s):
    words = s.split(' ')
    return ' '.join(cap_word(w, i == 0 or words[i - 1].endswith(('(', '/', '-'))) for i, w in enumerate(words))


def smart_case(s):
    """All-caps label text becomes title case; text that already has lower case is kept."""
    letters = [c for c in s if c.isalpha()]
    if not letters:
        return s
    upper_share = sum(1 for c in letters if c.isupper()) / len(letters)
    if upper_share > 0.8:
        return title_case(s)
    if s[0].islower():
        return s[0].upper() + s[1:]
    return s


def key_of(s):
    return re.sub(r'[^a-z0-9]+', '', s.lower())


def words_of(s):
    return re.findall(r'[a-z0-9]+', s.lower())


BRAND_SUFFIX = re.compile(r'[,.]?\s+(inc|incorporated|llc|l\.l\.c|co|corp|corporation|company|ltd|limited|lp|l\.p|plc|usa|us|na|north america)\.?$', re.I)
BRAND_ALIASES = {'kirkland': 'Kirkland Signature', 'kirklandsignature': 'Kirkland Signature', 'traderjoes': "Trader Joe's", 'traderjoe': "Trader Joe's"}


def clean_brand(b):
    b = ascii_text(b).strip(' ,.-')
    for _ in range(3):
        b2 = BRAND_SUFFIX.sub('', b).strip(' ,.-')
        b2 = re.sub(r'\s+(and|&)$', '', b2, flags=re.I)  # "Clif Bar and (Company)"
        if b2 == b:
            break
        b = b2
    b = smart_case(b)
    # Volunteer-entered variants: "KIRKLAND- Chocolate Chip Cookie Dough", "Specially selected - Aldi".
    k = key_of(b)
    if k.startswith('kirkland'):
        return 'Kirkland Signature'
    if k.startswith('traderjoe'):
        return "Trader Joe's"
    b = re.sub(r"\s*[-(]\s*(aldi|costco|trader joe'?s)\)?$", '', b, flags=re.I).strip(' ,.-')
    return BRAND_ALIASES.get(key_of(b), b)


def clean_name(desc, brand):
    s = ascii_text(desc)
    s = re.sub(r'\s*,\s*', ', ', s).strip(' ,')
    # Drop the brand when the description starts with it ("KIRKLAND SIGNATURE, ALMONDS").
    bw = words_of(brand)
    if bw:
        sw = words_of(s)
        if sw[:len(bw)] == bw and len(sw) > len(bw):
            # Remove that many words from the front of the original string.
            count = 0
            idx = 0
            for m in re.finditer(r'[A-Za-z0-9]+', s):
                count += 1
                if count == len(bw):
                    idx = m.end()
                    break
            s = s[idx:].lstrip(' ,-:').strip()
    # Drop comma-separated parts that only repeat words already said
    # ("GRANOLA, CINNAMON, RAISIN, CINNAMON, RAISIN" -> "GRANOLA, CINNAMON, RAISIN").
    parts = [p.strip() for p in s.split(', ') if p.strip()]
    kept = []
    seen = set()
    for i, p in enumerate(parts):
        pw = words_of(p)
        if i > 0 and pw and all(w in seen for w in pw):
            continue
        kept.append(p)
        seen.update(pw)
    s = ', '.join(kept)
    s = smart_case(s)
    if len(s) > 90:
        s = s[:88].rsplit(' ', 1)[0].rstrip(' ,') + '...'
    return s


# ---------------------------------------------------------------------------
# Servings

FRACTIONS = {0.25: '¼', 0.5: '½', 0.75: '¾'}


def fmt_amount(a):
    whole = int(math.floor(a + 1e-9))
    frac = a - whole
    for f, glyph in FRACTIONS.items():
        if abs(frac - f) < 0.01:
            return (str(whole) if whole else '') + glyph
    for f, text in ((1 / 3, '1/3'), (2 / 3, '2/3')):
        if abs(frac - f) < 0.02:
            return (str(whole) + ' ' if whole else '') + text
    if abs(frac) < 0.01:
        return str(whole)
    return fmt_num(round(a, 2))


UNIT_WORDS = [
    (r'\bonz\b', 'oz'), (r'\boza\b', 'fl oz'), (r'\bgrm\b', 'g'), (r'\bgm\b', 'g'), (r'\bmlt\b', 'ml'),
    (r'\btbsp?s?\b', 'tbsp'), (r'\btbls?\b', 'tbsp'), (r'\btablespoons?\b', 'tbsp'), (r'\btsps?\b', 'tsp'),
    (r'\bteaspoons?\b', 'tsp'), (r'\bpcs?\b\.?', 'pieces'), (r'\bpkgs?\b\.?', 'package'), (r'\bfl\.? ?oz\b\.?', 'fl oz'),
    (r'\bcups\b', 'cup'), (r'\bea\b\.?', 'each'), (r'\bsl\b\.?', 'slice'), (r'\bcont\b\.?', 'container'),
    # Canadian labels are bilingual: "0.25 de tasse", "1 c. a soupe".
    (r'\b(de )?tasses?\b', 'cup'), (r'\bc\. ?a soupe\b', 'tbsp'), (r'\bc\. ?a (the|cafe)\b', 'tsp'),
    (r'\bmorceaux\b', 'pieces'), (r'\bmorceau\b', 'piece'), (r'\btranches?\b', 'slice'),
]


def clean_serving(text):
    """'0.25 cup' -> '¼ cup'; '1 ONZ' -> None (plain weights are covered by g and oz)."""
    s = ascii_text(text)
    s = re.sub(r'\|.*$', '', s)
    s = re.sub(r'\((?:[^()]*)\)', '', s)  # "1 cup (240 ml)" -> "1 cup"
    s = re.sub(r'\s*/\s*\d+(?:\.\d+)?\s*(?:g|grams?|ml|oz)\b.*$', '', s, flags=re.I)  # "25 pieces / 41g" -> "25 pieces"
    s = re.sub(r'\b(approx\.?|approximately|about|abt\.?)', '', s, flags=re.I)
    s = ' '.join(s.split()).strip(' ,.;:-')
    if not s:
        return None
    low = s.lower()
    if low in ('none', 'amount per serving', 'serving', 'per serving', 'n/a', 'na', '0'):
        return None
    for pat, rep in UNIT_WORDS:
        low = re.sub(pat, rep, low)
    m = re.match(r'^(\d+\s+\d+/\d+|\d+/\d+|\d*\.?\d+)\s*(.*)$', low)
    if m:
        amt_s, rest = m.group(1), m.group(2).strip()
        try:
            if '/' in amt_s:
                parts = amt_s.split()
                whole = float(parts[0]) if len(parts) == 2 else 0.0
                n, d = parts[-1].split('/')
                amt = whole + float(n) / float(d)
            else:
                amt = float(amt_s)
        except (ValueError, ZeroDivisionError):
            return None
        if amt <= 0 or amt > 1000:
            return None
        if not rest or re.fullmatch(r'(g|mg|kg|oz|lb|lbs|ml|l)\.?', rest):
            return None
        low = fmt_amount(amt) + ' ' + rest
    elif not re.search(r'[a-z]', low):
        return None
    low = ' '.join(low.split())
    if len(low) > 32:
        return None
    return low


def package_grams(text):
    """'12 oz/340 g' -> 340; '1.5 lbs/680 g' -> 680; '64 fl oz/1.89 L' -> 1890."""
    s = ascii_text(text).lower()
    best = None
    for m in re.finditer(r'(\d+(?:\.\d+)?)\s*(kg|g|ml|l|lbs?|fl\.? ?oz|oz)\b', s):
        v = float(m.group(1))
        u = m.group(2).replace('.', '').replace(' ', '')
        g = {'kg': 1000, 'g': 1, 'ml': 1, 'l': 1000, 'lb': 453.6, 'lbs': 453.6, 'floz': 29.57, 'oz': 28.35}[u] * v
        if u in ('g', 'kg', 'ml', 'l'):
            return g  # metric is what the label states exactly
        best = best or g
    return best


# ---------------------------------------------------------------------------
# USDA branded foods

def parse_date(s):
    m = re.match(r'(\d+)/(\d+)/(\d{4})', s or '')
    return (int(m.group(3)), int(m.group(1)), int(m.group(2))) if m else (0, 0, 0)


def usda_values(n):
    vals = {}
    for key, ids in USDA_IDS.items():
        for i in ids:
            v = n.get(str(i))
            if v is not None:
                vals[key] = v
                break
    if '1114' in n:
        vals['vitD'] = n['1114']
    elif '1110' in n:
        vals['vitD'] = n['1110'] / 40.0
    if '1190' in n:
        vals['folate'] = n['1190']
    elif '1177' in n:
        vals['folate'] = n['1177']
    elif '1186' in n:
        vals['folate'] = n['1186'] * 1.7
    if 'kcal' not in vals and '1062' in n:
        vals['kcal'] = n['1062'] / 4.184
    return vals


stats = Counter()


def check_values(vals, serving_g=None, polyols=0):
    """Drop impossible values; return False when the food itself is unusable."""
    for k in list(vals):
        v = num(vals[k])
        if v is None or v < 0 or v > LIMITS.get(k, 1e9):
            stats['value dropped: ' + k] += 1
            del vals[k]
        else:
            vals[k] = v
    if any(vals.get(k) is None for k in ('kcal', 'prot', 'fat', 'carbs')):
        stats['skip: missing kcal/macros'] += 1
        return False
    if vals['prot'] + vals['fat'] + vals['carbs'] > 105:
        stats['skip: macros over 100 g'] += 1
        return False
    for part in ('sat', 'trans', 'mono', 'poly'):
        if vals.get(part) is not None and vals[part] > vals['fat'] + 0.5:
            del vals[part]
            stats['value dropped: ' + part + ' > fat'] += 1
    for part in ('sugars', 'fiber'):
        if vals.get(part) is not None and vals[part] > vals['carbs'] + 0.5:
            del vals[part]
            stats['value dropped: ' + part + ' > carbs'] += 1
    # Calories far outside what the macros imply (4/4/9, alcohol 7; fiber and sugar alcohols may
    # count for little) point to a unit or typing error. Labels round each value, so for small
    # servings (a teaspoon of mustard) a gap of ~20 kcal per serving is only rounding.
    high = 4 * vals['prot'] + 4 * vals['carbs'] + 9 * vals['fat'] + 7 * (vals.get('alcohol') or 0)
    low = 4 * vals['prot'] + 4 * max(0, vals['carbs'] - (vals.get('fiber') or 0) - (polyols or 0)) + 9 * vals['fat']
    kcal = vals['kcal']
    tol = max(60, 0.45 * max(kcal, high), 2000 / serving_g if serving_g else 0)
    if kcal > high + tol or kcal < low - tol:
        stats['skip: calories inconsistent with macros'] += 1
        return False
    return True


def load_usda():
    groups = defaultdict(list)
    for line in open(BRANDED_JSONL, encoding='utf-8'):
        r = json.loads(line)
        stats['usda: read'] += 1
        if r['mc'] not in ('United States', 'US'):
            stats['usda skip: not US market'] += 1
            continue
        if r['dd']:
            stats['usda skip: discontinued'] += 1
            continue
        brand_raw = r['b'] or r['o']
        if not brand_raw:
            stats['usda skip: no brand'] += 1
            continue
        brand = clean_brand(brand_raw)
        name = clean_name(r['d'], brand)
        if not name or not re.search(r'[A-Za-z]', name):
            stats['usda skip: no name'] += 1
            continue
        vals = usda_values(r['n'])
        ss = num(r['ss'])
        if ss is not None and not (0 < ss <= 3000):
            ss = None
        if not check_values(vals, ss, num(r['n'].get('1086')) or 0):
            continue
        label = clean_serving(r['hh']) if ss else None
        rec = {
            'id': int(r['id']), 'src': 'B', 'name': name, 'brand': brand, 'cat': ascii_text(r['c']),
            'vals': vals, 'ss': ss, 'label': label, 'pkg': package_grams(r['pw']) if r['pw'] else None,
            'upcs': [r['u'].strip()] if r['u'].strip().isdigit() else [], 'date': max(parse_date(r['md']), parse_date(r['pd'])),
        }
        groups[(key_of(brand), key_of(name))].append(rec)
    out = []
    for recs in groups.values():
        recs.sort(key=lambda x: (x['date'], x['id']), reverse=True)
        best = recs[0]
        for other in recs[1:]:
            best['upcs'].extend(u for u in other['upcs'] if u not in best['upcs'])
        stats['usda: merged duplicates'] += len(recs) - 1
        out.append(best)
    return out


# ---------------------------------------------------------------------------
# Open Food Facts

OFF_G = {  # key -> (nutriment, factor from grams)
    'prot': ('proteins', 1), 'fat': ('fat', 1), 'carbs': ('carbohydrates', 1), 'na': ('sodium', 1000),
    'sugars': ('sugars', 1), 'sat': ('saturated-fat', 1), 'chol': ('cholesterol', 1000), 'fiber': ('fiber', 1),
    'trans': ('trans-fat', 1), 'fe': ('iron', 1000), 'ca': ('calcium', 1000), 'k': ('potassium', 1000),
    'vitC': ('vitamin-c', 1000), 'vitD': ('vitamin-d', 1e6), 'mono': ('monounsaturated-fat', 1),
    'poly': ('polyunsaturated-fat', 1), 'vitA': ('vitamin-a', 1e6), 'b3': ('vitamin-pp', 1000),
    'b1': ('vitamin-b1', 1000), 'b2': ('vitamin-b2', 1000), 'b6': ('vitamin-b6', 1000),
    'folate': ('vitamin-b9', 1e6), 'mg': ('magnesium', 1000), 'p': ('phosphorus', 1000),
    'b12': ('vitamin-b12', 1e6), 'zn': ('zinc', 1000), 'b5': ('pantothenic-acid', 1000),
    'mn': ('manganese', 1000), 'cu': ('copper', 1000), 'se': ('selenium', 1e6), 'vitK': ('vitamin-k', 1e6),
    'vitE': ('vitamin-e', 1000), 'choline': ('choline', 1000), 'caffeine': ('caffeine', 1000),
    'alcohol': ('alcohol', 1),
}
OFF_SETS = ['kirkland', 'trader-joes', 'aldi-us', 'costco-us']
US_CA = {'en:united-states', 'en:canada'}


def off_category(tags):
    for t in reversed(tags or []):
        if t.startswith('en:'):
            return t[3:].replace('-', ' ').capitalize()
    return ''


def load_off(existing_upcs, existing_keys):
    by_code = {}
    for q in OFF_SETS:
        path = os.path.join(OFF_DIR, q + '.json')
        if not os.path.exists(path):
            print('missing', path, file=sys.stderr)
            continue
        for p in json.load(open(path, encoding='utf-8')):
            code = str(p.get('code') or '').strip()
            if code and code not in by_code:
                by_code[code] = (q, p)
    out = []
    for code, (q, p) in by_code.items():
        stats['off: read'] += 1
        if not code.isdigit() or not (6 <= len(code) <= 14):
            stats['off skip: odd barcode'] += 1
            continue
        upc = code.lstrip('0')
        if upc in existing_upcs:
            stats['off skip: already in USDA (barcode)'] += 1
            continue
        countries = set(p.get('countries_tags') or [])
        if q in ('kirkland', 'trader-joes') and countries and not (countries & US_CA):
            stats['off skip: sold outside US/Canada'] += 1
            continue
        # Open Food Facts flags entries whose numbers contradict each other.
        errors = [t for t in (p.get('data_quality_errors_tags') or []) if re.search(r'energy|nutrition|nutrient|serving', t)]
        if errors:
            stats['off skip: flagged by Open Food Facts'] += 1
            continue
        name = p.get('product_name_en') or (p.get('product_name') if (p.get('lang') in (None, '', 'en')) else '')
        name = (name or '').strip()
        if not name or not re.search(r'[A-Za-z]{3}', name):
            stats['off skip: no English name'] += 1
            continue
        brands = [b.strip() for b in (p.get('brands') or '').split(',') if b.strip()]
        brand = clean_brand(brands[0]) if brands else ''
        if not brand:
            stats['off skip: no brand'] += 1
            continue
        nm = p.get('nutriments') or {}
        states = set(p.get('states_tags') or [])
        if p.get('no_nutrition_data') in ('on', True) or 'en:nutrition-facts-to-be-completed' in states:
            stats['off skip: nutrition not entered'] += 1
            continue
        vals = {}
        kcal = num(nm.get('energy-kcal_100g'))
        if kcal is None and num(nm.get('energy_100g')) is not None:
            kcal = num(nm.get('energy_100g')) / 4.184
        if kcal is not None:
            vals['kcal'] = kcal
        for key, (nk, factor) in OFF_G.items():
            v = num(nm.get(nk + '_100g'))
            if v is None:
                continue
            unit = (nm.get(nk + '_unit') or '').lower()
            if key == 'vitA' and unit not in ('µg', 'mcg', 'mg', 'g'):
                continue  # IU or % DV: can't convert to RAE reliably
            vals[key] = v * factor
        name = clean_name(name, brand)
        ss = num(p.get('serving_quantity'))
        if ss is not None and not (0 < ss <= 3000):
            ss = None
        if not check_values(vals, ss, num(nm.get('polyols_100g')) or 0):
            stats['off skip: failed checks'] += 1
            continue
        k = (key_of(brand), key_of(name))
        if k in existing_keys:
            stats['off skip: already in USDA (name)'] += 1
            continue
        existing_keys.add(k)
        label = clean_serving(p.get('serving_size') or '') if ss else None
        rec = {
            'id': 10 ** 14 + int(code), 'src': 'O', 'name': name, 'brand': brand,
            'cat': off_category(p.get('categories_tags')), 'vals': vals, 'ss': ss, 'label': label,
            'pkg': package_grams(p.get('quantity') or ''), 'upcs': [code], 'date': (0, 0, 0),
        }
        out.append(rec)
        stats['off: kept ' + q] += 1
    return out


# ---------------------------------------------------------------------------
# Write

def write_text(path, text):
    data = text.encode('utf-8')
    with open(path, 'wb') as f:
        f.write(data)
    return len(data)


OUTPUT_FILE = re.compile(r'^(meta\.json|brands\.txt(\.gz)?|[iru]\d+\.txt(\.gz)?)$')


def main():
    # Write into a staging folder and swap at the end, so an interrupted build leaves the old files.
    stage = OUT.rstrip('/\\') + '.new'
    shutil.rmtree(stage, ignore_errors=True)
    os.makedirs(stage)

    usda = load_usda()
    upcs = set()
    keys = set()
    for r in usda:
        keys.add((key_of(r['brand']), key_of(r['name'])))
        for u in r['upcs']:
            upcs.add(u.lstrip('0'))
    off = load_off(upcs, keys) if os.path.isdir(OFF_DIR) else []
    recs = usda + off

    # Display brand per brand key: the most common spelling.
    spellings = defaultdict(Counter)
    for r in recs:
        spellings[key_of(r['brand'])][r['brand']] += 1
    for r in recs:
        r['bkey'] = key_of(r['brand'])
        r['brand'] = spellings[r['bkey']].most_common(1)[0][0]
    recs.sort(key=lambda r: (r['bkey'], r['name'].lower(), r['id']))

    cats = Counter(r['cat'] for r in recs)
    cat_list = [c for c, _ in cats.most_common()]
    cat_idx = {c: i for i, c in enumerate(cat_list)}

    index_lines, record_lines = [], []
    upc_rows = defaultdict(list)
    brands = []
    for line, r in enumerate(recs):
        if not brands or brands[-1][0] != r['bkey']:
            brands.append([r['bkey'], r['brand'], line, 0])
        brands[-1][3] += 1
        portions = []
        ss = r['ss']
        if ss:
            portions.append(((r['label'] or '1 serving'), ss))
            if r['pkg'] and r['pkg'] > ss * 1.5 and r['pkg'] <= 5000:
                portions.append(('1 package', r['pkg']))
        por_s = '|'.join(f'{lab}~{fmt_num(round(g, 1))}' for lab, g in portions)
        kcal = r['vals']['kcal']
        if ss:
            serv_label, serv_g = (r['label'] or '1 serving'), ss
        else:
            serv_label, serv_g = '100 g', 100
        index_lines.append(f"{r['name']}\t{int(round(kcal * serv_g / 100))}\t{serv_label}\t{fmt_num(round(serv_g, 1))}")
        record_lines.append('\t'.join([str(r['id']), r['src'], str(cat_idx[r['cat']]), fmt_values(r['vals']), por_s]))
        for u in r['upcs']:
            u = u.lstrip('0')
            if u.isdigit():
                upc_rows[int(u[-1])].append((u, line))

    total = len(recs)
    meta = {
        'version': VERSION, 'recordFormat': 2, 'count': total, 'keys': BKEYS, 'recordsPerShard': RECORDS_PER_SHARD,
        'parts': [], 'shards': math.ceil(total / RECORDS_PER_SHARD), 'upcShards': UPC_SHARDS,
        'categories': cat_list, 'brands': len(brands),
        'sources': {
            'B': {'name': 'USDA FoodData Central, Branded Foods (Dec 2025)', 'count': sum(1 for r in recs if r['src'] == 'B')},
            'O': {'name': 'Open Food Facts (ODbL)', 'count': sum(1 for r in recs if r['src'] == 'O')},
        },
    }
    sizes = Counter()
    sizes['brands'] += write_text(os.path.join(stage, 'brands.txt'), '\n'.join(f'{b[1]}\t{b[2]}\t{b[3]}' for b in brands))
    per_part = math.ceil(total / PARTS)
    for k in range(PARTS):
        a, b = k * per_part, min(total, (k + 1) * per_part)
        size = write_text(os.path.join(stage, f'i{k}.txt'), '\n'.join(index_lines[a:b]))
        meta['parts'].append({'file': f'i{k}.txt', 'start': a, 'count': b - a, 'bytes': size})
        sizes['index'] += size
    for s in range(meta['shards']):
        a = s * RECORDS_PER_SHARD
        sizes['records'] += write_text(os.path.join(stage, f'r{s:03d}.txt'), '\n'.join(record_lines[a:a + RECORDS_PER_SHARD]))
    for d in range(UPC_SHARDS):
        rows = sorted(upc_rows[d])
        sizes['barcodes'] += write_text(os.path.join(stage, f'u{d}.txt'), '\n'.join(f'{u}\t{line}' for u, line in rows))
    with open(os.path.join(stage, 'meta.json'), 'w', encoding='utf-8') as f:
        json.dump(meta, f, separators=(',', ':'))

    os.makedirs(OUT, exist_ok=True)
    for fn in os.listdir(OUT):
        if OUTPUT_FILE.match(fn):
            os.remove(os.path.join(OUT, fn))
    for fn in os.listdir(stage):
        os.replace(os.path.join(stage, fn), os.path.join(OUT, fn))
    os.rmdir(stage)

    print('products', total, 'brands', len(brands), 'record shards', meta['shards'])
    for k, v in sorted(sizes.items()):
        print(f'  {k:16s} {v / 1e6:8.2f} MB')
    for k, v in sorted(stats.items()):
        print(f'  {k:45s} {v}')


main()
