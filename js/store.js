/* Daily Value: app state, calculations, persistence (this device + the artifact's private per-user database). */
(function () {
  'use strict';
  const DV = window.DV;
  const { TRACKED, NUTRIENTS } = DV.core;
  const U = DV.util;
  const DB = DV.foodDB;

  const LS_KEY = 'dailyvalue:v1';
  const LS_UI = 'dailyvalue:ui';
  DV.VIEWS = ['diary', 'foods', 'weight', 'trends', 'profile'];

  // ---------------------------------------------------------------------------
  // State
  const S = (DV.state = {
    mode: 'sample', // 'sample' (example data, nothing saved) | 'user'
    profile: null,
    days: {}, // 'YYYY-MM-DD' -> day
    library: {}, // id -> custom food or recipe
    uid: null,
    backend: 'local', // 'local' | 'cloud'
    sync: 'idle', // idle | saving | saved | error
    syncMsg: '',
  });
  const UI = (DV.ui = { view: 'diary', date: U.today(), sheet: null, toasts: [] });

  const listeners = new Set();
  let queued = false;
  DV.subscribe = (fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  };
  DV.emit = () => {
    if (queued) return;
    queued = true;
    Promise.resolve().then(() => {
      queued = false;
      listeners.forEach((fn) => fn());
    });
  };
  DB.onChange(() => {
    recipeCache.clear();
    DV.emit();
  });
  DV.brands.onChange(() => DV.emit());

  const clone = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));

  // ---------------------------------------------------------------------------
  // Nutrient math
  const recipeCache = new Map();

  function libPer100(item) {
    if (!item) return null;
    if (item.type === 'food') return item.per100 || null;
    if (item.type === 'recipe') {
      const hit = recipeCache.get(item.id);
      if (hit && hit.u === item.u) return hit.n;
      const n = recipePer100(item);
      if (n) recipeCache.set(item.id, { u: item.u, n });
      return n;
    }
    return null;
  }
  // Sum of ingredients, scaled to 100 g of the finished recipe.
  function recipePer100(item) {
    const total = recipeGrams(item);
    if (!total) return null;
    const sum = {};
    TRACKED.forEach((k) => (sum[k] = 0));
    const missing = {};
    for (const ing of item.ingredients || []) {
      const per = refPer100(ing);
      if (!per) {
        if (ing.fid != null && DB.status !== 'ready') return null; // wait for the database
        continue;
      }
      for (const k of TRACKED) {
        if (per[k] == null) missing[k] = true;
        else sum[k] += (per[k] * ing.g) / 100;
      }
    }
    const out = {};
    for (const k of TRACKED) out[k] = missing[k] && !sum[k] ? null : (sum[k] * 100) / total;
    return out;
  }
  function recipeGrams(item) {
    if (item.yieldG > 0) return item.yieldG;
    return (item.ingredients || []).reduce((a, i) => a + (i.g || 0), 0);
  }
  function refPer100(ref) {
    if (ref.fid != null) {
      const f = DB.get(ref);
      return f ? DB.nutrients(f) : null;
    }
    if (ref.lid) return libPer100(S.library[ref.lid]);
    return null;
  }
  function scale(per, factor) {
    const out = {};
    for (const k of TRACKED) out[k] = per[k] == null ? null : per[k] * factor;
    return out;
  }

  // Nutrients for one diary entry. `full` is false when only the saved macro snapshot is available.
  function entryNutrients(e) {
    if (e.quick) {
      const out = {};
      for (const k of TRACKED) out[k] = e.s && e.s[k] != null ? e.s[k] : null;
      return { n: out, full: false };
    }
    const per = refPer100(e);
    if (per) return { n: scale(per, (e.g || 0) / 100), full: true };
    const out = {};
    for (const k of TRACKED) out[k] = e.s && e.s[k] != null ? e.s[k] : null;
    return { n: out, full: false };
  }
  function macroSnapshot(n) {
    return {
      kcal: round1(n.kcal || 0),
      prot: round1(n.prot || 0),
      carbs: round1(n.carbs || 0),
      fat: round1(n.fat || 0),
      alcohol: round1(n.alcohol || 0),
    };
  }
  const round1 = (v) => Math.round(v * 10) / 10;

  // Totals for a day: { n, missing, partial, meals, entries: Map(id -> n) }
  function dayTotals(day) {
    const n = {};
    const missing = {};
    const kcalMiss = {}; // calories from foods with no value for the nutrient
    TRACKED.forEach((k) => {
      n[k] = 0;
      missing[k] = 0;
      kcalMiss[k] = 0;
    });
    const meals = {};
    DV.MEALS.forEach(([m]) => (meals[m] = { kcal: 0, prot: 0, carbs: 0, fat: 0 }));
    const entries = new Map();
    let partial = false;
    for (const e of (day && day.entries) || []) {
      const r = entryNutrients(e);
      if (!r.full) partial = partial || !e.quick;
      entries.set(e.id, r.n);
      for (const k of TRACKED) {
        const v = r.n[k];
        if (v == null) {
          missing[k]++;
          kcalMiss[k] += r.n.kcal || 0;
        } else n[k] += v;
      }
      const m = meals[e.meal] || meals.snacks;
      m.kcal += r.n.kcal || 0;
      m.prot += r.n.prot || 0;
      m.carbs += r.n.carbs || 0;
      m.fat += r.n.fat || 0;
    }
    // Share of the day's calories that came from foods with data for each nutrient.
    const cov = {};
    TRACKED.forEach((k) => (cov[k] = n.kcal > 0 ? Math.max(0, 1 - kcalMiss[k] / n.kcal) : 1));
    return { n, missing, kcalMiss, cov, partial, meals, entries, count: ((day && day.entries) || []).length };
  }

  function exerciseTotal(day) {
    return ((day && day.ex) || []).reduce((a, x) => a + (x.kcal || 0), 0);
  }

  // Latest logged body weight on or before a date, falling back to the profile.
  function weightOn(date) {
    let best = null;
    for (const d of Object.keys(S.days)) {
      const w = S.days[d].weight;
      if (w > 0 && d <= date && (!best || d > best.d)) best = { d, w };
    }
    return best ? best.w : S.profile ? S.profile.weightKg : 70;
  }
  function targetsFor(date) {
    if (!S.profile) return {};
    return DV.core.targets(S.profile, weightOn(date || U.today()));
  }

  // Foods logged recently, most recent first: [{ key, fid|lid, bf?, name, qty, unit, ug, g, s, count, last }]
  function recentFoods(limit = 40) {
    const map = new Map();
    const dates = Object.keys(S.days).sort().reverse().slice(0, 45);
    for (const d of dates) {
      for (const e of S.days[d].entries || []) {
        if (e.quick) continue;
        const key = e.fid != null ? 'f' + e.fid : 'l' + e.lid;
        const cur = map.get(key);
        if (cur) cur.count++;
        else map.set(key, { key, fid: e.fid, lid: e.lid, bf: e.bf, name: e.name, qty: e.qty, unit: e.unit, ug: e.ug, g: e.g, s: e.s, count: 1, last: d });
      }
    }
    return Array.from(map.values()).slice(0, limit);
  }
  function usageCounts() {
    const counts = new Map();
    const dates = Object.keys(S.days).sort().reverse().slice(0, 60);
    for (const d of dates) for (const e of S.days[d].entries || []) if (e.fid != null) counts.set(e.fid, (counts.get(e.fid) || 0) + 1);
    return counts;
  }

  function streak() {
    let d = U.today();
    const has = (x) => S.days[x] && S.days[x].entries && S.days[x].entries.length > 0;
    if (!has(d)) d = U.addDays(d, -1);
    let n = 0;
    while (has(d)) {
      n++;
      d = U.addDays(d, -1);
    }
    return n;
  }

  // ---------------------------------------------------------------------------
  // Weight log
  // Weigh-ins, oldest first: [{ date, kg }]
  function weighIns() {
    return Object.keys(S.days)
      .filter((d) => S.days[d].weight > 0)
      .sort()
      .map((d) => ({ date: d, kg: S.days[d].weight }));
  }
  // Trend weight: moves 10% of the way toward each day's weigh-in, so water and salt swings barely
  // shift it. A gap between weigh-ins counts as that many days of movement. [{ date, kg, trend }]
  function weightTrend(list) {
    let prev = null;
    return list.map((w) => {
      const gap = prev ? Math.min(60, Math.max(1, U.daysBetween(prev.date, w.date))) : 0;
      const trend = prev ? prev.trend + (1 - Math.pow(0.9, gap)) * (w.kg - prev.trend) : w.kg;
      prev = { date: w.date, kg: w.kg, trend };
      return prev;
    });
  }
  // Change per week (kg) from a straight line fitted to the weigh-ins in the `days` days up to `end`.
  // null until there are 3 weigh-ins at least a week apart end to end.
  function weightPace(list, end, days = 28) {
    const start = U.addDays(end, -(days - 1));
    const pts = list.filter((w) => w.date >= start && w.date <= end);
    if (pts.length < 3 || U.daysBetween(pts[0].date, pts[pts.length - 1].date) < 7) return null;
    const xs = pts.map((w) => U.daysBetween(start, w.date));
    const mx = xs.reduce((a, x) => a + x, 0) / xs.length;
    const my = pts.reduce((a, w) => a + w.kg, 0) / pts.length;
    let num = 0;
    let den = 0;
    pts.forEach((w, i) => {
      num += (xs[i] - mx) * (w.kg - my);
      den += (xs[i] - mx) * (xs[i] - mx);
    });
    return den ? (num / den) * 7 : null;
  }

  // ---------------------------------------------------------------------------
  // Suggestions: foods this person logs often, ready to add in one tap
  const foodKey = (e) => (e.fid != null ? 'f' + e.fid : 'l' + e.lid);
  function canSuggest(e) {
    if (e.quick) return false;
    if (e.lid) return !!S.library[e.lid] && !S.library[e.lid].archived;
    return e.fid != null;
  }
  // Best first: [{ key, fid|lid, bf?, name, qty, unit, ug, g, s, score, count, inMeal }]. Recent logs count most
  // (half as much every 3 weeks), and logs at this meal count more than at others. Foods already in
  // this meal on `date` are left out. meal null ranks every meal alike.
  function suggestFoods(meal, date, { limit = 12, min = 0, days = 90 } = {}) {
    const today = S.days[date];
    const have = new Set(meal ? ((today && today.entries) || []).filter((e) => e.meal === meal && !e.quick).map(foodKey) : []);
    const map = new Map();
    const dates = Object.keys(S.days)
      .filter((d) => d !== date && Math.abs(U.daysBetween(d, date)) <= days)
      .sort()
      .reverse();
    for (const d of dates) {
      const w = Math.pow(0.5, Math.abs(U.daysBetween(d, date)) / 21);
      for (const e of S.days[d].entries || []) {
        if (!canSuggest(e)) continue;
        const key = foodKey(e);
        if (have.has(key)) continue;
        const same = !meal || e.meal === meal;
        let s = map.get(key);
        // Newest first, so the first log seen sets the amount, unless an older one was at this meal.
        if (!s) {
          s = { key, name: e.name, score: 0, count: 0, inMeal: 0 };
          map.set(key, s);
        }
        if (!s.amount || (same && !s.sameMeal)) {
          Object.assign(s, { fid: e.fid, lid: e.lid, bf: e.bf, name: e.name, qty: e.qty, unit: e.unit, ug: e.ug, g: e.g, s: e.s, amount: true, sameMeal: same });
        }
        s.score += (same ? 1 : 0.3) * w;
        s.count++;
        if (same) s.inMeal++;
      }
    }
    return Array.from(map.values())
      .filter((s) => s.score >= min)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
  // The foods eaten at this meal on most days it was logged in the 4 weeks before `date`, as they were
  // last logged: { items, days } or null.
  function usualMeal(meal, date) {
    const counts = new Map();
    let days = 0;
    const dates = Object.keys(S.days)
      .filter((d) => d < date && U.daysBetween(d, date) <= 28)
      .sort()
      .reverse();
    for (const d of dates) {
      const es = (S.days[d].entries || []).filter((e) => e.meal === meal && canSuggest(e));
      if (!es.length) continue;
      days++;
      const seen = new Set();
      es.forEach((e, i) => {
        const key = foodKey(e);
        if (seen.has(key)) return;
        seen.add(key);
        const c = counts.get(key);
        if (c) c.n++;
        else counts.set(key, { n: 1, e, i });
      });
    }
    if (days < 3) return null;
    const core = Array.from(counts.values()).filter((c) => c.n >= 3 && c.n / days >= 0.6);
    if (core.length < 2) return null;
    core.sort((a, b) => a.i - b.i);
    return { days, items: core.map(({ e }) => ({ fid: e.fid, lid: e.lid, bf: e.bf, name: e.name, qty: e.qty, unit: e.unit, ug: e.ug, g: e.g, s: e.s })) };
  }

  DV.calc = { entryNutrients, dayTotals, exerciseTotal, weightOn, targetsFor, recentFoods, usageCounts, streak, libPer100, refPer100, recipeGrams, scale, macroSnapshot, weighIns, weightTrend, weightPace, suggestFoods, usualMeal };

  // ---------------------------------------------------------------------------
  // Local storage (always a cache of the latest state; the only store when the database is unavailable)
  function readLocal() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }
  let lsTimer = null;
  function writeLocalSoon() {
    clearTimeout(lsTimer);
    lsTimer = setTimeout(writeLocal, 250);
  }
  function writeLocal() {
    clearTimeout(lsTimer);
    if (S.mode !== 'user') return;
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({ v: 1, uid: S.uid, profile: S.profile, days: S.days, library: S.library, savedAt: Date.now() }));
      if (S.backend === 'local') setSync('saved', 'Saved in this browser');
    } catch (e) {
      if (S.backend === 'local') setSync('error', 'This browser blocked saving. Export a backup from Profile so you don’t lose entries.');
    }
  }
  function clearLocal() {
    try {
      localStorage.removeItem(LS_KEY);
    } catch (e) {}
  }
  function setSync(state, msg) {
    if (S.sync === state && S.syncMsg === msg) return;
    S.sync = state;
    S.syncMsg = msg || '';
    DV.emit();
  }
  window.addEventListener('pagehide', writeLocal);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') writeLocal();
  });

  // UI conveniences (last view) live in browser storage only.
  function readUIPrefs() {
    try {
      return JSON.parse(localStorage.getItem(LS_UI) || '{}');
    } catch (e) {
      return {};
    }
  }
  function writeUIPrefs(p) {
    try {
      localStorage.setItem(LS_UI, JSON.stringify(Object.assign(readUIPrefs(), p)));
    } catch (e) {}
  }
  DV.uiPrefs = { read: readUIPrefs, write: writeUIPrefs };

  // ---------------------------------------------------------------------------
  // Cloud: the artifact's database. Everything lives under data/users/<id>/, which only that person can read.
  const cloud = {
    db: null,
    base: null,
    ready: false,
    queue: new Map(), // path -> { data } | { del: true }
    inflight: new Set(),
    unsubs: [],
    ref(path) {
      const root = this.db.doc(this.base + '/profile');
      if (path === 'profile') return root;
      const i = path.indexOf('/');
      return root.collection(path.slice(0, i)).doc(path.slice(i + 1));
    },
    busy(path) {
      return this.queue.has(path) || this.inflight.has(path);
    },
    write(path, data) {
      if (!this.ready) return;
      this.queue.set(path, { data: clone(data) });
      this.pump();
    },
    remove(path) {
      if (!this.ready) return;
      this.queue.set(path, { del: true });
      this.pump();
    },
    pump() {
      for (const [path, job] of this.queue) {
        if (this.inflight.size >= 4) break;
        if (this.inflight.has(path)) continue;
        this.queue.delete(path);
        this.run(path, job);
      }
      this.status();
    },
    async run(path, job) {
      this.inflight.add(path);
      this.status();
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const ref = this.ref(path);
          if (job.del) await ref.delete();
          else await ref.set(job.data);
          this.failed = false;
          break;
        } catch (e) {
          const code = (e && e.code) || 'unavailable';
          // One quiet retry for a transient failure, unless a newer version is already waiting.
          if (code === 'unavailable' && attempt === 0 && !this.queue.has(path)) {
            await new Promise((r) => setTimeout(r, 800 + Math.random() * 1200));
            continue;
          }
          this.failed = true;
          if (code === 'quota_exceeded') setSync('error', 'Your saved data hit the storage limit. Delete unused custom foods or recipes.');
          else if (['invalid_argument', 'not_granted', 'revoked', 'capability_disabled', 'capability_removed'].includes(code))
            goLocal('This diary can’t be saved to your Claude account here, so changes are kept in this browser.');
          else setSync('error', 'Couldn’t sync the last change. It’s kept in this browser and will retry with your next edit.');
          break;
        }
      }
      this.inflight.delete(path);
      if (this.ready) this.pump();
    },
    status() {
      if (!this.ready) return;
      if (this.inflight.size || this.queue.size) setSync('saving', 'Saving…');
      else if (!this.failed) setSync('saved', 'Synced to your Claude account');
    },
  };
  function goLocal(msg) {
    cloud.ready = false;
    cloud.unsubs.forEach((u) => u());
    cloud.unsubs = [];
    S.backend = 'local';
    writeLocal();
    setSync('error', msg);
  }

  function newer(a, b) {
    if (!a) return b;
    if (!b) return a;
    return (a.u || 0) >= (b.u || 0) ? a : b;
  }

  async function connectCloud() {
    const claude = window.claude;
    if (!claude || typeof claude.use !== 'function') return;
    let db, user;
    try {
      [db, user] = await Promise.all([claude.use('db'), claude.use('user')]);
    } catch (e) {
      return;
    }
    if (!db || !user) return;
    let id = null;
    try {
      id = await user.id();
    } catch (e) {}
    if (!id) return;
    cloud.db = db;
    cloud.base = 'data/users/' + id;
    const root = db.doc(cloud.base + '/profile');
    const daysQ = root.collection('days').orderBy('date', 'desc').limit(1000);
    const foodsQ = root.collection('foods').limit(1000);
    setSync('saving', 'Connecting…');
    let pSnap, dSnap, fSnap;
    try {
      [pSnap, dSnap, fSnap] = await Promise.all([root.get(), daysQ.get(), foodsQ.get()]);
    } catch (e) {
      setSync('error', 'Couldn’t reach your saved diary. Changes are kept in this browser for now.');
      return;
    }
    const remoteProfile = pSnap.exists ? clone(pSnap.data()) : null;
    const remoteDays = {};
    dSnap.docs.forEach((d) => {
      const x = d.data();
      if (x && x.date) remoteDays[x.date] = clone(x);
    });
    const remoteLib = {};
    fSnap.docs.forEach((d) => {
      const x = d.data();
      if (x && x.id) remoteLib[x.id] = clone(x);
    });
    // Local data counts only if it belongs to this person (or was made before they had an id here).
    const local = S.mode === 'user' && (!S.uid || S.uid === id) ? { profile: S.profile, days: S.days, library: S.library } : null;
    const uploads = [];
    if (remoteProfile && remoteProfile.sex) {
      const profile = newer(local && local.profile, remoteProfile);
      const days = Object.assign({}, remoteDays);
      const library = Object.assign({}, remoteLib);
      if (local) {
        if (profile === local.profile && local.profile !== remoteProfile) uploads.push(['profile', profile]);
        for (const [d, day] of Object.entries(local.days)) {
          const r = remoteDays[d];
          if (!r || (day.u || 0) > (r.u || 0)) {
            days[d] = day;
            uploads.push(['days/' + d, day]);
          }
        }
        for (const [lid, item] of Object.entries(local.library)) {
          const r = remoteLib[lid];
          if (!r || (item.u || 0) > (r.u || 0)) {
            library[lid] = item;
            uploads.push(['foods/' + lid, item]);
          }
        }
      }
      S.mode = 'user';
      S.profile = profile;
      S.days = days;
      S.library = library;
    } else if (local && local.profile) {
      uploads.push(['profile', local.profile]);
      Object.entries(local.days).forEach(([d, day]) => uploads.push(['days/' + d, day]));
      Object.entries(local.library).forEach(([lid, item]) => uploads.push(['foods/' + lid, item]));
    }
    S.uid = id;
    S.backend = 'cloud';
    cloud.ready = true;
    uploads.forEach(([p, d]) => cloud.write(p, d));
    if (S.mode === 'user') writeLocal();
    cloud.status();
    if (!uploads.length) setSync('saved', 'Synced to your Claude account');
    subscribe(root, daysQ, foodsQ);
    DV.emit();
  }

  // Live updates from the person's other devices and tabs.
  function subscribe(root, daysQ, foodsQ) {
    const onErr = () => {};
    cloud.unsubs.push(
      root.onSnapshot((snap) => {
        if (!snap.exists || cloud.busy('profile')) return;
        const x = snap.data();
        if (!x || !x.sex) return;
        if (!S.profile || (x.u || 0) > (S.profile.u || 0)) {
          S.profile = clone(x);
          if (S.mode !== 'user') S.mode = 'user';
          writeLocalSoon();
          DV.emit();
        }
      }, onErr)
    );
    cloud.unsubs.push(
      daysQ.onSnapshot((qs) => {
        let changed = false;
        qs.docChanges().forEach((ch) => {
          if (ch.type === 'removed') return;
          const x = ch.doc.data();
          if (!x || !x.date || cloud.busy('days/' + x.date)) return;
          const cur = S.days[x.date];
          if (!cur || (x.u || 0) > (cur.u || 0)) {
            S.days[x.date] = clone(x);
            changed = true;
          }
        });
        if (changed && S.mode === 'user') {
          writeLocalSoon();
          DV.emit();
        }
      }, onErr)
    );
    cloud.unsubs.push(
      foodsQ.onSnapshot((qs) => {
        let changed = false;
        qs.docChanges().forEach((ch) => {
          const x = ch.doc.data();
          const lid = (x && x.id) || ch.doc.id;
          if (cloud.busy('foods/' + lid)) return;
          if (ch.type === 'removed') {
            if (S.library[lid]) {
              delete S.library[lid];
              changed = true;
            }
            return;
          }
          const cur = S.library[lid];
          if (!cur || (x.u || 0) > (cur.u || 0)) {
            S.library[lid] = clone(x);
            changed = true;
          }
        });
        if (changed && S.mode === 'user') {
          writeLocalSoon();
          DV.emit();
        }
      }, onErr)
    );
  }

  // ---------------------------------------------------------------------------
  // Persistence helpers used by actions
  const save = {
    profile() {
      if (S.mode !== 'user') return;
      writeLocalSoon();
      cloud.write('profile', S.profile);
    },
    day(date) {
      if (S.mode !== 'user') return;
      writeLocalSoon();
      cloud.write('days/' + date, S.days[date]);
    },
    lib(lid) {
      if (S.mode !== 'user') return;
      writeLocalSoon();
      if (S.library[lid]) cloud.write('foods/' + lid, S.library[lid]);
      else cloud.remove('foods/' + lid);
    },
  };

  function getDay(date) {
    return S.days[date] || { date, entries: [], ex: [], water: 0, weight: null, note: '', u: 0 };
  }
  // Replace a day with an updated copy and save it.
  function updateDay(date, fn) {
    const day = clone(getDay(date));
    day.entries = day.entries || [];
    day.ex = day.ex || [];
    fn(day);
    day.date = date;
    day.u = Date.now();
    S.days = Object.assign({}, S.days, { [date]: day });
    save.day(date);
    DV.emit();
    return day;
  }
  function updateProfile(patch) {
    S.profile = Object.assign({}, S.profile, patch, { u: Date.now() });
    save.profile();
    DV.emit();
  }

  // ---------------------------------------------------------------------------
  // Toasts
  let toastId = 0;
  function toast(text, opts = {}) {
    const t = { id: ++toastId, text, action: opts.action, tone: opts.tone || 'neutral' };
    UI.toasts = UI.toasts.concat(t).slice(-3);
    DV.emit();
    setTimeout(() => {
      UI.toasts = UI.toasts.filter((x) => x.id !== t.id);
      DV.emit();
    }, opts.ms || 4200);
  }

  // ---------------------------------------------------------------------------
  // Actions
  const A = (DV.actions = {
    setView(view) {
      UI.view = view;
      writeUIPrefs({ view });
      try {
        if (location.hash.slice(1) !== view) history.replaceState(null, '', '#' + view);
      } catch (e) {}
      DV.emit();
    },
    setDate(date) {
      UI.date = date;
      DV.emit();
    },
    open(sheet) {
      UI.sheet = sheet;
      DV.emit();
    },
    close() {
      UI.sheet = null;
      DV.emit();
    },
    toast,

    /** Log a food. item: { fid (+ bf for brand-name foods) | lid, name, qty, unit, ug, g, s? } */
    addEntry(date, meal, item) {
      const e = makeEntry(meal, item);
      updateDay(date, (d) => d.entries.push(e));
      return e;
    },
    // Log several foods in one save (a usual meal); returns the new entries.
    addEntries(date, meal, items) {
      const list = items.map((item) => makeEntry(meal, item));
      updateDay(date, (d) => list.forEach((e) => d.entries.push(e)));
      return list;
    },
    // Take back entries that were just added (Undo), without a "Removed" message.
    unlog(date, ids) {
      updateDay(date, (d) => (d.entries = d.entries.filter((x) => !ids.includes(x.id))));
    },
    addQuick(date, meal, { name, kcal, prot, carbs, fat }) {
      const e = { id: U.uid('e'), meal, quick: true, name: name || 'Quick add', s: { kcal: +kcal || 0, prot: +prot || 0, carbs: +carbs || 0, fat: +fat || 0 }, t: Date.now() };
      updateDay(date, (d) => d.entries.push(e));
      return e;
    },
    updateEntry(date, id, patch) {
      updateDay(date, (d) => {
        const i = d.entries.findIndex((x) => x.id === id);
        if (i < 0) return;
        const e = Object.assign({}, d.entries[i], patch);
        if (!e.quick) e.s = macroSnapshot(entryNutrients(e).n);
        d.entries[i] = e;
      });
    },
    removeEntry(date, id) {
      const before = getDay(date).entries.find((x) => x.id === id);
      updateDay(date, (d) => (d.entries = d.entries.filter((x) => x.id !== id)));
      if (before)
        toast('Removed ' + shortName(before.name), {
          action: { label: 'Undo', run: () => updateDay(date, (d) => d.entries.push(before)) },
        });
    },
    copyMeal(fromDate, toDate, meal) {
      const src = getDay(fromDate).entries.filter((e) => e.meal === meal);
      if (!src.length) return 0;
      updateDay(toDate, (d) => {
        src.forEach((e) => d.entries.push(Object.assign({}, e, { id: U.uid('e'), t: Date.now() })));
      });
      return src.length;
    },
    addExercise(date, ex) {
      updateDay(date, (d) => d.ex.push(Object.assign({ id: U.uid('x') }, ex)));
    },
    removeExercise(date, id) {
      updateDay(date, (d) => (d.ex = d.ex.filter((x) => x.id !== id)));
    },
    setWater(date, ml) {
      updateDay(date, (d) => (d.water = Math.max(0, Math.round(ml))));
    },
    // Log, change or (with null) remove a day's weigh-in. Returns the previous value, for Undo.
    setWeight(date, kg) {
      const prev = getDay(date).weight || null;
      updateDay(date, (d) => (d.weight = kg > 0 ? Math.round(kg * 100) / 100 : null));
      // The profile's weight (used for targets when nothing is logged) follows the latest weigh-in.
      const last = latestWeightDate();
      if (last && S.profile && S.days[last].weight !== S.profile.weightKg) updateProfile({ weightKg: S.days[last].weight });
      return prev;
    },
    // Goal weight in kg, or null to remove it. The starting point is kept while the goal is only adjusted.
    setWeightGoal(kg) {
      const p = S.profile;
      if (!p) return;
      if (!(kg > 0)) {
        updateProfile({ goalWeightKg: null, goalStartKg: null, goalStartDate: null });
        return;
      }
      const goal = Math.round(kg * 100) / 100;
      const trend = weightTrend(weighIns());
      const now = trend.length ? trend[trend.length - 1].trend : p.weightKg;
      const keep = p.goalWeightKg > 0 && p.goalStartKg > 0 && Math.sign(p.goalWeightKg - p.goalStartKg) === Math.sign(goal - p.goalStartKg);
      updateProfile({
        goalWeightKg: goal,
        goalStartKg: keep ? p.goalStartKg : Math.round(now * 100) / 100,
        goalStartDate: keep ? p.goalStartDate : U.today(),
      });
    },
    setNote(date, note) {
      updateDay(date, (d) => (d.note = note));
    },

    updateProfile,
    // bf: a brand-name food's own copy, kept with the favorite so the list shows it without loading anything.
    toggleFavorite(key, bf) {
      const fav = new Set((S.profile && S.profile.favorites) || []);
      const favFoods = Object.assign({}, (S.profile && S.profile.favFoods) || {});
      if (fav.has(key)) {
        fav.delete(key);
        delete favFoods[key];
      } else {
        fav.add(key);
        if (bf) favFoods[key] = bf;
      }
      if (S.profile) updateProfile({ favorites: Array.from(fav), favFoods });
    },
    isFavorite(key) {
      return !!(S.profile && S.profile.favorites && S.profile.favorites.includes(key));
    },

    /** Set (or with null, clear) the person's own goal for a nutrient. See customTarget in core.js. */
    setGoal(key, goal) {
      if (!S.profile) return;
      if (key === 'kcal') {
        updateProfile({ kcalOverride: goal && goal.value > 0 ? Math.round(goal.value) : null });
        return;
      }
      const ov = Object.assign({}, S.profile.overrides || {});
      if (goal) {
        const clean = { kind: goal.kind };
        ['value', 'min', 'max'].forEach((f) => goal[f] != null && goal[f] !== '' && (clean[f] = +goal[f]));
        if (goal.unit && goal.unit !== 'amount') clean.unit = goal.unit;
        ov[key] = clean;
      } else delete ov[key];
      updateProfile({ overrides: ov });
    },
    resetGoals() {
      if (S.profile) updateProfile({ overrides: {}, kcalOverride: null });
    },

    saveLibraryItem(item) {
      const it = Object.assign({}, item, { u: Date.now() });
      if (!it.id) it.id = U.uid(it.type === 'recipe' ? 'r' : 'c');
      S.library = Object.assign({}, S.library, { [it.id]: it });
      recipeCache.delete(it.id);
      save.lib(it.id);
      DV.emit();
      return it;
    },
    deleteLibraryItem(id) {
      // Kept as an archived copy so past diary entries still add up.
      const it = S.library[id];
      if (!it) return;
      S.library = Object.assign({}, S.library, { [id]: Object.assign({}, it, { archived: true, u: Date.now() }) });
      save.lib(id);
      DV.emit();
    },

    // Leave the example data and start a real diary.
    startDiary(profile) {
      S.mode = 'user';
      S.profile = Object.assign({ favorites: [], created: Date.now() }, profile, { u: Date.now() });
      S.days = {};
      S.library = {};
      if (profile.weightKg) S.days[U.today()] = { date: U.today(), entries: [], ex: [], water: 0, weight: profile.weightKg, note: '', u: Date.now() };
      UI.date = U.today();
      save.profile();
      Object.keys(S.days).forEach((d) => save.day(d));
      writeLocal();
      DV.emit();
    },

    exportJSON() {
      return JSON.stringify({ app: 'Daily Value', v: 1, exported: new Date().toISOString(), profile: S.profile, days: S.days, library: S.library }, null, 1);
    },
    exportCSV() {
      const rows = [['date', 'meal', 'food', 'amount', 'grams', 'kcal', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'sugars_g', 'sodium_mg']];
      Object.keys(S.days)
        .sort()
        .forEach((d) => {
          (S.days[d].entries || []).forEach((e) => {
            const n = entryNutrients(e).n;
            const f = (v, dg = 1) => (v == null ? '' : (Math.round(v * 10 ** dg) / 10 ** dg).toString());
            rows.push([d, e.meal, e.name, e.quick ? '' : U.fmtQty(e.qty) + ' × ' + e.unit, f(e.g, 0), f(n.kcal, 0), f(n.prot), f(n.carbs), f(n.fat), f(n.fiber), f(n.sugars), f(n.na, 0)]);
          });
        });
      return rows.map((r) => r.map((c) => (/[",\n]/.test(String(c)) ? '"' + String(c).replace(/"/g, '""') + '"' : c)).join(',')).join('\n');
    },
    importJSON(text) {
      const data = JSON.parse(text);
      if (!data || !data.profile || typeof data.days !== 'object') throw new Error('This file isn’t a Daily Value backup.');
      S.mode = 'user';
      const now = Date.now();
      S.profile = Object.assign({}, data.profile, { u: now });
      S.days = {};
      Object.entries(data.days || {}).forEach(([d, day]) => (S.days[d] = Object.assign({}, day, { date: d, u: now })));
      S.library = {};
      Object.entries(data.library || {}).forEach(([id, it]) => (S.library[id] = Object.assign({}, it, { id, u: now })));
      recipeCache.clear();
      save.profile();
      Object.keys(S.days).forEach((d) => save.day(d));
      Object.keys(S.library).forEach((id) => save.lib(id));
      writeLocal();
      DV.emit();
    },
    async resetAll() {
      const days = Object.keys(S.days);
      const lib = Object.keys(S.library);
      if (cloud.ready) {
        days.forEach((d) => cloud.remove('days/' + d));
        lib.forEach((id) => cloud.remove('foods/' + id));
        cloud.remove('profile');
      }
      clearLocal();
      loadSample();
      DV.emit();
    },
  });

  function makeEntry(meal, item) {
    const e = { id: U.uid('e'), meal, name: item.name, qty: item.qty, unit: item.unit, ug: item.ug, g: item.g, t: Date.now() };
    if (item.fid != null) e.fid = item.fid;
    if (item.bf) e.bf = item.bf;
    if (item.lid) e.lid = item.lid;
    const r = entryNutrients(e);
    // Before the food database loads, a repeat of an earlier entry keeps that entry's numbers.
    e.s = !r.full && item.s ? Object.assign({}, item.s) : macroSnapshot(r.n);
    return e;
  }
  function latestWeightDate() {
    let best = '';
    for (const d of Object.keys(S.days)) if (S.days[d].weight > 0 && d > best) best = d;
    return best;
  }
  function shortName(name) {
    const s = String(name || '').split(',')[0];
    return s.length > 28 ? s.slice(0, 27) + '…' : s;
  }
  DV.shortName = shortName;

  // ---------------------------------------------------------------------------
  // Example data shown before someone sets up their own diary. Real USDA foods; nothing is saved.
  const SAMPLE_FOODS = {
    oatmeal: [2708381, 'Oatmeal, regular or quick, made with water, no added fat', [64, 2.21, 11.4, 1.09]],
    blueberries: [171711, 'Blueberries, raw', [57, 0.74, 14.5, 0.33]],
    latte: [2710386, 'Coffee, Latte', [43, 2.81, 4.35, 1.61]],
    pb: [2707537, 'Peanut butter', [598, 22.2, 22.3, 51.4]],
    chicken: [2705956, 'Chicken breast, baked, broiled, or roasted, skin not eaten, from raw', [161, 30.2, 0, 3.52]],
    spinach: [2709614, 'Spinach, raw', [27, 2.85, 2.41, 0.62]],
    quinoa: [168917, 'Quinoa, cooked', [120, 4.4, 21.3, 1.92]],
    avocado: [2709223, 'Avocado, raw', [160, 2, 8.53, 14.7]],
    oliveoil: [2710186, 'Olive oil', [900, 0, 0, 100]],
    tomato: [2709719, 'Tomatoes, raw', [20, 0.82, 4.04, 0.31]],
    apple: [2709215, 'Apple, raw', [61, 0.17, 14.8, 0.15]],
    almonds: [2707486, 'Almonds, unroasted', [626, 21.4, 20, 51.1]],
    greekyog: [2705424, 'Yogurt, Greek, nonfat milk, plain', [59, 10.3, 3.64, 0.37]],
    salmon: [2706286, 'Fish, salmon, baked or broiled', [274, 25.4, 0.01, 18.4]],
    broccoli: [2709645, 'Broccoli, fresh, cooked, no added fat', [41, 2.67, 6.51, 0.35]],
    sweetpotato: [2709699, 'Sweet potato, baked, no added fat', [82, 1.64, 18, 0.39]],
    eggs: [2707201, 'Egg omelet or scrambled egg, made with butter', [182, 11.6, 0.9, 14.6]],
    toast: [2707710, 'Bread, whole wheat, toasted', [279, 13.5, 47.4, 3.9]],
    butter: [2710155, 'Butter, stick', [743, 0.85, 0.06, 82.2]],
    coffee: [2710375, 'Coffee, brewed', [1, 0.12, 0, 0.02]],
    strawberries: [2709283, 'Strawberries, raw', [36, 0.64, 7.96, 0.22]],
    blackbeans: [2707363, 'Black beans, from canned, no added fat', [134, 8.87, 24.3, 0.43]],
    brownrice: [2708409, 'Rice, brown, cooked, NS as to fat', [123, 2.44, 25.8, 1.11]],
    cheddar: [2705709, 'Cheese, Cheddar', [409, 23.3, 2.44, 34]],
    turkey: [2706109, 'Turkey, light meat, roasted, skin not eaten', [139, 28.8, 0, 2.06]],
    bread: [2707709, 'Bread, whole wheat', [254, 12.3, 43.1, 3.55]],
    pasta: [2708357, 'Pasta, cooked', [157, 5.76, 30.7, 0.92]],
    meatsauce: [2706470, 'Spaghetti sauce with meat', [90, 5.94, 6.54, 4.36]],
    lentils: [2707425, 'Lentils, from dried, no added fat', [115, 8.97, 20, 0.38]],
    whiterice: [2708408, 'Rice, white, cooked, no added fat', [129, 2.67, 28, 0.28]],
    pizza: [2708616, 'Pizza, cheese, from restaurant or fast food, medium crust', [266, 11.4, 33.3, 9.69]],
    banana: [2709224, 'Banana, raw', [97, 0.74, 22.7, 0.28]],
    carrots: [2709660, 'Carrots, raw', [44, 0.87, 9.68, 0.24]],
    hummus: [2707402, 'Hummus, plain', [243, 7.35, 14.9, 17.1]],
    milk: [2705386, 'Milk, reduced fat (2%)', [50, 3.36, 4.9, 1.9]],
  };
  // [food, qty, unit label, grams per unit]
  const SAMPLE_MEALS = {
    breakfast: [
      [['oatmeal', 1, '1 cup, cooked', 240], ['blueberries', 0.5, '1 cup', 148], ['pb', 1, '1 tablespoon', 16], ['latte', 1, '1 small', 360]],
      [['eggs', 2, '1 egg', 55], ['toast', 2, '1 medium or regular slice', 33], ['butter', 1, '1 pat', 7], ['coffee', 1, '1 cup (8 fl oz)', 240]],
      [['greekyog', 1, '1 6 oz container', 170], ['strawberries', 1, '1 cup', 150], ['almonds', 0.5, '1 oz', 28.4], ['coffee', 1, '1 cup (8 fl oz)', 240]],
    ],
    lunch: [
      [['chicken', 1, '1 medium breast', 120], ['spinach', 2, '1 cup', 25], ['quinoa', 0.75, '1 cup', 185], ['avocado', 3, '1 slice', 15], ['tomato', 0.5, '1 cup', 180], ['oliveoil', 1, '1 tablespoon', 14]],
      [['blackbeans', 0.75, '1 cup', 180], ['brownrice', 1, '1 cup, cooked', 196], ['cheddar', 1, '1 slice', 21], ['avocado', 2, '1 slice', 15]],
      [['turkey', 2, '1 medium slice', 60], ['bread', 2, '1 medium or regular slice', 36], ['cheddar', 1, '1 slice', 21], ['apple', 1, '1 medium', 200]],
    ],
    dinner: [
      [['salmon', 1, '1 small/regular fillet', 140], ['broccoli', 1, '1 cup', 155], ['sweetpotato', 1, '1 medium', 150]],
      [['pasta', 1.5, '1 cup, cooked', 140], ['meatsauce', 1, '1 cup', 260], ['spinach', 1, '1 cup', 25]],
      [['lentils', 1, '1 cup', 180], ['whiterice', 1, '1 cup, cooked', 158], ['carrots', 1, '1 regular carrot', 60]],
      [['pizza', 2, '1 piece, large pizza', 119], ['broccoli', 1, '1 cup', 155]],
    ],
    snacks: [
      [['apple', 1, '1 medium', 200], ['almonds', 1, '1 oz', 28.4]],
      [['banana', 1, '1 banana', 126], ['pb', 1, '1 tablespoon', 16]],
      [['carrots', 1, '1 cup', 120], ['hummus', 1, '1 typical serving', 60]],
      [['greekyog', 1, '1 5.3 oz container', 150]],
    ],
  };
  function sampleEntry(meal, [key, qty, unit, ug], t) {
    const [fid, name, m] = SAMPLE_FOODS[key];
    const g = Math.round(qty * ug * 10) / 10;
    const f = g / 100;
    return { id: U.uid('e'), meal, fid, name, qty, unit, ug, g, s: { kcal: round1(m[0] * f), prot: round1(m[1] * f), carbs: round1(m[2] * f), fat: round1(m[3] * f), alcohol: 0 }, t };
  }
  function loadSample() {
    let seed = 20260927;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
    const t = U.today();
    const days = {};
    const startKg = 66.4;
    for (let i = 20; i >= 0; i--) {
      const date = U.addDays(t, -i);
      const entries = [];
      const isToday = i === 0;
      const b = isToday ? SAMPLE_MEALS.breakfast[0] : pick(SAMPLE_MEALS.breakfast);
      b.forEach((x) => entries.push(sampleEntry('breakfast', x, 0)));
      const l = isToday ? SAMPLE_MEALS.lunch[0] : pick(SAMPLE_MEALS.lunch);
      l.forEach((x) => entries.push(sampleEntry('lunch', x, 0)));
      const sn = isToday ? SAMPLE_MEALS.snacks[0] : pick(SAMPLE_MEALS.snacks);
      sn.forEach((x) => entries.push(sampleEntry('snacks', x, 0)));
      if (!isToday) pick(SAMPLE_MEALS.dinner).forEach((x) => entries.push(sampleEntry('dinner', x, 0)));
      const ex = [];
      if (i % 2 === 0) ex.push({ id: U.uid('x'), name: 'Walking, brisk (4 mph)', met: 5.0, min: 35, kcal: DV.core.exerciseKcal(5.0, 35, 65) });
      if (i % 3 === 1) ex.push({ id: U.uid('x'), name: 'Strength training, moderate', met: 3.5, min: 45, kcal: DV.core.exerciseKcal(3.5, 45, 65) });
      const weight = i % 3 === 0 ? Math.round((startKg - (20 - i) * 0.07 + (rnd() - 0.5) * 0.5) * 10) / 10 : null;
      days[date] = { date, entries, ex, water: isToday ? 1250 : 1500 + Math.round(rnd() * 8) * 125, weight, note: '', u: 1 };
    }
    S.mode = 'sample';
    S.profile = {
      sex: 'female',
      birthYear: new Date().getFullYear() - 34,
      heightCm: 165,
      weightKg: 65,
      activity: 'light',
      rate: -0.25,
      plan: 'balanced',
      units: defaultUnits(),
      goalWeightKg: 62,
      goalStartKg: startKg,
      goalStartDate: U.addDays(t, -20),
      favorites: ['f171711', 'f2707486'],
      overrides: {},
      eatBack: true,
      u: 0,
    };
    S.days = days;
    S.library = {
      r_sample1: {
        id: 'r_sample1',
        type: 'recipe',
        name: 'Overnight oats with berries',
        servings: 2,
        ingredients: [
          { fid: 2708381, name: 'Oatmeal, regular or quick, made with water, no added fat', qty: 2, unit: '1 cup, cooked', ug: 240, g: 480 },
          { fid: 2705424, name: 'Yogurt, Greek, nonfat milk, plain', qty: 1, unit: '1 5.3 oz container', ug: 150, g: 150 },
          { fid: 171711, name: 'Blueberries, raw', qty: 1, unit: '1 cup', ug: 148, g: 148 },
        ],
        u: 1,
      },
    };
    S.uid = null;
    S.backend = 'local';
  }
  function defaultUnits() {
    const lang = (navigator.language || 'en-US').toLowerCase();
    return /^en-(us|lr)|^my/.test(lang) ? 'imperial' : 'metric';
  }
  DV.defaultUnits = defaultUnits;

  // ---------------------------------------------------------------------------
  // Boot
  function boot() {
    const local = readLocal();
    if (local && local.profile && local.profile.sex) {
      S.mode = 'user';
      S.profile = local.profile;
      S.days = local.days || {};
      S.library = local.library || {};
      S.uid = local.uid || null;
      S.backend = 'local';
      S.sync = 'saved';
      S.syncMsg = 'Saved in this browser';
    } else {
      loadSample();
    }
    const prefs = readUIPrefs();
    const hash = (location.hash || '').slice(1);
    const views = DV.VIEWS;
    UI.view = views.includes(hash) ? hash : views.includes(prefs.view) ? prefs.view : 'diary';
    connectCloud();
    DB.load();
  }
  DV.boot = boot;
})();
