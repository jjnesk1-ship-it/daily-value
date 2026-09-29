/* Daily Value: USDA food database (data/foods.txt) loading, search and nutrient lookup. */
(function () {
  'use strict';
  const DV = window.DV;
  const { TRACKED } = DV.core;

  const DB = (DV.foodDB = {
    status: 'idle', // idle | loading | ready | error
    error: '',
    foods: [],
    byId: new Map(),
    keys: [],
    groups: [],
  });
  const listeners = new Set();
  DB.onChange = (fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  };
  const emit = () => listeners.forEach((fn) => fn());

  DB.load = function () {
    if (DB._p) return DB._p;
    DB.status = 'loading';
    emit();
    DB._p = fetch('data/foods.txt')
      .then((r) => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      })
      .then(parse)
      .then(() => {
        DB.status = 'ready';
        emit();
      })
      .catch((e) => {
        DB.status = 'error';
        DB.error = String((e && e.message) || e);
        DB._p = null;
        emit();
      });
    return DB._p;
  };

  // ---------------------------------------------------------------------------
  // Tokenizing
  const STOP = new Set(['and', 'with', 'of', 'the', 'a', 'an', 'in', 'or', 'to', 'for', 'on', 'my', 'some', 'w', 'from']);
  const SYNONYMS = {
    yoghurt: 'yogurt', soda: 'soft drink', pop: 'soft drink', fries: 'french fries', chips: 'chips',
    omelette: 'omelet', doughnut: 'doughnut', donut: 'doughnut', ketchup: 'catsup', catsup: 'catsup',
    scallion: 'onions green', aubergine: 'eggplant', courgette: 'zucchini', prawn: 'shrimp', prawns: 'shrimp',
    porridge: 'oatmeal', oats: 'oats', garbanzo: 'chickpeas', chickpea: 'chickpeas',
  };
  const PLAIN = new Set(['raw', 'whole', 'plain', 'cooked', 'baked', 'roasted', 'grilled', 'boiled', 'nfs', 'fresh', 'brewed', 'regular', 'unsweetened']);
  const EXTRA = new Set(['canned', 'sauce', 'breaded', 'coated', 'fried', 'battered', 'stuffed', 'dehydrated', 'powder', 'pickled', 'creamed', 'dry', 'mix']);
  function tokenize(s) {
    return s.toLowerCase().replace(/['’]/g, '').split(/[^a-z0-9%]+/).filter(Boolean);
  }
  function stem(t) {
    if (t.length > 4 && t.endsWith('ies')) return t.slice(0, -3) + 'y';
    if (t.length > 4 && t.endsWith('oes')) return t.slice(0, -2);
    if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss') && !t.endsWith('us')) return t.slice(0, -1);
    return t;
  }
  DB.tokenize = tokenize;

  function parse(text) {
    const lines = text.split('\n');
    const foods = [];
    const byId = new Map();
    let keys = [];
    let groups = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      if (line.charCodeAt(0) === 35 /* # */) {
        const tab = line.indexOf('\t');
        const tag = line.slice(0, tab);
        const rest = line.slice(tab + 1);
        if (tag === '#N') keys = rest.split(',');
        else if (tag === '#G') groups = rest.split('\t');
        continue;
      }
      const f = line.split('\t');
      const toks = tokenize(f[3]);
      const comma = f[3].indexOf(',');
      const food = {
        id: +f[0],
        src: f[1],
        g: +f[2],
        name: f[3],
        v: f[4] || '',
        p: f[5] || '',
        lname: f[3].toLowerCase(),
        toks,
        stems: toks.map(stem),
        // First comma-separated part, e.g. "chicken breast" in "Chicken breast, grilled"
        head: tokenize(comma < 0 ? f[3] : f[3].slice(0, comma)).map(stem).join(' '),
        _n: null,
        _por: null,
      };
      foods.push(food);
      byId.set(food.id, food);
    }
    DB.keys = keys;
    DB.groups = groups;
    DB.foods = foods;
    DB.byId = byId;
    // Group-level ranking penalties.
    DB.groupPenalty = groups.map((g) => {
      const s = g.toLowerCase();
      if (/baby|infant|formula|human milk/.test(s)) return -7;
      if (/alaska native/.test(s)) return -4;
      if (s === 'not included in a food category') return -3;
      return 0;
    });
    DB.groupBaby = groups.map((g) => /baby|infant|formula|human milk/i.test(g));
  }

  // ---------------------------------------------------------------------------
  // Nutrients (per 100 g), parsed lazily
  DB.nutrients = function (food) {
    if (food._n) return food._n;
    const parts = food.v.split(',');
    const keys = food.keys || DB.keys; // brand-name foods carry their own key order
    const raw = {};
    for (let i = 0; i < keys.length; i++) {
      const s = parts[i];
      raw[keys[i]] = s === undefined || s === '' ? null : parseFloat(s);
    }
    food._n = derive(raw);
    return food._n;
  };

  // Map the raw database columns onto the tracked nutrient set.
  function derive(raw) {
    const n = {};
    for (const key of TRACKED) n[key] = raw[key] !== undefined ? raw[key] : null;
    n.netcarbs = raw.carbs == null ? null : Math.max(0, raw.carbs - (raw.fiber || 0));
    n.metcys = raw.met != null && raw.cys != null ? raw.met + raw.cys : null;
    n.phetyr = raw.phe != null && raw.tyr != null ? raw.phe + raw.tyr : null;
    return n;
  }
  DB.derive = derive;

  DB.portions = function (food) {
    if (food._por) return food._por;
    const out = [];
    if (food.p) {
      for (const item of food.p.split('|')) {
        const i = item.lastIndexOf('~');
        if (i < 0) continue;
        const label = item.slice(0, i);
        const g = parseFloat(item.slice(i + 1));
        if (label && g > 0) out.push({ label, g });
      }
    }
    food._por = out;
    return out;
  };

  // The serving to preselect: FNDDS's "typical serving" when present, else the first listed portion.
  DB.defaultPortion = function (food) {
    const ps = DB.portions(food);
    if (!ps.length) return { label: '100 g', g: 100, qty: 1 };
    const typical = ps.find((p) => p.label === '1 typical serving');
    const first = ps.find((p) => p.label !== '1 typical serving') || ps[0];
    // Prefer a household measure the person would recognise over "typical serving" if it's the same weight.
    if (typical && first && Math.abs(first.g - typical.g) < 1) return first;
    return typical || first;
  };

  DB.groupName = (food) => (food.branded ? food.cat : DB.groups[food.g] || '');
  DB.sourceLabel = (food) => (food.branded ? DV.brands.sourceLabel(food) : food.src === 'F' ? 'USDA FNDDS' : 'USDA SR Legacy');

  /**
   * The food a reference points to: { fid } for USDA foods; brand-name foods also carry `bf`,
   * their own copy of the product (see js/branded.js), so they resolve without loading anything.
   */
  DB.get = function (ref) {
    if (!ref || ref.fid == null) return null;
    if (ref.bf && DV.brands) {
      const f = DV.brands.fromBf(ref.bf);
      if (f) return f;
    }
    return DB.byId.get(ref.fid) || (DV.brands && DV.brands.byId.get(ref.fid)) || null;
  };

  // ---------------------------------------------------------------------------
  // Search
  function matchToken(q, qs, food) {
    let best = 0;
    let pos = 99;
    const toks = food.toks;
    const stems = food.stems;
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      const st = stems[i];
      let s = 0;
      if (t === q || st === qs) s = 3;
      else if (t.startsWith(q) || st.startsWith(qs)) s = 2;
      else if (q.length >= 4 && (t.includes(q) || st.includes(qs))) s = 1;
      if (s > best) {
        best = s;
        pos = i;
        if (s === 3) break;
      }
    }
    return best ? best * 10 + Math.max(0, 9 - pos) : 0; // encode score + earliness
  }

  function expandQuery(query) {
    const raw = tokenize(query).filter((t) => !STOP.has(t));
    const out = [];
    for (const t of raw) {
      const syn = SYNONYMS[t];
      if (syn) tokenize(syn).forEach((x) => out.push(x));
      else out.push(t);
    }
    return Array.from(new Set(out));
  }

  /**
   * search(query, {limit, boost}) -> [{ food, score }]
   * All query words must match (exact word > word prefix > inside a word).
   * Falls back to "all but one word" when nothing matches every word.
   */
  DB.search = function (query, opts = {}) {
    if (DB.status !== 'ready') return [];
    const limit = opts.limit || 40;
    const boost = opts.boost;
    const q = expandQuery(query);
    if (!q.length) return [];
    const qs = q.map(stem);
    const wantsBaby = q.some((t) => /^(baby|infant|formula|toddler)/.test(t));
    const prefixes = q.map((t) => t.slice(0, Math.min(3, t.length)));
    const qhead = qs.join(' ');
    const qset = new Set(q);

    const run = (need) => {
      const out = [];
      for (const food of DB.foods) {
        if (need === q.length) {
          let ok = true;
          for (const p of prefixes) {
            if (food.lname.indexOf(p) < 0) {
              ok = false;
              break;
            }
          }
          if (!ok) continue;
        }
        let score = 0;
        let matched = 0;
        for (let i = 0; i < q.length; i++) {
          const m = matchToken(q[i], qs[i], food);
          if (m) {
            matched++;
            score += m;
          }
        }
        if (matched < need) continue;
        // Food name starts with the first query word: "Egg, whole…" for "egg".
        if (food.stems[0] === qs[0] || food.toks[0] === q[0]) score += 14;
        // …and better still when the leading part is exactly what was searched ("Egg, …" rather than "Egg burrito").
        if (food.head === qhead) score += 12;
        // Plain, everyday forms before specialty preparations.
        let plain = 0;
        let extra = 0;
        for (const t of food.toks) {
          if (PLAIN.has(t)) plain++;
          else if (EXTRA.has(t) && !qset.has(t)) extra++;
        }
        score += Math.min(plain, 3) * 1.5 - Math.min(extra, 2) * 2.5;
        if (food.lname.includes('skin eaten')) score -= 3;
        score -= food.toks.length * 1.3; // shorter, simpler names first
        if (food.src === 'F') score += 5; // FNDDS lists foods as people eat them
        if (!wantsBaby) score += DB.groupPenalty[food.g] * 4;
        if (/\b(nfs|ns as to)\b/.test(food.lname)) score += 2; // "not further specified" = the generic version
        if (boost) score += boost(food) || 0;
        out.push({ food, score });
      }
      return out;
    };

    let results = run(q.length);
    if (!results.length && q.length > 1) results = run(q.length - 1);
    results.sort((a, b) => b.score - a.score || a.food.name.length - b.food.name.length);
    return results.slice(0, limit);
  };

  // ---------------------------------------------------------------------------
  // Foods richest in a nutrient per typical serving ("nutrient oracle").
  const topCache = {};
  DB.topSources = function (key, limit = 16) {
    if (DB.status !== 'ready') return [];
    if (topCache[key]) return topCache[key].slice(0, limit);
    const scored = [];
    for (const food of DB.foods) {
      if (DB.groupBaby[food.g] || DB.groupPenalty[food.g] < 0) continue;
      if (/supplement|fortified with|formula|powder|dry mix|dehydrated|freeze-dried/.test(food.lname)) continue;
      const por = DB.defaultPortion(food);
      if (!por || por.g > 600) continue;
      const n = DB.nutrients(food);
      const v = n[key];
      if (!v || !(n.kcal >= 0)) continue;
      const amount = (v * por.g) / 100;
      scored.push({ food, portion: por, amount });
    }
    scored.sort((a, b) => b.amount - a.amount);
    // Avoid ten near-identical entries ("Cereals ready-to-eat, …") by keying on the first two words.
    const seen = new Set();
    const out = [];
    for (const s of scored) {
      const k = s.food.toks.slice(0, 2).join(' ');
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(s);
      if (out.length >= 40) break;
    }
    topCache[key] = out;
    return out.slice(0, limit);
  };
})();
