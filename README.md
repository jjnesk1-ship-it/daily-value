# Daily Value

A nutrition tracker in the spirit of Cronometer and MyFitnessPal, styled after the Nutrition Facts label. It is a static web page: plain JavaScript files, no build step and no server code.

## Features

- **Diary** for breakfast, lunch, dinner and snacks, plus exercise, water and daily notes.
- **Foods:** 13,224 everyday foods from USDA (SR Legacy and FNDDS) and 374,125 brand-name products from USDA Branded Foods and Open Food Facts (store brands such as Kirkland Signature, Trader Joe's, Aldi and Costco).
- **Barcodes** scanned live with the camera, read from a photo, or typed.
- **Custom foods and recipes**, favorites and recent foods.
- **One-tap suggestions** of the foods you usually eat at each meal, and your usual meal in a single tap.
- **Weight log** with a smoothed trend line, goal weight, weekly pace and an estimated date to reach the goal.
- **Targets** from the Dietary Reference Intakes for your age and sex, with your own goals for any macro or micronutrient.
- **Trends:** calories by source, body weight, the foods that supply the most calories, and a nutrient report.
- **With Claude** (only when the page runs as a claude.ai artifact): describe or photograph a meal to log it, read a Nutrition Facts label into a custom food, and get a review of your day.

## Run it locally

```bash
python tools/dev_server.py 8765
```

Then open http://localhost:8765. Any static file server works; `dev_server.py` also adds the small page wrapper the claude.ai artifact host adds when publishing.

Outside claude.ai the diary is saved in the browser (localStorage), and the Claude features and account sync are hidden.

## Project layout

| Path | What it holds |
| --- | --- |
| `index.html` | The page and all styles |
| `js/core.js` | Nutrients, targets, units and dates |
| `js/fooddb.js` | USDA foods (`data/foods.txt`) and search |
| `js/branded.js` | Brand-name products, barcode lookup and the camera scanner |
| `js/store.js` | App state, calculations, saving and sync |
| `js/ai.js` | Features that ask Claude |
| `js/ui.js` | Shared components and charts |
| `js/app.js` | Views and sheets |
| `data/foods.txt` | USDA SR Legacy and FNDDS foods |
| `data/b/` | Brand-name products: search index, records, barcodes and brands |
| `tools/` | Scripts that build the data files |

## Rebuilding the food data

The raw downloads are not in the repository; each script's header describes its input.

1. **Everyday foods:** download the SR Legacy and FNDDS CSV files from [FoodData Central](https://fdc.nal.usda.gov/download-datasets), then run
   `python tools/build_food_db.py <sr_dir> <fndds_dir> data/foods.txt`.
2. **Brand-name products:** download the Branded Foods JSON from FoodData Central and the Open Food Facts [data export](https://static.openfoodfacts.org/data/), then run
   - `python tools/extract_branded.py <branded_json.zip> branded_min.jsonl`
   - `python tools/extract_off.py <en.openfoodfacts.org.products.csv.gz> offx`
   - `python tools/build_branded.py branded_min.jsonl offx data/b`

## Data sources and licenses

- **USDA FoodData Central** (SR Legacy, April 2018; FNDDS 2021–2023; Branded Foods, December 2025) is in the public domain under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).
- **Open Food Facts** data is © Open Food Facts contributors and licensed under the [Open Database License (ODbL)](https://opendatacommons.org/licenses/odbl/1-0/). The brand-name files in `data/b/` contain Open Food Facts data and are made available under the ODbL; individual contents are under the [Database Contents License](https://opendatacommons.org/licenses/dbcl/1-0/).
- **Targets** follow the National Academies' Dietary Reference Intakes. Exercise estimates use MET values from the Compendium of Physical Activities.
- **Libraries** are loaded from CDNs at runtime: [Preact](https://preactjs.com) with [htm](https://github.com/developit/htm) (MIT) and [ZXing](https://github.com/zxing-js/library) (Apache 2.0) for barcode reading.

Daily Value is for general tracking and isn't medical advice.
