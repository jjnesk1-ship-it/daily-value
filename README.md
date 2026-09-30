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

## Install it on your phone

Open **https://jjnesk1-ship-it.github.io/daily-value/** on your phone.

- **iPhone or iPad:** in Safari, tap the Share button (on iPhone with iOS 26 it's in the **⋯** menu next to the address bar), choose **Add to Home Screen**, leave **Open as Web App** on, and tap **Add**. The Home Screen app keeps its own diary, separate from Safari's, so add it before you start logging.
- **Android:** in Chrome, tap **Install** when the app offers it, or open the ⋮ menu and choose **Add to home screen** / **Install app**.

The installed app opens full screen from its icon and works offline after the first visit. Its diary is saved on that device only. To move it to another device, or from Safari into the Home Screen app, use **Copy backup** and **Paste a backup** in Profile, or **Back up** and **Restore backup** with a file.

## Email accounts

In the installable app, signing in with an email keeps a diary in an account and syncs it between devices. People sign in with a one-time code from an email; there's no password. The claude.ai version keeps syncing through the Claude account instead.

Accounts use a free [Supabase](https://supabase.com) project and stay switched off until `pwa/config.js` has its details:

1. **Create a project** on supabase.com.
2. **Set up the database:** in **SQL Editor**, run [`supabase/schema.sql`](supabase/schema.sql). It creates the `dv_docs` table, the row-level security that limits each account to its own rows, a storage limit per account (5,000 documents, 20 MB), and a function for deleting an account.
3. **Point sign-in links at the app:** in **Authentication → URL Configuration**, set **Site URL** to `https://jjnesk1-ship-it.github.io/daily-value/`.
4. **Connect the app:** click **Connect** at the top of the project page (or open **Settings → API Keys**) and copy the **Project URL** and the **Publishable key** (`sb_publishable_…`) into `pwa/config.js`, then publish (see below). Never use a secret key: the app refuses one, and one committed to this public repo would need rotating.

**Codes or links.** Supabase's default emails carry a sign-in link rather than a code, and new free projects can't change their email templates until they use their own email provider. The app accepts either way:

- **A code** works everywhere. To send codes, set up your own email provider (next paragraph), then in **Authentication → Emails → Templates** put `{{ .Token }}` in both **Confirm sign up** and **Magic link or OTP** (for example `<p>Your Daily Value code: <strong>{{ .Token }}</strong></p>`) and remove the link. Codes may be 6 or 8 digits; set **Email OTP Length** under **Authentication → Sign In / Providers → Email** if you prefer.
- **A link** can be tapped on a computer or an Android phone. The installed iPhone app keeps its own storage, so there, copy the link from the email and paste it into the app's sign-in screen.

**Who can sign in.** Without your own email provider, Supabase only emails the members of your Supabase team (so, you), about 2 emails an hour. For anyone else to sign in, add a provider such as Resend, Postmark or Amazon SES under **Authentication → Emails → SMTP Settings**. You'll need a domain you can verify with it. Before opening sign-in to others, also consider turning on CAPTCHA under **Authentication → Attack Protection**, and serving the app from its own domain rather than a shared `github.io` address.

**Free-plan limits.** A project is paused after about a week without use (normal syncing counts as use); resume it from the Supabase dashboard and nothing is lost.

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
| `pwa/` | What the installable app adds: manifest, icons, service worker, install prompts, email accounts (`account.js`) and settings (`config.js`) |
| `supabase/schema.sql` | Database setup for email accounts |
| `tools/` | Scripts that build the data files and the installable site |

## Publishing the installable app

The GitHub Pages site is built from the same files, with the pieces in `pwa/` added:

```bash
python tools/build_site.py --publish
git push origin gh-pages
```

To try the build first, run `python tools/serve_site.py` and open http://localhost:8766.

The build writes `_site/` and commits it to the `gh-pages` branch, which GitHub Pages serves. When the app's files change, installed copies offer a **Reload** the next time they open; the food data they've stored is kept unless the data files changed too.

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

## License

The code (`index.html`, `js/` and `tools/`) is released under the [MIT License](LICENSE). The food data in `data/` keeps the licenses of its sources, listed above.

Daily Value is for general tracking and isn't medical advice.
