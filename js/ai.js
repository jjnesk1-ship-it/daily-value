/* Daily Value: features that ask Claude (meal description or photo -> foods, label photo -> custom food, day review). */
(function () {
  'use strict';
  const DV = window.DV;
  const U = DV.util;
  const { NUTRIENTS } = DV.core;

  const AI = (DV.ai = {
    fn: null, // the sample function, once available
    available: false,
    images: false,
    imageTypes: [],
    disabledReason: '',
  });

  AI.init = async function () {
    const claude = window.claude;
    if (!claude || typeof claude.use !== 'function') return;
    let s = null;
    try {
      s = await claude.use('sample');
    } catch (e) {}
    if (!s) return;
    AI.fn = s;
    AI.available = true;
    try {
      const lim = await s.limits();
      AI.images = !!(lim && lim.images);
      AI.imageTypes = (lim && lim.images && lim.images.mediaTypes) || [];
    } catch (e) {}
    DV.emit();
  };

  // Viewer-facing copy for each failure.
  AI.message = function (e) {
    const code = (e && e.code) || 'upstream_error';
    switch (code) {
      case 'cancelled':
        return '';
      case 'not_granted':
      case 'sampling_disabled':
      case 'not_declared':
      case 'capability_disabled':
      case 'capability_removed':
        return 'Claude isn’t available on this page, so AI logging is turned off.';
      case 'rate_limited':
        return 'Claude is handling too many requests right now. Try again in a minute.';
      case 'session_expired':
        return 'Sign in to Claude again, then retry.';
      case 'image_rejected':
        return 'That photo couldn’t be read. Try a JPEG or PNG under 20 MB.';
      case 'images_unavailable':
        return 'Photos can’t be sent from here. Describe the meal in words instead.';
      case 'refused':
        return 'Claude couldn’t help with that. Try describing it differently.';
      case 'invalid_json':
      case 'empty_completion':
        return 'Claude’s answer came back in a form the app couldn’t read. Try again.';
      case 'prompt_too_large':
        return 'That’s too much to send at once. Try a shorter description.';
      default:
        return 'Something went wrong reaching Claude. Try again.';
    }
  };
  function handleFatal(e) {
    const code = e && e.code;
    if (['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed'].includes(code)) {
      AI.available = false;
      AI.disabledReason = AI.message(e);
      DV.emit();
    }
    if (code === 'images_unavailable') {
      AI.images = false;
      DV.emit();
    }
  }

  // ---------------------------------------------------------------------------
  // Meal description / photo -> list of foods matched against the USDA database
  AI.parseMeal = async function ({ text, image, signal }) {
    if (!AI.fn) throw { code: 'not_granted' };
    const prompt = [
      'You turn a meal into a list of foods for a nutrition tracker that searches the USDA FoodData Central database and a database of brand-name products.',
      text ? 'What the person ate: """' + text.slice(0, 2000) + '"""' : '',
      image ? 'A photo of the meal is attached. Identify each food and estimate its portion from the photo' + (text ? ', using the description above as well.' : '.') : '',
      '',
      'Rules:',
      '- One item per distinct food or drink. Keep composite dishes (lasagna, burrito, pizza, sandwich) as one item unless the parts are clearly separate.',
      '- "query": 2 to 6 words in USDA naming style, main food first, then type and preparation. Examples: "egg whole scrambled", "bread whole wheat toasted", "chicken breast grilled", "rice white cooked", "coffee brewed", "milk 2%", "pizza cheese thin crust".',
      '- "grams": best estimate of the edible weight eaten, as a number. For drinks, grams roughly equal millilitres.',
      '- "amount": the portion in everyday words, like "2 large eggs", "1 slice", "1.5 cups".',
      '- "label": a short readable name, like "Scrambled eggs".',
      '- "brand": the brand or store brand when the person names one or it is readable on a package in the photo, like "Kirkland Signature", "Chobani" or "Trader Joe\'s"; otherwise "". Restaurant names are not brands here.',
      '- For a branded item, "query" is the product name as the package would say it, without the brand, like "protein bar chocolate chip cookie dough" or "greek yogurt vanilla".',
      '',
      'Reply with only JSON, no other text, in this shape:',
      '{"items":[{"label":"Scrambled eggs","query":"egg scrambled","grams":120,"amount":"2 large eggs","brand":""}]}',
      'If nothing described is food or drink, reply {"items":[]}.',
    ]
      .filter((x) => x !== '')
      .join('\n');
    const opts = { modelTier: image ? 'default' : 'quick', cache: false };
    if (signal) opts.signal = signal;
    if (image) opts.images = image;
    try {
      const out = await AI.fn.json(prompt, opts);
      const items = Array.isArray(out && out.items) ? out.items : Array.isArray(out) ? out : [];
      return items
        .filter((x) => x && (x.query || x.label))
        .slice(0, 20)
        .map((x) => ({
          label: String(x.label || x.query).slice(0, 80),
          query: String(x.query || x.label).slice(0, 80),
          grams: Math.max(1, Math.min(3000, Number(x.grams) || 100)),
          amount: String(x.amount || '').slice(0, 60),
          brand: String(x.brand || '').slice(0, 60),
        }));
    } catch (e) {
      handleFatal(e);
      throw e;
    }
  };

  // ---------------------------------------------------------------------------
  // Nutrition Facts label photo -> custom food fields (per serving)
  const LABEL_KEYS = {
    kcal: 'Calories', fat: 'Total fat (g)', sat: 'Saturated fat (g)', trans: 'Trans fat (g)', chol: 'Cholesterol (mg)',
    na: 'Sodium (mg)', carbs: 'Total carbohydrate (g)', fiber: 'Dietary fiber (g)', sugars: 'Total sugars (g)', prot: 'Protein (g)',
    vitD: 'Vitamin D (µg)', ca: 'Calcium (mg)', fe: 'Iron (mg)', k: 'Potassium (mg)', vitA: 'Vitamin A (µg RAE)', vitC: 'Vitamin C (mg)',
    vitE: 'Vitamin E (mg)', vitK: 'Vitamin K (µg)', b1: 'Thiamin (mg)', b2: 'Riboflavin (mg)', b3: 'Niacin (mg)', b6: 'Vitamin B6 (mg)',
    folate: 'Folate (µg DFE)', b12: 'Vitamin B12 (µg)', mg: 'Magnesium (mg)', zn: 'Zinc (mg)', p: 'Phosphorus (mg)', se: 'Selenium (µg)',
    cu: 'Copper (mg)', mn: 'Manganese (mg)', choline: 'Choline (mg)', caffeine: 'Caffeine (mg)',
  };
  AI.readLabel = async function ({ image, signal }) {
    if (!AI.fn) throw { code: 'not_granted' };
    const keys = Object.entries(LABEL_KEYS)
      .map(([k, v]) => '"' + k + '": ' + v)
      .join(', ');
    const prompt = [
      'Read the Nutrition Facts label in the attached photo.',
      'Reply with only JSON. Use amounts for ONE serving as printed. Leave out any nutrient that is not on the label.',
      'Keys: "name" (product name if visible, else ""), "serving_text" (like "2/3 cup (55g)"), "serving_grams" (number; estimate if only volume is given), ' + keys + '.',
      'If a vitamin or mineral is shown only as %DV, convert it with the FDA Daily Values: vitamin D 20 µg, calcium 1300 mg, iron 18 mg, potassium 4700 mg, vitamin A 900 µg, vitamin C 90 mg, vitamin E 15 mg, vitamin K 120 µg, thiamin 1.2 mg, riboflavin 1.3 mg, niacin 16 mg, vitamin B6 1.7 mg, folate 400 µg, vitamin B12 2.4 µg, magnesium 420 mg, zinc 11 mg, phosphorus 1250 mg, selenium 55 µg, copper 0.9 mg, manganese 2.3 mg, choline 550 mg.',
      'If the photo is not a nutrition label, reply {"error":"not a label"}.',
    ].join('\n');
    const opts = { images: image, modelTier: 'default', cache: false };
    if (signal) opts.signal = signal;
    try {
      const out = await AI.fn.json(prompt, opts);
      if (!out || out.error) throw { code: 'refused', message: 'not a label' };
      const per = {};
      Object.keys(LABEL_KEYS).forEach((k) => {
        const v = Number(out[k]);
        if (out[k] != null && !Number.isNaN(v)) per[k] = v;
      });
      return {
        name: String(out.name || '').slice(0, 80),
        servingText: String(out.serving_text || '').slice(0, 40),
        servingG: Number(out.serving_grams) > 0 ? Number(out.serving_grams) : null,
        values: per,
      };
    } catch (e) {
      handleFatal(e);
      throw e;
    }
  };

  // ---------------------------------------------------------------------------
  // Day review (streams plain text)
  AI.reviewDay = async function ({ date, onText, signal }) {
    if (!AI.fn) throw { code: 'not_granted' };
    const S = DV.state;
    const p = S.profile;
    const day = S.days[date];
    const tot = DV.calc.dayTotals(day);
    const T = DV.calc.targetsFor(date);
    const age = DV.core.ageOf(p);
    const w = DV.calc.weightOn(date);
    const plan = (DV.core.PLANS[p.plan] || DV.core.PLANS.balanced).label;
    const goal = p.rate < 0 ? 'lose ' + Math.abs(p.rate) + ' kg a week' : p.rate > 0 ? 'gain ' + p.rate + ' kg a week' : 'maintain weight';
    const lines = [];
    const rowFor = (k) => {
      const t = T[k];
      const v = tot.n[k];
      const tv = DV.core.targetValue(t);
      if (tv == null) return;
      const st = DV.core.status(v, t);
      lines.push(NUTRIENTS[k].label + ': ' + U.fmtNutrient(k, v) + ' of ' + (t.kind === 'max' ? 'limit ' : 'target ') + U.fmtNutrient(k, tv) + ' (' + U.fmtPct(st.pct) + ')' + (t.max != null && t.kind !== 'max' ? ', upper limit ' + U.fmtNutrient(k, t.max) : ''));
    };
    ['kcal', 'prot', 'carbs', 'fat', 'fiber', 'sat', 'na', 'k', 'ca', 'fe', 'mg', 'zn', 'vitA', 'vitC', 'vitD', 'vitE', 'vitK', 'folate', 'b12', 'choline', 'o3', 'caffeine', 'alcohol'].forEach(rowFor);
    const foods = DV.MEALS.map(([m, label]) => {
      const es = ((day && day.entries) || []).filter((e) => e.meal === m);
      if (!es.length) return label + ': nothing logged';
      return label + ': ' + es.map((e) => (e.quick ? e.name + ' (' + Math.round(e.s.kcal) + ' kcal)' : e.name + ' (' + U.fmtQty(e.qty) + ' × ' + e.unit + ')')).join('; ');
    }).join('\n');
    const burned = DV.calc.exerciseTotal(day);
    const prompt = [
      'You are a friendly, practical nutrition coach reviewing one day of food logging. Be specific and encouraging. Do not diagnose or give medical advice.',
      'Person: ' + (p.sex === 'male' ? 'male' : 'female') + ', ' + age + ' years, ' + Math.round(w) + ' kg. Goal: ' + goal + '. Macro plan: ' + plan + '.',
      'Exercise logged: ' + (burned ? burned + ' active kcal' : 'none') + '.',
      'Intake vs targets for ' + date + ':',
      lines.join('\n'),
      'Foods:',
      foods,
      '',
      'Write, in plain text with "- " bullets and no headings or bold:',
      'One sentence with the overall picture of the day.',
      'Then up to 3 bullets on the most important gaps or excesses, with numbers.',
      'Then 3 bullets with specific foods and portions to add or swap tomorrow to close the biggest gaps.',
      'If dinner or other meals are not logged yet, account for that instead of calling the day low. Keep it under 170 words.',
    ].join('\n');
    const opts = { onText, cache: false };
    if (signal) opts.signal = signal;
    try {
      return await AI.fn(prompt, opts);
    } catch (e) {
      handleFatal(e);
      throw e;
    }
  };
})();
