"""Build data/foods.txt for the Nourish app from USDA FoodData Central CSV downloads.

Inputs (extracted zips from https://fdc.nal.usda.gov/download-datasets):
  FoodData_Central_sr_legacy_food_csv_2018-04       (SR Legacy, ~7,800 foods)
  FoodData_Central_survey_food_csv_2024-10-31       (FNDDS 2021-2023, ~5,400 foods)

Usage:
  python tools/build_food_db.py <sr_dir> <fndds_dir> [out_path]

Output format (UTF-8 text, one food per line, tab separated):
  #NOURISH-FOODS\t1
  #N\t<nutrient keys, comma separated>
  #G\t<group names, tab separated>
  <fdc_id>\t<S|F>\t<group index>\t<name>\t<values per 100 g, comma separated, empty = no data>\t<portions>
Portions are "label~grams" joined with "|".
"""

import csv
import math
import os
import sys
from collections import defaultdict

# Output nutrient order. Each entry: key -> list of FDC nutrient ids tried in order.
# Keys prefixed with "=" are derived below.
NUTRIENTS = [
    ("kcal", [1008]), ("prot", [1003]), ("fat", [1004]), ("carbs", [1005]),
    ("fiber", [1079]), ("sugars", [2000, 1063]), ("water", [1051]),
    ("alcohol", [1018]), ("caffeine", [1057]),
    ("sat", [1258]), ("mono", [1292]), ("poly", [1293]), ("trans", [1257]),
    ("chol", [1253]), ("o3", "="), ("o6", "="), ("epadha", "="),
    ("vitA", [1106]), ("vitC", [1162]), ("vitD", "="), ("vitE", [1109]),
    ("vitK", [1185]), ("b1", [1165]), ("b2", [1166]), ("b3", [1167]),
    ("b5", [1170]), ("b6", [1175]), ("folate", [1190, 1177]), ("b12", [1178]),
    ("choline", [1180]),
    ("betacar", [1107]), ("lycopene", [1122]), ("lutein", [1123]),
    ("ca", [1087]), ("cu", [1098]), ("fe", [1089]), ("mg", [1090]),
    ("mn", [1101]), ("p", [1091]), ("k", [1092]), ("se", [1103]),
    ("na", [1093]), ("zn", [1095]),
    ("his", [1221]), ("ile", [1212]), ("leu", [1213]), ("lys", [1214]),
    ("met", [1215]), ("cys", [1216]), ("phe", [1217]), ("tyr", [1218]),
    ("thr", [1211]), ("trp", [1210]), ("val", [1219]),
]

# Fatty-acid components used for the derived omega totals.
ALA_EXACT, PUFA_18_3 = 1404, 1270
SDA, EPA, DPA, DHA = 1276, 1278, 1280, 1272
LA_EXACT, PUFA_18_2 = 1316, 1269
GLA, PUFA_20_2_N6 = 1321, 1313
AA_EXACT, PUFA_20_4 = 1406, 1271
VIT_D_UG, VIT_D_IU = 1114, 1110


def rows(path):
    with open(path, newline="", encoding="utf-8") as f:
        yield from csv.DictReader(f)


def fmt_num(v):
    """Compact number: 3 significant digits (integers from 100 up), no trailing zeros, no leading 0."""
    if v is None:
        return ""
    if v == 0:
        return "0"
    a = abs(v)
    if a >= 100:
        s = str(int(round(v)))
    else:
        digits = 3 - int(math.floor(math.log10(a))) - 1  # 3 significant digits
        digits = max(0, min(digits, 6))
        s = f"{v:.{digits}f}"
        if "." in s:
            s = s.rstrip("0").rstrip(".")
    if s.startswith("0."):
        s = s[1:]
    elif s.startswith("-0."):
        s = "-" + s[2:]
    return s if s not in ("", "-") else "0"


def clean(text):
    return " ".join(str(text).replace("\t", " ").replace("|", "/").replace("~", "-").split())


def fmt_amount(a):
    """Household amounts are always >= 1 after normalisation."""
    if abs(a - round(a)) < 1e-9:
        return str(int(round(a)))
    return fmt_num(a)


def fmt_portions(portions):
    return "|".join(f"{clean(label)}~{fmt_num(round(grams, 1))}" for label, grams in portions)


def derive(n):
    """n: dict fdc_nutrient_id -> amount. Returns dict key -> value (or None)."""
    out = {}
    for key, ids in NUTRIENTS:
        if ids == "=":
            continue
        val = None
        for i in ids:
            if i in n:
                val = n[i]
                break
        out[key] = val

    # Vitamin D: prefer micrograms, fall back to IU / 40.
    if VIT_D_UG in n:
        out["vitD"] = n[VIT_D_UG]
    elif VIT_D_IU in n:
        out["vitD"] = n[VIT_D_IU] / 40.0
    else:
        out["vitD"] = None

    ala = n.get(ALA_EXACT, n.get(PUFA_18_3))
    o3_parts = [ala, n.get(SDA), n.get(EPA), n.get(DPA), n.get(DHA)]
    out["o3"] = sum(x for x in o3_parts if x is not None) if any(x is not None for x in o3_parts) else None

    la = n.get(LA_EXACT, n.get(PUFA_18_2))
    aa = n.get(AA_EXACT, n.get(PUFA_20_4))
    o6_parts = [la, aa, n.get(GLA), n.get(PUFA_20_2_N6)]
    out["o6"] = sum(x for x in o6_parts if x is not None) if any(x is not None for x in o6_parts) else None

    ed = [n.get(EPA), n.get(DHA)]
    out["epadha"] = sum(x for x in ed if x is not None) if any(x is not None for x in ed) else None
    return out


def load_nutrients(base, id_map=None):
    """Return dict fdc_id -> {fdc_nutrient_id: amount}."""
    per_food = defaultdict(dict)
    for r in rows(os.path.join(base, "food_nutrient.csv")):
        nid = r["nutrient_id"]
        if id_map is not None:
            nid = id_map.get(nid)
            if nid is None:
                continue
        try:
            nid = int(nid)
            amt = float(r["amount"])
        except (TypeError, ValueError):
            continue
        per_food[r["fdc_id"]][nid] = amt
    return per_food


def load_portions(base, units, fndds):
    per_food = defaultdict(list)
    for r in rows(os.path.join(base, "food_portion.csv")):
        try:
            grams = float(r["gram_weight"] or 0)
        except ValueError:
            continue
        if grams <= 0:
            continue
        seq = int(float(r["seq_num"] or 0))
        desc = clean(r.get("portion_description") or "")
        if fndds:
            if not desc:
                continue
            if desc.lower() == "quantity not specified":
                desc = "1 typical serving"
            if desc.lower().startswith("guideline amount"):
                continue  # FNDDS recipe-guidance weights, not portions people eat
            label = desc
        else:
            modifier = clean(r.get("modifier") or "")
            unit_id = r.get("measure_unit_id") or "9999"
            unit = "" if unit_id == "9999" else units.get(unit_id, "")
            try:
                amount = float(r["amount"] or 1)
            except ValueError:
                amount = 1.0
            if amount <= 0:
                amount = 1.0
            # Normalise fractional household measures to one whole unit ("0.5 cup" -> "1 cup").
            if amount < 1:
                grams = grams / amount
                amount = 1.0
            words = " ".join(x for x in (unit, modifier or desc) if x)
            if not words:
                continue
            if words.lower().startswith("nlea serving"):
                words = "serving (NLEA)" + words[12:]
            label = f"{fmt_amount(amount)} {words}"
        per_food[r["fdc_id"]].append((seq, label, grams))
    out = {}
    for fid, items in per_food.items():
        items.sort(key=lambda x: x[0])
        seen, portions = set(), []
        for _, label, grams in items:
            k = label.lower()
            if k in seen:
                continue
            seen.add(k)
            portions.append((label, grams))
        out[fid] = portions[:8]
    return out


# FNDDS does not report these; estimate them from each food's SR Legacy ingredient recipe.
FILL_IDS = [1101, 1257]  # manganese, trans fat (both stable in cooking)
AMINO_IDS = [1221, 1212, 1213, 1214, 1215, 1216, 1217, 1218, 1211, 1210, 1219]


def fill_from_ingredients(fn_dir, sr_dir, fn_nut, sr_nut):
    """Add ingredient-based estimates to FNDDS nutrient dicts (in place). Returns count of foods filled."""
    ndb_to_fdc = {r["NDB_number"]: r["fdc_id"] for r in rows(os.path.join(sr_dir, "sr_legacy_food.csv"))}
    recipes = defaultdict(list)
    for r in rows(os.path.join(fn_dir, "input_food.csv")):
        try:
            g = float(r["gram_weight"] or 0)
        except ValueError:
            continue
        sr = ndb_to_fdc.get((r.get("sr_code") or "").strip())
        if g > 0:
            recipes[r["fdc_id"]].append((sr, g))
    filled = 0
    for fid, ings in recipes.items():
        food = fn_nut.get(fid)
        if not food:
            continue
        total_w = sum(g for _, g in ings)
        known = [(sr_nut.get(sr), g) for sr, g in ings]
        if total_w <= 0 or any(n is None for n, _ in known):
            continue  # an ingredient we can't resolve; don't guess
        dry = [(n, g, g * (100 - n.get(1051, 0)) / 100) for n, g in known]
        total_dry = sum(d for _, _, d in dry)
        if total_dry <= 0:
            continue
        mix_prot = sum(n.get(1003, 0) * g / 100 for n, g, _ in dry) / total_w * 100
        mix_dry_frac = total_dry / total_w
        food_dry_frac = (100 - food.get(1051, 0)) / 100
        dm_factor = food_dry_frac / mix_dry_frac if mix_dry_frac > 0 else 1
        did = False
        for nid in FILL_IDS + AMINO_IDS:
            amino = nid in AMINO_IDS
            covered = 0.0
            amount = 0.0
            for n, g, d in dry:
                v = n.get(nid)
                if v is None and amino and n.get(1003, 0) == 0:
                    v = 0.0  # no protein, so no amino acids
                if v is None:
                    continue
                covered += d
                amount += v * g / 100
            if covered < 0.8 * total_dry:
                continue
            per100 = amount / total_w * 100 / (covered / total_dry)
            if amino:
                if mix_prot <= 0.05:
                    per100 = 0.0 if food.get(1003, 0) < 0.1 else None
                else:
                    per100 = per100 * food.get(1003, 0) / mix_prot  # scale to the food's own protein
            else:
                per100 = per100 * dm_factor  # adjust for water gained or lost in cooking
            if per100 is not None:
                food[nid] = per100
                did = True
        filled += did
    return filled


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    sr_dir, fn_dir = sys.argv[1], sys.argv[2]
    out_path = sys.argv[3] if len(sys.argv) > 3 else os.path.join(os.path.dirname(__file__), "..", "data", "foods.txt")

    groups, group_index = [], {}

    def gidx(name):
        name = clean(name) or "Other"
        if name not in group_index:
            group_index[name] = len(groups)
            groups.append(name)
        return group_index[name]

    lines = []
    keys = [k for k, _ in NUTRIENTS]

    # --- SR Legacy ---
    sr_units = {r["id"]: r["name"] for r in rows(os.path.join(sr_dir, "measure_unit.csv"))}
    sr_cats = {r["id"]: r["description"] for r in rows(os.path.join(sr_dir, "food_category.csv"))}
    sr_nut = load_nutrients(sr_dir)
    sr_por = load_portions(sr_dir, sr_units, fndds=False)
    n_sr = 0
    for r in rows(os.path.join(sr_dir, "food.csv")):
        fid = r["fdc_id"]
        n = sr_nut.get(fid)
        if not n or 1008 not in n:
            continue
        d = derive(n)
        g = gidx(sr_cats.get(r["food_category_id"], "Other"))
        vals = ",".join(fmt_num(d[k]) for k in keys).rstrip(",")
        por = fmt_portions(sr_por.get(fid, []))
        lines.append(f"{fid}\tS\t{g}\t{clean(r['description'])}\t{vals}\t{por}")
        n_sr += 1

    # --- FNDDS (survey foods) ---
    fn_nut_map = {r["nutrient_nbr"]: r["id"] for r in rows(os.path.join(fn_dir, "nutrient.csv")) if r.get("nutrient_nbr")}
    fn_units = {r["id"]: r["name"] for r in rows(os.path.join(fn_dir, "measure_unit.csv"))}
    fn_cats = {r["wweia_food_category"]: r["wweia_food_category_description"] for r in rows(os.path.join(fn_dir, "wweia_food_category.csv"))}
    fn_nut = load_nutrients(fn_dir, id_map=fn_nut_map)
    n_filled = fill_from_ingredients(fn_dir, sr_dir, fn_nut, sr_nut)
    print(f"FNDDS foods with ingredient-based estimates: {n_filled}")
    fn_por = load_portions(fn_dir, fn_units, fndds=True)
    n_fn = 0
    for r in rows(os.path.join(fn_dir, "food.csv")):
        fid = r["fdc_id"]
        n = fn_nut.get(fid)
        if not n or 1008 not in n:
            continue
        d = derive(n)
        g = gidx(fn_cats.get(r["food_category_id"], "Other"))
        vals = ",".join(fmt_num(d[k]) for k in keys).rstrip(",")
        por = fmt_portions(fn_por.get(fid, []))
        lines.append(f"{fid}\tF\t{g}\t{clean(r['description'])}\t{vals}\t{por}")
        n_fn += 1

    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    with open(out_path, "w", encoding="utf-8", newline="\n") as f:
        f.write("#NOURISH-FOODS\t1\n")
        f.write("#N\t" + ",".join(keys) + "\n")
        f.write("#G\t" + "\t".join(groups) + "\n")
        f.write("\n".join(lines))
        f.write("\n")
    size = os.path.getsize(out_path)
    print(f"SR foods: {n_sr}, FNDDS foods: {n_fn}, groups: {len(groups)}, file: {out_path} ({size/1024/1024:.2f} MB)")


if __name__ == "__main__":
    main()
