/* Daily Value: views and sheets. */
(function () {
  'use strict';
  const { html, render, useState, useEffect, useRef, useMemo, useReducer } = window.htmPreact;
  const DV = window.DV;
  const U = DV.util;
  const C = DV.core;
  const A = DV.actions;
  const DB = DV.foodDB;
  const BR = DV.brands;
  const AI = DV.ai;
  const S = DV.state;
  const UI = DV.ui;
  const { Icon, Sheet, Meter, Mark, NutrientRow, NutritionLabel, Seg, Spinner, ChartFrame, StackedColumns, WeightChart, SplitBar } = DV.UI;

  const MACROS = [
    { key: 'prot', label: 'Protein', color: 'var(--protein)', kcal: 4 },
    { key: 'carbs', label: 'Carbs', color: 'var(--carbs)', kcal: 4 },
    { key: 'fat', label: 'Fat', color: 'var(--fat)', kcal: 9 },
    { key: 'alcohol', label: 'Alcohol', color: 'var(--alcohol)', kcal: 7 },
  ];
  const MEAL_OPTS = DV.MEALS;
  const mealName = (m) => (DV.MEALS.find((x) => x[0] === m) || [m, 'Snacks'])[1];
  const units = () => (S.profile && S.profile.units) || 'imperial';

  function useDebounced(value, ms) {
    const [v, setV] = useState(value);
    useEffect(() => {
      const t = setTimeout(() => setV(value), ms);
      return () => clearTimeout(t);
    }, [value]);
    return v;
  }

  // "2 large", "½ cup, cooked", "150 g"
  function amountText(qty, unit) {
    if (unit === 'g' || unit === 'oz') return U.fmtQty(qty) + ' ' + unit;
    if (/^1 /.test(unit)) return U.fmtQty(qty) + ' ' + unit.slice(2);
    if (qty === 1) return unit;
    return U.fmtQty(qty) + ' × ' + unit;
  }

  // ---------------------------------------------------------------------------
  // Food references: { fid } for USDA foods (brand-name ones also carry bf, their own copy of the product),
  // { lid } for the person's own foods and recipes
  function refKey(ref) {
    return ref.fid != null ? 'f' + ref.fid : 'l' + ref.lid;
  }
  // A clean reference from anything that has fid/bf/lid (entries, recents, foods).
  function refOf(x) {
    if (x.fid != null) return x.bf ? { fid: x.fid, bf: x.bf } : { fid: x.fid };
    return { lid: x.lid };
  }
  function resolveRef(ref) {
    if (ref.fid != null) {
      const f = DB.get(ref);
      if (!f) return null;
      return { key: refKey(ref), name: f.name, src: DB.sourceLabel(f), group: DB.groupName(f), per100: DB.nutrients(f), portions: DB.portions(f), def: DB.defaultPortion(f), food: f };
    }
    const it = S.library[ref.lid];
    if (!it) return null;
    if (it.type === 'recipe') {
      const total = DV.calc.recipeGrams(it);
      const serv = { label: '1 serving', g: Math.round((total / (it.servings || 1)) * 10) / 10 };
      return { key: refKey(ref), name: it.name, src: 'My recipe', group: (it.servings || 1) + ' servings', per100: DV.calc.libPer100(it), portions: serv.g > 0 ? [serv] : [], def: serv, item: it };
    }
    const por = it.portions && it.portions.length ? it.portions : [];
    return { key: refKey(ref), name: it.name + (it.brand ? ' (' + it.brand + ')' : ''), src: 'My food', group: it.brand || '', per100: it.per100, portions: por, def: por[0] || { label: '100 g', g: 100 }, item: it };
  }
  function unitOptions(info, extra) {
    const out = [];
    const seen = new Set();
    const push = (o) => {
      if (!o || !o.label || !(o.g > 0) || seen.has(o.label)) return;
      seen.add(o.label);
      out.push(o);
    };
    (info ? info.portions : []).forEach(push);
    if (info && info.def) push(info.def);
    if (extra) push(extra);
    push({ label: 'g', g: 1 });
    push({ label: 'oz', g: U.units.G_PER_OZ });
    return out;
  }

  function openAdd(meal) {
    const date = UI.view === 'diary' ? UI.date : U.today();
    A.open({ type: 'add', date, meal: meal || U.mealForNow() });
  }

  // ---------------------------------------------------------------------------
  // App shell
  function App() {
    const [, force] = useReducer((x) => x + 1, 0);
    useEffect(() => DV.subscribe(force), []);
    useEffect(() => {
      const onHash = () => {
        const h = location.hash.slice(1);
        if (DV.VIEWS.includes(h) && h !== UI.view) A.setView(h);
      };
      window.addEventListener('hashchange', onHash);
      return () => window.removeEventListener('hashchange', onHash);
    }, []);
    const v = UI.view;
    return html`<div class="app">
      <${Sidebar} />
      <main class="main" id="main">
        <div class="wrap">
          <${MobileHeader} />
          ${S.mode === 'sample' ? html`<${SampleBanner} />` : null}
          ${v === 'diary' ? html`<${InstallBanner} />` : null}
          ${v === 'diary'
            ? html`<${DiaryView} />`
            : v === 'foods'
            ? html`<${FoodsView} />`
            : v === 'weight'
            ? html`<${WeightView} />`
            : v === 'trends'
            ? html`<${TrendsView} />`
            : html`<${ProfileView} />`}
        </div>
      </main>
      <${TabBar} />
      <${Toasts} />
      <${SheetHost} />
    </div>`;
  }

  const NAV = [
    ['diary', 'Diary', 'diary'],
    ['foods', 'Foods', 'apple'],
    ['weight', 'Weight', 'scale'],
    ['trends', 'Trends', 'chart'],
    ['profile', 'Profile & targets', 'user'],
  ];
  function Sidebar() {
    return html`<aside class="side">
      <div class="brand" aria-label="Daily Value">Daily Value<small>Nutrition tracker</small></div>
      <nav class="nav" aria-label="Main">
        ${NAV.map(([v, label, icon]) => html`<button type="button" key=${v} aria-current=${UI.view === v ? 'page' : undefined} onClick=${() => A.setView(v)}><${Icon} name=${icon} size=${18} /> ${label}</button>`)}
      </nav>
      <button type="button" class="btn btn-primary side-add" onClick=${() => openAdd()}><${Icon} name="plus" size=${18} /> Log food</button>
      <div class="side-foot">
        <${SyncStatus} />
        <p>Food data: USDA FoodData Central</p>
      </div>
    </aside>`;
  }
  // Phones: Profile sits in the header so the tab bar has room for Weight.
  function MobileHeader() {
    return html`<header class="mhead">
      <span class="mbrand">Daily Value</span>
      <${SyncStatus} short />
      <button type="button" class="iconbtn quiet mprofile" aria-label="Profile & targets" aria-current=${UI.view === 'profile' ? 'page' : undefined} onClick=${() => A.setView('profile')}><${Icon} name="user" /></button>
    </header>`;
  }
  function TabBar() {
    const item = (v, label, icon) => html`<button type="button" class="tab" aria-current=${UI.view === v ? 'page' : undefined} onClick=${() => A.setView(v)}><${Icon} name=${icon} size=${22} /><span>${label}</span></button>`;
    return html`<nav class="tabbar" aria-label="Main">
      ${item('diary', 'Diary', 'diary')}
      ${item('foods', 'Foods', 'apple')}
      <button type="button" class="tab-add" aria-label="Log food" onClick=${() => openAdd()}><${Icon} name="plus" size=${26} stroke=${2.5} /></button>
      ${item('weight', 'Weight', 'scale')}
      ${item('trends', 'Trends', 'chart')}
    </nav>`;
  }
  // `short`: a few words for the phone header; a sync problem there shows its full message when tapped.
  function SyncStatus({ short }) {
    if (S.mode === 'sample') return html`<span class="sync"><${Icon} name="info" size=${14} /> ${short ? 'Example data' : 'Example data, not saved'}</span>`;
    const icon = S.sync === 'error' ? 'alert' : S.backend === 'cloud' ? 'cloud' : 'device';
    const full = S.syncMsg || (S.backend === 'cloud' ? 'Synced' : 'Saved in this browser');
    if (!short) return html`<span class=${'sync s-' + S.sync} title=${S.syncMsg}><${Icon} name=${icon} size=${14} /> ${full}</span>`;
    if (S.sync === 'error') return html`<button type="button" class="sync s-error sync-btn" onClick=${() => A.toast(full, { ms: 8000 })}><${Icon} name=${icon} size=${14} /> Sync problem</button>`;
    const text = S.sync === 'saving' ? (S.syncMsg && S.syncMsg.length <= 14 ? S.syncMsg : 'Saving…') : S.backend === 'cloud' ? 'Synced' : 'Saved on this device';
    return html`<span class=${'sync s-' + S.sync} title=${full}><${Icon} name=${icon} size=${14} /> ${text}</span>`;
  }
  function SampleBanner() {
    return html`<div class="banner" role="note">
      <p><b>This is an example diary.</b> It belongs to a made-up person so you can see how tracking works. Nothing you change here is saved.</p>
      <div class="row gap8 wrap">
        ${canSignIn() ? html`<button type="button" class="btn btn-quiet" onClick=${() => A.open({ type: 'signin' })}>Sign in</button>` : null}
        <button type="button" class="btn btn-invert" onClick=${() => A.open({ type: 'onboard' })}>Start my diary</button>
      </div>
    </div>`;
  }
  // Installable-app build only (DV.pwa, from pwa/pwa.js): a nudge on the diary to put the app on the
  // home screen, hidden for a month when dismissed. On iPhone the Home Screen app keeps its own diary,
  // apart from Safari's, which is why it shows even before a diary is started. A diary kept in a Safari tab
  // can be erased by Safari after 7 days of not visiting, so then it says so and comes back after 3 days.
  function InstallBanner() {
    const P = DV.pwa;
    const [hidden, setHidden] = useState(() => (DV.uiPrefs.read().installHiddenUntil || 0) > Date.now());
    if (!P || P.installed || hidden || !(P.canPrompt || P.ios)) return null;
    const atRisk = P.ios && S.mode === 'user';
    const hide = () => {
      DV.uiPrefs.write({ installHiddenUntil: Date.now() + (atRisk ? 3 : 30) * 86400000 });
      setHidden(true);
    };
    const how = html`in Safari tap Share <${Icon} name="share" size=${16} /> (under ⋯ on iOS 26), then <b>Add to Home Screen</b>.`;
    return html`<div class="banner install-banner" role="note">
      <p>${P.canPrompt
        ? html`<b>Install Daily Value</b> for a home-screen icon, a full-screen view and offline use.`
        : atRisk
        ? html`<b>Safari can erase this diary</b> if you go 7 days of using Safari without opening Daily Value. Add it to your Home Screen: ${how} Then move your entries with <b>Copy backup</b> here and <b>Paste a backup</b> in the app, both in Profile.`
        : html`<b>Add Daily Value to your Home Screen:</b> ${how} The Home Screen app keeps its own diary, so add it before you start logging.`}</p>
      <div class="row gap8">
        ${P.canPrompt ? html`<button type="button" class="btn btn-invert" onClick=${() => P.prompt().then((r) => r === 'accepted' && hide())}>Install</button>` : null}
        <button type="button" class="btn btn-quiet" onClick=${hide}>${P.canPrompt ? 'Not now' : 'Got it'}</button>
      </div>
    </div>`;
  }

  function Toasts() {
    return html`<div class="toasts" role="status" aria-live="polite">
      ${UI.toasts.map(
        (t) => html`<div class="toast" key=${t.id}>
          <span>${t.text}</span>
          ${t.action
            ? html`<button type="button" onClick=${() => {
                t.action.run();
                UI.toasts = UI.toasts.filter((x) => x.id !== t.id);
                DV.emit();
              }}>${t.action.label}</button>`
            : null}
        </div>`
      )}
    </div>`;
  }

  function SheetHost() {
    const sh = UI.sheet;
    if (!sh) return null;
    const close = () => A.close();
    const k = sh.type + ':' + (sh.id || sh.key || sh.lid || '');
    switch (sh.type) {
      case 'add':
        return html`<${AddFoodSheet} key=${k} date=${sh.date} meal=${sh.meal} foodId=${sh.foodId} bf=${sh.bf} lid=${sh.lid} onClose=${close} />`;
      case 'entry':
        return html`<${EntrySheet} key=${k} date=${sh.date} id=${sh.id} onClose=${close} />`;
      case 'exercise':
        return html`<${ExerciseSheet} key=${k} date=${sh.date} onClose=${close} />`;
      case 'ai':
        return html`<${AiLogSheet} key=${k} date=${sh.date} meal=${sh.meal} onClose=${close} />`;
      case 'custom':
        return html`<${CustomFoodSheet} key=${k} lid=${sh.lid} prefill=${sh.prefill} onClose=${close} />`;
      case 'recipe':
        return html`<${RecipeSheet} key=${k} lid=${sh.lid} onClose=${close} />`;
      case 'nutrient':
        return html`<${NutrientSheet} key=${k} nkey=${sh.key} date=${sh.date} range=${sh.range} onClose=${close} />`;
      case 'goal':
        return html`<${GoalSheet} key=${k} nkey=${sh.key} back=${sh.back} onClose=${close} />`;
      case 'weight':
        return html`<${WeightSheet} key=${k} date=${sh.date} onClose=${close} />`;
      case 'paste':
        return html`<${PasteSheet} key=${k} onClose=${close} />`;
      case 'signin':
        return html`<${SignInSheet} key=${k} onClose=${close} />`;
      case 'onboard':
        return html`<${OnboardSheet} key=${k} onClose=${close} />`;
      case 'review':
        return html`<${ReviewSheet} key=${k} date=${sh.date} onClose=${close} />`;
      case 'confirm':
        return html`<${ConfirmSheet} key=${k} ...${sh} onClose=${close} />`;
      case 'text':
        return html`<${TextSheet} key=${k} ...${sh} onClose=${close} />`;
      default:
        return null;
    }
  }

  function ConfirmSheet({ title, body, confirm, danger, run, onClose }) {
    return html`<${Sheet} title=${title} onClose=${onClose}
      footer=${html`<button type="button" class="btn" onClick=${onClose}>Cancel</button>
        <button type="button" class=${'btn ' + (danger ? 'btn-danger-solid' : 'btn-primary')} onClick=${() => {
          onClose();
          run();
        }}>${confirm}</button>`}>
      <p class="lede">${body}</p>
    <//>`;
  }
  function TextSheet({ title, body, text, onClose }) {
    const ref = useRef(null);
    const [copied, setCopied] = useState(false);
    const copy = async () => {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
      } catch (e) {
        ref.current && ref.current.select();
      }
    };
    return html`<${Sheet} title=${title} onClose=${onClose} wide
      footer=${html`<button type="button" class="btn btn-primary" onClick=${copy}><${Icon} name="copy" size=${16} /> ${copied ? 'Copied' : 'Copy'}</button>`}>
      <p class="muted">${body}</p>
      <textarea class="input mono" ref=${ref} readonly rows="12" aria-label=${title} value=${text} onFocus=${(e) => e.target.select()}></textarea>
    <//>`;
  }

  // ---------------------------------------------------------------------------
  // Diary
  function DiaryView() {
    const date = UI.date;
    const day = S.days[date] || { date, entries: [], ex: [], water: 0 };
    const T = DV.calc.targetsFor(date);
    const tot = DV.calc.dayTotals(day);
    const burned = DV.calc.exerciseTotal(day);
    return html`<div class="diary">
      <${DateBar} date=${date} />
      <div class="diary-top">
        <div class="area-main">
          <${Meals} date=${date} day=${day} tot=${tot} />
          <${Extras} date=${date} day=${day} burned=${burned} />
        </div>
        <div class="area-side"><${DaySummary} date=${date} T=${T} tot=${tot} burned=${burned} /></div>
      </div>
      <div class="area-nutrients"><${NutrientPanel} date=${date} T=${T} tot=${tot} /></div>
    </div>`;
  }

  function DateBar({ date }) {
    const d = U.fmtDay(date);
    const isToday = date === U.today();
    const pick = (e) => e.target.value && A.setDate(e.target.value);
    return html`<div class="datebar">
      <button type="button" class="iconbtn" aria-label="Previous day" onClick=${() => A.setDate(U.addDays(date, -1))}><${Icon} name="left" /></button>
      <div class="datebar-t">
        <h1>${d.rel}</h1>
        <div class="sub">${d.full}</div>
      </div>
      <button type="button" class="iconbtn" aria-label="Next day" onClick=${() => A.setDate(U.addDays(date, 1))}><${Icon} name="right" /></button>
      <label class="iconbtn datepick" title="Pick a date">
        <${Icon} name="calendar" />
        <span class="sr">Pick a date</span>
        <input type="date" value=${date} onChange=${pick} />
      </label>
      <input class="input date-in" type="date" aria-label="Pick a date" value=${date} onChange=${pick} />
      ${!isToday ? html`<button type="button" class="btn btn-sm" onClick=${() => A.setDate(U.today())}>Today</button>` : null}
    </div>`;
  }

  // "86 / 120 g", "30 / 50 g max", "62 / 50–80 g", or "86 g" with no goal.
  function macroAmt(v, t) {
    const tv = C.targetValue(t);
    if (tv == null) return U.fmt(v, 0) + ' g';
    if (t.range) return U.fmt(v, 0) + ' / ' + U.fmt(t.min, 0) + '–' + U.fmt(t.max, 0) + ' g';
    return U.fmt(v, 0) + ' / ' + U.fmt(tv, 0) + ' g' + (t.kind === 'max' ? ' max' : t.custom && t.kind === 'min' ? ' min' : '');
  }

  function DaySummary({ date, T, tot, burned }) {
    const p = S.profile;
    const goal = T.kcal ? T.kcal.goal : 2000;
    const eatBack = p.eatBack !== false;
    const budget = goal + (eatBack ? burned : 0);
    const food = tot.n.kcal || 0;
    const left = budget - food;
    const over = left < 0;
    const pct = budget > 0 ? food / budget : 0;
    const parts = MACROS.map((m) => ({ key: m.key, label: m.label, color: m.color, value: (tot.n[m.key] || 0) * m.kcal }));
    const kcalSum = parts.reduce((a, x) => a + x.value, 0);
    const fiber = C.status(tot.n.fiber, T.fiber);
    return html`<section class="factlabel summary" aria-label="Day summary">
      <div class="fl-title">Daily Value</div>
      <div class="fl-serv"><span>${date === U.today() ? 'Today' : U.fmtDay(date, 'short')}</span><b>${tot.count} ${tot.count === 1 ? 'food' : 'foods'} logged</b></div>
      <div class="rule-xl"></div>
      <div class="fl-per">${over ? 'Calories over budget' : 'Calories remaining'}</div>
      <div class=${'hero' + (over ? ' is-over' : '')}>
        <span class="hero-num">${U.fmt(Math.abs(left), 0)}</span>
        ${over ? html`<${Mark} state="over" />` : null}
      </div>
      <${Meter} pct=${pct} thick state=${over ? 'over' : ''} />
      <div class="eq">
        <span><b>${U.fmt(goal, 0)}</b> goal</span>
        <span aria-hidden="true">−</span>
        <span><b>${U.fmt(food, 0)}</b> food</span>
        ${eatBack ? html`<span aria-hidden="true">+</span><span><b>${U.fmt(burned, 0)}</b> exercise</span>` : null}
      </div>
      <div class="rule-l"></div>
      ${MACROS.slice(0, 3).map((m) => {
        const t = T[m.key];
        const v = tot.n[m.key] || 0;
        const st = C.status(v, t);
        return html`<div class="macro" key=${m.key}>
          <div class="macro-h">
            <i class="sw" style=${'background:' + m.color}></i>
            <b>${m.label}</b>
            <span class="macro-amt">${macroAmt(v, t)}</span>
            <span class="dv">${U.fmtPct(st.pct)}</span>
          </div>
          <${Meter} pct=${st.pct} color=${st.state === 'over' ? null : m.color} state=${st.state === 'over' ? 'over' : ''} />
        </div>`;
      })}
      <div class="macro">
        <div class="macro-h">
          <i class="sw sw-ink"></i>
          <b>Fiber</b>
          <span class="macro-amt">${macroAmt(tot.n.fiber || 0, T.fiber)}</span>
          <span class="dv">${U.fmtPct(fiber.pct)}</span>
        </div>
        <${Meter} pct=${fiber.pct} state=${fiber.state} />
      </div>
      <div class="rule"></div>
      <div class="fl-sub">Calories by source</div>
      <${SplitBar} parts=${parts} />
      <div class="legend small">
        ${kcalSum > 0
          ? parts.filter((x) => x.value > 0).map((x) => html`<span key=${x.key}><i class="key" style=${'background:' + x.color}></i>${x.label} ${Math.round((x.value / kcalSum) * 100)}%</span>`)
          : html`<span class="muted">Nothing logged yet</span>`}
      </div>
      ${AI.available && tot.count > 0
        ? html`<button type="button" class="btn btn-block review-btn" onClick=${() => A.open({ type: 'review', date })}><${Icon} name="sparkles" size=${18} /> Review this day with Claude</button>`
        : null}
    </section>`;
  }

  function Meals({ date, day, tot }) {
    return html`<section class="panel meals" aria-label="Meals">
      ${DV.MEALS.map(([m, label]) => html`<${Meal} key=${m} meal=${m} label=${label} date=${date} day=${day} tot=${tot} />`)}
    </section>`;
  }
  function Meal({ meal, label, date, day, tot }) {
    const entries = (day.entries || []).filter((e) => e.meal === meal);
    const sums = tot.meals[meal];
    const prev = U.addDays(date, -1);
    const prevCount = ((S.days[prev] || {}).entries || []).filter((e) => e.meal === meal).length;
    return html`<section class="meal" aria-label=${label}>
      <header class="meal-h">
        <h3>${label}</h3>
        ${entries.length ? html`<span class="meal-macros" title="Protein · carbs · fat">P ${U.fmt(sums.prot, 0)} · C ${U.fmt(sums.carbs, 0)} · F ${U.fmt(sums.fat, 0)}</span>` : null}
        <span class="meal-kcal">${entries.length ? U.fmt(sums.kcal, 0) + ' kcal' : ''}</span>
      </header>
      ${entries.map((e) => html`<${EntryRow} key=${e.id} e=${e} n=${tot.entries.get(e.id)} date=${date} />`)}
      <div class="meal-add">
        <button type="button" class="btn btn-sm btn-quiet" onClick=${() => A.open({ type: 'add', date, meal })}><${Icon} name="plus" size=${16} /> Add food</button>
        ${AI.available ? html`<button type="button" class="btn btn-sm btn-quiet" onClick=${() => A.open({ type: 'ai', date, meal })}><${Icon} name="sparkles" size=${16} /> Describe it</button>` : null}
        ${!entries.length && prevCount
          ? html`<button type="button" class="btn btn-sm btn-quiet" onClick=${() => {
              const n = A.copyMeal(prev, date, meal);
              A.toast('Copied ' + n + (n === 1 ? ' food' : ' foods') + ' from the day before');
            }}><${Icon} name="copy" size=${16} /> Copy from ${U.fmtDay(prev).rel.toLowerCase() === 'yesterday' ? 'yesterday' : 'previous day'}</button>`
          : null}
      </div>
      <${MealSuggestions} meal=${meal} date=${date} empty=${!entries.length} />
    </section>`;
  }

  // ---------------------------------------------------------------------------
  // One-tap logging of what this person usually eats
  // A loggable item from a suggestion or an earlier entry: the same food in the same amount.
  function itemOf(x) {
    return Object.assign(refOf(x), { name: x.name, qty: x.qty, unit: x.unit, ug: x.ug, g: x.g, s: x.s });
  }
  // Calories for that amount: from the food itself when it's loaded, else as they were when logged.
  function itemKcal(x) {
    const info = resolveRef(refOf(x));
    if (info && info.per100 && info.per100.kcal != null) return (info.per100.kcal * x.g) / 100;
    return x.s && x.s.kcal != null ? x.s.kcal : null;
  }
  // A short name that still tells foods apart: "Coffee, Latte" and "Coffee, brewed", "Oatmeal" from
  // "Oatmeal, regular or quick, …", "Almonds" from "Almonds (Kirkland Signature)".
  function chipName(name) {
    const base = String(name || '').replace(/\s*\([^()]*\)\s*$/, '') || String(name || '');
    const parts = base.split(', ');
    return parts.length > 1 && parts[0].length <= 12 && parts[0].length + parts[1].length <= 24 ? parts[0] + ', ' + parts[1] : parts[0];
  }
  const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
  function logNow(date, meal, x) {
    const e = A.addEntry(date, meal, itemOf(x));
    A.toast('Added ' + clip(chipName(x.name), 32) + ', ' + amountText(x.qty, x.unit) + ', to ' + mealName(meal).toLowerCase(), { action: { label: 'Undo', run: () => A.unlog(date, [e.id]) } });
  }
  function logUsual(date, meal, usual) {
    const es = A.addEntries(date, meal, usual.items.map(itemOf));
    A.toast('Added your usual ' + mealName(meal).toLowerCase() + ' (' + es.length + ' foods)', { action: { label: 'Undo', run: () => A.unlog(date, es.map((e) => e.id)) } });
  }

  // Chips under each meal: the person's usual meal (when the meal is still empty) and the foods they
  // most often have at it. One tap logs the usual amount; the toast offers Undo.
  function MealSuggestions({ meal, date, empty }) {
    if (!S.profile || S.profile.suggest === false) return null;
    const usual = empty ? DV.calc.usualMeal(meal, date) : null;
    const foods = DV.calc.suggestFoods(meal, date, { limit: 12, min: 0.9 }).filter((x) => x.inMeal >= 2).slice(0, 5);
    if (!usual && !foods.length) return null;
    const label = mealName(meal).toLowerCase();
    const usualKcal = usual ? usual.items.reduce((a, x) => a + (itemKcal(x) || 0), 0) : 0;
    return html`<div class="sugg" role="group" aria-label=${'Often at ' + label}>
      ${usual
        ? html`<button type="button" class="schip usual" onClick=${() => logUsual(date, meal, usual)} title=${usual.items.map((x) => chipName(x.name)).join(', ')}
            aria-label=${'Add your usual ' + label + ': ' + usual.items.map((x) => chipName(x.name)).join(', ') + ', ' + Math.round(usualKcal) + ' calories'}>
            <${Icon} name="copy" size=${14} />
            <span class="sn">Usual ${label}</span>
            <span class="sk">${usual.items.length} foods · ${U.fmt(usualKcal, 0)} kcal</span>
          </button>`
        : null}
      ${foods.map((x) => {
        const kcal = itemKcal(x);
        return html`<button type="button" class="schip" key=${x.key} onClick=${() => logNow(date, meal, x)} title=${x.name + ', ' + amountText(x.qty, x.unit)}
          aria-label=${'Add ' + x.name + ', ' + amountText(x.qty, x.unit) + (kcal != null ? ', ' + Math.round(kcal) + ' calories' : '')}>
          <${Icon} name="plus" size=${14} stroke=${2.5} />
          <span class="sn">${chipName(x.name)}</span>
          ${kcal != null ? html`<span class="sk">${U.fmt(kcal, 0)} kcal</span>` : null}
        </button>`;
      })}
    </div>`;
  }
  function EntryRow({ e, n, date }) {
    const kcal = n && n.kcal != null ? n.kcal : e.s ? e.s.kcal : 0;
    const meta = e.quick ? 'Quick add · ' + ['prot', 'carbs', 'fat'].map((k) => (e.s[k] ? U.fmt(e.s[k], 0) + 'g ' + k.slice(0, 1).toUpperCase() : '')).filter(Boolean).join(' ') : amountText(e.qty, e.unit) + (e.unit !== 'g' ? ' · ' + U.fmt(e.g, 0) + ' g' : '');
    return html`<button type="button" class="entry" onClick=${() => A.open({ type: 'entry', date, id: e.id })}>
      <span class="entry-name">${e.name}</span>
      <span class="entry-meta">${meta}</span>
      <span class="entry-kcal">${U.fmt(kcal, 0)}</span>
    </button>`;
  }

  function Extras({ date, day, burned }) {
    return html`<div class="extras">
      <${ExerciseCard} date=${date} day=${day} burned=${burned} />
      <${WaterCard} date=${date} day=${day} />
      <${BodyCard} date=${date} day=${day} />
    </div>`;
  }
  function ExerciseCard({ date, day, burned }) {
    const ex = day.ex || [];
    return html`<section class="panel card" aria-label="Exercise">
      <header class="card-h"><${Icon} name="flame" size=${18} /><h3>Exercise</h3><span class="card-v">${burned ? U.fmt(burned, 0) + ' kcal' : ''}</span></header>
      ${ex.length
        ? html`<ul class="exlist">${ex.map(
            (x) => html`<li key=${x.id}>
              <span class="nm">${x.name}</span>
              <span class="meta">${x.min ? x.min + ' min · ' : ''}${U.fmt(x.kcal, 0)} kcal</span>
              <button type="button" class="iconbtn quiet sm" aria-label=${'Remove ' + x.name} onClick=${() => A.removeExercise(date, x.id)}><${Icon} name="x" size=${16} /></button>
            </li>`
          )}</ul>`
        : html`<p class="muted small">Workouts add to your calorie budget${S.profile.eatBack === false ? ' (turned off in Profile)' : ''}.</p>`}
      <button type="button" class="btn btn-sm btn-quiet" onClick=${() => A.open({ type: 'exercise', date })}><${Icon} name="plus" size=${16} /> Add exercise</button>
    </section>`;
  }
  function WaterCard({ date, day }) {
    const sys = units();
    const goal = C.waterGoal(S.profile);
    const cup = sys === 'imperial' ? U.units.ozToMl(8) : 250;
    const ml = day.water || 0;
    const cups = Math.min(14, Math.max(6, Math.round(goal / cup)));
    const filled = Math.round(ml / cup);
    return html`<section class="panel card" aria-label="Water">
      <header class="card-h"><${Icon} name="droplet" size=${18} /><h3>Water</h3><span class="card-v">${U.fmtWater(ml, sys)} <span class="muted">of ${U.fmtWater(goal, sys)}</span></span></header>
      <div class="cups" role="group" aria-label=${'Glasses of water, ' + (sys === 'imperial' ? '8 fl oz' : '250 mL') + ' each'}>
        ${Array.from({ length: cups }, (_, i) => html`<button type="button" key=${i} class=${'cup' + (i < filled ? ' on' : '')} aria-label=${'Set to ' + (i + 1) + ' glasses'} aria-pressed=${i < filled ? 'true' : 'false'}
          onClick=${() => A.setWater(date, (i + 1 === filled ? i : i + 1) * cup)}>
          <svg viewBox="0 0 20 24" width="18" height="22" aria-hidden="true"><path d="M3 3h14l-1.6 17.2A2 2 0 0 1 13.4 22H6.6a2 2 0 0 1-2-1.8z" /></svg>
        </button>`)}
      </div>
      <div class="row gap8">
        <button type="button" class="btn btn-sm" onClick=${() => A.setWater(date, Math.max(0, ml - cup))} aria-label="Remove a glass"><${Icon} name="minus" size=${16} /></button>
        <button type="button" class="btn btn-sm" onClick=${() => A.setWater(date, ml + cup)}><${Icon} name="plus" size=${16} /> ${sys === 'imperial' ? '8 fl oz' : '250 mL'}</button>
      </div>
    </section>`;
  }
  function BodyCard({ date, day }) {
    const sys = units();
    const kg = day.weight;
    const shown = kg ? (sys === 'imperial' ? U.units.kgToLb(kg) : kg) : '';
    const [val, setVal] = useState(shown ? String(Math.round(shown * 10) / 10) : '');
    const [note, setNote] = useState(day.note || '');
    useEffect(() => {
      setVal(shown ? String(Math.round(shown * 10) / 10) : '');
      setNote(day.note || '');
    }, [date, kg, sys]);
    const commit = () => {
      const v = parseFloat(val);
      const next = v > 0 ? (sys === 'imperial' ? U.units.lbToKg(v) : v) : null;
      if ((next || null) !== (kg || null)) A.setWeight(date, next);
    };
    const prevW = DV.calc.weightOn(U.addDays(date, -1));
    return html`<section class="panel card" aria-label="Body and notes">
      <header class="card-h"><${Icon} name="scale" size=${18} /><h3>Weight & notes</h3><button type="button" class="linkbtn" onClick=${() => A.setView('weight')}>Weight log</button></header>
      <div class="row gap8 wrap">
        <label class="inline-field">
          <span class="sr">Weight</span>
          <input id="weight-in" class="input num" type="number" inputmode="decimal" step="0.1" min="0" placeholder=${'Weight'} value=${val}
            onInput=${(e) => setVal(e.target.value)} onBlur=${commit} onKeyDown=${(e) => e.key === 'Enter' && e.target.blur()} />
          <span class="unit">${sys === 'imperial' ? 'lb' : 'kg'}</span>
        </label>
        <span class="muted small">${kg ? '' : 'Last: ' + U.fmtWeight(prevW, sys)}</span>
      </div>
      <textarea id="day-note" class="input note" rows="2" placeholder="Notes: sleep, mood, how you felt…" value=${note} onInput=${(e) => setNote(e.target.value)} onBlur=${() => note !== (day.note || '') && A.setNote(date, note)}></textarea>
    </section>`;
  }

  function nutrientKeys(group) {
    return C.NUTRIENT_LIST.filter((n) => n[3] === group).map((n) => n[0]);
  }
  function NutrientPanel({ date, T, tot }) {
    const anyMissing = C.TRACKED.some((k) => tot.missing[k] > 0 && tot.count > 0);
    return html`<section class="panel npanel" aria-label="Nutrients">
      <header class="panel-h">
        <h2>Nutrient targets</h2>
        <span class="panel-sub">${DB.status === 'ready' ? 'Select a nutrient to see where it came from' : DB.status === 'error' ? html`Food data didn’t load. <button type="button" class="linkbtn" onClick=${() => DB.load()}>Retry</button>` : html`<${Spinner} /> Loading food data…`}</span>
      </header>
      <div class="ncols">
        ${C.GROUPS.map(
          ([g, label]) => html`<section class="ngroup" key=${g} aria-label=${label}>
            <h3>${label}</h3>
            ${nutrientKeys(g).map((k) => html`<${NutrientRow} key=${k} k=${k} value=${tot.n[k]} target=${T[k]} missing=${tot.count ? tot.missing[k] : 0} coverage=${tot.count ? tot.cov[k] : null} onClick=${() => A.open({ type: 'nutrient', key: k, date })} />`)}
          </section>`
        )}
      </div>
      ${anyMissing ? html`<p class="footnote">* USDA has no value for this nutrient in some of the foods you logged, so the true total may be higher. “No data” means most of the day’s calories came from foods without a value, so the total can’t be judged.</p>` : null}
    </section>`;
  }

  // ---------------------------------------------------------------------------
  // Add food
  function MealPicker({ meal, setMeal }) {
    return html`<${Seg} value=${meal} options=${MEAL_OPTS} onChange=${setMeal} label="Meal" small />`;
  }

  function useBoost() {
    return useMemo(() => {
      const fav = new Set((S.profile && S.profile.favorites) || []);
      const counts = DV.calc.usageCounts();
      return (food) => (fav.has('f' + food.id) ? 10 : 0) + Math.min(12, (counts.get(food.id) || 0) * 3);
    }, [S.profile, S.days]);
  }

  function libraryMatches(q) {
    const toks = DB.tokenize(q);
    return Object.values(S.library)
      .filter((it) => !it.archived)
      .filter((it) => {
        const name = (it.name + ' ' + (it.brand || '')).toLowerCase();
        return toks.every((t) => name.includes(t));
      });
  }
  // Foods this person has logged in the past year whose names match the search, most logged first.
  function historyMatches(q, limit = 5) {
    const toks = DB.tokenize(q).map((t) => (t.length > 3 && /[^s]s$/.test(t) ? t.slice(0, -1) : t));
    if (!toks.length) return [];
    return DV.calc
      .suggestFoods(null, U.today(), { limit: 400, days: 365 })
      .filter((x) => {
        const name = x.name.toLowerCase().replace(/['’]/g, '');
        return toks.every((t) => name.includes(t));
      })
      .slice(0, limit);
  }

  function portionKcal(info, portion) {
    if (!info || !info.per100 || info.per100.kcal == null || !portion) return null;
    return (info.per100.kcal * portion.g) / 100;
  }

  function DbResult({ food, onPick }) {
    const info = resolveRef({ fid: food.id });
    const def = info.def;
    const kcal = portionKcal(info, def);
    return html`<button type="button" class="result" onClick=${onPick}>
      <span class="nm">${food.name}</span>
      <span class="meta"><span class="src">${food.src === 'F' ? 'FNDDS' : 'SR'}</span> ${kcal != null ? U.fmt(kcal, 0) + ' kcal' : ''} · ${def.label}${def.label === 'g' || /\d+ ?g$/.test(def.label) ? '' : ' (' + U.fmt(def.g, 0) + ' g)'}</span>
    </button>`;
  }
  function LibResult({ item, onPick }) {
    const info = resolveRef({ lid: item.id });
    const kcal = info ? portionKcal(info, info.def) : null;
    return html`<button type="button" class="result" onClick=${onPick}>
      <span class="nm">${info ? info.name : item.name}</span>
      <span class="meta"><span class="src">${item.type === 'recipe' ? 'Recipe' : 'My food'}</span> ${kcal != null ? U.fmt(kcal, 0) + ' kcal' : ''} · ${info ? info.def.label : ''}</span>
    </button>`;
  }

  // ---------------------------------------------------------------------------
  // Brand-name products (js/branded.js): the files load on the first search.
  const NO_BRANDS = { rows: [], total: 0, brandHit: false };
  function useBrandSearch(dq, limit = 40) {
    const active = dq.trim().length >= 2 && !BR.isBarcode(dq);
    useEffect(() => {
      if (active && BR.status === 'idle') BR.load();
    }, [active]);
    return useMemo(() => (active ? BR.search(dq, { limit }) : NO_BRANDS), [dq, active, BR.count, limit]);
  }

  // The person's own food saved with this barcode, if any.
  const upcKey = (code) => String(code || '').replace(/\D/g, '').replace(/^0+/, '');
  function libraryByBarcode(code) {
    const c = upcKey(code);
    return Object.values(S.library).find((it) => !it.archived && it.upc && upcKey(it.upc) === c) || null;
  }

  // Barcode typed or scanned into the search box -> { code, busy, food | lib, err } once looked up.
  function useBarcode(q) {
    const code = BR.isBarcode(q) ? q.trim() : '';
    const [res, setRes] = useState({ code: '' });
    useEffect(() => {
      if (!code) return;
      const lib = libraryByBarcode(code);
      if (lib) {
        setRes({ code, busy: false, food: null, lib, err: '' });
        return;
      }
      let live = true;
      setRes({ code, busy: true, food: null, err: '' });
      BR.byBarcode(code)
        .then((food) => live && setRes({ code, busy: false, food, err: '' }))
        .catch(() => live && setRes({ code, busy: false, food: null, err: 'Couldn’t look up that barcode. Check your connection and try again.' }));
      return () => (live = false);
    }, [code]);
    return code ? (res.code === code ? res : { code, busy: true }) : null;
  }

  // Open a brand-name search row: fetch its full record, then hand back a reference.
  function useBrandPick(onRef) {
    const [pending, setPending] = useState(null);
    const pick = (row) => {
      setPending(row.line);
      BR.record(row.line)
        .then((f) => {
          setPending(null);
          onRef({ fid: f.id, bf: f.bf });
        })
        .catch(() => {
          setPending(null);
          A.toast('Couldn’t open that product. Check your connection and try again.');
        });
    };
    return [pending, pick];
  }

  function servingText(label, g) {
    return label + (label === 'g' || /\d ?(g|ml)$/.test(label) ? '' : ' (' + U.fmt(g, g < 10 ? 1 : 0) + ' g)');
  }

  function BrandResult({ row, onPick, busy }) {
    return html`<button type="button" class="result" onClick=${onPick} aria-busy=${busy ? 'true' : 'false'}>
      <span class="nm">${row.name}</span>
      <span class="meta"><span class="bname">${row.brand}</span> · ${U.fmt(row.kcal, 0)} kcal · ${servingText(row.label, row.g)}${busy ? html` <${Spinner} />` : null}</span>
    </button>`;
  }

  function BrandSection({ dq, res, pending, onPick }) {
    if (dq.trim().length < 2 || BR.isBarcode(dq)) return null;
    const loading = BR.status === 'loading' || BR.status === 'idle';
    const short = !DB.tokenize(dq).some((t) => t.length >= 3);
    return html`<section class="rsec" aria-label="Brand-name products">
      <h4 class="rsec-h">Brand-name products${res.total ? html` <span class="rsec-n">${U.fmt(res.total, 0)}${loading ? '+' : ''}</span>` : null}</h4>
      ${res.rows.map((r) => html`<${BrandResult} key=${'b' + r.line} row=${r} busy=${pending === r.line} onPick=${() => onPick(r)} />`)}
      ${loading ? html`<p class="muted small pad"><${Spinner} /> Loading brand-name foods${BR.total ? ' · ' + Math.round((BR.count / BR.total) * 100) + '%' : ''}…</p>` : null}
      ${BR.status === 'error' ? html`<p class="muted small pad">Brand-name foods didn’t load. ${BR.error} <button type="button" class="linkbtn" onClick=${() => BR.load()}>Try again</button></p>` : null}
      ${BR.status === 'ready' && !res.rows.length ? html`<p class="muted small pad">${short ? 'Type at least 3 letters to search brands.' : 'No brand-name products match.'}</p>` : null}
    </section>`;
  }

  function BarcodeHit({ bc, onOpen, onCreate }) {
    if (!bc) return null;
    if (bc.busy) return html`<p class="muted pad"><${Spinner} /> Looking up barcode ${bc.code}…</p>`;
    if (bc.err) return html`<p class="error pad" role="alert"><${Icon} name="alert" size=${16} /> ${bc.err}</p>`;
    if (bc.lib) {
      return html`<section class="rsec" aria-label="Barcode match">
        <h4 class="rsec-h">Barcode match <span class="rsec-n">your food</span></h4>
        <${LibResult} item=${bc.lib} onPick=${() => onOpen({ lid: bc.lib.id })} />
      </section>`;
    }
    if (!bc.food) {
      return html`<div class="empty">
        <p>No product with barcode ${bc.code} yet.</p>
        <p class="muted small">Store brands and new products are sometimes missing. Add it from its Nutrition Facts label and the barcode is saved with it, so the next scan finds it.</p>
        <button type="button" class="btn btn-sm" onClick=${() => onCreate(bc.code)}><${Icon} name="plus" size=${16} /> Create this food</button>
      </div>`;
    }
    const f = bc.food;
    const def = DB.defaultPortion(f);
    const kcal = ((DB.nutrients(f).kcal || 0) * def.g) / 100;
    return html`<section class="rsec" aria-label="Barcode match">
      <h4 class="rsec-h">Barcode match</h4>
      <button type="button" class="result" onClick=${() => onOpen({ fid: f.id, bf: f.bf })}>
        <span class="nm">${f.base}</span>
        <span class="meta"><span class="bname">${f.brand}</span> · ${U.fmt(kcal, 0)} kcal · ${servingText(def.label, def.g)}</span>
      </button>
    </section>`;
  }

  // Read a barcode from a photo (taken now or chosen from the library).
  function PhotoScanButton({ onCode }) {
    const [st, setSt] = useState({ busy: false, err: '' });
    const run = async (file) => {
      if (!file) return;
      setSt({ busy: true, err: '' });
      try {
        const code = await BR.readBarcode(file);
        if (code) {
          setSt({ busy: false, err: '' });
          onCode(code);
        } else setSt({ busy: false, err: 'No barcode found in that photo. Fill the frame with the bars and try again, or type the numbers printed under them.' });
      } catch (e) {
        setSt({ busy: false, err: 'Couldn’t read the barcode. Type the numbers printed under the bars instead.' });
      }
    };
    return html`<div class="stack-sm">
      <label class="btn btn-sm">
        ${st.busy ? html`<${Spinner} /> Reading barcode…` : html`<${Icon} name="camera" size=${16} /> Scan from a photo`}
        <input class="sr" type="file" accept="image/*" capture="environment" disabled=${st.busy} onChange=${(e) => {
          run(e.target.files && e.target.files[0]);
          e.target.value = '';
        }} />
      </label>
      ${st.err ? html`<p class="error small" role="alert">${st.err}</p>` : null}
    </div>`;
  }

  function cameraError(e) {
    const name = (e && e.name) || '';
    if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError')
      return 'Camera access is blocked. Allow the camera for this site in your browser’s settings and try again, or scan from a photo.';
    if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') return 'No camera was found on this device. Scan from a photo or type the number instead.';
    if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') return 'The camera is in use by another app. Close it and try again.';
    return 'The camera couldn’t start here. Scan from a photo or type the number instead.';
  }

  /**
   * Live camera barcode scanner. Reads continuously and calls onCode once the same code is seen
   * twice in a row; offers a photo or typing when the camera isn't available.
   */
  function BarcodeScanner({ onCode }) {
    const videoRef = useRef(null);
    const trackRef = useRef(null);
    const [phase, setPhase] = useState('starting'); // starting | scanning | error
    const [err, setErr] = useState('');
    const [torch, setTorch] = useState(null); // null: no light control
    const [cams, setCams] = useState([]);
    const [camId, setCamId] = useState(null); // null: the rear camera by default
    const [typed, setTyped] = useState('');
    const [retry, setRetry] = useState(0);
    useEffect(() => {
      let stopped = false;
      let stream = null;
      let timer = 0;
      const stop = () => {
        stopped = true;
        clearTimeout(timer);
        if (stream) stream.getTracks().forEach((t) => t.stop());
        trackRef.current = null;
      };
      const fail = (msg) => {
        if (stopped) return;
        setErr(msg);
        setPhase('error');
      };
      setPhase('starting');
      setErr('');
      (async () => {
        const policy = document.permissionsPolicy || document.featurePolicy;
        if (policy && policy.allowsFeature && !policy.allowsFeature('camera')) return fail('This page isn’t allowed to use the camera here. Scan from a photo or type the number instead.');
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return fail('This browser can’t open the camera here. Scan from a photo or type the number instead.');
        try {
          const video = camId ? { deviceId: { exact: camId } } : { facingMode: { ideal: 'environment' } };
          stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: Object.assign(video, { width: { ideal: 1280 }, height: { ideal: 720 } }) });
        } catch (e) {
          return fail(cameraError(e));
        }
        if (stopped) return stop();
        const v = videoRef.current;
        if (!v) return stop();
        v.srcObject = stream;
        try {
          await v.play();
        } catch (e) {
          /* autoplay of a muted inline video is allowed; ignore odd rejections */
        }
        const track = stream.getVideoTracks()[0];
        trackRef.current = track;
        const caps = track && track.getCapabilities ? track.getCapabilities() : {};
        setTorch(caps && caps.torch ? false : null);
        if (!cams.length) {
          try {
            const ids = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput' && d.deviceId).map((d) => d.deviceId);
            if (!stopped && ids.length > 1) setCams(ids);
          } catch (e) {
            /* the camera list only enables "Switch camera" */
          }
        }
        let scanner;
        try {
          scanner = await BR.scanner();
        } catch (e) {
          stop();
          return fail('The barcode reader didn’t load. Check your connection, or type the number instead.');
        }
        if (stopped) return;
        setPhase('scanning');
        let last = '';
        let lastAt = 0;
        const tick = async () => {
          if (stopped) return;
          let code = null;
          if (v.readyState >= 2) {
            try {
              code = await scanner.detect(v);
            } catch (e) {
              code = null;
            }
          }
          if (stopped) return;
          if (code && /^\d{6,14}$/.test(code)) {
            const k = upcKey(code);
            const now = Date.now();
            if (k === last && now - lastAt < 2500) {
              stop();
              if (navigator.vibrate) navigator.vibrate(60);
              onCode(code);
              return;
            }
            last = k;
            lastAt = now;
          }
          timer = setTimeout(tick, code ? 50 : 120);
        };
        tick();
      })();
      return stop;
    }, [camId, retry]);
    const switchCamera = () => {
      const t = trackRef.current;
      const cur = t && t.getSettings ? t.getSettings().deviceId : camId;
      setCamId(cams[(cams.indexOf(cur) + 1) % cams.length]);
    };
    const toggleTorch = async () => {
      const t = trackRef.current;
      if (!t) return;
      try {
        await t.applyConstraints({ advanced: [{ torch: !torch }] });
        setTorch(!torch);
      } catch (e) {
        setTorch(null);
      }
    };
    const typedOk = /^\d{8,14}$/.test(typed.trim());
    return html`<div class="scanner">
      ${phase === 'error'
        ? html`<div class="scan-error" role="alert">
            <${Icon} name="alert" size=${18} />
            <div><p>${err}</p><button type="button" class="linkbtn" onClick=${() => setRetry(retry + 1)}>Try the camera again</button></div>
          </div>`
        : html`<div class="scan-view">
            <video ref=${videoRef} playsinline=${true} muted=${true} autoplay=${true} aria-label="Camera preview"></video>
            <div class="scan-box" aria-hidden="true"></div>
            <p class="scan-hint" aria-live="polite">${phase === 'starting' ? 'Starting the camera…' : 'Hold the barcode inside the box'}</p>
            ${torch !== null || cams.length > 1
              ? html`<div class="scan-tools">
                  ${torch !== null ? html`<button type="button" class="btn btn-sm" aria-pressed=${torch ? 'true' : 'false'} onClick=${toggleTorch}><${Icon} name="bolt" size=${16} /> ${torch ? 'Light off' : 'Light on'}</button>` : null}
                  ${cams.length > 1 ? html`<button type="button" class="btn btn-sm" onClick=${switchCamera}>Switch camera</button>` : null}
                </div>`
              : null}
          </div>`}
      <div class="scan-alt">
        <${PhotoScanButton} onCode=${onCode} />
        <form class="row gap8" onSubmit=${(e) => {
          e.preventDefault();
          if (typedOk) onCode(typed.trim());
        }}>
          <input class="input num" type="text" inputmode="numeric" autocomplete="off" aria-label="Barcode number" placeholder="Or type the number" value=${typed} onInput=${(e) => setTyped(e.target.value.replace(/[^\d]/g, ''))} />
          <button type="submit" class="btn btn-sm" disabled=${!typedOk}>Look up</button>
        </form>
      </div>
    </div>`;
  }

  // Phones and tablets: don't raise the keyboard over the suggestions when the sheet opens.
  const coarsePointer = () => !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);

  function AddFoodSheet({ date, meal: meal0, foodId, bf, lid, onClose }) {
    const [meal, setMeal] = useState(meal0 || U.mealForNow());
    const [tab, setTab] = useState('suggested');
    const [q, setQ] = useState('');
    const dq = useDebounced(q, 110);
    const [sel, setSel] = useState(foodId != null ? { ref: refOf({ fid: foodId, bf }) } : lid ? { ref: { lid } } : null);
    const [quick, setQuick] = useState(false);
    const boost = useBoost();
    // What this person has logged before comes first, with their usual amount.
    const mine = dq.trim().length >= 2 && !BR.isBarcode(dq) ? historyMatches(dq) : [];
    const mineKeys = new Set(mine.map((x) => x.key));
    const results = useMemo(() => (dq.trim().length >= 2 && DB.status === 'ready' ? DB.search(dq, { limit: 50, boost }) : []), [dq, DB.status]).filter((r) => !mineKeys.has('f' + r.food.id));
    const libHits = useMemo(() => (dq.trim().length >= 2 ? libraryMatches(dq) : []), [dq, S.library]).filter((it) => !mineKeys.has('l' + it.id));
    const brands = useBrandSearch(dq);
    const bc = useBarcode(q);
    const [pending, pickBrand] = useBrandPick((ref) => setSel({ ref }));
    // Brand results lead when a searched word names a brand ("kirkland almonds").
    const brandFirst = brands.brandHit;
    const [scanning, setScanning] = useState(false);
    const [scanned, setScanned] = useState(''); // a code just read by the scanner: open its product when found
    useEffect(() => {
      if (!scanned || !bc || bc.code !== scanned || bc.busy) return;
      if (bc.food) setSel({ ref: { fid: bc.food.id, bf: bc.food.bf } });
      else if (bc.lib) setSel({ ref: { lid: bc.lib.id } });
      setScanned('');
    }, [scanned, bc && bc.busy, bc && bc.code]);
    const onScan = (code) => {
      setScanning(false);
      setQ(code);
      setScanned(code);
    };
    const addItem = (item, m) => {
      const e = A.addEntry(date, m || meal, item);
      A.toast('Added ' + DV.shortName(item.name) + ' to ' + mealName(m || meal).toLowerCase(), { action: { label: 'Undo', run: () => A.unlog(date, [e.id]) } });
    };
    const openMine = (x) => setSel({ ref: refOf(x), initial: { qty: x.qty, unit: x.unit, ug: x.ug } });
    const title = sel ? 'Add to ' + mealName(meal).toLowerCase() : quick ? 'Quick add calories' : scanning ? 'Scan a barcode' : 'Log food';
    const back = sel || quick || scanning ? () => (setSel(null), setQuick(false), setScanning(false)) : null;
    let body;
    if (scanning) {
      body = html`<${BarcodeScanner} onCode=${onScan} />`;
    } else if (sel) {
      body = html`<${FoodDetail} refObj=${sel.ref} initial=${sel.initial} meal=${meal} setMeal=${setMeal} date=${date}
        onSubmit=${(item, m) => {
          addItem(item, m);
          onClose();
        }} submitLabel=${'Add to ' + mealName(meal).toLowerCase()} />`;
    } else if (quick) {
      body = html`<${QuickAdd} meal=${meal} setMeal=${setMeal}
        onSubmit=${(v, m) => {
          A.addQuick(date, m, v);
          A.toast('Added ' + U.fmt(+v.kcal || 0, 0) + ' kcal to ' + mealName(m).toLowerCase());
          onClose();
        }} />`;
    } else {
      const searching = q.trim().length >= 2;
      body = html`<div class="addfood">
        <div class="addfood-top">
          <${MealPicker} meal=${meal} setMeal=${setMeal} />
          <div class="searchbox">
            <${Icon} name="search" size=${18} />
            <input id="food-q" class="input" type="search" placeholder="Search foods, brands or a barcode" aria-label="Search foods, brands or a barcode" value=${q} autocomplete="off" onInput=${(e) => setQ(e.target.value)}
              onKeyDown=${(e) => {
                if (e.key !== 'Enter') return;
                if (bc && bc.food) setSel({ ref: { fid: bc.food.id, bf: bc.food.bf } });
                else if (bc && bc.lib) setSel({ ref: { lid: bc.lib.id } });
                else if (mine[0]) openMine(mine[0]);
                else if (brandFirst && brands.rows[0]) pickBrand(brands.rows[0]);
                else if (results[0]) setSel({ ref: { fid: results[0].food.id } });
                else if (brands.rows[0]) pickBrand(brands.rows[0]);
              }} />
          </div>
          ${!searching
            ? html`<div class="quick-actions">
                ${AI.available
                  ? html`<button type="button" class="btn btn-sm" onClick=${() => A.open({ type: 'ai', date, meal })}><${Icon} name="sparkles" size=${16} /> Describe or photograph a meal</button>`
                  : null}
                <button type="button" class="btn btn-sm" onClick=${() => setScanning(true)}><${Icon} name="barcode" size=${16} /> Scan a barcode</button>
                <button type="button" class="btn btn-sm" onClick=${() => setQuick(true)}><${Icon} name="bolt" size=${16} /> Quick add calories</button>
                <button type="button" class="btn btn-sm" onClick=${() => A.open({ type: 'custom' })}><${Icon} name="plus" size=${16} /> New food</button>
                <button type="button" class="btn btn-sm" onClick=${() => A.open({ type: 'recipe' })}><${Icon} name="bowl" size=${16} /> New recipe</button>
              </div>`
            : null}
        </div>
        ${searching
          ? html`<div class="results" aria-live="polite">
              <${BarcodeHit} bc=${bc} onOpen=${(ref) => setSel({ ref })} onCreate=${(code) => A.open({ type: 'custom', prefill: { upc: code } })} />
              ${DB.status === 'loading' ? html`<p class="muted pad"><${Spinner} /> Loading the food database…</p>` : null}
              ${DB.status === 'error' ? html`<p class="muted pad">The food database didn’t load. <button type="button" class="linkbtn" onClick=${() => DB.load()}>Try again</button></p>` : null}
              ${mine.length && !bc
                ? html`<section class="rsec" aria-label="Foods you've logged">
                    <h4 class="rsec-h">You’ve logged</h4>
                    ${mine.map((x) => html`<${QuickRow} key=${x.key} x=${x} onOpen=${() => openMine(x)} onAdd=${() => addItem(itemOf(x), meal)} />`)}
                  </section>`
                : null}
              ${libHits.map((it) => html`<${LibResult} key=${it.id} item=${it} onPick=${() => setSel({ ref: { lid: it.id } })} />`)}
              ${brandFirst ? html`<${BrandSection} dq=${dq} res=${brands} pending=${pending} onPick=${pickBrand} />` : null}
              ${results.length && !bc ? html`<h4 class="rsec-h">Everyday foods <span class="rsec-n">USDA</span></h4>` : null}
              ${results.map((r) => html`<${DbResult} key=${r.food.id} food=${r.food} onPick=${() => setSel({ ref: { fid: r.food.id } })} />`)}
              ${!brandFirst ? html`<${BrandSection} dq=${dq} res=${brands} pending=${pending} onPick=${pickBrand} />` : null}
              ${DB.status === 'ready' && !bc && BR.status === 'ready' && !results.length && !libHits.length && !brands.rows.length && !mine.length
                ? html`<div class="empty">
                    <p>No foods match “${q.trim()}”.</p>
                    <p class="muted small">Try fewer or more general words, or check the spelling of the brand.</p>
                    <div class="row gap8 wrap">
                      ${AI.available ? html`<button type="button" class="btn btn-sm" onClick=${() => A.open({ type: 'ai', date, meal })}><${Icon} name="sparkles" size=${16} /> Describe it to Claude</button>` : null}
                      <button type="button" class="btn btn-sm" onClick=${() => A.open({ type: 'custom', prefill: { name: q.trim() } })}><${Icon} name="plus" size=${16} /> Create “${q.trim()}”</button>
                    </div>
                  </div>`
                : null}
            </div>`
          : html`<div>
              <${Seg} value=${tab} options=${[['suggested', 'Suggested'], ['recent', 'Recent'], ['favorites', 'Favorites'], ['mine', 'My foods']]} onChange=${setTab} label="Lists" />
              <${QuickLists} tab=${tab} meal=${meal} date=${date} setSel=${setSel} addItem=${addItem} />
            </div>`}
      </div>`;
    }
    return html`<${Sheet} title=${title} onClose=${onClose} tall wide onBack=${back} focus=${sel || quick || scanning || coarsePointer() ? null : '#food-q'}>${body}<//>`;
  }

  // A food with an amount this person used before: tap to adjust it, + to log it as is.
  function QuickRow({ x, onOpen, onAdd }) {
    const kcal = itemKcal(x);
    const amt = amountText(x.qty, x.unit);
    return html`<div class="frow">
      <button type="button" class="result" onClick=${onOpen}>
        <span class="nm">${x.name}</span>
        <span class="meta">${amt}${kcal != null ? ' · ' + U.fmt(kcal, 0) + ' kcal' : ''}</span>
      </button>
      <button type="button" class="iconbtn quiet" aria-label=${'Log ' + x.name + ', ' + amt} onClick=${onAdd}><${Icon} name="plus" /></button>
    </div>`;
  }

  function QuickLists({ tab, meal, date, setSel, addItem }) {
    const open = (x) => setSel({ ref: refOf(x), initial: { qty: x.qty, unit: x.unit, ug: x.ug } });
    if (tab === 'suggested') {
      const label = mealName(meal).toLowerCase();
      const day = S.days[date];
      const usual = ((day && day.entries) || []).some((e) => e.meal === meal) ? null : DV.calc.usualMeal(meal, date);
      const sug = DV.calc.suggestFoods(meal, date, { limit: 20 });
      if (!sug.length && !usual) return html`<p class="empty muted">Foods you log often show up here, ranked for each meal, ready to add again in one tap.</p>`;
      return html`<div class="results">
        ${usual
          ? html`<div class="usual">
              <div class="usual-t">
                <b>Your usual ${label}</b>
                <span class="muted small">${usual.items.map((x) => chipName(x.name)).join(', ')} · ${U.fmt(usual.items.reduce((a, x) => a + (itemKcal(x) || 0), 0), 0)} kcal</span>
              </div>
              <button type="button" class="btn btn-sm btn-primary" onClick=${() => logUsual(date, meal, usual)}><${Icon} name="plus" size=${16} /> Add all ${usual.items.length}</button>
            </div>`
          : null}
        ${sug.length ? html`<h4 class="rsec-h">Often at ${label}</h4>` : null}
        ${sug.map((x) => html`<${QuickRow} key=${x.key} x=${x} onOpen=${() => open(x)} onAdd=${() => addItem(itemOf(x), meal)} />`)}
      </div>`;
    }
    if (tab === 'recent') {
      const rec = DV.calc.recentFoods(40);
      if (!rec.length) return html`<p class="empty muted">Foods you log will show up here for one-tap logging.</p>`;
      return html`<div class="results">
        ${rec.map((r) => html`<${QuickRow} key=${r.key} x=${r} onOpen=${() => open(r)} onAdd=${() => addItem(itemOf(r), meal)} />`)}
      </div>`;
    }
    if (tab === 'favorites') {
      const favFoods = S.profile.favFoods || {};
      // Logged with the amount last used, or the food's usual serving.
      const used = new Map(DV.calc.recentFoods(400).map((r) => [r.key, r]));
      const favs = (S.profile.favorites || [])
        .map((k) => (k[0] === 'f' ? refOf({ fid: +k.slice(1), bf: favFoods[k] }) : { lid: k.slice(1) }))
        .map((ref) => ({ ref, info: resolveRef(ref) }))
        .filter((x) => x.info);
      if (!favs.length) return html`<p class="empty muted">${DB.status !== 'ready' && (S.profile.favorites || []).length ? 'Loading…' : 'Star a food on its details page to keep it here.'}</p>`;
      return html`<div class="results">
        ${favs.map(({ ref, info }) => {
          const r = used.get(info.key);
          const x = r || Object.assign({}, ref, { name: info.name, qty: 1, unit: info.def.label, ug: info.def.g, g: info.def.g });
          return html`<${QuickRow} key=${info.key} x=${x} onOpen=${() => (r ? open(r) : setSel({ ref }))} onAdd=${() => addItem(itemOf(x), meal)} />`;
        })}
      </div>`;
    }
    const items = Object.values(S.library)
      .filter((it) => !it.archived)
      .sort((a, b) => a.name.localeCompare(b.name));
    if (!items.length) return html`<p class="empty muted">Foods and recipes you create show up here.</p>`;
    return html`<div class="results">${items.map((it) => html`<${LibResult} key=${it.id} item=${it} onPick=${() => setSel({ ref: { lid: it.id } })} />`)}</div>`;
  }

  // Serving editor + Nutrition Facts for one food. Used for adding, editing and browsing.
  function FoodDetail({ refObj, initial, meal, setMeal, date, onSubmit, submitLabel, onDelete, extraActions }) {
    const info = resolveRef(refObj);
    const initUnit = initial ? { label: initial.unit, g: initial.ug } : null;
    const opts = unitOptions(info, initUnit);
    const [qty, setQty] = useState(initial ? String(initial.qty) : '1');
    const [unit, setUnit] = useState(initial ? initial.unit : null);
    const unitLabel = unit || (info && info.def && info.def.label) || 'g';
    const opt = opts.find((o) => o.label === unitLabel) || opts[0];
    const q = parseFloat(qty);
    const grams = q > 0 && opt ? q * opt.g : 0;
    const T = DV.calc.targetsFor(date || U.today());
    if (!info) {
      return html`<div class="pad">${refObj.fid != null && DB.status !== 'ready'
        ? html`<p class="muted"><${Spinner} /> Loading food data…</p>`
        : html`<p>This food is no longer available.</p>`}</div>`;
    }
    if (!info.per100) return html`<p class="muted pad"><${Spinner} /> Loading ingredient data…</p>`;
    const n = DV.calc.scale(info.per100, grams / 100);
    const fav = A.isFavorite(info.key);
    const serving = q > 0 ? amountText(q, opt.label) + (opt.label === 'g' ? '' : ' (' + U.fmt(grams, 0) + 'g)') : '—';
    const submit = (e) => {
      e && e.preventDefault();
      if (!(grams > 0)) return;
      onSubmit(Object.assign({}, refObj, { name: info.name, qty: q, unit: opt.label, ug: opt.g, g: Math.round(grams * 10) / 10 }), meal);
    };
    return html`<form class="detail" onSubmit=${submit}>
      <div class="detail-head">
        <h3 class="detail-name">${info.name}</h3>
        <p class="detail-src"><span class="src">${info.src}</span>${info.group ? ' · ' + info.group : ''}</p>
        ${info.food && info.food.branded
          ? html`<p class="detail-note">Values from the package label${info.food.upc ? ' · barcode ' + BR.fmtBarcode(info.food.upc) : ''}. Vitamins and minerals count only where the label lists them.</p>`
          : null}
      </div>
      <div class="detail-grid">
        <div class="detail-form">
          ${setMeal ? html`<div class="field"><span class="lbl">Meal</span><${MealPicker} meal=${meal} setMeal=${setMeal} /></div>` : null}
          <div class="amount-row">
            <label class="field amt"><span class="lbl">Amount</span>
              <input id="amt-qty" class="input num" type="number" inputmode="decimal" min="0" step="any" value=${qty} onInput=${(e) => setQty(e.target.value)} />
            </label>
            <label class="field unit"><span class="lbl">Unit</span>
              <select id="amt-unit" class="input" value=${opt.label} onChange=${(e) => {
                const next = opts.find((o) => o.label === e.target.value);
                // Keep the same weight when switching to grams or ounces.
                if (next && (next.label === 'g' || next.label === 'oz') && grams > 0) setQty(String(Math.round((grams / next.g) * 10) / 10));
                else if (next && (opt.label === 'g' || opt.label === 'oz')) setQty('1');
                setUnit(e.target.value);
              }}>
                ${opts.map((o) => html`<option key=${o.label} value=${o.label}>${o.label === 'g' || o.label === 'oz' ? o.label : o.label + ' (' + U.fmt(o.g, o.g < 10 ? 1 : 0) + ' g)'}</option>`)}
              </select>
            </label>
          </div>
          <div class="quick-amts">
            ${[0.5, 1, 1.5, 2].map((v) => html`<button type="button" key=${v} class=${'chip' + (q === v ? ' on' : '')} onClick=${() => setQty(String(v))}>${U.fmtQty(v)}</button>`)}
          </div>
          <div class="detail-macros">
            ${MACROS.slice(0, 3).map((m) => html`<div key=${m.key}><i class="sw" style=${'background:' + m.color}></i><span>${m.label}</span><b>${U.fmt(n[m.key] || 0, 1)} g</b></div>`)}
          </div>
          <div class="detail-actions">
            <button type="submit" class="btn btn-primary btn-grow" disabled=${!(grams > 0)}>${submitLabel}</button>
            <button type="button" class=${'btn fav' + (fav ? ' on' : '')} aria-pressed=${fav ? 'true' : 'false'} onClick=${() => A.toggleFavorite(info.key, refObj.bf)} title=${fav ? 'Remove from favorites' : 'Add to favorites'}>
              <${Icon} name="star" size=${18} fill=${fav} /><span class="sr">Favorite</span>
            </button>
            ${onDelete ? html`<button type="button" class="btn btn-danger" onClick=${onDelete}><${Icon} name="trash" size=${18} /><span class="sr">Delete</span></button>` : null}
          </div>
          ${extraActions || null}
        </div>
        <${NutritionLabel} n=${n} serving=${serving} T=${T} />
      </div>
    </form>`;
  }

  function QuickAdd({ meal, setMeal, onSubmit, initial, submitLabel = 'Add' }) {
    const [v, setV] = useState(initial || { name: '', kcal: '', prot: '', carbs: '', fat: '' });
    const set = (k) => (e) => setV(Object.assign({}, v, { [k]: e.target.value }));
    const fromMacros = (+v.prot || 0) * 4 + (+v.carbs || 0) * 4 + (+v.fat || 0) * 9;
    const kcal = +v.kcal > 0 ? +v.kcal : fromMacros;
    const submit = (e) => {
      e.preventDefault();
      if (!(kcal > 0)) return;
      onSubmit(Object.assign({}, v, { kcal }), meal);
    };
    return html`<form class="stack" onSubmit=${submit}>
      ${setMeal ? html`<div class="field"><span class="lbl">Meal</span><${MealPicker} meal=${meal} setMeal=${setMeal} /></div>` : null}
      <label class="field"><span class="lbl">Description (optional)</span><input id="qa-name" class="input" value=${v.name} onInput=${set('name')} placeholder="Coffee shop muffin" /></label>
      <div class="grid4">
        <label class="field"><span class="lbl">Calories</span><input id="qa-kcal" class="input num" type="number" inputmode="decimal" min="0" value=${v.kcal} onInput=${set('kcal')} placeholder=${fromMacros ? String(Math.round(fromMacros)) : '0'} /></label>
        <label class="field"><span class="lbl">Protein (g)</span><input id="qa-p" class="input num" type="number" inputmode="decimal" min="0" value=${v.prot} onInput=${set('prot')} /></label>
        <label class="field"><span class="lbl">Carbs (g)</span><input id="qa-c" class="input num" type="number" inputmode="decimal" min="0" value=${v.carbs} onInput=${set('carbs')} /></label>
        <label class="field"><span class="lbl">Fat (g)</span><input id="qa-f" class="input num" type="number" inputmode="decimal" min="0" value=${v.fat} onInput=${set('fat')} /></label>
      </div>
      <p class="muted small">Quick adds count toward calories and macros only. Log real foods to track vitamins and minerals.</p>
      <button type="submit" class="btn btn-primary" disabled=${!(kcal > 0)}>${submitLabel}${kcal > 0 ? ' · ' + U.fmt(kcal, 0) + ' kcal' : ''}</button>
    </form>`;
  }

  // Edit a logged entry
  function EntrySheet({ date, id, onClose }) {
    const day = S.days[date];
    const e = day && (day.entries || []).find((x) => x.id === id);
    const [meal, setMeal] = useState(e ? e.meal : 'snacks');
    if (!e) {
      return html`<${Sheet} title="Entry" onClose=${onClose}><p>This entry was removed.</p><//>`;
    }
    const del = () => {
      A.removeEntry(date, id);
      onClose();
    };
    if (e.quick) {
      return html`<${Sheet} title="Edit quick add" onClose=${onClose}>
        <${QuickAdd} meal=${meal} setMeal=${setMeal} initial=${{ name: e.name === 'Quick add' ? '' : e.name, kcal: String(e.s.kcal || ''), prot: String(e.s.prot || ''), carbs: String(e.s.carbs || ''), fat: String(e.s.fat || '') }} submitLabel="Save"
          onSubmit=${(v, m) => {
            A.updateEntry(date, id, { meal: m, name: v.name || 'Quick add', s: { kcal: +v.kcal || 0, prot: +v.prot || 0, carbs: +v.carbs || 0, fat: +v.fat || 0 } });
            onClose();
          }} />
        <button type="button" class="btn btn-danger btn-block top16" onClick=${del}><${Icon} name="trash" size=${16} /> Delete</button>
      <//>`;
    }
    const ref = refOf(e);
    return html`<${Sheet} title="Edit entry" onClose=${onClose} wide tall>
      <${FoodDetail} refObj=${ref} initial=${{ qty: e.qty, unit: e.unit, ug: e.ug }} meal=${meal} setMeal=${setMeal} date=${date} submitLabel="Save changes"
        onSubmit=${(item, m) => {
          A.updateEntry(date, id, { meal: m, qty: item.qty, unit: item.unit, ug: item.ug, g: item.g });
          A.toast('Saved');
          onClose();
        }} onDelete=${del} />
    <//>`;
  }

  // ---------------------------------------------------------------------------
  // Exercise
  function ExerciseSheet({ date, onClose }) {
    const [q, setQ] = useState('');
    const [sel, setSel] = useState(null);
    const [min, setMin] = useState('30');
    const [custom, setCustom] = useState({ name: '', kcal: '' });
    const kg = DV.calc.weightOn(date);
    const list = C.EXERCISES.filter((x) => x.label.toLowerCase().includes(q.trim().toLowerCase()));
    const kcal = sel ? C.exerciseKcal(sel.met, +min || 0, kg) : 0;
    const add = (ex) => {
      A.addExercise(date, ex);
      A.toast('Added ' + ex.name.split(',')[0].toLowerCase() + ', ' + U.fmt(ex.kcal, 0) + ' kcal');
      onClose();
    };
    return html`<${Sheet} title="Add exercise" onClose=${onClose} tall onBack=${sel ? () => setSel(null) : null} focus=${sel ? '#ex-min' : '#ex-q'}>
      ${sel
        ? html`<form class="stack" onSubmit=${(e) => {
            e.preventDefault();
            if (+min > 0) add({ name: sel.label, met: sel.met, min: +min, kcal });
          }}>
            <h3 class="detail-name">${sel.label}</h3>
            <label class="field"><span class="lbl">Minutes</span><input id="ex-min" class="input num" type="number" inputmode="numeric" min="1" value=${min} onInput=${(e) => setMin(e.target.value)} /></label>
            <div class="chips">${[15, 20, 30, 45, 60, 90].map((m) => html`<button type="button" key=${m} class=${'chip' + (+min === m ? ' on' : '')} onClick=${() => setMin(String(m))}>${m} min</button>`)}</div>
            <p class="big-stat"><b>${U.fmt(kcal, 0)}</b> active kcal</p>
            <p class="muted small">Estimated from ${sel.met} METs at ${U.fmtWeight(kg, units())}. Resting calories are already in your budget, so this counts only the extra burn.</p>
            <button type="submit" class="btn btn-primary" disabled=${!(+min > 0)}>Add exercise</button>
          </form>`
        : html`<div class="stack">
            <div class="searchbox"><${Icon} name="search" size=${18} /><input id="ex-q" class="input" type="search" placeholder="Find an activity" aria-label="Find an activity" value=${q} onInput=${(e) => setQ(e.target.value)} /></div>
            <div class="results">
              ${list.map((x) => html`<button type="button" class="result" key=${x.id} onClick=${() => setSel(x)}><span class="nm">${x.label}</span><span class="meta">${U.fmt(C.exerciseKcal(x.met, 30, kg), 0)} kcal per 30 min</span></button>`)}
            </div>
            <details class="custom-ex">
              <summary>Enter calories from a watch or machine</summary>
              <form class="grid2" onSubmit=${(e) => {
                e.preventDefault();
                if (+custom.kcal > 0) add({ name: custom.name || 'Workout', kcal: +custom.kcal });
              }}>
                <label class="field"><span class="lbl">Activity</span><input id="ex-cname" class="input" value=${custom.name} onInput=${(e) => setCustom(Object.assign({}, custom, { name: e.target.value }))} placeholder="Spin class" /></label>
                <label class="field"><span class="lbl">Active kcal</span><input id="ex-ckcal" class="input num" type="number" inputmode="numeric" min="0" value=${custom.kcal} onInput=${(e) => setCustom(Object.assign({}, custom, { kcal: e.target.value }))} /></label>
                <button type="submit" class="btn btn-primary span2" disabled=${!(+custom.kcal > 0)}>Add</button>
              </form>
            </details>
          </div>`}
    <//>`;
  }

  // ---------------------------------------------------------------------------
  // Describe / photograph a meal (Claude)
  function AiLogSheet({ date, meal: meal0, onClose }) {
    const [meal, setMeal] = useState(meal0 || U.mealForNow());
    const [text, setText] = useState('');
    const [photo, setPhoto] = useState(null);
    const [preview, setPreview] = useState('');
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState('');
    const [items, setItems] = useState(null);
    const ctl = useRef(null);
    useEffect(() => () => ctl.current && ctl.current.abort(), []);
    useEffect(() => {
      if (!photo) return setPreview('');
      const url = URL.createObjectURL(photo);
      setPreview(url);
      return () => URL.revokeObjectURL(url);
    }, [photo]);
    const run = async () => {
      if (!text.trim() && !photo) return;
      setBusy(true);
      setErr('');
      ctl.current = new AbortController();
      try {
        if (DB.status !== 'ready') await DB.load();
        const parsed = await AI.parseMeal({ text: text.trim(), image: photo, signal: ctl.current.signal });
        // Named brands ("Kirkland protein bar") are matched against brand-name products first.
        if (parsed.some((it) => it.brand)) await BR.load();
        const matched = await Promise.all(
          parsed.map(async (it, i) => {
            let branded = [];
            if (it.brand && BR.status === 'ready') {
              let rows = BR.search(it.brand + ' ' + it.query, { limit: 3 }).rows;
              if (!rows.length) rows = BR.search(it.brand + ' ' + it.label, { limit: 3 }).rows;
              branded = (await Promise.all(rows.map((r) => BR.record(r.line).catch(() => null)))).filter(Boolean);
            }
            const res = DB.search(it.query, { limit: 6 });
            const alt = res.length ? res : DB.search(it.label, { limit: 6 });
            const cands = branded.concat(alt.map((r) => r.food));
            return { i, it, cands, pick: cands.length ? cands[0].id : null, grams: String(Math.round(it.grams)), on: cands.length > 0 };
          })
        );
        setItems(matched);
        if (!matched.length) setErr('Claude didn’t find any food or drink in that. Try adding more detail.');
      } catch (e) {
        const msg = AI.message(e);
        if (msg) setErr(msg);
      } finally {
        setBusy(false);
      }
    };
    const update = (i, patch) => setItems(items.map((x) => (x.i === i ? Object.assign({}, x, patch) : x)));
    const chosen = (items || []).filter((x) => x.on && x.pick != null && +x.grams > 0);
    const picked = (x) => x.cands.find((c) => c.id === +x.pick) || null;
    const addAll = () => {
      chosen.forEach((x) => {
        const f = picked(x);
        if (!f) return;
        const g = +x.grams;
        const label = x.it.amount && x.it.amount.length < 40 ? x.it.amount : U.fmt(g, 0) + ' g';
        A.addEntry(date, meal, Object.assign(refOf({ fid: f.id, bf: f.bf }), { name: f.name, qty: 1, unit: label, ug: g, g }));
      });
      A.toast('Added ' + chosen.length + (chosen.length === 1 ? ' food' : ' foods') + ' to ' + mealName(meal).toLowerCase());
      onClose();
    };
    const totalKcal = chosen.reduce((a, x) => {
      const f = picked(x);
      return a + (f ? ((DB.nutrients(f).kcal || 0) * +x.grams) / 100 : 0);
    }, 0);
    return html`<${Sheet} title="Describe a meal" onClose=${onClose} tall wide focus=${items ? null : '#ai-text'}
      footer=${items && items.length
        ? html`<button type="button" class="btn" onClick=${() => setItems(null)}>Start over</button>
          <button type="button" class="btn btn-primary" disabled=${!chosen.length} onClick=${addAll}>Add ${chosen.length} to ${mealName(meal).toLowerCase()} · ${U.fmt(totalKcal, 0)} kcal</button>`
        : null}>
      <div class="stack">
        <div class="field"><span class="lbl">Meal</span><${MealPicker} meal=${meal} setMeal=${setMeal} /></div>
        ${!items
          ? html`<label class="field"><span class="lbl">What did you eat or drink?</span>
              <textarea id="ai-text" class="input" rows="4" value=${text} onInput=${(e) => setText(e.target.value)} placeholder="Two scrambled eggs, a slice of whole wheat toast with butter, and a small latte" disabled=${busy}></textarea>
            </label>
            ${AI.images
              ? html`<div class="photo-row">
                  <label class="btn btn-sm">
                    <${Icon} name="camera" size=${16} /> ${photo ? 'Change photo' : 'Add a photo'}
                    <input class="sr" type="file" accept=${AI.imageTypes.length ? AI.imageTypes.join(',') : 'image/*'} onChange=${(e) => setPhoto(e.target.files && e.target.files[0] ? e.target.files[0] : null)} />
                  </label>
                  ${preview ? html`<img class="thumb" src=${preview} alt="Meal photo to analyze" /><button type="button" class="linkbtn" onClick=${() => setPhoto(null)}>Remove</button>` : html`<span class="muted small">Claude can estimate portions from a photo.</span>`}
                </div>`
              : null}
            <div class="row gap8">
              <button type="button" class="btn btn-primary" disabled=${busy || (!text.trim() && !photo)} onClick=${run}>${busy ? html`<${Spinner} /> Thinking…` : html`<${Icon} name="sparkles" size=${16} /> Find foods`}</button>
              ${busy ? html`<button type="button" class="btn" onClick=${() => ctl.current && ctl.current.abort()}><${Icon} name="stop" size=${14} /> Stop</button>` : null}
            </div>
            <p class="muted small">Claude splits the meal into foods and estimates amounts. Name brands (“Kirkland protein bar”) to match packaged products. You check each match before anything is logged. This uses your Claude usage.</p>`
          : html`<div class="ai-items">
              ${items.map((x) => {
                const f = x.pick != null ? picked(x) : null;
                const kcal = f ? ((DB.nutrients(f).kcal || 0) * (+x.grams || 0)) / 100 : null;
                return html`<div class=${'ai-item' + (x.on ? '' : ' off')} key=${x.i}>
                  <label class="ai-check"><input type="checkbox" checked=${x.on} disabled=${!x.cands.length} onChange=${(e) => update(x.i, { on: e.target.checked })} /><span class="sr">Include ${x.it.label}</span></label>
                  <div class="ai-main">
                    <div class="ai-title"><b>${x.it.label}</b> <span class="muted">${x.it.amount}</span></div>
                    ${x.cands.length
                      ? html`<select class="input" aria-label=${'Database match for ' + x.it.label} value=${String(x.pick)} onChange=${(e) => update(x.i, { pick: +e.target.value })}>
                          ${x.cands.map((c) => html`<option key=${c.id} value=${String(c.id)}>${c.name}</option>`)}
                        </select>`
                      : html`<p class="muted small">No match in the database. Search for it with Log food instead.</p>`}
                  </div>
                  <label class="ai-grams"><input class="input num" type="number" inputmode="decimal" min="0" value=${x.grams} aria-label=${'Grams of ' + x.it.label} onInput=${(e) => update(x.i, { grams: e.target.value })} /><span>g</span></label>
                  <span class="ai-kcal">${kcal != null ? U.fmt(kcal, 0) + ' kcal' : ''}</span>
                </div>`;
              })}
            </div>`}
        ${err ? html`<p class="error" role="alert"><${Icon} name="alert" size=${16} /> ${err}</p>` : null}
      </div>
    <//>`;
  }

  // AI day review
  function ReviewSheet({ date, onClose }) {
    const [text, setText] = useState('');
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState('');
    const ctl = useRef(null);
    const go = async () => {
      setBusy(true);
      setErr('');
      setText('');
      ctl.current = new AbortController();
      try {
        const r = await AI.reviewDay({ date, signal: ctl.current.signal, onText: ({ text }) => setText(text) });
        setText(r.text);
      } catch (e) {
        if (e && e.text) setText(e.text);
        const msg = AI.message(e);
        if (msg) setErr(msg);
      } finally {
        setBusy(false);
      }
    };
    useEffect(() => {
      go();
      return () => ctl.current && ctl.current.abort();
    }, []);
    return html`<${Sheet} title=${'Review of ' + (date === U.today() ? 'today' : U.fmtDay(date, 'short'))} onClose=${onClose}
      footer=${busy
        ? html`<button type="button" class="btn" onClick=${() => ctl.current && ctl.current.abort()}><${Icon} name="stop" size=${14} /> Stop</button>`
        : html`<button type="button" class="btn" onClick=${go}><${Icon} name="sparkles" size=${16} /> Ask again</button>`}>
      ${!text && busy ? html`<p class="muted"><${Spinner} /> Thinking…</p>` : null}
      ${text ? html`<div class="review">${text.split('\n').filter((l) => l.trim()).map((l, i) => (/^\s*[-•]/.test(l) ? html`<p class="bullet" key=${i}>${l.replace(/^\s*[-•]\s*/, '')}</p>` : html`<p key=${i}>${l}</p>`))}</div>` : null}
      ${err ? html`<p class="error" role="alert"><${Icon} name="alert" size=${16} /> ${err}</p>` : null}
      <p class="muted small top16">Written by Claude from your logged foods and targets. It isn’t medical advice.</p>
    <//>`;
  }

  // ---------------------------------------------------------------------------
  // Custom foods
  const LABEL_FIELDS = [
    ['kcal', 'Calories', ''],
    ['fat', 'Total fat', 'g'],
    ['sat', 'Saturated fat', 'g'],
    ['trans', 'Trans fat', 'g'],
    ['chol', 'Cholesterol', 'mg'],
    ['na', 'Sodium', 'mg'],
    ['carbs', 'Total carbohydrate', 'g'],
    ['fiber', 'Dietary fiber', 'g'],
    ['sugars', 'Total sugars', 'g'],
    ['prot', 'Protein', 'g'],
    ['vitD', 'Vitamin D', 'µg'],
    ['ca', 'Calcium', 'mg'],
    ['fe', 'Iron', 'mg'],
    ['k', 'Potassium', 'mg'],
  ];
  const MORE_FIELDS = ['vitA', 'vitC', 'vitE', 'vitK', 'b1', 'b2', 'b3', 'b5', 'b6', 'folate', 'b12', 'choline', 'mg', 'zn', 'p', 'se', 'cu', 'mn', 'o3', 'o6', 'mono', 'poly', 'caffeine', 'alcohol'];

  function CustomFoodSheet({ lid, prefill, onClose }) {
    const existing = lid ? S.library[lid] : null;
    const init = () => {
      if (existing) {
        const sg = (existing.portions && existing.portions[0] && existing.portions[0].g) || 100;
        const v = {};
        Object.keys(existing.per100 || {}).forEach((k) => {
          if (existing.per100[k] != null) v[k] = String(Math.round(((existing.per100[k] * sg) / 100) * 100) / 100);
        });
        return { name: existing.name, brand: existing.brand || '', upc: existing.upc || '', servLabel: (existing.portions && existing.portions[0] && existing.portions[0].label) || '1 serving', servG: String(sg), v };
      }
      return { name: (prefill && prefill.name) || '', brand: '', upc: (prefill && prefill.upc) || '', servLabel: '1 serving', servG: '', v: {} };
    };
    const [f, setF] = useState(init);
    const [more, setMore] = useState(false);
    const [scan, setScan] = useState({ busy: false, err: '' });
    const ctl = useRef(null);
    useEffect(() => () => ctl.current && ctl.current.abort(), []);
    const upd = (patch) => setF((prev) => Object.assign({}, prev, patch));
    const setV = (k, val) => setF((prev) => Object.assign({}, prev, { v: Object.assign({}, prev.v, { [k]: val }) }));
    const sg = parseFloat(f.servG);
    const valid = f.name.trim() && sg > 0 && f.v.kcal !== undefined && f.v.kcal !== '';
    const doScan = async (file) => {
      if (!file) return;
      setScan({ busy: true, err: '' });
      ctl.current = new AbortController();
      try {
        const r = await AI.readLabel({ image: file, signal: ctl.current.signal });
        const v = {};
        Object.keys(r.values).forEach((k) => (v[k] = String(r.values[k])));
        setF({ name: f.name || r.name, brand: f.brand, upc: f.upc, servLabel: r.servingText ? '1 serving (' + r.servingText + ')' : f.servLabel, servG: r.servingG ? String(r.servingG) : f.servG, v: Object.assign({}, f.v, v) });
        setScan({ busy: false, err: '' });
        A.toast('Label read. Check the numbers before saving.');
      } catch (e) {
        setScan({ busy: false, err: e && e.code === 'refused' ? 'That photo doesn’t look like a Nutrition Facts label. Try a sharper, straight-on shot.' : AI.message(e) });
      }
    };
    const save = (e) => {
      e.preventDefault();
      if (!valid) return;
      const per100 = {};
      C.TRACKED.forEach((k) => (per100[k] = null));
      Object.keys(f.v).forEach((k) => {
        const x = parseFloat(f.v[k]);
        if (!Number.isNaN(x) && f.v[k] !== '') per100[k] = (x * 100) / sg;
      });
      ['kcal', 'prot', 'fat', 'carbs'].forEach((k) => per100[k] == null && (per100[k] = 0));
      if (per100.carbs != null) per100.netcarbs = Math.max(0, per100.carbs - (per100.fiber || 0));
      const upc = String(f.upc || '').replace(/\D/g, '');
      const item = A.saveLibraryItem({ id: existing ? existing.id : undefined, type: 'food', name: f.name.trim(), brand: f.brand.trim(), upc: upc.length >= 6 ? upc : null, per100, portions: [{ label: f.servLabel.trim() || '1 serving', g: sg }] });
      A.toast((existing ? 'Saved ' : 'Created ') + item.name);
      onClose();
    };
    const input = (k, label, unit) => html`<label class="field lf" key=${k}>
      <span class="lbl">${label}${unit ? ' (' + unit + ')' : ''}</span>
      <input id=${'cf-' + k} class="input num" type="number" inputmode="decimal" min="0" step="any" value=${f.v[k] || ''} onInput=${(e) => setV(k, e.target.value)} />
    </label>`;
    return html`<${Sheet} title=${existing ? 'Edit food' : 'New food'} onClose=${onClose} wide tall
      footer=${html`${existing
          ? html`<button type="button" class="btn btn-danger" onClick=${() => {
              A.deleteLibraryItem(existing.id);
              A.toast('Deleted ' + existing.name);
              onClose();
            }}><${Icon} name="trash" size=${16} /> Delete</button>`
          : null}
        <button type="submit" form="cf-form" class="btn btn-primary" disabled=${!valid}>${existing ? 'Save food' : 'Create food'}</button>`}>
      <form id="cf-form" class="stack" onSubmit=${save}>
        ${AI.available && AI.images
          ? html`<div class="scan">
              <label class="btn">
                ${scan.busy ? html`<${Spinner} /> Reading label…` : html`<${Icon} name="camera" size=${16} /> Fill from a label photo`}
                <input class="sr" type="file" accept=${AI.imageTypes.length ? AI.imageTypes.join(',') : 'image/*'} disabled=${scan.busy} onChange=${(e) => doScan(e.target.files && e.target.files[0])} />
              </label>
              <span class="muted small">Claude reads the Nutrition Facts panel for you.</span>
              ${scan.err ? html`<p class="error" role="alert">${scan.err}</p>` : null}
            </div>`
          : null}
        <div class="grid2">
          <label class="field span2"><span class="lbl">Name</span><input id="cf-name" class="input" required value=${f.name} onInput=${(e) => upd({ name: e.target.value })} placeholder="Protein bar, chocolate peanut" /></label>
          <label class="field"><span class="lbl">Brand (optional)</span><input id="cf-brand" class="input" value=${f.brand} onInput=${(e) => upd({ brand: e.target.value })} /></label>
          <label class="field"><span class="lbl">Barcode (optional)</span><input id="cf-upc" class="input num" type="text" inputmode="numeric" autocomplete="off" value=${f.upc} onInput=${(e) => upd({ upc: e.target.value.replace(/[^\d]/g, '') })} placeholder="Scanning it finds this food" /></label>
          <label class="field"><span class="lbl">Serving name</span><input id="cf-serv" class="input" value=${f.servLabel} onInput=${(e) => upd({ servLabel: e.target.value })} placeholder="1 bar" /></label>
          <label class="field"><span class="lbl">Serving weight (g)</span><input id="cf-servg" class="input num" type="number" inputmode="decimal" min="0" step="any" required value=${f.servG} onInput=${(e) => upd({ servG: e.target.value })} placeholder="40" /></label>
        </div>
        <h3 class="sec-h">Per serving</h3>
        <div class="grid3">${LABEL_FIELDS.map(([k, label, unit]) => input(k, label, unit))}</div>
        <button type="button" class="linkbtn" onClick=${() => setMore(!more)}>${more ? 'Hide other nutrients' : 'Add other vitamins and minerals'}</button>
        ${more ? html`<div class="grid3">${MORE_FIELDS.map((k) => input(k, C.NUTRIENTS[k].label, C.NUTRIENTS[k].unit))}</div>` : null}
      </form>
    <//>`;
  }

  // ---------------------------------------------------------------------------
  // Recipes
  function RecipeSheet({ lid, onClose }) {
    const existing = lid ? S.library[lid] : null;
    const [name, setName] = useState(existing ? existing.name : '');
    const [servings, setServings] = useState(existing ? String(existing.servings || 1) : '4');
    const [yieldG, setYieldG] = useState(existing && existing.yieldG ? String(existing.yieldG) : '');
    const [ings, setIngs] = useState(existing ? existing.ingredients || [] : []);
    const [picking, setPicking] = useState(false);
    const draft = { type: 'recipe', name, servings: +servings || 1, yieldG: +yieldG || 0, ingredients: ings };
    const totalG = ings.reduce((a, i) => a + (i.g || 0), 0);
    const finalG = +yieldG > 0 ? +yieldG : totalG;
    const sum = {};
    C.TRACKED.forEach((k) => (sum[k] = 0));
    let loading = false;
    ings.forEach((ing) => {
      const per = DV.calc.refPer100(ing);
      if (!per) {
        loading = true;
        return;
      }
      C.TRACKED.forEach((k) => (sum[k] += per[k] == null ? 0 : (per[k] * ing.g) / 100));
    });
    const perServing = {};
    C.TRACKED.forEach((k) => (perServing[k] = sum[k] / (+servings || 1)));
    const valid = name.trim() && ings.length && +servings > 0;
    const save = () => {
      const item = A.saveLibraryItem(Object.assign({ id: existing ? existing.id : undefined }, draft, { name: name.trim() }));
      A.toast((existing ? 'Saved ' : 'Created ') + item.name);
      onClose();
    };
    if (picking) {
      return html`<${Sheet} title="Add ingredient" onClose=${onClose} tall wide onBack=${() => setPicking(false)} focus="#food-q">
        <${FoodPicker} onPick=${(item) => {
          setIngs(ings.concat(item));
          setPicking(false);
        }} />
      <//>`;
    }
    return html`<${Sheet} title=${existing ? 'Edit recipe' : 'New recipe'} onClose=${onClose} wide tall
      footer=${html`${existing
          ? html`<button type="button" class="btn btn-danger" onClick=${() => {
              A.deleteLibraryItem(existing.id);
              A.toast('Deleted ' + existing.name);
              onClose();
            }}><${Icon} name="trash" size=${16} /> Delete</button>`
          : null}
        <button type="button" class="btn btn-primary" disabled=${!valid} onClick=${save}>${existing ? 'Save recipe' : 'Create recipe'}</button>`}>
      <div class="detail-grid">
        <div class="stack">
          <label class="field"><span class="lbl">Recipe name</span><input id="rc-name" class="input" value=${name} onInput=${(e) => setName(e.target.value)} placeholder="Turkey chili" /></label>
          <div class="grid2">
            <label class="field"><span class="lbl">Servings</span><input id="rc-serv" class="input num" type="number" inputmode="decimal" min="1" step="any" value=${servings} onInput=${(e) => setServings(e.target.value)} /></label>
            <label class="field"><span class="lbl">Cooked weight (g, optional)</span><input id="rc-yield" class="input num" type="number" inputmode="decimal" min="0" step="any" value=${yieldG} onInput=${(e) => setYieldG(e.target.value)} placeholder=${totalG ? U.fmt(totalG, 0) : ''} /></label>
          </div>
          <h3 class="sec-h">Ingredients</h3>
          ${ings.length
            ? html`<ul class="inglist">${ings.map(
                (ing, i) => html`<li key=${i}>
                  <span class="nm">${ing.name}</span>
                  <span class="meta">${amountText(ing.qty, ing.unit)} · ${U.fmt(ing.g, 0)} g</span>
                  <button type="button" class="iconbtn quiet sm" aria-label=${'Remove ' + ing.name} onClick=${() => setIngs(ings.filter((_, j) => j !== i))}><${Icon} name="x" size=${16} /></button>
                </li>`
              )}</ul>`
            : html`<p class="muted small">Add each ingredient with the amount used for the whole recipe.</p>`}
          <button type="button" class="btn" onClick=${() => setPicking(true)}><${Icon} name="plus" size=${16} /> Add ingredient</button>
          <p class="muted small">${finalG ? 'One serving is about ' + U.fmt(finalG / (+servings || 1), 0) + ' g.' : ''} If the dish loses water while cooking, enter the cooked weight so servings weigh the right amount.</p>
        </div>
        ${ings.length ? (loading ? html`<p class="muted"><${Spinner} /> Loading ingredient data…</p>` : html`<${NutritionLabel} n=${perServing} serving=${'1 of ' + (+servings || 1) + ' servings'} T=${DV.calc.targetsFor(U.today())} />`) : null}
      </div>
    <//>`;
  }

  // Search the database (and the person's own foods) and choose an amount. Used for recipe ingredients.
  function FoodPicker({ onPick }) {
    const [q, setQ] = useState('');
    const dq = useDebounced(q, 110);
    const [sel, setSel] = useState(null);
    const results = useMemo(() => (dq.trim().length >= 2 && DB.status === 'ready' ? DB.search(dq, { limit: 40 }) : []), [dq, DB.status]);
    const lib = useMemo(() => (dq.trim().length >= 2 ? libraryMatches(dq).filter((it) => it.type === 'food') : []), [dq]);
    const brands = useBrandSearch(dq, 30);
    const [pending, pickBrand] = useBrandPick(setSel);
    if (sel) {
      return html`<${FoodDetail} refObj=${sel} submitLabel="Add ingredient" onSubmit=${(item) => onPick(item)}
        extraActions=${html`<button type="button" class="linkbtn top8" onClick=${() => setSel(null)}>Choose a different food</button>`} />`;
    }
    return html`<div class="stack">
      <div class="searchbox"><${Icon} name="search" size=${18} /><input id="food-q" class="input" type="search" placeholder="Search ingredients or brands" aria-label="Search ingredients or brands" value=${q} onInput=${(e) => setQ(e.target.value)} /></div>
      <div class="results">
        ${lib.map((it) => html`<${LibResult} key=${it.id} item=${it} onPick=${() => setSel({ lid: it.id })} />`)}
        ${brands.brandHit ? html`<${BrandSection} dq=${dq} res=${brands} pending=${pending} onPick=${pickBrand} />` : null}
        ${results.length ? html`<h4 class="rsec-h">Everyday foods <span class="rsec-n">USDA</span></h4>` : null}
        ${results.map((r) => html`<${DbResult} key=${r.food.id} food=${r.food} onPick=${() => setSel({ fid: r.food.id })} />`)}
        ${DB.status === 'loading' ? html`<p class="muted pad"><${Spinner} /> Loading the food database…</p>` : null}
        ${!brands.brandHit ? html`<${BrandSection} dq=${dq} res=${brands} pending=${pending} onPick=${pickBrand} />` : null}
      </div>
    </div>`;
  }

  // ---------------------------------------------------------------------------
  // Nutrient detail
  // A target in plain words: "At least 90 mg · upper limit 2,000 mg", "At most 2,300 mg", "Between 50 g and 80 g".
  function goalText(k, t) {
    if (!t) return 'No goal';
    const f = (v) => U.fmtNutrient(k, v);
    if (t.kind === 'goal') return 'Aim for ' + f(t.goal) + (t.max != null ? ' · limit ' + f(t.max) : '');
    if (t.kind === 'max') return 'At most ' + f(t.max);
    if (t.range) return 'Between ' + f(t.min) + ' and ' + f(t.max);
    return 'At least ' + f(t.min) + (t.max != null ? ' · upper limit ' + f(t.max) : '');
  }
  function targetText(k, t) {
    if (!t) return 'No daily target';
    if (t.custom) return 'Your goal: ' + goalText(k, t).replace(/^./, (c) => c.toLowerCase());
    const f = (v) => U.fmtNutrient(k, v);
    if (t.kind === 'goal') return 'Goal ' + f(t.goal);
    if (t.kind === 'max') return 'Limit ' + f(t.max);
    return (C.AI_KEYS.has(k) ? 'Adequate intake ' : 'Target ') + f(t.min) + (t.max != null ? ' · upper limit ' + f(t.max) : '');
  }
  function targetBasis(k, t) {
    if (!t) return '';
    if (t.custom) return 'You set this goal' + (t.unit === 'pct' ? ' as a share of your calories' : t.unit === 'perkg' ? ' by body weight' : '') + '.' + (t.kind === 'min' && t.max != null && !t.range ? ' The upper limit is the safety limit for your age and sex.' : '');
    if (['kcal', 'prot', 'carbs', 'fat'].includes(k)) return 'From your energy needs and macro plan in Profile.';
    if (['his', 'ile', 'leu', 'lys', 'metcys', 'phetyr', 'thr', 'trp', 'val'].includes(k)) return 'Scaled to your body weight (Institute of Medicine, 2005).';
    if (k === 'fiber') return '14 g per 1,000 kcal of your calorie goal (Dietary Reference Intakes).';
    if (k === 'sat') return 'Under 10% of calories (Dietary Guidelines for Americans).';
    if (k === 'na') return 'Adequate intake 1,500 mg; limit 2,300 mg to lower chronic disease risk (National Academies, 2019).';
    if (['chol', 'caffeine', 'alcohol'].includes(k)) return 'A common guideline limit, not a formal DRI.';
    return 'Dietary Reference Intakes for your age and sex (National Academies).' + (t.max != null ? ' The upper limit is the most you can take daily without risk of harm.' : '');
  }

  function NutrientSheet({ nkey, date, onClose }) {
    const k = nkey;
    const n = C.NUTRIENTS[k];
    const day = S.days[date] || { entries: [] };
    const tot = DV.calc.dayTotals(day);
    const T = DV.calc.targetsFor(date);
    const t = T[k];
    const v = tot.n[k];
    const st = C.status(v, t);
    const contrib = (day.entries || [])
      .map((e) => ({ e, v: (tot.entries.get(e.id) || {})[k] }))
      .filter((x) => x.v > 0)
      .sort((a, b) => b.v - a.v);
    const top = DB.status === 'ready' ? DB.topSources(k, 12) : [];
    const tv = C.targetValue(t);
    return html`<${Sheet} title=${n.label} onClose=${onClose} wide>
      <div class="nd-head">
        <div class="nd-num"><b>${U.fmtAmount(k, v)}</b> ${n.unit}</div>
        <div class="nd-target">${targetText(k, t)}${st.pct != null ? html` · <b>${U.fmtPct(st.pct)}</b>` : null} <${Mark} state=${st.state} /></div>
        ${tv != null ? html`<${Meter} pct=${st.pct} state=${st.state} thick />` : null}
        <p class="nd-info">${C.INFO[k]}</p>
        <p class="muted small">${targetBasis(k, t)}</p>
        ${S.mode === 'user' && k !== 'water'
          ? html`<button type="button" class="btn btn-sm" onClick=${() => A.open({ type: 'goal', key: k, back: { type: 'nutrient', key: k, date } })}><${Icon} name="target" size=${16} /> ${t && t.custom ? 'Change my goal' : 'Set my own goal'}</button>`
          : null}
        ${tot.missing[k] > 0 && tot.count
          ? html`<p class="muted small">USDA has no ${n.label.toLowerCase()} value for ${tot.missing[k]} of the ${tot.count} foods logged${date === U.today() ? ' today' : ''}${tot.cov[k] < 0.6 ? ', covering ' + Math.round((1 - tot.cov[k]) * 100) + '% of the calories, so this total is incomplete' : ''}.</p>`
          : null}
      </div>
      <h3 class="sec-h">Where it came from${date === U.today() ? ' today' : ' on ' + U.fmtDay(date, 'short')}</h3>
      ${contrib.length
        ? html`<ul class="contrib">${contrib.slice(0, 12).map(
            (x) => html`<li key=${x.e.id}>
              <span class="nm">${x.e.name}</span>
              <span class="amt">${U.fmtNutrient(k, x.v)}</span>
              <${Meter} pct=${v ? x.v / v : 0} color="var(--ink-2)" />
            </li>`
          )}</ul>`
        : html`<p class="muted">None of the foods logged ${date === U.today() ? 'today' : 'that day'} contain ${n.label.toLowerCase()}.</p>`}
      ${top.length
        ? html`<h3 class="sec-h">Foods rich in ${n.label.toLowerCase()}</h3>
            <p class="muted small">Per typical serving, from the USDA database. Select one to log it.</p>
            <div class="results">
              ${top.map((x) => html`<button type="button" class="result" key=${x.food.id} onClick=${() => A.open({ type: 'add', date, meal: U.mealForNow(), foodId: x.food.id })}>
                <span class="nm">${x.food.name}</span>
                <span class="meta"><b>${U.fmtNutrient(k, x.amount)}</b>${tv ? ' (' + U.fmtPct(x.amount / tv) + ')' : ''} in ${x.portion.label}</span>
              </button>`)}
            </div>`
        : null}
    <//>`;
  }

  // ---------------------------------------------------------------------------
  // Your own goal for one nutrient
  const MACRO_KEYS = ['prot', 'carbs', 'fat'];
  const KIND_OPTS = [
    ['goal', 'Aim for'],
    ['min', 'At least'],
    ['max', 'At most'],
    ['range', 'Between'],
    ['off', 'No goal'],
  ];
  const LB_PER_KG = 2.20462;
  const round = (v, d) => String(Math.round(v * 10 ** d) / 10 ** d);

  function GoalSheet({ nkey, back, onClose }) {
    const k = nkey;
    const n = C.NUTRIENTS[k];
    const p = S.profile;
    const kg = DV.calc.weightOn(U.today());
    const imperial = (p.units || 'imperial') === 'imperial';
    const bodyW = imperial ? kg * LB_PER_KG : kg; // weight in the units shown
    const T = DV.calc.targetsFor(U.today());
    const kcalGoal = T.kcal ? T.kcal.goal : 2000;
    const auto = C.targets(Object.assign({}, p, { overrides: {}, kcalOverride: null }), kg);
    const defaults = C.targets(Object.assign({}, p, { overrides: {} }), kg);
    const d = k === 'kcal' ? auto.kcal : defaults[k];
    const saved = (p.overrides || {})[k];
    const units = k === 'kcal' ? ['amount'] : C.goalUnits(k);
    const kpg = { prot: 4, carbs: 4, netcarbs: 4, sugars: 4, fat: 9, sat: 9, mono: 9, poly: 9 }[k];
    const unitLabel = (u) => (u === 'pct' ? '% of calories' : u === 'perkg' ? (imperial ? 'g per lb of body weight' : 'g per kg of body weight') : n.unit);
    // Grams from a value in the chosen unit, and back.
    const toAmt = (v, u) => (u === 'pct' ? (kcalGoal * v) / 100 / kpg : u === 'perkg' ? v * bodyW : v);
    const fromAmt = (a, u) => (u === 'pct' ? round((a * kpg * 100) / kcalGoal, 1) : u === 'perkg' ? round(a / bodyW, 2) : round(a, a >= 10 ? 0 : 2));
    const shown = (v, u) => (v == null ? '' : u === 'perkg' ? round(imperial ? v / LB_PER_KG : v, 2) : String(v));

    const init = () => {
      if (k === 'kcal') return { kind: 'goal', value: p.kcalOverride ? String(p.kcalOverride) : '', min: '', max: '', unit: 'amount' };
      if (saved && saved.kind) {
        const u = saved.unit || 'amount';
        return { kind: saved.kind, value: shown(saved.value, u), min: shown(saved.min, u), max: shown(saved.max, u), unit: u };
      }
      if (saved) {
        // Older form typed into the targets table: { min?, max? }.
        const kind = saved.min != null && saved.max != null ? 'range' : saved.min == null ? 'max' : d && d.kind === 'goal' ? 'goal' : 'min';
        return { kind, value: String(kind === 'max' ? saved.max : saved.min), min: saved.min != null ? String(saved.min) : '', max: saved.max != null ? String(saved.max) : '', unit: 'amount' };
      }
      const kind = d ? (d.kind === 'goal' ? 'goal' : d.kind === 'max' ? 'max' : 'min') : 'min';
      const tv = d ? C.targetValue(d) : null;
      return { kind, value: tv != null ? fromAmt(tv, 'amount') : '', min: '', max: '', unit: 'amount' };
    };
    const [g, setG] = useState(init);
    const set = (patch) => setG((prev) => Object.assign({}, prev, typeof patch === 'function' ? patch(prev) : patch));
    const num = (s) => (s === '' || s == null ? null : parseFloat(s));
    // Switching units keeps the same amount: 150 g protein -> 30% of 2,000 kcal.
    const setUnit = (u) =>
      set((prev) => {
        const conv = (s) => (num(s) == null ? s : fromAmt(toAmt(num(s), prev.unit), u));
        return { unit: u, value: conv(prev.value), min: conv(prev.min), max: conv(prev.max) };
      });

    const kinds = k === 'kcal' ? [] : KIND_OPTS.filter(([id]) => !(MACRO_KEYS.includes(k) && id === 'off'));
    const v = num(g.value);
    const lo = num(g.min);
    const hi = num(g.max);
    let problem = '';
    if (g.kind === 'range') {
      if (lo == null || hi == null) problem = 'Enter both amounts.';
      else if (lo < 0 || hi < 0) problem = 'Amounts can’t be negative.';
      else if (lo > hi) problem = 'The first amount should be the smaller one.';
    } else if (g.kind !== 'off' && !(k === 'kcal' && g.value === '')) {
      if (v == null || Number.isNaN(v)) problem = 'Enter an amount.';
      else if (v < 0) problem = 'Amounts can’t be negative.';
      else if (k === 'kcal' && (v < 800 || v > 8000)) problem = 'Enter a calorie goal between 800 and 8,000.';
    }
    // The goal as it will be saved (values per kg when set by body weight).
    const store = (s) => (num(s) == null ? null : g.unit === 'perkg' && imperial ? Math.round(num(s) * LB_PER_KG * 1000) / 1000 : num(s));
    const draft = g.kind === 'off' ? { kind: 'off' } : g.kind === 'range' ? { kind: 'range', min: store(g.min), max: store(g.max), unit: g.unit } : { kind: g.kind, value: store(g.value), unit: g.unit };
    // Preview with the same rules the diary uses.
    let preview = null;
    if (!problem && k !== 'kcal') {
      const withDraft = Object.assign({}, p, { overrides: Object.assign({}, p.overrides || {}, { [k]: draft }) });
      preview = C.targets(withDraft, kg)[k] || null;
    }
    const todayTot = DV.calc.dayTotals(S.days[U.today()]);
    const todayV = todayTot.n[k] || 0;
    const st = preview ? C.status(todayV, preview) : null;
    // Safety notes against the default upper limit and recommended intake.
    const notes = [];
    if (preview && d && !MACRO_KEYS.includes(k)) {
      const floor = preview.kind === 'goal' ? preview.goal : preview.min;
      if (d.max != null && floor != null && floor > d.max && d.kind !== 'max')
        notes.push('That’s above the upper limit of ' + U.fmtNutrient(k, d.max) + ', the most that’s considered safe daily for your age and sex. Check with a clinician before aiming this high.');
      if (d.kind === 'min' && d.min != null && preview.kind === 'max' && preview.max < d.min)
        notes.push('That limit is below the recommended ' + U.fmtNutrient(k, d.min) + ' a day for your age and sex.');
    }
    // Protein, carbs and fat against the calorie goal.
    let macroNote = '';
    if (MACRO_KEYS.includes(k) && preview) {
      const withDraft = Object.assign({}, p, { overrides: Object.assign({}, p.overrides || {}, { [k]: draft }) });
      const TT = C.targets(withDraft, kg);
      const grams = MACRO_KEYS.map((m) => (TT[m] && TT[m].range ? (TT[m].min + TT[m].max) / 2 : C.targetValue(TT[m])));
      if (grams.every((x) => x != null)) {
        const sum = grams[0] * 4 + grams[1] * 4 + grams[2] * 9;
        if (Math.abs(sum - kcalGoal) > kcalGoal * 0.05)
          macroNote = 'Protein, carbs and fat goals together come to ' + U.fmt(sum, 0) + ' kcal; your calorie goal is ' + U.fmt(kcalGoal, 0) + ' kcal.';
      }
    }
    const done = () => (back ? A.open(back) : onClose());
    const save = (e) => {
      if (e) e.preventDefault();
      if (problem) return;
      if (k === 'kcal') A.setGoal('kcal', g.value === '' ? null : { value: v });
      else A.setGoal(k, draft);
      A.toast(k === 'kcal' && g.value === '' ? 'Calorie goal set to automatic' : 'Goal saved');
      done();
    };
    const custom = k === 'kcal' ? p.kcalOverride > 0 : !!saved;
    const input = (field, label) => html`<label class="field goal-amt">
        <span class="lbl">${label}</span>
        <span class="inline-field"><input id=${'goal-' + field} class="input num" type="number" inputmode="decimal" step="any" min="0" value=${g[field]} onInput=${(e) => set({ [field]: e.target.value })} /><span class="unit">${unitLabel(g.unit)}</span></span>
      </label>`;
    return html`<${Sheet} title=${n.label + ' goal'} onClose=${onClose} onBack=${back ? () => A.open(back) : null} focus=${g.kind === 'range' ? '#goal-min' : '#goal-value'}
      footer=${html`${custom
          ? html`<button type="button" class="btn" onClick=${() => {
              A.setGoal(k, null);
              A.toast(n.label + ' goal back to the default');
              done();
            }}>Use the default</button>`
          : null}
        <button type="submit" form="goal-form" class="btn btn-primary" disabled=${!!problem}>Save goal</button>`}>
      <form id="goal-form" class="stack" onSubmit=${save}>
        <p class="muted small">Default: ${d ? goalText(k, d).replace(/^./, (c) => c.toLowerCase()) : 'no goal'}${k === 'kcal' ? ', from your body and activity in Profile' : ''}.</p>
        ${kinds.length
          ? html`<div class="field"><span class="lbl">Goal type</span>
              <div class="chips" role="group" aria-label="Goal type">
                ${kinds.map(([id, label]) => html`<button type="button" key=${id} class=${'chip' + (g.kind === id ? ' on' : '')} aria-pressed=${g.kind === id ? 'true' : 'false'} onClick=${() => set((prev) => ({ kind: id, min: id === 'range' && prev.min === '' ? prev.value : prev.min }))}>${label}</button>`)}
              </div>
            </div>`
          : null}
        ${g.kind === 'off'
          ? html`<p class="muted">You’ll still see how much you ate each day, without a goal or a progress bar.</p>`
          : html`${units.length > 1
                ? html`<div class="field"><span class="lbl">Set it in</span>
                    <${Seg} value=${g.unit} options=${units.map((u) => [u, u === 'amount' ? n.unit : u === 'pct' ? '% of calories' : imperial ? 'g per lb' : 'g per kg'])} onChange=${setUnit} label="Units" small />
                  </div>`
                : null}
              ${g.kind === 'range'
                ? html`<div class="grid2">${input('min', 'From')}${input('max', 'To')}</div>`
                : input('value', k === 'kcal' ? 'Calories a day (blank for automatic)' : 'Amount a day')}
              ${!problem && preview && g.unit !== 'amount'
                ? html`<p class="small">That’s <b>${preview.range ? U.fmt(preview.min, 0) + '–' + U.fmtNutrient(k, preview.max) : U.fmtNutrient(k, C.targetValue(preview))}</b> a day at ${g.unit === 'pct' ? 'your ' + U.fmt(kcalGoal, 0) + ' kcal goal' : 'your weight of ' + U.fmtWeight(kg, p.units)}.</p>`
                : null}`}
        ${problem && g.value !== '' ? html`<p class="error small" role="alert">${problem}</p>` : null}
        ${st && S.days[U.today()] ? html`<p class="small">Today so far: <b>${U.fmtNutrient(k, todayV)}</b>${st.pct != null ? ' · ' + U.fmtPct(st.pct) + (preview.kind === 'max' ? ' of the limit' : ' of the goal') : ''}</p>` : null}
        ${notes.map((x, i) => html`<p class="warn-note" key=${i}><${Icon} name="alert" size=${16} /> ${x}</p>`)}
        ${macroNote ? html`<p class="muted small">${macroNote}</p>` : null}
        ${MACRO_KEYS.includes(k) ? html`<p class="muted small">Your own goal replaces the ${C.PLANS[p.plan || 'balanced'].label.toLowerCase()} plan’s ${n.label.toLowerCase()} target. Goals in % of calories or by body weight follow your calorie goal and weight as they change.</p>` : null}
      </form>
    <//>`;
  }

  // ---------------------------------------------------------------------------
  // Foods view
  function FoodsView() {
    const [tab, setTab] = useState('search');
    const [q, setQ] = useState('');
    const dq = useDebounced(q, 110);
    const boost = useBoost();
    const results = useMemo(() => (dq.trim().length >= 2 && DB.status === 'ready' ? DB.search(dq, { limit: 60, boost }) : []), [dq, DB.status]);
    const brands = useBrandSearch(dq, 60);
    const bc = useBarcode(q);
    const lib = Object.values(S.library).filter((it) => !it.archived);
    const foods = lib.filter((it) => it.type === 'food').sort((a, b) => a.name.localeCompare(b.name));
    const recipes = lib.filter((it) => it.type === 'recipe').sort((a, b) => a.name.localeCompare(b.name));
    const openFood = (ref) => A.open(Object.assign({ type: 'add', date: U.today(), meal: U.mealForNow() }, ref.fid != null ? { foodId: ref.fid, bf: ref.bf } : { lid: ref.lid }));
    const [pending, pickBrand] = useBrandPick(openFood);
    const [meta, setMeta] = useState(BR.meta);
    useEffect(() => {
      if (!meta) BR.loadMeta().then(setMeta, () => {});
    }, []);
    const [scanning, setScanning] = useState(false);
    const [scanned, setScanned] = useState('');
    useEffect(() => {
      if (!scanned || !bc || bc.code !== scanned || bc.busy) return;
      if (bc.food) openFood({ fid: bc.food.id, bf: bc.food.bf });
      else if (bc.lib) openFood({ lid: bc.lib.id });
      setScanned('');
    }, [scanned, bc && bc.busy, bc && bc.code]);
    const brandCount = meta ? meta.count : 0;
    const srcCount = (k) => (meta && meta.sources[k] ? U.fmt(meta.sources[k].count, 0) : '');
    return html`<div class="view">
      <header class="view-h"><h1>Foods</h1><p class="muted">${U.fmt(13224 + brandCount, 0)}${brandCount ? '' : '+'} foods and brand-name products from USDA FoodData Central${brandCount ? ' and Open Food Facts' : ''}, plus your own.</p></header>
      <${Seg} value=${tab} options=${[['search', 'Database'], ['foods', 'My foods (' + foods.length + ')'], ['recipes', 'Recipes (' + recipes.length + ')']]} onChange=${setTab} label="Food lists" />
      ${tab === 'search'
        ? html`<div class="panel pad-panel top16">
            <div class="row gap8 wrap searchrow">
              <div class="searchbox big"><${Icon} name="search" size=${20} /><input id="db-q" class="input" type="search" placeholder="Search foods, brands or a barcode, like “kirkland almonds”" aria-label="Search foods, brands or a barcode" value=${q} onInput=${(e) => setQ(e.target.value)} /></div>
              <button type="button" class="btn" aria-pressed=${scanning ? 'true' : 'false'} onClick=${() => setScanning(!scanning)}><${Icon} name=${scanning ? 'x' : 'barcode'} size=${18} /> ${scanning ? 'Close scanner' : 'Scan a barcode'}</button>
            </div>
            ${scanning
              ? html`<div class="top8"><${BarcodeScanner} onCode=${(code) => {
                  setScanning(false);
                  setQ(code);
                  setScanned(code);
                }} /></div>`
              : null}
            ${dq.trim().length >= 2 || bc
              ? html`<div class="results top8">
                  <${BarcodeHit} bc=${bc} onOpen=${openFood} onCreate=${(code) => A.open({ type: 'custom', prefill: { upc: code } })} />
                  ${DB.status === 'loading' ? html`<p class="muted pad"><${Spinner} /> Loading the food database…</p>` : null}
                  ${brands.brandHit ? html`<${BrandSection} dq=${dq} res=${brands} pending=${pending} onPick=${pickBrand} />` : null}
                  ${results.length && !bc ? html`<h4 class="rsec-h">Everyday foods <span class="rsec-n">USDA</span></h4>` : null}
                  ${results.map((r) => html`<${DbResult} key=${r.food.id} food=${r.food} onPick=${() => openFood({ fid: r.food.id })} />`)}
                  ${!brands.brandHit ? html`<${BrandSection} dq=${dq} res=${brands} pending=${pending} onPick=${pickBrand} />` : null}
                </div>`
              : html`<div class="about-data">
                  <div><h3>SR Legacy</h3><p>7,793 foods analyzed by USDA labs: raw and cooked ingredients, brand-name staples and restaurant items, with up to 150 nutrients each.</p></div>
                  <div><h3>FNDDS 2021–2023</h3><p>5,431 foods and drinks as Americans actually eat them, from “Chicken breast, grilled” to “Pizza, thin crust”, with complete values for 65 nutrients.</p></div>
                  <div><h3>USDA Branded Foods</h3><p>${srcCount('B') || '360,000+'} packaged foods sold in the US, from each product’s Nutrition Facts label (December 2025 release), searchable by name, brand or barcode.</p></div>
                  <div><h3>Open Food Facts</h3><p>${srcCount('O') || 'Thousands of'} more products from Kirkland Signature, Trader Joe’s, Aldi and Costco that USDA doesn’t list, entered by volunteers from package labels. <a href="https://world.openfoodfacts.org" target="_blank" rel="noopener">Open Food Facts</a> data is available under the Open Database License.</p></div>
                </div>`}
          </div>`
        : null}
      ${tab === 'foods'
        ? html`<div class="panel pad-panel top16">
            <div class="row gap8 wrap">
              <button type="button" class="btn btn-primary" onClick=${() => A.open({ type: 'custom' })}><${Icon} name="plus" size=${16} /> New food</button>
            </div>
            ${foods.length
              ? html`<div class="results top8">${foods.map((it) => html`<div class="frow" key=${it.id}>
                  <${LibResult} item=${it} onPick=${() => openFood({ lid: it.id })} />
                  <button type="button" class="iconbtn quiet" aria-label=${'Edit ' + it.name} onClick=${() => A.open({ type: 'custom', lid: it.id })}><${Icon} name="pencil" size=${18} /></button>
                </div>`)}</div>`
              : html`<p class="empty muted">Add packaged foods from their Nutrition Facts label${AI.images ? ', or photograph the label and let Claude fill it in' : ''}.</p>`}
          </div>`
        : null}
      ${tab === 'recipes'
        ? html`<div class="panel pad-panel top16">
            <button type="button" class="btn btn-primary" onClick=${() => A.open({ type: 'recipe' })}><${Icon} name="plus" size=${16} /> New recipe</button>
            ${recipes.length
              ? html`<div class="results top8">${recipes.map((it) => html`<div class="frow" key=${it.id}>
                  <${LibResult} item=${it} onPick=${() => openFood({ lid: it.id })} />
                  <button type="button" class="iconbtn quiet" aria-label=${'Edit ' + it.name} onClick=${() => A.open({ type: 'recipe', lid: it.id })}><${Icon} name="pencil" size=${18} /></button>
                </div>`)}</div>`
              : html`<p class="empty muted">Build a recipe from ingredients once, then log it by the serving.</p>`}
          </div>`
        : null}
    </div>`;
  }

  // ---------------------------------------------------------------------------
  // Trends
  function TrendsView() {
    const [range, setRangeS] = useState(() => DV.uiPrefs.read().range || 30);
    const [showAll, setShowAll] = useState(false);
    const setRange = (r) => {
      setRangeS(r);
      DV.uiPrefs.write({ range: r });
    };
    const sys = units();
    const end = U.today();
    const dates = [];
    for (let i = range - 1; i >= 0; i--) dates.push(U.addDays(end, -i));
    const rows = dates.map((d) => {
      const day = S.days[d];
      const tot = DV.calc.dayTotals(day);
      return { d, day, tot, logged: tot.count > 0 };
    });
    const logged = rows.filter((r) => r.logged);
    const T = DV.calc.targetsFor(end);
    const avg = {};
    C.TRACKED.forEach((k) => (avg[k] = logged.length ? logged.reduce((a, r) => a + (r.tot.n[k] || 0), 0) / logged.length : 0));
    const missingDays = {};
    C.TRACKED.forEach((k) => (missingDays[k] = logged.filter((r) => r.tot.missing[k] > 0).length));
    const kcalAll = logged.reduce((a, r) => a + (r.tot.n.kcal || 0), 0);
    const avgCov = {};
    C.TRACKED.forEach((k) => (avgCov[k] = kcalAll > 0 ? Math.max(0, 1 - logged.reduce((a, r) => a + r.tot.kcalMiss[k], 0) / kcalAll) : 1));
    const isLimited = (k) => avgCov[k] < 0.6;
    const avgBurn = logged.length ? logged.reduce((a, r) => a + DV.calc.exerciseTotal(r.day), 0) / logged.length : 0;
    // The trend runs over every weigh-in, so it's already settled where this range begins.
    const weights = DV.calc
      .weightTrend(DV.calc.weighIns())
      .filter((w) => w.date >= dates[0] && w.date <= end)
      .map((w) => ({ date: w.date, value: kgTo(w.kg, sys), trend: kgTo(w.trend, sys) }));
    const wChange = weights.length > 1 ? weights[weights.length - 1].value - weights[0].value : null;
    const colData = rows.map((r) => {
      const values = {};
      MACROS.forEach((m) => (values[m.key] = (r.tot.n[m.key] || 0) * m.kcal));
      const total = MACROS.reduce((a, m) => a + values[m.key], 0);
      return { key: r.d, label: range <= 7 ? U.fmtDay(r.d, 'weekday') : U.fmtDay(r.d, 'short'), title: U.fmtDay(r.d).rel + ', ' + U.fmtDay(r.d, 'short'), values, total, unit: 'kcal from macros', note: r.logged ? '' : 'Nothing logged' };
    });
    // Nutrient report: average of logged days vs targets.
    const reportKeys = C.TRACKED.filter((k) => T[k] && !['kcal'].includes(k));
    const report = reportKeys.map((k) => ({ k, st: C.status(avg[k], T[k]), t: T[k] }));
    const goals = report.filter((r) => r.t.kind !== 'max' && !isLimited(r.k)).sort((a, b) => (a.st.pct || 0) - (b.st.pct || 0));
    const limits = report.filter((r) => r.t.kind === 'max').sort((a, b) => (b.st.pct || 0) - (a.st.pct || 0));
    const noData = report.filter((r) => r.t.kind !== 'max' && isLimited(r.k));
    const shownGoals = showAll ? goals : goals.filter((r) => r.st.state === 'low');
    // Foods that supplied the most calories.
    const byFood = new Map();
    logged.forEach((r) =>
      (r.day.entries || []).forEach((e) => {
        const key = e.quick ? 'q:' + e.name : e.fid != null ? 'f' + e.fid : 'l' + e.lid;
        const n = r.tot.entries.get(e.id) || {};
        const cur = byFood.get(key) || { name: e.name, kcal: 0, count: 0, prot: 0 };
        cur.kcal += n.kcal || 0;
        cur.prot += n.prot || 0;
        cur.count++;
        byFood.set(key, cur);
      })
    );
    const totalKcal = logged.reduce((a, r) => a + (r.tot.n.kcal || 0), 0);
    const topFoods = Array.from(byFood.values()).sort((a, b) => b.kcal - a.kcal).slice(0, 10);
    const streak = DV.calc.streak();

    return html`<div class="view trends">
      <header class="view-h row between wrap gap8">
        <div><h1>Trends</h1><p class="muted">Averages count only days with food logged.</p></div>
        <${Seg} value=${range} options=${[[7, '7 days'], [30, '30 days'], [90, '90 days']]} onChange=${setRange} label="Date range" />
      </header>
      <div class="tiles">
        <div class="tile"><div class="lbl">Average calories</div><div class="val">${logged.length ? U.fmt(avg.kcal, 0) : '—'}</div><div class="sub">Goal ${U.fmt(T.kcal ? T.kcal.goal : 0, 0)}${avgBurn ? ' + ' + U.fmt(avgBurn, 0) + ' exercise' : ''}</div></div>
        <div class="tile"><div class="lbl">Average protein</div><div class="val">${logged.length ? U.fmt(avg.prot, 0) + ' g' : '—'}</div><div class="sub">${T.prot ? goalText('prot', T.prot).split(' · ')[0] : 'No goal'}</div></div>
        <div class="tile"><div class="lbl">Days logged</div><div class="val">${logged.length} <span class="of">of ${range}</span></div><div class="sub">${streak ? streak + '-day streak' : 'Log today to start a streak'}</div></div>
        <div class="tile"><div class="lbl">Weight change</div><div class="val">${wChange == null ? '—' : (wChange > 0 ? '+' : wChange < 0 ? '−' : '') + U.fmt(Math.abs(wChange), 1) + (sys === 'imperial' ? ' lb' : ' kg')}</div><div class="sub">${weights.length ? U.fmt(weights[weights.length - 1].value, 1) + (sys === 'imperial' ? ' lb' : ' kg') + ' latest' : 'Log weight in the diary'}</div></div>
      </div>

      <${ChartFrame} title="Calories by source" sub=${'Daily calories from protein, carbs, fat and alcohol, against your goal of ' + U.fmt(T.kcal ? T.kcal.goal : 0, 0) + ' kcal.'}
        legend=${MACROS.map((m) => html`<span key=${m.key}><i class="key" style=${'background:' + m.color}></i>${m.label}</span>`)}
        table=${() => html`<table class="dtable">
          <thead><tr><th>Date</th><th>Calories</th><th>Protein</th><th>Carbs</th><th>Fat</th><th>Alcohol</th></tr></thead>
          <tbody>${rows.slice().reverse().map((r) => html`<tr key=${r.d}><td>${U.fmtDay(r.d, 'short')}</td><td>${r.logged ? U.fmt(r.tot.n.kcal, 0) : '—'}</td><td>${r.logged ? U.fmt(r.tot.n.prot, 0) + ' g' : ''}</td><td>${r.logged ? U.fmt(r.tot.n.carbs, 0) + ' g' : ''}</td><td>${r.logged ? U.fmt(r.tot.n.fat, 0) + ' g' : ''}</td><td>${r.logged && r.tot.n.alcohol ? U.fmt(r.tot.n.alcohol, 0) + ' g' : ''}</td></tr>`)}</tbody>
        </table>`}>
        <${StackedColumns} data=${colData} series=${MACROS} target=${T.kcal ? T.kcal.goal : null} targetLabel="Goal" onPick=${(d) => {
          A.setDate(d.key);
          A.setView('diary');
        }} />
      <//>

      <div class="two-col">
        <${ChartFrame} title="Body weight" sub=${weights.length ? weights.length + ' weigh-ins in this range. The line is your trend.' : 'Log your weight to see a trend.'}
          actions=${html`<button type="button" class="btn btn-sm btn-quiet" onClick=${() => A.setView('weight')}><${Icon} name="scale" size=${16} /> Weight log</button>`}
          table=${weights.length ? () => html`<${WeightTable} points=${weights} unit=${wUnit(sys)} />` : null}>
          <${WeightChart} points=${weights} unit=${wUnit(sys)} goal=${S.profile.goalWeightKg > 0 ? kgTo(S.profile.goalWeightKg, sys) : null} />
        <//>
        <${ChartFrame} title="Most calories from" sub="Foods that supplied the most energy in this range."
          table=${null}>
          ${topFoods.length
            ? html`<ol class="topfoods">${topFoods.map((f, i) => html`<li key=${i}>
                <span class="nm">${f.name}</span>
                <span class="amt">${U.fmt(f.kcal, 0)} kcal · ${f.count}×</span>
                <${Meter} pct=${totalKcal ? f.kcal / topFoods[0].kcal : 0} color="var(--ink-2)" />
              </li>`)}</ol>`
            : html`<p class="muted">Nothing logged in this range.</p>`}
        <//>
      </div>

      <section class="panel pad-panel report" aria-label="Nutrient report">
        <header class="row between wrap gap8">
          <div><h2 class="h2">Nutrient report</h2><p class="muted small">Average daily intake over ${logged.length} logged ${logged.length === 1 ? 'day' : 'days'}, as a share of today’s targets.</p></div>
          <${Seg} value=${showAll ? 'all' : 'low'} options=${[['low', 'Below target'], ['all', 'All nutrients']]} onChange=${(v) => setShowAll(v === 'all')} label="Filter nutrients" small />
        </header>
        ${logged.length
          ? html`<div class="report-grid">
              <div>
                <h3 class="report-h">${showAll ? 'Targets' : 'Consistently short'}</h3>
                ${shownGoals.length
                  ? shownGoals.map((r) => html`<${NutrientRow} key=${r.k} k=${r.k} value=${avg[r.k]} target=${r.t} missing=${missingDays[r.k]} coverage=${avgCov[r.k]} onClick=${() => A.open({ type: 'nutrient', key: r.k, date: end })} />`)
                  : html`<p class="good-note"><${Icon} name="check" size=${16} stroke=${3} /> Every target was met on average.</p>`}
              </div>
              <div>
                <h3 class="report-h">Limits</h3>
                ${limits.map((r) => html`<${NutrientRow} key=${r.k} k=${r.k} value=${avg[r.k]} target=${r.t} missing=${missingDays[r.k]} coverage=${avgCov[r.k]} onClick=${() => A.open({ type: 'nutrient', key: r.k, date: end })} />`)}
                ${goals.filter((r) => r.st.state === 'over').length
                  ? html`<h3 class="report-h top16">Above upper limit</h3>
                      ${goals.filter((r) => r.st.state === 'over').map((r) => html`<${NutrientRow} key=${'o' + r.k} k=${r.k} value=${avg[r.k]} target=${r.t} missing=${missingDays[r.k]} coverage=${avgCov[r.k]} onClick=${() => A.open({ type: 'nutrient', key: r.k, date: end })} />`)}`
                  : null}
                ${noData.length
                  ? html`<h3 class="report-h top16">Not enough data</h3>
                      <p class="muted small">Most of the foods you logged have no USDA value for these, so the averages can’t be judged: ${noData.map((r) => C.NUTRIENTS[r.k].label.toLowerCase()).join(', ')}.</p>`
                  : null}
              </div>
            </div>
            <p class="footnote">* Some logged foods have no USDA value for this nutrient on at least one day, so the average may read low.</p>`
          : html`<p class="empty muted">Log a few days of food to see which nutrients you get enough of.</p>`}
      </section>
    </div>`;
  }

  // ---------------------------------------------------------------------------
  // Weight
  const wUnit = (sys) => (sys === 'imperial' ? 'lb' : 'kg');
  const kgTo = (kg, sys) => (sys === 'imperial' ? U.units.kgToLb(kg) : kg);
  const toKg = (v, sys) => (sys === 'imperial' ? U.units.lbToKg(v) : v);
  const r1 = (v) => Math.round(v * 10) / 10;
  const okWeight = (v, sys) => v > 0 && toKg(v, sys) >= 20 && toKg(v, sys) <= 350;
  // "+0.4", "−1.2", "0"
  function signed(v) {
    const r = r1(v);
    return (r > 0 ? '+' : r < 0 ? '−' : '') + U.fmt(Math.abs(r), 1);
  }
  function dayWord(date) {
    const t = U.today();
    if (date === t) return 'today';
    if (date === U.addDays(t, -1)) return 'yesterday';
    return U.fmtDay(date, 'short');
  }
  function dayLabel(date) {
    const d = U.parseYmd(date);
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
  }
  // Where things stand against the goal weight, in kg: { goal, start, now, dir (−1 lose, 1 gain), toGo, done, pct, reached }
  function goalState(p, trend) {
    const goal = p.goalWeightKg > 0 ? p.goalWeightKg : null;
    const now = trend.length ? trend[trend.length - 1].trend : p.weightKg || null;
    if (!goal || !now) return null;
    const start = p.goalStartKg > 0 ? p.goalStartKg : trend.length ? trend[0].kg : now;
    const dir = Math.sign(goal - start) || Math.sign(goal - now) || -1;
    const done = (now - start) * dir;
    const span = Math.abs(goal - start);
    const reached = (goal - now) * dir <= 0.05;
    return { goal, start, now, dir, toGo: Math.abs(goal - now), done, reached, pct: span > 0.05 ? Math.max(0, Math.min(1, done / span)) : reached ? 1 : 0 };
  }

  // A weight field with − and + buttons (0.2 lb or 0.1 kg a tap), so most mornings need no typing.
  function WeightInput({ id, value, setValue, sys, onEnter }) {
    const step = sys === 'imperial' ? 0.2 : 0.1;
    const bump = (dir) => {
      const v = parseFloat(value);
      if (v > 0) setValue(String(r1(v + dir * step)));
    };
    return html`<div class="wstep">
      <button type="button" class="iconbtn" aria-label=${'Down ' + step + ' ' + wUnit(sys)} onClick=${() => bump(-1)}><${Icon} name="minus" size=${22} /></button>
      <label class="wstep-in">
        <span class="sr">Weight in ${sys === 'imperial' ? 'pounds' : 'kilograms'}</span>
        <input id=${id} class="input num" type="number" inputmode="decimal" step="0.1" min="0" autocomplete="off" value=${value}
          onInput=${(e) => setValue(e.target.value)}
          onKeyDown=${(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            if (onEnter) onEnter();
          }} />
        <span class="unit" aria-hidden="true">${wUnit(sys)}</span>
      </label>
      <button type="button" class="iconbtn" aria-label=${'Up ' + step + ' ' + wUnit(sys)} onClick=${() => bump(1)}><${Icon} name="plus" size=${22} /></button>
    </div>`;
  }

  // Log today's weight (or another day's). Starts from the last weigh-in so a small change is a tap or two.
  function WeightLog({ sys, list }) {
    const today = U.today();
    const unit = wUnit(sys);
    const [date, setDate] = useState(today);
    const on = S.days[date] && S.days[date].weight > 0 ? S.days[date].weight : null;
    const before = list.filter((w) => w.date < date).pop() || null;
    const from = on || (before && before.kg) || null;
    const shown = from ? String(r1(kgTo(from, sys))) : '';
    const [val, setVal] = useState(shown);
    useEffect(() => setVal(shown), [date, on, sys]);
    const v = parseFloat(val);
    const ok = okWeight(v, sys);
    const same = !!on && ok && Math.abs(r1(kgTo(on, sys)) - r1(v)) < 0.05;
    const save = () => {
      if (!ok || same) return;
      const prev = A.setWeight(date, toKg(v, sys));
      A.toast((prev ? 'Updated to ' : 'Logged ') + U.fmt(r1(v), 1) + ' ' + unit + ' for ' + dayWord(date), { action: { label: 'Undo', run: () => A.setWeight(date, prev) } });
    };
    const label = same
      ? 'Logged for ' + dayWord(date)
      : !ok
      ? (on ? 'Update weight' : 'Log weight')
      : (on ? 'Update to ' : 'Log ') + U.fmt(r1(v), 1) + ' ' + unit + (date === today || on ? '' : ' for ' + dayWord(date));
    return html`<section class="panel pad-panel wlog" aria-label="Log your weight">
      <div class="wlog-h">
        <h2 class="h2">Log weight</h2>
        <input class="input date-sm" type="date" aria-label="Date of the weigh-in" value=${date} max=${today} onChange=${(e) => e.target.value && e.target.value <= today && setDate(e.target.value)} />
      </div>
      <${WeightInput} id="w-in" value=${val} setValue=${setVal} sys=${sys} onEnter=${save} />
      <button type="button" class="btn btn-primary btn-block wlog-btn" disabled=${!ok || same} onClick=${save}>
        ${same ? html`<${Icon} name="check" size=${18} stroke=${2.5} />` : null} ${label}
      </button>
      <p class="muted small wlog-note">
        ${v > 0 && !ok
          ? 'Enter a weight between ' + U.fmt(r1(kgTo(20, sys)), 0) + ' and ' + U.fmt(r1(kgTo(350, sys)), 0) + ' ' + unit + '.'
          : on && before
          ? r1(kgTo(on, sys)) === r1(kgTo(before.kg, sys))
            ? 'Same as ' + dayLabel(before.date) + '.'
            : signed(kgTo(on - before.kg, sys)) + ' ' + unit + ' since ' + dayLabel(before.date) + '.'
          : !on && before
          ? 'Last weigh-in: ' + U.fmt(r1(kgTo(before.kg, sys)), 1) + ' ' + unit + ' on ' + dayLabel(before.date) + '.'
          : on
          ? 'Your first weigh-in. Your trend starts here.'
          : 'Your first weigh-in starts your trend.'}
      </p>
    </section>`;
  }

  // Goal weight, progress toward it, when you'll likely get there, and the weekly pace behind the calorie goal.
  function WeightGoal({ sys, trend, pace }) {
    const p = S.profile;
    const unit = wUnit(sys);
    const gs = goalState(p, trend);
    const [editing, setEditing] = useState(false);
    const [val, setVal] = useState('');
    const v = parseFloat(val);
    const ok = okWeight(v, sys);
    const fmtW = (kg) => U.fmt(r1(kgTo(kg, sys)), 1);
    const saveGoal = () => {
      if (!ok) return;
      A.setWeightGoal(toKg(v, sys));
      setEditing(false);
      A.toast('Goal set to ' + U.fmt(r1(v), 1) + ' ' + unit);
    };
    if (!gs || editing) {
      return html`<section class="panel pad-panel wgoal" aria-label="Weight goal">
        <h2 class="h2">Goal weight</h2>
        ${gs ? null : html`<p class="muted small">Set a goal to see your progress and about when you’ll get there.</p>`}
        <form class="row gap8 wrap top8" onSubmit=${(e) => {
          e.preventDefault();
          saveGoal();
        }}>
          <span class="inline-field"><input id="wg-in" class="input num" type="number" inputmode="decimal" step="0.1" min="0" value=${val} onInput=${(e) => setVal(e.target.value)} aria-label=${'Goal weight in ' + (sys === 'imperial' ? 'pounds' : 'kilograms')} /><span class="unit">${unit}</span></span>
          <button type="submit" class="btn btn-primary" disabled=${!ok}>${gs ? 'Save goal' : 'Set goal'}</button>
          ${editing ? html`<button type="button" class="btn btn-quiet" onClick=${() => setEditing(false)}>Cancel</button>` : null}
        </form>
      </section>`;
    }
    const pregnant = p.stage === 'pregnant' || p.stage === 'lactating';
    const rate = pregnant ? 0 : p.rate || 0; // planned kg a week
    let eta = null;
    if (!gs.reached) {
      if (pace != null && Math.sign(pace) === gs.dir && Math.abs(pace) >= 0.02) eta = { weeks: gs.toGo / Math.abs(pace), by: 'pace' };
      else if (Math.sign(rate) === gs.dir) eta = { weeks: gs.toGo / Math.abs(rate), by: 'plan' };
    }
    const when = eta && eta.weeks <= 104 ? U.parseYmd(U.addDays(U.today(), Math.round(eta.weeks * 7))).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: eta.weeks > 40 ? 'numeric' : undefined }) : null;
    const paceNote = pace == null ? '' : Math.abs(pace) < 0.02 ? 'Your weight has held steady over the last 4 weeks. ' : Math.sign(pace) !== gs.dir ? 'Your weight has gone the other way over the last 4 weeks. ' : '';
    const T = DV.calc.targetsFor(U.today());
    const removeGoal = () => {
      const prev = { goalWeightKg: p.goalWeightKg, goalStartKg: p.goalStartKg, goalStartDate: p.goalStartDate };
      A.setWeightGoal(null);
      A.toast('Goal removed', { action: { label: 'Undo', run: () => A.updateProfile(prev) } });
    };
    return html`<section class="panel pad-panel wgoal" aria-label="Weight goal">
      <h2 class="h2">Goal weight</h2>
      <div class="wgoal-nums">
        <span>Start<b>${fmtW(gs.start)}</b></span>
        <span>Trend now<b>${fmtW(gs.now)}</b></span>
        <span>Goal<b>${fmtW(gs.goal)}</b></span>
      </div>
      <${Meter} pct=${gs.pct} thick color="var(--ink)" />
      <p class="wgoal-prog">
        ${gs.done >= 0.05 ? html`<b>${fmtW(gs.done)} ${unit} ${gs.dir < 0 ? 'lost' : 'gained'}</b>` : gs.done <= -0.05 ? html`<b>${gs.dir < 0 ? 'Up' : 'Down'} ${fmtW(-gs.done)} ${unit}</b> since you started` : html`<b>Just getting started</b>`}
        ${gs.reached ? null : html` · ${fmtW(gs.toGo)} ${unit} to go`}
      </p>
      ${gs.reached
        ? html`<p class="good-note"><${Icon} name="check" size=${16} stroke=${3} /> You’ve reached your goal.${rate !== 0 ? ' Set your weekly goal to Maintain weight to hold it here.' : ''}</p>`
        : eta && when
        ? html`<p>${eta.by === 'pace'
            ? html`At your pace over the last 4 weeks (${fmtW(Math.abs(pace))} ${unit} a week), you’ll reach ${fmtW(gs.goal)} ${unit} around <b>${when}</b>.`
            : html`${paceNote}At your planned ${fmtW(Math.abs(rate))} ${unit} a week, you’d reach it around <b>${when}</b>.`}</p>`
        : eta
        ? html`<p>${paceNote}At ${eta.by === 'pace' ? 'your recent pace' : 'your planned pace'}, that’s more than two years away.</p>`
        : html`<p>${paceNote}Your weekly goal is set to ${rate === 0 ? 'maintain' : gs.dir < 0 ? 'gain' : 'lose'} weight. Choose a pace below to work toward ${fmtW(gs.goal)} ${unit}.</p>`}
      <label class="field top16"><span class="lbl">Weekly goal</span>
        <select id="wg-rate" class="input" value=${String(nearestRate(p.rate || 0, sys))} disabled=${pregnant} onChange=${(e) => A.updateProfile({ rate: parseFloat(e.target.value) })}>
          ${rateOptions(sys).map(([rv, label]) => html`<option key=${label} value=${String(rv)}>${label}</option>`)}
        </select>
      </label>
      <p class="muted small top8">${pregnant
        ? 'Weekly goals are off during pregnancy and breastfeeding.'
        : p.kcalOverride > 0
        ? 'Your calorie goal is set by hand (' + U.fmt(p.kcalOverride, 0) + ' kcal), so this doesn’t change it. Clear it in Profile to have it follow your pace.'
        : 'This sets your daily calorie goal: ' + U.fmt(T.kcal ? T.kcal.goal : 0, 0) + ' kcal.'}</p>
      <div class="row gap8 wrap top8">
        <button type="button" class="btn btn-sm" onClick=${() => {
          setVal(String(r1(kgTo(gs.goal, sys))));
          setEditing(true);
        }}><${Icon} name="pencil" size=${16} /> Change goal</button>
        <button type="button" class="btn btn-sm btn-quiet" onClick=${removeGoal}>Remove goal</button>
      </div>
    </section>`;
  }

  function WeightTable({ points, unit }) {
    return html`<table class="dtable">
      <thead><tr><th>Date</th><th>Weigh-in</th><th>Trend</th></tr></thead>
      <tbody>${points.slice().reverse().map((w) => html`<tr key=${w.date}><td>${dayLabel(w.date)}</td><td>${U.fmt(w.value, 1)} ${unit}</td><td>${U.fmt(w.trend, 1)} ${unit}</td></tr>`)}</tbody>
    </table>`;
  }

  function WeightHistory({ sys, trend }) {
    const [all, setAll] = useState(false);
    const unit = wUnit(sys);
    const rows = trend.slice().reverse();
    const shown = all ? rows : rows.slice(0, 10);
    const exportCsv = () => {
      const lines = [['date', 'weight_' + unit, 'trend_' + unit]].concat(trend.map((w) => [w.date, r1(kgTo(w.kg, sys)), r1(kgTo(w.trend, sys))]));
      saveTextFile('daily-value-weight-' + U.today() + '.csv', lines.map((l) => l.join(',')).join('\n'), 'Weight log as CSV');
    };
    return html`<section class="panel whist" aria-label="Weigh-ins">
      <header class="panel-h"><h2>Weigh-ins</h2><span class="panel-sub">${rows.length ? rows.length + ' logged · tap one to change it' : 'None yet'}</span></header>
      ${rows.length
        ? html`<ul class="wlist">
            ${shown.map((w, i) => {
              const prev = rows[i + 1];
              const amt = U.fmt(r1(kgTo(w.kg, sys)), 1) + ' ' + unit;
              return html`<li key=${w.date}>
                <button type="button" class="wrow" onClick=${() => A.open({ type: 'weight', date: w.date })} aria-label=${'Change the weigh-in for ' + dayLabel(w.date) + ', ' + amt}>
                  <span class="wd">${dayLabel(w.date)}</span>
                  <span class="wv">${amt}</span>
                  <span class="wc">${prev ? signed(kgTo(w.kg - prev.kg, sys)) : ''}</span>
                  <${Icon} name="right" size=${16} />
                </button>
              </li>`;
            })}
          </ul>`
        : html`<p class="empty muted whist-empty">Your weigh-ins will be listed here.</p>`}
      ${rows.length
        ? html`<div class="whist-f">
            ${rows.length > shown.length ? html`<button type="button" class="btn btn-sm btn-quiet" onClick=${() => setAll(true)}>Show all ${rows.length}</button>` : html`<span></span>`}
            <button type="button" class="btn btn-sm" disabled=${S.mode === 'sample'} onClick=${exportCsv}><${Icon} name="download" size=${16} /> Export CSV</button>
          </div>`
        : null}
    </section>`;
  }

  // Change or delete one weigh-in.
  function WeightSheet({ date, onClose }) {
    const sys = units();
    const kg = S.days[date] && S.days[date].weight > 0 ? S.days[date].weight : null;
    const [val, setVal] = useState(kg ? String(r1(kgTo(kg, sys))) : '');
    const v = parseFloat(val);
    const ok = okWeight(v, sys);
    const undo = (prev) => ({ label: 'Undo', run: () => A.setWeight(date, prev) });
    const save = () => {
      if (!ok) return;
      const prev = A.setWeight(date, toKg(v, sys));
      A.toast('Saved ' + U.fmt(r1(v), 1) + ' ' + wUnit(sys) + ' for ' + dayWord(date), { action: undo(prev) });
      onClose();
    };
    const del = () => {
      const prev = A.setWeight(date, null);
      A.toast('Removed the weigh-in for ' + dayWord(date), { action: undo(prev) });
      onClose();
    };
    return html`<${Sheet} title=${'Weigh-in, ' + dayLabel(date)} onClose=${onClose} focus="#ws-in"
      footer=${html`${kg ? html`<button type="button" class="btn btn-danger mr-auto" onClick=${del}><${Icon} name="trash" size=${16} /> Delete</button>` : null}
        <button type="button" class="btn" onClick=${onClose}>Cancel</button>
        <button type="button" class="btn btn-primary" disabled=${!ok} onClick=${save}>Save</button>`}>
      <${WeightInput} id="ws-in" value=${val} setValue=${setVal} sys=${sys} onEnter=${save} />
    <//>`;
  }

  function WeightView() {
    const sys = units();
    const unit = wUnit(sys);
    const today = U.today();
    const list = DV.calc.weighIns();
    const trend = DV.calc.weightTrend(list);
    const pace = DV.calc.weightPace(list, today);
    const gs = goalState(S.profile, trend);
    const last = trend[trend.length - 1];
    const first = list[0];
    const [range, setRangeS] = useState(() => DV.uiPrefs.read().wrange || 90);
    const setRange = (r) => {
      setRangeS(r);
      DV.uiPrefs.write({ wrange: r });
    };
    const cut = range === 'all' ? '' : U.addDays(today, -(range - 1));
    const pts = trend.filter((w) => w.date >= cut).map((w) => ({ date: w.date, value: kgTo(w.kg, sys), trend: kgTo(w.trend, sys) }));
    const num = (kg, sign) => (kg == null ? '—' : html`${sign ? signed(kgTo(kg, sys)) : U.fmt(r1(kgTo(kg, sys)), 1)} <span class="of">${unit}</span>`);
    return html`<div class="view weight">
      <header class="view-h"><h1>Weight</h1><p class="muted">Weigh in at the same time each day, like first thing in the morning, for the steadiest trend.</p></header>
      <div class="wtop">
        <${WeightLog} sys=${sys} list=${list} />
        <${WeightGoal} sys=${sys} trend=${trend} pace=${pace} />
      </div>
      <div class="tiles">
        <div class="tile"><div class="lbl">Trend weight</div><div class="val">${num(last ? last.trend : null)}</div><div class="sub">${last ? 'Latest weigh-in ' + U.fmt(r1(kgTo(last.kg, sys)), 1) + ' ' + unit : 'Log a weigh-in to start'}</div></div>
        <div class="tile"><div class="lbl">Weekly pace</div><div class="val">${num(pace, true)}</div><div class="sub">${pace != null ? 'A week, over the last 4 weeks' : 'Needs 3 weigh-ins over a week'}</div></div>
        <div class="tile"><div class="lbl">Total change</div><div class="val">${num(list.length > 1 ? last.kg - first.kg : null, true)}</div><div class="sub">${list.length > 1 ? 'Since ' + dayLabel(first.date) : first ? 'Needs a second weigh-in' : 'No weigh-ins yet'}</div></div>
        <div class="tile"><div class="lbl">To goal</div><div class="val">${!gs ? '—' : gs.reached ? 'Reached' : num(gs.toGo)}</div><div class="sub">${gs ? 'Goal ' + U.fmt(r1(kgTo(gs.goal, sys)), 1) + ' ' + unit : 'No goal set'}</div></div>
      </div>
      <${ChartFrame} title="Weight trend" sub="Dots are weigh-ins. The line is your trend, which smooths out day-to-day swings from water and salt."
        legend=${[html`<span key="d"><i class="key dot"></i>Weigh-in</span>`, html`<span key="t"><i class="key line" style="background:var(--ink)"></i>Trend</span>`]}
        table=${pts.length ? () => html`<${WeightTable} points=${pts} unit=${unit} />` : null}>
        <div class="chart-range"><${Seg} small value=${range} options=${[[30, '1 month'], [90, '3 months'], [365, '1 year'], ['all', 'All']]} onChange=${setRange} label="Date range" /></div>
        <${WeightChart} points=${pts} unit=${unit} goal=${gs ? kgTo(gs.goal, sys) : null} />
      <//>
      <${WeightHistory} sys=${sys} trend=${trend} />
    </div>`;
  }

  // Offer text as a file: through claude.ai's downloads inside the artifact; elsewhere the share sheet on
  // phones (Save to Files on iPhone) or an ordinary download; as a last resort, text to copy.
  async function saveTextFile(filename, data, title) {
    if (window.claude && window.claude.use) {
      let dl = null;
      try {
        dl = await window.claude.use('downloads');
      } catch (e) {}
      if (dl) {
        try {
          await dl.save({ filename, data });
          A.toast('Saved ' + filename);
          return;
        } catch (e) {
          if (e && e.code === 'declined') return;
        }
      }
    } else {
      // Nothing is awaited before this point, so the tap still counts as permission for the share sheet.
      const type = filename.endsWith('.json') ? 'application/json' : 'text/csv';
      const file = new File([data], filename, { type });
      if (coarsePointer() && navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: filename });
          return;
        } catch (e) {
          if (e && e.name === 'AbortError') return; // closed the share sheet
        }
      }
      try {
        const url = URL.createObjectURL(file);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        A.toast('Downloading ' + filename);
        return;
      } catch (e) {}
    }
    A.open({ type: 'text', title, body: 'Downloads aren’t available here. Copy this text and save it as ' + filename + '.', text: data });
  }

  // Put a backup on the clipboard, to paste into the app on another device or into the Home Screen app.
  async function copyBackup() {
    const data = A.exportJSON();
    try {
      await navigator.clipboard.writeText(data);
      A.toast('Backup copied. In the other app or browser, open Profile and tap Paste a backup.', { ms: 7000 });
    } catch (e) {
      A.open({ type: 'text', title: 'Backup', body: 'Copy all of this text, then paste it with Paste a backup in the other app or browser.', text: data });
    }
  }

  function PasteSheet({ onClose }) {
    const [text, setText] = useState('');
    const [err, setErr] = useState('');
    const run = () => {
      try {
        A.importJSON(text.trim());
        onClose();
        A.toast('Backup restored');
      } catch (e) {
        setErr(e instanceof SyntaxError ? 'That isn’t a whole backup. Copy all of the backup text and paste it again.' : e.message || 'That backup couldn’t be read.');
      }
    };
    return html`<${Sheet} title="Paste a backup" onClose=${onClose} focus="#paste-in"
      footer=${html`<button type="button" class="btn" onClick=${onClose}>Cancel</button>
        <button type="button" class="btn btn-primary" disabled=${!text.trim()} onClick=${run}>Replace this diary</button>`}>
      <div class="stack">
        <p class="muted">Paste the text from Copy backup or Back up on your other device or browser. It replaces the diary, foods and settings here.</p>
        <textarea id="paste-in" class="input mono" rows="10" aria-label="Backup text" value=${text} onInput=${(e) => {
          setText(e.target.value);
          setErr('');
        }}></textarea>
        ${err ? html`<p class="error" role="alert"><${Icon} name="alert" size=${16} /> ${err}</p>` : null}
      </div>
    <//>`;
  }

  // ---------------------------------------------------------------------------
  // Profile & targets
  const RATES = {
    metric: [[-1, 'Lose 1 kg a week'], [-0.75, 'Lose 0.75 kg a week'], [-0.5, 'Lose 0.5 kg a week'], [-0.25, 'Lose 0.25 kg a week'], [0, 'Maintain weight'], [0.25, 'Gain 0.25 kg a week'], [0.5, 'Gain 0.5 kg a week']],
    imperial: [[-2, 'Lose 2 lb a week'], [-1.5, 'Lose 1.5 lb a week'], [-1, 'Lose 1 lb a week'], [-0.5, 'Lose 0.5 lb a week'], [0, 'Maintain weight'], [0.5, 'Gain 0.5 lb a week'], [1, 'Gain 1 lb a week']],
  };
  function rateOptions(sys) {
    return RATES[sys].map(([v, label]) => [sys === 'imperial' ? Math.round(U.units.lbToKg(v) * 1000) / 1000 : v, label]);
  }
  function nearestRate(rate, sys) {
    const opts = rateOptions(sys);
    let best = opts[4];
    opts.forEach((o) => {
      if (Math.abs(o[0] - rate) < Math.abs(best[0] - rate)) best = o;
    });
    return best[0];
  }

  // The body-and-goal form, shared by onboarding and Profile. `p` is a profile-like object; `set(patch)` applies changes.
  function ProfileForm({ p, set, weightKg, setWeightKg, compact }) {
    const sys = p.units || 'imperial';
    const age = C.ageOf(p);
    const fmtW = (kg) => (kg ? String(Math.round((sys === 'imperial' ? U.units.kgToLb(kg) : kg) * 10) / 10) : '');
    const [ft, setFt] = useState(() => (p.heightCm ? String(Math.floor(Math.round(U.units.cmToIn(p.heightCm)) / 12)) : ''));
    const [inch, setInch] = useState(() => (p.heightCm ? String(Math.round(U.units.cmToIn(p.heightCm)) % 12) : ''));
    const [cm, setCm] = useState(() => (p.heightCm ? String(Math.round(p.heightCm)) : ''));
    const [w, setW] = useState(() => fmtW(weightKg));
    const [ageS, setAgeS] = useState(String(age));
    useEffect(() => {
      // Reformat only when the stored weight no longer matches what's typed (e.g. after switching units).
      const cur = parseFloat(w);
      const curKg = cur > 0 ? (sys === 'imperial' ? U.units.lbToKg(cur) : cur) : null;
      if (weightKg && (!curKg || Math.abs(curKg - weightKg) > 0.03)) setW(fmtW(weightKg));
    }, [sys, weightKg]);
    useEffect(() => {
      if (!p.heightCm) return;
      const totalIn = Math.round(U.units.cmToIn(p.heightCm));
      setFt(String(Math.floor(totalIn / 12)));
      setInch(String(totalIn % 12));
      setCm(String(Math.round(p.heightCm)));
    }, [sys]);
    // Onboarding applies every keystroke; the Profile page saves when a field is left.
    const ev = (fn) => (compact ? { onInput: fn, onChange: fn } : { onChange: fn });
    const commitAge = (e) => {
      const a = parseInt(e.target.value, 10);
      if (a >= 13 && a <= 100) set({ birthYear: new Date().getFullYear() - a });
    };
    const commitImperial = (f, i) => {
      const total = (parseInt(f, 10) || 0) * 12 + (parseInt(i, 10) || 0);
      if (total > 36 && total < 100) set({ heightCm: Math.round(U.units.inToCm(total) * 10) / 10 });
    };
    const commitCm = (e) => {
      const v = parseFloat(e.target.value);
      if (v > 90 && v < 260) set({ heightCm: v });
    };
    const commitW = (e) => {
      const v = parseFloat(e.target.value);
      if (v > 0) setWeightKg(sys === 'imperial' ? U.units.lbToKg(v) : v);
    };
    const plan = p.plan || 'balanced';
    const split = C.macroSplit(p);
    const splitSum = split.p + split.c + split.f;
    return html`<div class="pform">
      <div class="grid2">
        <div class="field"><span class="lbl">Sex</span><${Seg} value=${p.sex} options=${[['female', 'Female'], ['male', 'Male']]} onChange=${(v) => set({ sex: v, stage: v === 'male' ? 'none' : p.stage })} label="Sex" /></div>
        <label class="field"><span class="lbl">Age</span>
          <input id="pf-age" class="input num" type="number" inputmode="numeric" min="13" max="100" value=${ageS}
            ...${ev((e) => {
              setAgeS(e.target.value);
              commitAge(e);
            })} />
        </label>
        ${sys === 'imperial'
          ? html`<div class="field"><span class="lbl">Height</span>
              <div class="row gap8">
                <label class="inline-field"><input id="pf-ft" class="input num" type="number" inputmode="numeric" min="3" max="8" value=${ft} aria-label="Feet"
                  ...${ev((e) => {
                    setFt(e.target.value);
                    commitImperial(e.target.value, inch);
                  })} /><span class="unit">ft</span></label>
                <label class="inline-field"><input id="pf-in" class="input num" type="number" inputmode="numeric" min="0" max="11" value=${inch} aria-label="Inches"
                  ...${ev((e) => {
                    setInch(e.target.value);
                    commitImperial(ft, e.target.value);
                  })} /><span class="unit">in</span></label>
              </div>
            </div>`
          : html`<label class="field"><span class="lbl">Height</span><span class="inline-field"><input id="pf-cm" class="input num" type="number" inputmode="numeric" min="100" max="250" value=${cm}
              ...${ev((e) => {
                setCm(e.target.value);
                commitCm(e);
              })} /><span class="unit">cm</span></span></label>`}
        <label class="field"><span class="lbl">Weight</span><span class="inline-field"><input id="pf-w" class="input num" type="number" inputmode="decimal" step="0.1" min="20" value=${w}
          onInput=${(e) => {
            setW(e.target.value);
            if (compact) commitW(e);
          }}
          onChange=${commitW} /><span class="unit">${sys === 'imperial' ? 'lb' : 'kg'}</span></span></label>
        ${p.sex === 'female'
          ? html`<label class="field span2"><span class="lbl">Pregnancy</span>
              <select id="pf-stage" class="input" value=${p.stage || 'none'} onChange=${(e) => set({ stage: e.target.value })}>
                <option value="none">Not pregnant or breastfeeding</option>
                <option value="pregnant">Pregnant</option>
                <option value="lactating">Breastfeeding</option>
              </select></label>`
          : null}
      </div>
      <div class="field"><span class="lbl">Daily activity, not counting workouts</span>
        <div class="choices">
          ${C.ACTIVITY.map((a) => html`<label class=${'choice' + (p.activity === a.id ? ' on' : '')} key=${a.id}>
            <input type="radio" name="pf-activity" value=${a.id} checked=${p.activity === a.id} onChange=${() => set({ activity: a.id })} />
            <b>${a.label}</b><span>${a.hint}</span>
          </label>`)}
        </div>
      </div>
      <div class="grid2">
        <label class="field"><span class="lbl">Goal</span>
          <select id="pf-rate" class="input" value=${String(nearestRate(p.rate || 0, sys))} disabled=${p.stage === 'pregnant' || p.stage === 'lactating'} onChange=${(e) => set({ rate: parseFloat(e.target.value) })}>
            ${rateOptions(sys).map(([v, label]) => html`<option key=${label} value=${String(v)}>${label}</option>`)}
          </select>
        </label>
        <label class="field"><span class="lbl">Macro plan</span>
          <select id="pf-plan" class="input" value=${plan} onChange=${(e) => set({ plan: e.target.value, macros: e.target.value === 'custom' ? p.macros || C.macroSplit(p) : p.macros })}>
            ${Object.entries(C.PLANS).map(([id, pl]) => html`<option key=${id} value=${id}>${pl.label}${pl.p ? ' (' + pl.p + '/' + pl.c + '/' + pl.f + ')' : ''}</option>`)}
          </select>
        </label>
      </div>
      ${plan === 'custom'
        ? html`<div class="grid3">
            ${[['p', 'Protein %'], ['c', 'Carbs %'], ['f', 'Fat %']].map(([k, label]) => html`<label class="field" key=${k}><span class="lbl">${label}</span><input id=${'pf-m' + k} class="input num" type="number" inputmode="numeric" min="0" max="100" value=${split[k]}
              onChange=${(e) => set({ macros: Object.assign({}, split, { [k]: Math.max(0, Math.min(100, parseInt(e.target.value, 10) || 0)) }) })} /></label>`)}
            ${splitSum !== 100 ? html`<p class="error span3" role="alert">These add up to ${splitSum}%. Adjust them to total 100%.</p>` : null}
          </div>`
        : html`<p class="muted small">${C.PLANS[plan].hint}</p>`}
      ${compact ? null : html`<label class="field"><span class="lbl">Body fat % (optional)</span><input id="pf-bf" class="input num" type="number" inputmode="decimal" min="3" max="60" value=${p.bodyFat || ''} placeholder="Leave blank if unsure" onChange=${(e) => set({ bodyFat: parseFloat(e.target.value) || null })} /><span class="hint">With body fat, resting energy uses the Katch-McArdle formula, which accounts for lean mass.</span></label>`}
    </div>`;
  }

  function TargetsPreview({ p, weightKg }) {
    const e = C.energy(p, weightKg);
    const T = C.targets(p, weightKg);
    return html`<div class="tpreview">
      <div class="tp-main"><span class="lbl">Daily calorie goal</span><b>${U.fmt(e.target, 0)}</b><span class="unit">kcal</span></div>
      <div class="tp-macros">
        ${MACROS.slice(0, 3).map((m) => html`<span key=${m.key}><i class="sw" style=${'background:' + m.color}></i>${m.label} <b>${macroAmt(0, T[m.key]).replace(/^0 \/ /, '')}</b></span>`)}
      </div>
      <p class="muted small">Resting ${U.fmt(e.bmr, 0)} kcal (${e.method}) × activity = ${U.fmt(e.tdee, 0)} kcal to maintain${e.delta ? ', ' + (e.delta < 0 ? '−' : '+') + U.fmt(Math.abs(e.delta), 0) + ' for your goal' : ''}${e.extra ? ', +' + e.extra + ' for ' + (p.stage === 'pregnant' ? 'pregnancy' : 'breastfeeding') : ''}.</p>
      ${e.floored ? html`<p class="warn-note"><${Icon} name="alert" size=${16} /> Raised to ${U.fmt(e.floor, 0)} kcal, the lowest goal this app sets without medical supervision. A slower rate would get you there safely.</p>` : null}
    </div>`;
  }

  function OnboardSheet({ onClose }) {
    const [p, setP] = useState(() => ({ sex: 'female', birthYear: new Date().getFullYear() - 30, heightCm: null, activity: 'light', rate: 0, plan: 'balanced', units: DV.defaultUnits(), eatBack: true, overrides: {}, stage: 'none' }));
    const [kg, setKg] = useState(null);
    const set = (patch) => setP(Object.assign({}, p, patch));
    const ok = p.heightCm > 90 && kg > 20 && (p.plan !== 'custom' || C.macroSplit(p).p + C.macroSplit(p).c + C.macroSplit(p).f === 100);
    return html`<${Sheet} title="Set up your diary" onClose=${onClose} wide tall
      footer=${html`<button type="button" class="btn btn-primary" disabled=${!ok} onClick=${() => {
        A.startDiary(Object.assign({}, p, { weightKg: Math.round(kg * 100) / 100 }));
        A.setView('diary');
        onClose();
        A.toast('Your diary is ready. Log your first food with the + button.');
      }}>Start my diary</button>`}>
      <div class="stack">
        <p class="lede">A few details set your calorie goal and the vitamin and mineral targets for your age and sex. You can change any of it later.</p>
        ${canSignIn() ? html`<p class="small">Already have an account? <button type="button" class="linkbtn" onClick=${() => A.open({ type: 'signin' })}>Sign in instead</button></p>` : null}
        <div class="field"><span class="lbl">Units</span><${Seg} value=${p.units} options=${[['imperial', 'lb, ft, fl oz'], ['metric', 'kg, cm, mL']]} onChange=${(v) => set({ units: v })} label="Units" /></div>
        <${ProfileForm} p=${p} set=${set} weightKg=${kg} setWeightKg=${setKg} compact />
        ${ok ? html`<${TargetsPreview} p=${p} weightKg=${kg} />` : html`<p class="muted small">Enter your height and weight to see your targets.</p>`}
        <p class="muted small">Your diary is saved to your Claude account where available, so it follows you across devices. Only you can see it.</p>
      </div>
    <//>`;
  }

  // ---------------------------------------------------------------------------
  // Email accounts (installable app only; js/account.js). Sign-in is a one-time code sent by email, or the
  // sign-in link in that email when the project's emails carry a link instead.
  const canSignIn = () => !!(DV.account && DV.account.configured && !DV.account.signedIn);
  function accountMessage(e) {
    switch (e && e.code) {
      case 'rate_limited':
        return 'Too many sign-in emails have been sent. Wait a few minutes, then try again.';
      case 'bad_code':
        return 'That code or link is wrong, already used, or expired. Use the newest email, or send a new one.';
      case 'bad_email':
        return 'That doesn’t look like an email address. Check it and try again.';
      case 'not_authorized':
        return 'The app can’t email this address yet: until its owner sets up an email service, it only sends to the owner’s own address.';
      case 'signups_closed':
        return 'This copy of the app isn’t taking new accounts. Use the email you signed up with.';
      case 'setup':
      case 'unauthenticated':
        return 'The account service isn’t set up correctly for this app yet.';
      case 'unavailable':
        return 'Couldn’t reach the account service. Check your connection and try again.';
      default:
        return (e && e.message) || 'Something went wrong. Try again.';
    }
  }
  // After signing in (with a code here, or a tapped link on start-up): load the account's diary, or set one up.
  async function afterSignIn(hadDiary) {
    const AC = DV.account;
    const ok = await A.connectAccount();
    if (!ok) {
      A.toast('Signed in as ' + AC.email + '. Your diary will load as soon as your account can be reached.', { ms: 7000 });
      return false;
    }
    if (S.mode === 'user') A.toast('Signed in as ' + AC.email + (hadDiary ? '. This device’s diary is now in your account.' : '.'), { ms: 6000 });
    else {
      // A new account: set up the diary next.
      A.open({ type: 'onboard' });
      A.toast('Signed in as ' + AC.email + '. Set up your diary to start.', { ms: 6000 });
    }
    return true;
  }
  // A tapped sign-in link comes back to the app with the session in the address.
  function finishLinkSignIn() {
    const AC = DV.account;
    if (!AC || !AC.configured) return;
    const hadDiary = S.mode === 'user';
    AC.finishLinkSignIn()
      .then((done) => done && afterSignIn(hadDiary))
      .catch((e) => A.toast(accountMessage(e), { ms: 8000 }));
  }

  function AccountCard() {
    const AC = DV.account;
    if (!AC || !AC.configured) return null;
    if (!AC.signedIn) {
      return html`<section class="panel pad-panel acct" aria-label="Account">
        <div class="acct-row">
          <div>
            <h2 class="h2">Account</h2>
            <p class="muted small">Sign in with your email to keep your diary in your account and use it on your phone and computer. There’s no password: we email you a code.</p>
          </div>
          <button type="button" class="btn btn-primary" onClick=${() => A.open({ type: 'signin' })}><${Icon} name="user" size=${16} /> Sign in</button>
        </div>
      </section>`;
    }
    const done = () => A.toast('Signed out');
    const signOut = () =>
      A.open({
        type: 'confirm',
        title: 'Sign out?',
        body: 'Your diary stays in your account. This device goes back to the example diary until you sign in again.',
        confirm: 'Sign out',
        run: () =>
          A.signOut().then((r) => {
            if (!r.unsent) return done();
            // Pending changes couldn't be sent: say so before anything is lost.
            A.open({
              type: 'confirm',
              title: 'Some changes haven’t synced',
              body:
                r.unsent +
                (r.unsent === 1 ? ' change' : ' changes') +
                ' on this device couldn’t be sent to your account. If you sign out now, ' +
                (r.unsent === 1 ? 'it’s' : 'they’re') +
                ' lost. Try again when you’re connected, or sign out anyway.',
              confirm: 'Sign out anyway',
              danger: true,
              run: () => A.signOut({ force: true }).then(done),
            });
          }),
      });
    const del = () =>
      A.open({
        type: 'confirm',
        title: 'Delete your account?',
        body: 'This permanently deletes the account for ' + AC.email + ' and the diary stored in it. This device keeps its own copy of your diary.',
        confirm: 'Delete account',
        danger: true,
        run: () =>
          A.deleteAccount()
            .then(() => A.toast('Account deleted'))
            .catch((e) => A.toast(accountMessage(e), { ms: 7000 })),
      });
    return html`<section class="panel pad-panel acct" aria-label="Account">
      <div class="acct-row">
        <div>
          <h2 class="h2">Account</h2>
          <p class="acct-email">Signed in as <b>${AC.email}</b></p>
          <p class="row gap8"><${SyncStatus} /></p>
        </div>
        <div class="row gap8 wrap">
          <button type="button" class="btn" onClick=${signOut}>Sign out</button>
          <button type="button" class="btn btn-danger" onClick=${del}><${Icon} name="trash" size=${16} /> Delete account</button>
        </div>
      </div>
      <p class="muted small top8">Your diary is kept in your account and syncs to every device where you sign in with this email. The database lets each account read only its own entries.</p>
    </section>`;
  }

  function SignInSheet({ onClose }) {
    const AC = DV.account;
    const [step, setStep] = useState('email'); // email | code | waiting
    const [email, setEmail] = useState(() => S.acctEmail || DV.uiPrefs.read().lastEmail || '');
    const [code, setCode] = useState('');
    const [linkMode, setLinkMode] = useState(false); // the email had a link rather than a code
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState('');
    const [sentAt, setSentAt] = useState(0);
    const [now, setNow] = useState(Date.now());
    useEffect(() => {
      if (step !== 'code') return;
      const el = document.getElementById('si-code');
      if (el) el.focus();
      const t = setInterval(() => setNow(Date.now()), 1000);
      return () => clearInterval(t);
    }, [step, linkMode]);
    if (!AC || !AC.configured) return html`<${Sheet} title="Sign in" onClose=${onClose}><p>Accounts aren’t set up for this copy of the app.</p><//>`;
    const addr = email.trim();
    const okEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr);
    const entry = linkMode ? code.trim() : code.replace(/\D/g, '');
    const okEntry = linkMode ? AC.isLink(entry) : /^\d{6,10}$/.test(entry);
    const wait = Math.max(0, 60 - Math.floor((now - sentAt) / 1000));
    const unsynced = A.unsynced();
    const send = async (e) => {
      if (e) e.preventDefault();
      if (!okEmail || busy) return;
      setBusy(true);
      setErr('');
      try {
        await AC.sendCode(addr);
        DV.uiPrefs.write({ lastEmail: addr });
        setCode('');
        setSentAt(Date.now());
        setNow(Date.now());
        setStep('code');
      } catch (x) {
        setErr(accountMessage(x));
      }
      setBusy(false);
    };
    const verify = async (e) => {
      if (e) e.preventDefault();
      if (!okEntry || busy) return;
      setBusy(true);
      setErr('');
      const hadDiary = S.mode === 'user';
      try {
        await AC.verifyCode(addr, entry);
      } catch (x) {
        setErr(accountMessage(x));
        setBusy(false);
        return;
      }
      const connected = await afterSignIn(hadDiary);
      if (connected && S.mode === 'user') onClose();
      else if (!connected) {
        setBusy(false);
        setStep('waiting');
      }
    };
    const error = err ? html`<p class="error" role="alert"><${Icon} name="alert" size=${16} /> ${err}</p>` : null;
    if (step === 'waiting') {
      return html`<${Sheet} title="Signed in" onClose=${onClose} footer=${html`<button type="button" class="btn btn-primary" onClick=${onClose}>OK</button>`}>
        <p class="lede">You’re signed in as <b>${AC.email}</b>, but your account couldn’t be reached just now. Your diary will load and sync on its own once the connection is back.</p>
      <//>`;
    }
    if (step === 'email') {
      return html`<${Sheet} title="Sign in" onClose=${onClose} focus="#si-email">
        <form class="stack" onSubmit=${send}>
          <p class="lede">Keep your diary in your account and use it on your phone and computer.</p>
          <label class="field"><span class="lbl">Email</span>
            <input id="si-email" class="input" type="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" value=${email} onInput=${(e) => setEmail(e.target.value)} />
          </label>
          <button type="submit" class="btn btn-primary" disabled=${!okEmail || busy}>${busy ? html`<${Spinner} /> Sending…` : 'Email me a code'}</button>
          ${error}
          ${S.mode === 'user' && S.acctEmail && okEmail && addr.toLowerCase() !== S.acctEmail.toLowerCase()
            ? html`<p class="warn-note"><${Icon} name="alert" size=${16} /> The diary on this device belongs to ${S.acctEmail}. Signing in with a different email removes it from this device; it stays in that account${unsynced ? ', except ' + unsynced + (unsynced === 1 ? ' change that hasn’t' : ' changes that haven’t') + ' synced yet' : ''}.</p>`
            : null}
          <p class="muted small">We’ll email you a sign-in code; there’s no password. If you’re new, this creates your account${S.mode === 'user' && !(S.acctEmail && addr.toLowerCase() !== S.acctEmail.toLowerCase()) ? ', and the diary on this device goes into it' : ''}.</p>
        </form>
      <//>`;
    }
    return html`<${Sheet} title=${linkMode ? 'Paste your sign-in link' : 'Enter your code'} onClose=${onClose} onBack=${() => (setStep('email'), setErr(''))}>
      <form class="stack" onSubmit=${verify}>
        <p class="lede">We sent an email to <b>${addr}</b>.</p>
        ${linkMode
          ? html`<label class="field"><span class="lbl">Sign-in link</span>
              <textarea id="si-code" class="input mono" rows="3" autocapitalize="off" spellcheck="false" placeholder="https://…" value=${code} onInput=${(e) => setCode(e.target.value)}></textarea>
              <span class="hint">In the email, press and hold the sign-in link, choose Copy, then paste it here.</span>
            </label>`
          : html`<label class="field"><span class="lbl">Code</span>
              <input id="si-code" class="input num code-in" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="12" value=${code} onInput=${(e) => setCode(e.target.value)} />
            </label>`}
        <button type="submit" class="btn btn-primary" disabled=${!okEntry || busy}>${busy ? html`<${Spinner} /> Signing in…` : 'Sign in'}</button>
        ${error}
        <div class="row gap8 wrap">
          <button type="button" class="linkbtn" disabled=${wait > 0 || busy} onClick=${send}>${wait > 0 ? 'Send a new email in ' + wait + ' s' : 'Send a new email'}</button>
          <span class="muted small">·</span>
          <button type="button" class="linkbtn" onClick=${() => (setStep('email'), setErr(''))}>Use a different email</button>
        </div>
        ${linkMode
          ? html`<p class="muted small">On a computer or an Android phone, you can also just tap the link in the email. <button type="button" class="linkbtn" onClick=${() => (setLinkMode(false), setCode(''), setErr(''))}>Got a code instead?</button></p>`
          : html`<p class="muted small">It can take a minute to arrive; check your spam folder too. <button type="button" class="linkbtn" onClick=${() => (setLinkMode(true), setCode(''), setErr(''))}>The email has a link instead of a code?</button></p>`}
      </form>
    <//>`;
  }

  // Installable-app build only: how to install on this device, or confirmation that it's installed.
  function InstallCard() {
    const P = DV.pwa;
    if (!P) return null;
    let body;
    if (P.installed) body = html`<p class="good-note"><${Icon} name="check" size=${16} stroke=${3} /> You’re using the installed app.</p>`;
    else if (P.canPrompt)
      body = html`<p class="muted small">Adds Daily Value to your home screen and app list. It opens full screen and works offline.</p>
        <button type="button" class="btn btn-primary top8" onClick=${() => P.prompt()}><${Icon} name="download" size=${16} /> Install Daily Value</button>`;
    else if (P.ios)
      body = html`<ol class="steps">
        <li>In Safari, tap the Share button <${Icon} name="share" size=${16} />. On iPhone with iOS 26 it’s in the <b>⋯</b> menu next to the address bar.</li>
        <li>Choose <b>Add to Home Screen</b> (tap <b>More</b> if you don’t see it) and leave <b>Open as Web App</b> on.</li>
        <li>Tap <b>Add</b>. Daily Value then opens from its icon, full screen, and works offline.</li>
      </ol>`;
    else if (P.android)
      body = html`<p class="muted small">Open your browser’s menu (⋮) and tap <b>Install app</b> or <b>Add to Home screen</b>. If Daily Value is already installed, tap <b>Open in app</b> there instead.</p>`;
    else body = html`<p class="muted small">To install it, open this page in Chrome, Edge or Samsung Internet on Android, or Safari on iPhone and iPad. On a computer, Chrome and Edge show an install button in the address bar.</p>`;
    return html`<section class="panel pad-panel top16" aria-label="Get the app">
      <h2 class="h2">Get the app</h2>
      ${body}
      <p class="muted small top8">${canSignIn() || S.cloud === 'account'
        ? 'Sign in with the same email on each device (Account, above) and your diary syncs between them.'
        : html`The app keeps its diary on this device${P.ios ? ', and on iPhone the Home Screen app’s diary is separate from Safari’s' : ''}. To move entries between the app, a browser or another device, use Copy backup and Paste a backup below, or Back up and Restore backup with a file.`}</p>
    </section>`;
  }

  function ProfileView() {
    const p = S.profile;
    const sys = p.units || 'imperial';
    const kg = DV.calc.weightOn(U.today());
    const T = DV.calc.targetsFor(U.today());
    const set = (patch) => A.updateProfile(patch);
    const sample = S.mode === 'sample';
    const customKeys = Object.keys(p.overrides || {}).concat(p.kcalOverride > 0 ? ['kcal'] : []);
    const exportFile = (kind) =>
      saveTextFile('daily-value-' + U.today() + (kind === 'json' ? '.json' : '.csv'), kind === 'json' ? A.exportJSON() : A.exportCSV(), kind === 'json' ? 'Backup' : 'Diary as CSV');
    const importFile = (file) => {
      if (!file) return;
      const r = new FileReader();
      r.onload = () => {
        try {
          A.importJSON(String(r.result));
          A.toast('Backup restored');
        } catch (e) {
          A.toast(e.message || 'That file couldn’t be read.');
        }
      };
      r.readAsText(file);
    };
    return html`<div class="view profile">
      <header class="view-h"><h1>Profile & targets</h1><p class="muted">${sample ? 'Showing the example person. Start your own diary to enter your details.' : 'Changes update your targets right away.'}</p></header>
      <${AccountCard} />
      <div class="profile-grid">
        <section class="panel pad-panel" aria-label="About you">
          <h2 class="h2">About you</h2>
          ${sample
            ? html`<div class="stack"><p>This profile belongs to the example diary.</p><button type="button" class="btn btn-primary" onClick=${() => A.open({ type: 'onboard' })}>Start my diary</button></div>`
            : html`<div class="stack">
                <div class="field"><span class="lbl">Units</span><${Seg} value=${sys} options=${[['imperial', 'lb, ft, fl oz'], ['metric', 'kg, cm, mL']]} onChange=${(v) => set({ units: v })} label="Units" /></div>
                <${ProfileForm} p=${p} set=${set} weightKg=${kg} setWeightKg=${(v) => A.setWeight(U.today(), v)} />
              </div>`}
        </section>
        <section class="panel pad-panel" aria-label="Daily targets">
          <h2 class="h2">Daily targets</h2>
          <${TargetsPreview} p=${p} weightKg=${kg} />
          ${sample
            ? null
            : html`<div class="stack top16">
                <label class="field"><span class="lbl">Calorie goal override</span><span class="inline-field"><input id="pf-kcal" class="input num" type="number" inputmode="numeric" min="800" max="6000" value=${p.kcalOverride || ''} placeholder="Automatic"
                  onChange=${(e) => set({ kcalOverride: parseFloat(e.target.value) || null })} /><span class="unit">kcal</span></span></label>
                <label class="check"><input type="checkbox" checked=${p.eatBack !== false} onChange=${(e) => set({ eatBack: e.target.checked })} /> Add exercise calories to my daily budget</label>
                <label class="check"><input type="checkbox" checked=${p.suggest !== false} onChange=${(e) => set({ suggest: e.target.checked })} /> Show one-tap suggestions of foods I often eat under each meal</label>
                <label class="field"><span class="lbl">Water goal</span><span class="inline-field"><input id="pf-water" class="input num" type="number" inputmode="numeric" min="0" value=${p.waterGoal ? Math.round(sys === 'imperial' ? U.units.mlToOz(p.waterGoal) : p.waterGoal) : ''} placeholder=${String(Math.round(sys === 'imperial' ? U.units.mlToOz(C.waterGoal(Object.assign({}, p, { waterGoal: null }))) : C.waterGoal(Object.assign({}, p, { waterGoal: null }))))}
                  onChange=${(e) => {
                    const v = parseFloat(e.target.value);
                    set({ waterGoal: v > 0 ? Math.round(sys === 'imperial' ? U.units.ozToMl(v) : v) : null });
                  }} /><span class="unit">${sys === 'imperial' ? 'fl oz' : 'mL'}</span></span></label>
              </div>`}
        </section>
      </div>

      <section class="panel pad-panel top16" aria-label="Your goals">
        <header class="row between wrap gap8">
          <div>
            <h2 class="h2">Your goals</h2>
            <p class="muted small">Defaults follow the Dietary Reference Intakes for ${p.sex === 'male' ? 'men' : 'women'} aged ${C.ageOf(p)}${p.stage === 'pregnant' ? ' during pregnancy' : p.stage === 'lactating' ? ' while breastfeeding' : ''}, and your calorie goal and macro plan. ${sample ? 'Start your own diary to set your own goals.' : 'Select any nutrient to set your own: aim for an amount, at least, at most, a range, or no goal. Macros can also be a share of calories or grams per body weight.'}</p>
          </div>
          ${customKeys.length && !sample
            ? html`<button type="button" class="btn btn-sm" onClick=${() =>
                A.open({ type: 'confirm', title: 'Reset all goals?', body: 'Your ' + customKeys.length + (customKeys.length === 1 ? ' custom goal goes' : ' custom goals go') + ' back to the defaults.', confirm: 'Reset goals', run: () => {
                  A.resetGoals();
                  A.toast('Goals reset to the defaults');
                } })}>Reset all to defaults</button>`
            : null}
        </header>
        <div class="goal-list">
          ${C.GROUPS.map(([g, label]) => html`<div class="goal-grp" key=${g}>
            <h3 class="goal-grp-h">${label}</h3>
            ${nutrientKeys(g)
              .filter((k) => k !== 'water')
              .map((k) => {
                const mine = customKeys.includes(k);
                return html`<button type="button" key=${k} class=${'goal-row' + (mine ? ' mine' : '')} disabled=${sample} onClick=${() => A.open({ type: 'goal', key: k })}>
                  <span class="gn">${C.NUTRIENTS[k].label}</span>
                  <span class="gv">${goalText(k, T[k])}</span>
                  ${mine ? html`<span class="badge">Yours</span>` : null}
                  <${Icon} name="right" size=${16} />
                </button>`;
              })}
          </div>`)}
        </div>
      </section>

      <${InstallCard} />

      <div class="profile-grid top16">
        <section class="panel pad-panel" aria-label="Your data">
          <h2 class="h2">Your data</h2>
          <p class="row gap8"><${SyncStatus} /></p>
          <p class="muted small">${S.cloud === 'account'
            ? 'Your diary is kept in your account and on this device, and syncs to every device where you sign in.'
            : S.backend === 'cloud'
            ? 'Your diary is stored with this page in your Claude account, in a private space only you can read, and syncs across your devices.'
            : 'Your diary is saved in this browser. Export a backup now and then so you don’t lose it if browser data is cleared.'}</p>
          ${DV.pwa && DV.pwa.ios && !DV.pwa.installed && !sample
            ? html`<p class="warn-note top8"><${Icon} name="alert" size=${16} /> Safari can erase this diary if you go 7 days of using Safari without opening Daily Value. Add it to your Home Screen (see Get the app above) and move your entries there with Copy backup and Paste a backup.</p>`
            : null}
          <div class="row gap8 wrap top8">
            <button type="button" class="btn" disabled=${sample} onClick=${() => exportFile('json')}><${Icon} name="download" size=${16} /> Back up (JSON)</button>
            <button type="button" class="btn" disabled=${sample} onClick=${() => exportFile('csv')}><${Icon} name="download" size=${16} /> Export diary (CSV)</button>
            <label class="btn"><${Icon} name="upload" size=${16} /> Restore backup<input class="sr" type="file" accept=".json,application/json" onChange=${(e) => importFile(e.target.files && e.target.files[0])} /></label>
          </div>
          <div class="row gap8 wrap top8">
            <button type="button" class="btn btn-sm" disabled=${sample} onClick=${copyBackup}><${Icon} name="copy" size=${16} /> Copy backup</button>
            <button type="button" class="btn btn-sm" onClick=${() => A.open({ type: 'paste' })}><${Icon} name="list" size=${16} /> Paste a backup</button>
          </div>
          ${sample
            ? null
            : html`<button type="button" class="btn btn-danger top16" onClick=${() =>
                A.open({ type: 'confirm', title: 'Delete all data?', body: 'This permanently deletes your diary, foods, recipes and profile' + (S.cloud === 'account' ? ' from your account and this device' : S.backend === 'cloud' ? ' from your Claude account and this browser' : ' from this browser') + '. Export a backup first if you might want it later.', confirm: 'Delete everything', danger: true, run: () => A.resetAll().then(() => A.toast('All data deleted')) })}><${Icon} name="trash" size=${16} /> Delete all data</button>`}
        </section>
        <section class="panel pad-panel about" aria-label="About the numbers">
          <h2 class="h2">About the numbers</h2>
          <p><b>Foods</b> come from USDA FoodData Central: SR Legacy (April 2018) and FNDDS 2021–2023. Values are per 100 g and scaled to your serving. FNDDS doesn’t report amino acids, manganese or trans fat; where a food’s USDA ingredient recipe allows, those are estimated from its ingredients.</p>
          <p><b>Brand-name products</b> come from USDA’s Branded Foods database (December 2025) and, for store brands USDA lacks (Kirkland Signature, Trader Joe’s, Aldi, Costco), from <a href="https://world.openfoodfacts.org" target="_blank" rel="noopener">Open Food Facts</a> (© Open Food Facts contributors, Open Database License). They carry what the package label lists, usually calories, macros, sodium, sugars and a few vitamins and minerals. Drinks measured in milliliters are counted as 1 g per ml. Products with impossible values, or with calories that don’t fit their protein, carbs and fat, were left out.</p>
          <p><b>Targets</b> use the National Academies’ Dietary Reference Intakes. Calories use the Mifflin-St Jeor equation, or Katch-McArdle when you enter body fat.</p>
          <p><b>Exercise</b> estimates use MET values from the Compendium of Physical Activities, minus resting burn.</p>
          <p class="muted small">Daily Value is for general tracking and isn’t medical advice. If you’re pregnant, managing a health condition or aiming for a very low calorie intake, work with a clinician or registered dietitian.</p>
        </section>
      </div>
    </div>`;
  }

  // ---------------------------------------------------------------------------
  // Boot
  DV.boot();
  finishLinkSignIn();
  AI.init();
  render(html`<${App} />`, document.getElementById('app'));
})();
