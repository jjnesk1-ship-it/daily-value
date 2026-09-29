/* Daily Value: brand-name foods (USDA Branded Foods + Open Food Facts), loaded from data/b/ on first search.
   Files are built by tools/build_branded.py; see that script for the formats. */
(function () {
  'use strict';
  const DV = window.DV;
  const DB = DV.foodDB;

  const BASE = 'data/b/';
  // Nutrient order of brand-name values, per record format version (BKEYS in tools/build_branded.py).
  const BKEYS = {
    1: ['kcal', 'prot', 'fat', 'carbs', 'na', 'sugars', 'sat', 'chol', 'fiber', 'trans', 'fe', 'ca', 'k',
      'vitC', 'vitD', 'mono', 'poly', 'vitA', 'b3', 'b1', 'b2', 'b6', 'folate', 'mg', 'p', 'b12', 'zn',
      'b5', 'mn', 'cu', 'se', 'vitK', 'vitE', 'choline', 'caffeine', 'alcohol', 'water'],
  };
  const SOURCES = { B: 'USDA Branded Foods', O: 'Open Food Facts' };
  const STOP = new Set(['and', 'with', 'of', 'the', 'a', 'an', 'in', 'or', 'to', 'for', 'on', 'my', 'some', 'w', 'from']);

  const BR = (DV.brands = {
    status: 'idle', // idle | loading | ready | error
    error: '',
    meta: null,
    count: 0, // products searchable so far
    total: 0, // products in the full set
    partsLoaded: 0,
    byId: new Map(), // id -> food, for products opened this session
  });
  const listeners = new Set();
  BR.onChange = (fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  };
  const emit = () => listeners.forEach((fn) => fn());

  // ---------------------------------------------------------------------------
  // Files (plain text; see tools/build_branded.py for the formats).
  async function fetchText(path) {
    const r = await fetch(BASE + path);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.text();
  }

  let metaP = null;
  function loadMeta() {
    if (!metaP) {
      metaP = fetchText('meta.json').then((t) => {
        const m = JSON.parse(t);
        if (!BKEYS[m.version] || m.recordFormat !== 2) throw new Error('Unknown brand-name food format ' + m.version);
        BR.meta = m;
        BR.total = m.count;
        return m;
      });
      metaP.catch(() => (metaP = null));
    }
    return metaP;
  }
  BR.loadMeta = loadMeta;

  // Brands: products are sorted by brand, so each brand is one run of lines.
  let brands = null; // { name: [], words: [], start: Int32Array, count: Int32Array }
  function parseBrands(text) {
    const rows = text.split('\n');
    const b = { name: new Array(rows.length), words: new Array(rows.length), start: new Int32Array(rows.length), count: new Int32Array(rows.length) };
    rows.forEach((row, i) => {
      const f = row.split('\t');
      b.name[i] = f[0];
      b.words[i] = ' ' + norm(f[0]) + ' ';
      b.start[i] = +f[1];
      b.count[i] = +f[2];
    });
    return b;
  }
  function brandOfLine(line) {
    const s = brands.start;
    let lo = 0;
    let hi = s.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (s[mid] <= line) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  // Search index parts: "name\tkcal per serving\tserving label\tserving grams" per line.
  // `low` is the same text lower-cased with apostrophes removed, for matching.
  const parts = [];
  function lineStarts(text, n) {
    const a = new Int32Array(n + 1);
    let pos = 0;
    for (let i = 0; i < n; i++) {
      a[i] = pos;
      const nl = text.indexOf('\n', pos);
      pos = nl < 0 ? text.length + 1 : nl + 1;
    }
    a[n] = text.length + 1;
    return a;
  }
  function addPart(info, text) {
    const low = norm(text);
    parts.push({ start: info.start, count: info.count, text, low, ts: lineStarts(text, info.count), ls: lineStarts(low, info.count) });
    parts.sort((a, b) => a.start - b.start);
    BR.count += info.count;
    BR.partsLoaded++;
  }
  function norm(s) {
    return s.toLowerCase().replace(/['’]/g, '');
  }
  // The index line for a product, once its part has loaded.
  function rowAt(line) {
    for (const p of parts) if (line >= p.start && line < p.start + p.count) return rowOf(p, line - p.start);
    return null;
  }

  // Each file loads once; a failed one is dropped so the next attempt fetches it again.
  let brandsP = null;
  function loadBrands() {
    if (!brandsP) {
      brandsP = fetchText('brands.txt').then((t) => {
        brands = parseBrands(t);
        emit();
      });
      brandsP.catch(() => (brandsP = null));
    }
    return brandsP;
  }
  const partPs = new Map(); // part index -> Promise
  function loadPart(meta, k) {
    let p = partPs.get(k);
    if (!p) {
      const info = meta.parts[k];
      p = fetchText(info.file).then((text) => {
        addPart(info, text);
        emit();
      });
      p.catch(() => partPs.delete(k));
      partPs.set(k, p);
    }
    return p;
  }

  BR.load = function () {
    if (BR._p) return BR._p;
    BR.status = 'loading';
    BR.error = '';
    emit();
    BR._p = (async () => {
      const meta = await loadMeta();
      await loadBrands();
      // Parts arrive in any order; search covers whatever has loaded so far.
      await Promise.all(meta.parts.map((_, k) => loadPart(meta, k)));
      BR.status = 'ready';
      emit();
    })().catch((e) => {
      BR.status = 'error';
      BR.error = String((e && e.message) || e);
      BR._p = null;
      emit();
    });
    return BR._p;
  };

  // ---------------------------------------------------------------------------
  // Search
  function isWordChar(c) {
    return (c >= 48 && c <= 57) || (c >= 97 && c <= 122);
  }
  // 3 = whole word, 2 = start of a word, 0 = no match. `s` is lower-case text.
  function wordMatch(s, t) {
    let i = s.indexOf(t);
    let best = 0;
    while (i >= 0) {
      if (i === 0 || !isWordChar(s.charCodeAt(i - 1))) {
        const end = i + t.length;
        if (end >= s.length || !isWordChar(s.charCodeAt(end))) return 3;
        best = 2;
      }
      i = s.indexOf(t, i + 1);
    }
    return best;
  }

  function queryTokens(query) {
    // Product text is plain ASCII, so "jalapeño" is searched as "jalapeno".
    const toks = norm(query.normalize('NFD').replace(/[\u0300-\u036f]/g, ''))
      .split(/[^a-z0-9%]+/)
      .filter((t) => t && !STOP.has(t));
    return Array.from(new Set(toks));
  }

  /**
   * search(query, {limit}) -> { rows: [{ line, name, brand, kcal, label, g }], total, brandHit }
   * Every query word must start a word in the product name or its brand.
   */
  BR.search = function (query, opts = {}) {
    const limit = opts.limit || 40;
    const empty = { rows: [], total: 0, brandHit: false };
    if (!brands || !parts.length) return empty;
    const q = queryTokens(query);
    if (!q.length || !q.some((t) => t.length >= 3)) return empty;

    // Brands matching each word, e.g. "kirk" -> Kirkland Signature.
    const brandHits = q.map((t) => {
      const set = new Set();
      const needle = ' ' + t;
      for (let i = 0; i < brands.words.length; i++) if (brands.words[i].indexOf(needle) >= 0) set.add(i);
      return set;
    });
    // Drive the scan with the longest word (the most selective, usually).
    let d = 0;
    q.forEach((t, i) => {
      if (t.length > q[d].length) d = i;
    });
    const dt = q[d];

    const scored = [];
    const nameN = q.map(() => 0); // lines where each word matched the name…
    const brandN = q.map(() => 0); // …or only the brand
    const seen = new Set();
    const consider = (p, li) => {
      const line = p.start + li;
      if (seen.has(line)) return;
      seen.add(line);
      const ls = p.ls[li];
      const lend = p.ls[li + 1] - 1;
      const tab = p.low.indexOf('\t', ls);
      const nameLow = p.low.slice(ls, tab < 0 || tab > lend ? lend : tab);
      const b = brandOfLine(line);
      const first = nameLow.slice(0, nameLow.search(/[^a-z0-9%]|$/));
      let score = 0;
      let byBrand = 0; // bit i: word i matched only through the brand
      let firsts = 0; // bit i: the name starts with word i
      for (let i = 0; i < q.length; i++) {
        const m = wordMatch(nameLow, q[i]);
        if (m) {
          score += m * 10;
          if (first.startsWith(q[i])) firsts |= 1 << i;
        } else if (brandHits[i].has(b)) {
          score += 25;
          byBrand |= 1 << i;
        } else return;
      }
      for (let i = 0; i < q.length; i++) byBrand & (1 << i) ? brandN[i]++ : nameN[i]++;
      const words = (nameLow.match(/[a-z0-9%]+/g) || []).length;
      scored.push({ line, p, li, score: score - words * 1.4, byBrand, firsts, nlen: nameLow.length });
    };

    for (const p of parts) {
      // Products whose name contains the word…
      let i = p.low.indexOf(dt);
      let li = 0;
      while (i >= 0) {
        if (i === 0 || !isWordChar(p.low.charCodeAt(i - 1))) {
          while (p.ls[li + 1] <= i) li++; // the line holding position i (matches come in order)
          consider(p, li);
          i = p.low.indexOf('\n', i);
          if (i < 0) break;
        }
        i = p.low.indexOf(dt, i + 1);
      }
      // …and products of brands that match it.
      for (const bi of brandHits[d]) {
        const a = Math.max(brands.start[bi], p.start);
        const z = Math.min(brands.start[bi] + brands.count[bi], p.start + p.count);
        for (let line = a; line < z; line++) consider(p, line - p.start);
      }
    }

    // A word names a brand when most matches came through the brand ("kirkland", "quest"),
    // not when a few brands merely contain it ("The Greek Gods" for "greek yogurt").
    let brandWords = 0;
    q.forEach((t, i) => {
      if (brandN[i] > nameN[i]) brandWords |= 1 << i;
    });
    for (const x of scored) {
      if (x.byBrand & brandWords) x.score += 12; // the brand's own products before others that mention it
      if (x.firsts & ~brandWords) x.score += 12; // "Almonds, …" first for "almonds"
    }
    scored.sort((x, y) => y.score - x.score || x.nlen - y.nlen);
    const rows = scored.slice(0, limit).map((s) => rowOf(s.p, s.li));
    const brandHit = scored.length > 0 && (scored[0].byBrand & brandWords) !== 0;
    return { rows, total: scored.length, brandHit };
  };

  function rowOf(p, li) {
    const text = p.text.slice(p.ts[li], p.ts[li + 1] - 1);
    const f = text.split('\t');
    const line = p.start + li;
    return { line, name: f[0], brand: brands.name[brandOfLine(line)], kcal: +f[1], label: f[2], g: +f[3] };
  }

  // ---------------------------------------------------------------------------
  // Full records (nutrients, servings), fetched per shard when a product is opened.
  const shards = new Map(); // shard -> Promise<string[]>, most recent last
  function shard(i) {
    let p = shards.get(i);
    if (p) {
      shards.delete(i);
      shards.set(i, p);
      return p;
    }
    p = fetchText('r' + String(i).padStart(3, '0') + '.txt').then((t) => t.split('\n'));
    p.catch(() => shards.delete(i));
    shards.set(i, p);
    while (shards.size > 6) shards.delete(shards.keys().next().value);
    return p;
  }

  /** The full product on a line: nutrients from its record shard, name and brand from the index. */
  BR.record = async function (line, upc) {
    const meta = await loadMeta();
    const k = meta.parts.findIndex((p) => line >= p.start && line < p.start + p.count);
    if (k < 0) throw new Error('Product not found');
    const R = meta.recordsPerShard;
    const [lines] = await Promise.all([shard(Math.floor(line / R)), loadBrands(), loadPart(meta, k)]);
    const row = lines[line % R];
    const info = rowAt(line);
    if (!row || !info) throw new Error('Product not found');
    // Record: id, source, category index, values, portions.
    const f = row.split('\t');
    // Self-contained copy saved with diary entries, recipes and favorites.
    const bf = [meta.version, f[0], f[1], info.name, info.brand, meta.categories[+f[2]] || '', f[3] || '', f[4] || '', upc || ''].join('\t');
    const food = BR.fromBf(bf);
    if (!food) throw new Error('Unreadable product');
    BR.byId.set(food.id, food);
    return food;
  };

  // bf: "version \t id \t src \t name \t brand \t category \t values \t portions \t barcode"
  const bfCache = new Map();
  BR.fromBf = function (bf) {
    if (typeof bf !== 'string') return null;
    const hit = bfCache.get(bf);
    if (hit) return hit;
    const f = bf.split('\t');
    const keys = BKEYS[+f[0]];
    if (!keys || f.length < 7) return null;
    const base = f[3];
    const brand = f[4];
    const name = brand ? base + ' (' + brand + ')' : base;
    const toks = DB.tokenize(name);
    const food = {
      id: +f[1],
      src: f[2],
      g: -1,
      name,
      base,
      brand,
      cat: f[5],
      v: f[6] || '',
      p: f[7] || '',
      upc: f[8] || '',
      keys,
      bf,
      branded: true,
      lname: name.toLowerCase(),
      toks,
      stems: toks,
      head: '',
      _n: null,
      _por: null,
    };
    bfCache.set(bf, food);
    if (bfCache.size > 2000) bfCache.delete(bfCache.keys().next().value);
    return food;
  };
  BR.sourceLabel = (food) => SOURCES[food.src] || 'Brand-name food';

  // ---------------------------------------------------------------------------
  // Barcodes
  const upcShards = new Map();
  function upcShard(d) {
    let p = upcShards.get(d);
    if (!p) {
      p = fetchText('u' + d + '.txt').then((t) => t.split('\n'));
      p.catch(() => upcShards.delete(d));
      upcShards.set(d, p);
    }
    return p;
  }
  // UPC-E (8 digits, small packages) written out as the UPC-A it stands for.
  function upcEtoA(e) {
    if (!/^[01]\d{7}$/.test(e)) return null;
    const ns = e[0];
    const m = e.slice(1, 7);
    const check = e[7];
    const last = m[5];
    let body;
    if ('012'.includes(last)) body = m.slice(0, 2) + last + '0000' + m.slice(2, 5);
    else if (last === '3') body = m.slice(0, 3) + '00000' + m.slice(3, 5);
    else if (last === '4') body = m.slice(0, 4) + '00000' + m[4];
    else body = m.slice(0, 5) + '0000' + last;
    return ns + body + check;
  }
  function candidates(code) {
    const digits = String(code).replace(/\D/g, '');
    const out = new Set();
    const add = (c) => {
      const s = c && c.replace(/^0+/, '');
      if (s && s.length >= 6) out.add(s);
    };
    add(digits);
    if (digits.length === 8) add(upcEtoA(digits));
    return Array.from(out);
  }
  BR.isBarcode = (q) => /^\s*\d{8,14}\s*$/.test(q);
  // Stored without leading zeros; UPC-A codes read best as their usual 12 digits.
  BR.fmtBarcode = (u) => (u.length >= 9 && u.length < 12 ? u.padStart(12, '0') : u);

  /** Find a product by barcode. Resolves to a food or null. */
  BR.byBarcode = async function (code) {
    await loadMeta();
    for (const c of candidates(code)) {
      const rows = await upcShard(+c[c.length - 1]);
      let lo = 0;
      let hi = rows.length - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const row = rows[mid];
        const u = row.slice(0, row.indexOf('\t'));
        if (u === c) return BR.record(+row.slice(u.length + 1), c);
        if (u < c) lo = mid + 1;
        else hi = mid - 1;
      }
    }
    return null;
  };

  // Read a barcode from a photo: the browser's own detector where there is one, else ZXing.
  let zxingP = null;
  function loadZXing() {
    if (window.ZXing) return Promise.resolve(window.ZXing);
    if (!zxingP) {
      zxingP = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.crossOrigin = 'anonymous';
        s.src = 'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js';
        s.onload = () => (window.ZXing ? resolve(window.ZXing) : reject(new Error('Barcode reader failed to load')));
        s.onerror = () => {
          zxingP = null;
          reject(new Error('Barcode reader failed to load'));
        };
        document.head.appendChild(s);
      });
    }
    return zxingP;
  }
  async function imageCanvas(file, maxSide) {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    if (bmp.close) bmp.close();
    return c;
  }
  BR.readBarcode = async function (file) {
    if ('BarcodeDetector' in window) {
      try {
        const det = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
        const found = await det.detect(await createImageBitmap(file));
        if (found && found.length) return found[0].rawValue;
      } catch (e) {
        /* fall through to ZXing */
      }
    }
    const Z = await loadZXing();
    const reader = zxingReader(Z);
    for (const side of [1600, 1000, 2400]) {
      const canvas = await imageCanvas(file, side);
      try {
        const bitmap = new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.HTMLCanvasElementLuminanceSource(canvas)));
        return reader.decode(bitmap).getText();
      } catch (e) {
        /* try another size */
      }
    }
    return null;
  };
  function zxingReader(Z) {
    const hints = new Map();
    hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.EAN_8, Z.BarcodeFormat.UPC_A, Z.BarcodeFormat.UPC_E]);
    hints.set(Z.DecodeHintType.TRY_HARDER, true);
    const reader = new Z.MultiFormatReader();
    reader.setHints(hints);
    return reader;
  }

  /**
   * Live scanning from a <video>: resolves to { detect(video) -> Promise<code|null> }, using the
   * browser's own detector where it reads grocery barcodes, else ZXing on the middle of the frame.
   */
  BR.scanner = async function () {
    if ('BarcodeDetector' in window) {
      try {
        const want = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];
        const have = window.BarcodeDetector.getSupportedFormats ? await window.BarcodeDetector.getSupportedFormats() : want;
        const formats = want.filter((f) => have.includes(f));
        if (formats.length) {
          const det = new window.BarcodeDetector({ formats });
          return {
            kind: 'native',
            detect: async (video) => {
              const found = await det.detect(video);
              return found && found.length ? found[0].rawValue : null;
            },
          };
        }
      } catch (e) {
        /* fall back to ZXing */
      }
    }
    const Z = await loadZXing();
    const reader = zxingReader(Z);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    let frame = 0;
    return {
      kind: 'zxing',
      detect: async (video) => {
        const vw = video.videoWidth;
        const vh = video.videoHeight;
        if (!vw || !vh) return null;
        // The band across the middle of the frame, where the on-screen guide box sits.
        const sw = Math.round(vw * 0.9);
        const sh = Math.round(vh * 0.5);
        const scale = Math.min(1, 1000 / sw);
        canvas.width = Math.round(sw * scale);
        canvas.height = Math.round(sh * scale);
        ctx.drawImage(video, Math.round((vw - sw) / 2), Math.round((vh - sh) / 2), sw, sh, 0, 0, canvas.width, canvas.height);
        // Alternate binarizers: each copes better with different lighting.
        const Bin = frame++ % 2 ? Z.GlobalHistogramBinarizer : Z.HybridBinarizer;
        try {
          return reader.decodeWithState(new Z.BinaryBitmap(new Bin(new Z.HTMLCanvasElementLuminanceSource(canvas)))).getText();
        } catch (e) {
          return null; // nothing readable in this frame
        }
      },
    };
  };
})();
