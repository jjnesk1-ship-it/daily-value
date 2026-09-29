/* Daily Value: core nutrition logic.
   Nutrient definitions, Dietary Reference Intake targets, energy math, units, dates, formatting. */
(function () {
  'use strict';
  const DV = (window.DV = window.DV || {});

  // ---------------------------------------------------------------------------
  // Nutrients
  // [key, label, unit, group]
  const NUTRIENT_LIST = [
    ['kcal', 'Energy', 'kcal', 'general'],
    ['water', 'Water from food', 'g', 'general'],
    ['alcohol', 'Alcohol', 'g', 'general'],
    ['caffeine', 'Caffeine', 'mg', 'general'],
    ['carbs', 'Carbohydrates', 'g', 'carbs'],
    ['netcarbs', 'Net carbs', 'g', 'carbs'],
    ['fiber', 'Fiber', 'g', 'carbs'],
    ['sugars', 'Sugars', 'g', 'carbs'],
    ['fat', 'Fat', 'g', 'lipids'],
    ['sat', 'Saturated fat', 'g', 'lipids'],
    ['mono', 'Monounsaturated fat', 'g', 'lipids'],
    ['poly', 'Polyunsaturated fat', 'g', 'lipids'],
    ['o3', 'Omega-3', 'g', 'lipids'],
    ['o6', 'Omega-6', 'g', 'lipids'],
    ['epadha', 'EPA + DHA', 'g', 'lipids'],
    ['trans', 'Trans fat', 'g', 'lipids'],
    ['chol', 'Cholesterol', 'mg', 'lipids'],
    ['prot', 'Protein', 'g', 'protein'],
    ['his', 'Histidine', 'g', 'protein'],
    ['ile', 'Isoleucine', 'g', 'protein'],
    ['leu', 'Leucine', 'g', 'protein'],
    ['lys', 'Lysine', 'g', 'protein'],
    ['metcys', 'Methionine + cysteine', 'g', 'protein'],
    ['phetyr', 'Phenylalanine + tyrosine', 'g', 'protein'],
    ['thr', 'Threonine', 'g', 'protein'],
    ['trp', 'Tryptophan', 'g', 'protein'],
    ['val', 'Valine', 'g', 'protein'],
    ['vitA', 'Vitamin A', 'µg', 'vitamins'],
    ['vitC', 'Vitamin C', 'mg', 'vitamins'],
    ['vitD', 'Vitamin D', 'µg', 'vitamins'],
    ['vitE', 'Vitamin E', 'mg', 'vitamins'],
    ['vitK', 'Vitamin K', 'µg', 'vitamins'],
    ['b1', 'Thiamin (B1)', 'mg', 'vitamins'],
    ['b2', 'Riboflavin (B2)', 'mg', 'vitamins'],
    ['b3', 'Niacin (B3)', 'mg', 'vitamins'],
    ['b5', 'Pantothenic acid (B5)', 'mg', 'vitamins'],
    ['b6', 'Vitamin B6', 'mg', 'vitamins'],
    ['folate', 'Folate (B9)', 'µg', 'vitamins'],
    ['b12', 'Vitamin B12', 'µg', 'vitamins'],
    ['choline', 'Choline', 'mg', 'vitamins'],
    ['betacar', 'Beta-carotene', 'µg', 'vitamins'],
    ['lycopene', 'Lycopene', 'µg', 'vitamins'],
    ['lutein', 'Lutein + zeaxanthin', 'µg', 'vitamins'],
    ['ca', 'Calcium', 'mg', 'minerals'],
    ['cu', 'Copper', 'mg', 'minerals'],
    ['fe', 'Iron', 'mg', 'minerals'],
    ['mg', 'Magnesium', 'mg', 'minerals'],
    ['mn', 'Manganese', 'mg', 'minerals'],
    ['p', 'Phosphorus', 'mg', 'minerals'],
    ['k', 'Potassium', 'mg', 'minerals'],
    ['se', 'Selenium', 'µg', 'minerals'],
    ['na', 'Sodium', 'mg', 'minerals'],
    ['zn', 'Zinc', 'mg', 'minerals'],
  ];
  const NUTRIENTS = {};
  NUTRIENT_LIST.forEach(([key, label, unit, group], i) => { NUTRIENTS[key] = { key, label, unit, group, order: i }; });
  const TRACKED = NUTRIENT_LIST.map((n) => n[0]);

  const GROUPS = [
    ['general', 'General'],
    ['carbs', 'Carbohydrates'],
    ['lipids', 'Fats'],
    ['protein', 'Protein'],
    ['vitamins', 'Vitamins'],
    ['minerals', 'Minerals'],
  ];

  const INFO = {
    kcal: 'Energy from the protein, carbohydrate, fat and alcohol you eat and drink.',
    water: 'Water contained in foods and drinks you log. Plain water is tracked separately in the diary.',
    alcohol: 'Supplies 7 kcal per gram. The limit shown is 1 drink (14 g) a day for women and 2 for men.',
    caffeine: 'Up to 400 mg a day is considered safe for most adults, 200 mg during pregnancy.',
    carbs: 'The body’s main fuel, especially for the brain and hard exercise.',
    netcarbs: 'Carbohydrates minus fiber. Low-carb and keto plans usually count these.',
    fiber: 'Feeds gut bacteria, slows digestion and helps with fullness. Target: 14 g per 1,000 kcal.',
    sugars: 'Natural and added sugars combined. There is no target for total sugars.',
    fat: 'Dense energy that also carries vitamins A, D, E and K.',
    sat: 'Mostly from meat, dairy and tropical oils. Keep under 10% of calories.',
    mono: 'Found in olive oil, avocados and most nuts. No set target.',
    poly: 'Includes omega-3 and omega-6 fats from oils, nuts, seeds and fish.',
    o3: 'The target is for ALA, the plant omega-3. The total also counts EPA, DPA and DHA from seafood.',
    o6: 'Mostly linoleic acid, from vegetable oils, nuts and seeds.',
    epadha: 'Long-chain omega-3s from fatty fish and seafood. No official target; 250–500 mg a day is common advice.',
    trans: 'Raises LDL cholesterol. Keep as low as possible.',
    chol: 'Found only in animal foods. The 300 mg limit is a common guideline, not a DRI.',
    prot: 'Builds and repairs muscle and other tissue, and is the most filling macronutrient.',
    his: 'Essential amino acid. Target: 14 mg per kg of body weight.',
    ile: 'Essential branched-chain amino acid. Target: 19 mg per kg of body weight.',
    leu: 'Essential branched-chain amino acid that triggers muscle protein synthesis. Target: 42 mg/kg.',
    lys: 'Essential amino acid that’s often low in grain-based diets. Target: 38 mg/kg.',
    metcys: 'Sulfur amino acids, counted together. Target: 19 mg/kg.',
    phetyr: 'Aromatic amino acids, counted together. Target: 33 mg/kg.',
    thr: 'Essential amino acid. Target: 20 mg per kg of body weight.',
    trp: 'Essential amino acid used to make serotonin and niacin. Target: 5 mg/kg.',
    val: 'Essential branched-chain amino acid. Target: 24 mg per kg of body weight.',
    vitA: 'Vision, immunity and skin. Measured in retinol activity equivalents (RAE).',
    vitC: 'Antioxidant needed for collagen, wound healing and iron absorption.',
    vitD: 'Bone health and calcium absorption. Few foods have much; sunlight and supplements are common sources.',
    vitE: 'Antioxidant that protects cell membranes. Nuts, seeds and plant oils are rich sources.',
    vitK: 'Blood clotting and bone health. Leafy greens are the richest source.',
    b1: 'Helps turn carbohydrates into energy.',
    b2: 'Supports energy production and healthy skin and eyes.',
    b3: 'Supports energy metabolism and DNA repair.',
    b5: 'Needed to make coenzyme A for energy metabolism.',
    b6: 'Protein metabolism, red blood cells and brain chemistry.',
    folate: 'Cell division and DNA synthesis, and especially important before and during pregnancy. Measured in dietary folate equivalents (DFE).',
    b12: 'Nerve function and red blood cells. Found almost only in animal foods and fortified foods.',
    choline: 'Cell membranes, liver health and the neurotransmitter acetylcholine.',
    betacar: 'Orange-yellow carotenoid the body converts to vitamin A. No set target.',
    lycopene: 'Red carotenoid in tomatoes, watermelon and pink grapefruit. No set target.',
    lutein: 'Carotenoids concentrated in the retina. Leafy greens and egg yolks are sources. No set target.',
    ca: 'Bones and teeth, muscle contraction and nerve signaling.',
    cu: 'Iron metabolism, connective tissue and energy production.',
    fe: 'Carries oxygen in red blood cells. Vitamin C in the same meal improves absorption.',
    mg: 'Takes part in over 300 enzyme reactions, including muscle and nerve function.',
    mn: 'Bone formation and the metabolism of carbohydrates and cholesterol.',
    p: 'Bones and teeth, and the energy carrier ATP.',
    k: 'Blood pressure, fluid balance and muscle function.',
    se: 'Antioxidant enzymes and thyroid hormone metabolism.',
    na: 'Fluid balance and nerve function. Most people eat more than the 2,300 mg limit.',
    zn: 'Immunity, wound healing, taste and protein synthesis.',
  };

  // Which DRI type each micronutrient target is (for the info text).
  const AI_KEYS = new Set(['vitK', 'b5', 'choline', 'mn', 'k', 'na', 'o3', 'o6', 'fiber']);

  // ---------------------------------------------------------------------------
  // Dietary Reference Intakes (National Academies). Arrays are indexed by age group:
  // 0: 9–13, 1: 14–18, 2: 19–30, 3: 31–50, 4: 51–70, 5: 71+.
  // Pregnancy (P) and lactation (L) arrays: 0: ≤18, 1: 19–30, 2: 31–50.
  // A = both sexes. "max" is the Tolerable Upper Intake Level (or CDRR for sodium).
  const DRI = {
    vitA: { min: { M: [600, 900, 900, 900, 900, 900], F: [600, 700, 700, 700, 700, 700], P: [750, 770, 770], L: [1200, 1300, 1300] } },
    vitC: {
      min: { M: [45, 75, 90, 90, 90, 90], F: [45, 65, 75, 75, 75, 75], P: [80, 85, 85], L: [115, 120, 120] },
      max: { A: [1200, 1800, 2000, 2000, 2000, 2000], P: [1800, 2000, 2000], L: [1800, 2000, 2000] },
    },
    vitD: {
      min: { A: [15, 15, 15, 15, 15, 20], P: [15, 15, 15], L: [15, 15, 15] },
      max: { A: [100, 100, 100, 100, 100, 100], P: [100, 100, 100], L: [100, 100, 100] },
    },
    vitE: { min: { A: [11, 15, 15, 15, 15, 15], P: [15, 15, 15], L: [19, 19, 19] } },
    vitK: { min: { M: [60, 75, 120, 120, 120, 120], F: [60, 75, 90, 90, 90, 90], P: [75, 90, 90], L: [75, 90, 90] } },
    b1: { min: { M: [0.9, 1.2, 1.2, 1.2, 1.2, 1.2], F: [0.9, 1.0, 1.1, 1.1, 1.1, 1.1], P: [1.4, 1.4, 1.4], L: [1.4, 1.4, 1.4] } },
    b2: { min: { M: [0.9, 1.3, 1.3, 1.3, 1.3, 1.3], F: [0.9, 1.0, 1.1, 1.1, 1.1, 1.1], P: [1.4, 1.4, 1.4], L: [1.6, 1.6, 1.6] } },
    b3: { min: { M: [12, 16, 16, 16, 16, 16], F: [12, 14, 14, 14, 14, 14], P: [18, 18, 18], L: [17, 17, 17] } },
    b5: { min: { A: [4, 5, 5, 5, 5, 5], P: [6, 6, 6], L: [7, 7, 7] } },
    b6: {
      min: { M: [1.0, 1.3, 1.3, 1.3, 1.7, 1.7], F: [1.0, 1.2, 1.3, 1.3, 1.5, 1.5], P: [1.9, 1.9, 1.9], L: [2.0, 2.0, 2.0] },
      max: { A: [60, 80, 100, 100, 100, 100], P: [80, 100, 100], L: [80, 100, 100] },
    },
    folate: { min: { A: [300, 400, 400, 400, 400, 400], P: [600, 600, 600], L: [500, 500, 500] } },
    b12: { min: { A: [1.8, 2.4, 2.4, 2.4, 2.4, 2.4], P: [2.6, 2.6, 2.6], L: [2.8, 2.8, 2.8] } },
    choline: {
      min: { M: [375, 550, 550, 550, 550, 550], F: [375, 400, 425, 425, 425, 425], P: [450, 450, 450], L: [550, 550, 550] },
      max: { A: [2000, 3000, 3500, 3500, 3500, 3500], P: [3000, 3500, 3500], L: [3000, 3500, 3500] },
    },
    ca: {
      min: { M: [1300, 1300, 1000, 1000, 1000, 1200], F: [1300, 1300, 1000, 1000, 1200, 1200], P: [1300, 1000, 1000], L: [1300, 1000, 1000] },
      max: { A: [3000, 3000, 2500, 2500, 2000, 2000], P: [3000, 2500, 2500], L: [3000, 2500, 2500] },
    },
    cu: {
      min: { A: [0.7, 0.89, 0.9, 0.9, 0.9, 0.9], P: [1.0, 1.0, 1.0], L: [1.3, 1.3, 1.3] },
      max: { A: [5, 8, 10, 10, 10, 10], P: [8, 10, 10], L: [8, 10, 10] },
    },
    fe: {
      min: { M: [8, 11, 8, 8, 8, 8], F: [8, 15, 18, 18, 8, 8], P: [27, 27, 27], L: [10, 9, 9] },
      max: { A: [40, 45, 45, 45, 45, 45], P: [45, 45, 45], L: [45, 45, 45] },
    },
    mg: { min: { M: [240, 410, 400, 420, 420, 420], F: [240, 360, 310, 320, 320, 320], P: [400, 350, 360], L: [360, 310, 320] } },
    mn: {
      min: { M: [1.9, 2.2, 2.3, 2.3, 2.3, 2.3], F: [1.6, 1.6, 1.8, 1.8, 1.8, 1.8], P: [2.0, 2.0, 2.0], L: [2.6, 2.6, 2.6] },
      max: { A: [6, 9, 11, 11, 11, 11], P: [9, 11, 11], L: [9, 11, 11] },
    },
    p: {
      min: { A: [1250, 1250, 700, 700, 700, 700], P: [1250, 700, 700], L: [1250, 700, 700] },
      max: { A: [4000, 4000, 4000, 4000, 4000, 3000], P: [3500, 3500, 3500], L: [4000, 4000, 4000] },
    },
    k: { min: { M: [2500, 3000, 3400, 3400, 3400, 3400], F: [2300, 2300, 2600, 2600, 2600, 2600], P: [2600, 2900, 2900], L: [2500, 2800, 2800] } },
    se: {
      min: { A: [40, 55, 55, 55, 55, 55], P: [60, 60, 60], L: [70, 70, 70] },
      max: { A: [280, 400, 400, 400, 400, 400], P: [400, 400, 400], L: [400, 400, 400] },
    },
    na: {
      min: { A: [1200, 1500, 1500, 1500, 1500, 1500], P: [1500, 1500, 1500], L: [1500, 1500, 1500] },
      max: { A: [1800, 2300, 2300, 2300, 2300, 2300], P: [2300, 2300, 2300], L: [2300, 2300, 2300] },
    },
    zn: {
      min: { M: [8, 11, 11, 11, 11, 11], F: [8, 9, 8, 8, 8, 8], P: [12, 11, 11], L: [13, 12, 12] },
      max: { A: [23, 34, 40, 40, 40, 40], P: [34, 40, 40], L: [34, 40, 40] },
    },
    o3: { min: { M: [1.2, 1.6, 1.6, 1.6, 1.6, 1.6], F: [1.0, 1.1, 1.1, 1.1, 1.1, 1.1], P: [1.4, 1.4, 1.4], L: [1.3, 1.3, 1.3] } },
    o6: { min: { M: [12, 16, 17, 17, 14, 14], F: [10, 11, 12, 12, 11, 11], P: [13, 13, 13], L: [13, 13, 13] } },
  };
  // Total water Adequate Intake (food + drinks), mL. Drinking goal defaults to ~80% of it.
  const WATER_AI = { M: [2400, 3300, 3700, 3700, 3700, 3700], F: [2100, 2300, 2700, 2700, 2700, 2700], P: [3000, 3000, 3000], L: [3800, 3800, 3800] };
  // Indispensable amino acids, mg per kg body weight per day (IOM 2005 adult RDA).
  const AMINO_MG_PER_KG = { his: 14, ile: 19, leu: 42, lys: 38, metcys: 19, phetyr: 33, thr: 20, trp: 5, val: 24 };

  function ageGroup(age) {
    if (age < 14) return 0;
    if (age < 19) return 1;
    if (age < 31) return 2;
    if (age < 51) return 3;
    if (age < 71) return 4;
    return 5;
  }
  function stageGroup(age) {
    return age < 19 ? 0 : age < 31 ? 1 : 2;
  }
  function lookup(table, sex, age, stage) {
    if (!table) return null;
    if (stage === 'pregnant' && table.P) return table.P[stageGroup(age)];
    if (stage === 'lactating' && table.L) return table.L[stageGroup(age)];
    const arr = table[sex === 'male' ? 'M' : 'F'] || table.A;
    return arr ? arr[ageGroup(age)] : null;
  }

  // ---------------------------------------------------------------------------
  // Energy
  const ACTIVITY = [
    { id: 'sedentary', label: 'Mostly sitting', hint: 'Desk job, driving, little walking', factor: 1.2 },
    { id: 'light', label: 'Lightly active', hint: 'On your feet part of the day, like teaching or retail', factor: 1.375 },
    { id: 'moderate', label: 'Active', hint: 'On your feet most of the day, like nursing or serving', factor: 1.55 },
    { id: 'very', label: 'Very active', hint: 'Heavy physical work, like construction or farming', factor: 1.725 },
  ];
  const PLANS = {
    balanced: { label: 'Balanced', p: 25, c: 45, f: 30, hint: 'An even split that suits most people.' },
    highprotein: { label: 'High protein', p: 35, c: 35, f: 30, hint: 'For building muscle, or staying full while losing fat.' },
    lowcarb: { label: 'Low carb', p: 30, c: 20, f: 50, hint: 'Fewer starches and sugars, more fat.' },
    keto: { label: 'Keto', p: 20, c: 5, f: 75, hint: 'Very low carb. Track net carbs.' },
    custom: { label: 'Custom', hint: 'Set your own percentages.' },
  };
  const KCAL_PER_KG = 7700; // energy in ~1 kg of body fat

  function ageOf(profile) {
    const y = new Date().getFullYear();
    return Math.max(9, Math.min(110, y - (profile.birthYear || y - 30)));
  }

  function energy(profile, weightKg) {
    const age = ageOf(profile);
    const w = weightKg || profile.weightKg || 70;
    const h = profile.heightCm || 170;
    let bmr, method;
    if (profile.bodyFat > 3 && profile.bodyFat < 60) {
      bmr = 370 + 21.6 * w * (1 - profile.bodyFat / 100);
      method = 'Katch-McArdle';
    } else {
      bmr = 10 * w + 6.25 * h - 5 * age + (profile.sex === 'male' ? 5 : -161);
      method = 'Mifflin-St Jeor';
    }
    const act = ACTIVITY.find((a) => a.id === profile.activity) || ACTIVITY[1];
    const tdee = bmr * act.factor;
    const stage = profile.sex === 'female' ? profile.stage || 'none' : 'none';
    const extra = stage === 'pregnant' ? 340 : stage === 'lactating' ? 330 : 0;
    const rate = stage === 'none' ? profile.rate || 0 : 0; // no deficit while pregnant or nursing
    const delta = (rate * KCAL_PER_KG) / 7;
    const floor = profile.sex === 'male' ? 1500 : 1200;
    let target = Math.round((tdee + delta + extra) / 10) * 10;
    let floored = false;
    if (target < floor) {
      target = floor;
      floored = true;
    }
    if (profile.kcalOverride > 0) target = Math.round(profile.kcalOverride);
    return { bmr: Math.round(bmr), tdee: Math.round(tdee), delta: Math.round(delta), extra, target, floor, floored, method, age };
  }

  function macroSplit(profile) {
    const plan = PLANS[profile.plan] || PLANS.balanced;
    if (profile.plan === 'custom' && profile.macros) {
      const { p = 25, c = 45, f = 30 } = profile.macros;
      return { p, c, f };
    }
    return { p: plan.p, c: plan.c, f: plan.f };
  }

  // Full set of daily targets: { key: { min?, max?, goal?, kind } }
  //   kind 'goal' = aim for it (±10% counts as on target), 'min' = at least, 'max' = at most.
  function targets(profile, weightKg) {
    const sex = profile.sex === 'male' ? 'male' : 'female';
    const age = ageOf(profile);
    const stage = sex === 'female' ? profile.stage || 'none' : 'none';
    const w = weightKg || profile.weightKg || 70;
    const e = energy(profile, w);
    const kcal = e.target;
    const split = macroSplit(profile);
    const T = {};
    T.kcal = { goal: kcal, kind: 'goal' };
    T.prot = { goal: Math.round((kcal * split.p) / 100 / 4), kind: 'goal' };
    T.carbs = { goal: Math.round((kcal * split.c) / 100 / 4), kind: 'goal' };
    T.fat = { goal: Math.round((kcal * split.f) / 100 / 9), kind: 'goal' };
    T.fiber = { min: Math.round((kcal / 1000) * 14), kind: 'min' };
    T.sat = { max: Math.round((kcal * 0.1) / 9), kind: 'max' };
    T.chol = { max: 300, kind: 'max' };
    T.caffeine = { max: age < 19 ? 100 : stage === 'pregnant' ? 200 : stage === 'lactating' ? 300 : 400, kind: 'max' };
    if (stage === 'pregnant') T.alcohol = { max: 0, kind: 'max' };
    else if (age >= 21) T.alcohol = { max: sex === 'male' ? 28 : 14, kind: 'max' };
    Object.keys(DRI).forEach((key) => {
      const min = lookup(DRI[key].min, sex, age, stage);
      const max = lookup(DRI[key].max, sex, age, stage);
      if (min != null) T[key] = { min, kind: 'min' };
      if (max != null) T[key] = Object.assign(T[key] || { kind: 'max' }, { max });
    });
    Object.keys(AMINO_MG_PER_KG).forEach((key) => {
      T[key] = { min: Math.round(((AMINO_MG_PER_KG[key] * w) / 1000) * 100) / 100, kind: 'min' };
    });
    // Personal goals replace the computed values.
    const ov = profile.overrides || {};
    Object.keys(ov).forEach((key) => {
      const o = ov[key];
      if (!o) return;
      if (o.kind) {
        const t = customTarget(key, o, T[key], { kcal, w });
        if (t) T[key] = t;
        else delete T[key];
        return;
      }
      // Older saved form: { min?, max? } typed into the targets table.
      const t = Object.assign({}, T[key] || { kind: 'min' });
      if (o.min != null && o.min !== '') {
        if (t.kind === 'goal') t.goal = +o.min;
        else {
          t.min = +o.min;
          if (t.kind === 'max') t.kind = 'min';
        }
      }
      if (o.max != null && o.max !== '') t.max = +o.max;
      t.custom = true;
      T[key] = t;
    });
    return T;
  }

  // Calories per gram, for goals set as a share of calories.
  const KCAL_PER_G = { prot: 4, carbs: 4, netcarbs: 4, sugars: 4, fat: 9, sat: 9, mono: 9, poly: 9, alcohol: 7 };
  // Units a goal can be set in: grams (the nutrient's own unit), % of calories, or grams per kg of body weight.
  function goalUnits(key) {
    const units = ['amount'];
    if (KCAL_PER_G[key] && key !== 'alcohol') units.push('pct');
    if (['prot', 'carbs', 'netcarbs', 'fat', 'fiber'].includes(key)) units.push('perkg');
    return units;
  }
  function goalAmount(key, value, unit, ctx) {
    const v = +value;
    if (!(v >= 0)) return null;
    if (unit === 'pct') return Math.round((ctx.kcal * v) / 100 / KCAL_PER_G[key]);
    if (unit === 'perkg') return Math.round(v * ctx.w);
    return v;
  }
  /**
   * A goal the person set: { kind: 'goal'|'min'|'max'|'range'|'off', value?, min?, max?, unit? }.
   *   goal = aim for (±10%), min = at least, max = at most, range = between, off = no target.
   * A custom "at least" keeps the safety upper limit, if the nutrient has one.
   */
  function customTarget(key, o, base, ctx) {
    if (o.kind === 'off') return null;
    const amt = (v) => goalAmount(key, v, o.unit, ctx);
    let t;
    if (o.kind === 'goal') t = { kind: 'goal', goal: amt(o.value) };
    else if (o.kind === 'max') t = { kind: 'max', max: amt(o.value) };
    else if (o.kind === 'range') t = { kind: 'min', min: amt(o.min), max: amt(o.max), range: true };
    else {
      t = { kind: 'min', min: amt(o.value) };
      if (base && base.kind === 'min' && base.max != null) t.max = base.max;
    }
    if ((t.kind === 'goal' && t.goal == null) || (t.kind === 'max' && t.max == null) || (t.kind === 'min' && t.min == null)) return base || null;
    t.custom = true;
    t.unit = o.unit || 'amount';
    return t;
  }

  function waterGoal(profile) {
    if (profile.waterGoal > 0) return profile.waterGoal;
    const sex = profile.sex === 'male' ? 'male' : 'female';
    const stage = sex === 'female' ? profile.stage || 'none' : 'none';
    const ai = lookup(WATER_AI, sex, ageOf(profile), stage) || 2700;
    return Math.round((ai * 0.8) / 100) * 100;
  }

  // Progress state for a value against a target.
  //   'none' (no target) | 'low' | 'met' | 'high' (goal overshoot) | 'over' (above a limit) | 'ok' (under a limit)
  function status(value, t) {
    if (!t) return { state: 'none', pct: null };
    const v = value || 0;
    if (t.kind === 'goal') {
      const pct = t.goal > 0 ? v / t.goal : 0;
      if (t.max != null && v > t.max) return { state: 'over', pct };
      return { state: pct >= 1.1 ? 'high' : pct >= 0.9 ? 'met' : 'low', pct };
    }
    if (t.min != null) {
      const pct = t.min > 0 ? v / t.min : 1;
      if (t.max != null && v > t.max) return { state: 'over', pct };
      return { state: pct >= 1 ? 'met' : 'low', pct };
    }
    if (t.max != null) {
      const pct = t.max > 0 ? v / t.max : v > 0 ? 2 : 0;
      return { state: v > t.max ? 'over' : 'ok', pct };
    }
    return { state: 'none', pct: null };
  }

  function targetValue(t) {
    if (!t) return null;
    if (t.kind === 'goal') return t.goal;
    if (t.min != null) return t.min;
    return t.max;
  }

  // ---------------------------------------------------------------------------
  // Exercise (METs from the Compendium of Physical Activities)
  const EXERCISES = [
    ['walk_easy', 'Walking, easy pace (2.5 mph)', 3.0],
    ['walk', 'Walking, moderate pace (3 mph)', 3.5],
    ['walk_brisk', 'Walking, brisk (4 mph)', 5.0],
    ['hike', 'Hiking', 6.0],
    ['run_5', 'Running, 5 mph (12 min/mile)', 8.3],
    ['run_6', 'Running, 6 mph (10 min/mile)', 9.8],
    ['run_7', 'Running, 7.5 mph (8 min/mile)', 11.8],
    ['bike_easy', 'Cycling, leisurely (under 10 mph)', 4.0],
    ['bike', 'Cycling, moderate (12–14 mph)', 8.0],
    ['bike_stationary', 'Stationary bike, moderate', 6.8],
    ['swim', 'Swimming laps, moderate', 5.8],
    ['swim_hard', 'Swimming laps, vigorous', 9.8],
    ['weights', 'Strength training, moderate', 3.5],
    ['weights_hard', 'Strength training, vigorous', 6.0],
    ['hiit', 'HIIT or circuit training', 8.0],
    ['elliptical', 'Elliptical, moderate', 5.0],
    ['row', 'Rowing machine, moderate', 7.0],
    ['stairs', 'Stair climber', 9.0],
    ['yoga', 'Yoga', 2.5],
    ['pilates', 'Pilates', 3.0],
    ['dance', 'Dancing, aerobic', 7.3],
    ['jump_rope', 'Jumping rope', 11.8],
    ['basketball', 'Basketball, game', 8.0],
    ['soccer', 'Soccer, casual', 7.0],
    ['tennis', 'Tennis, singles', 8.0],
    ['garden', 'Gardening', 3.8],
    ['clean', 'Housework, general cleaning', 3.3],
  ].map(([id, label, met]) => ({ id, label, met }));

  // Net ("active") calories: resting burn is already in the daily budget, so subtract 1 MET.
  function exerciseKcal(met, minutes, weightKg) {
    return Math.max(0, Math.round((met - 1) * (weightKg || 70) * (minutes / 60)));
  }

  // ---------------------------------------------------------------------------
  // Units
  const LB = 2.2046226;
  const units = {
    kgToLb: (kg) => kg * LB,
    lbToKg: (lb) => lb / LB,
    cmToIn: (cm) => cm / 2.54,
    inToCm: (inch) => inch * 2.54,
    mlToOz: (ml) => ml / 29.5735,
    ozToMl: (oz) => oz * 29.5735,
    G_PER_OZ: 28.3495,
  };
  function fmtWeight(kg, sys, digits = 1) {
    if (kg == null) return '—';
    return sys === 'imperial' ? fmt(units.kgToLb(kg), digits) + ' lb' : fmt(kg, digits) + ' kg';
  }
  function fmtHeight(cm, sys) {
    if (!cm) return '—';
    if (sys === 'imperial') {
      const total = Math.round(units.cmToIn(cm));
      return Math.floor(total / 12) + ' ft ' + (total % 12) + ' in';
    }
    return Math.round(cm) + ' cm';
  }
  function fmtWater(ml, sys) {
    if (sys === 'imperial') return fmt(units.mlToOz(ml), 0) + ' fl oz';
    return fmt(ml, 0) + ' mL';
  }

  // ---------------------------------------------------------------------------
  // Number formatting
  const nfCache = {};
  function fmt(v, digits) {
    if (v == null || Number.isNaN(v)) return '—';
    const d = digits == null ? autoDigits(v) : digits;
    const k = d;
    if (!nfCache[k]) nfCache[k] = new Intl.NumberFormat('en-US', { maximumFractionDigits: d, minimumFractionDigits: 0 });
    return nfCache[k].format(v);
  }
  function autoDigits(v) {
    const a = Math.abs(v);
    if (a >= 100) return 0;
    if (a >= 1) return 1;
    if (a === 0) return 0;
    return 2;
  }
  function fmtAmount(key, v) {
    const n = NUTRIENTS[key];
    if (v == null) return '—';
    if (key === 'kcal') return fmt(v, 0);
    if (n && (n.unit === 'mg' || n.unit === 'µg')) return fmt(v, Math.abs(v) >= 10 ? 0 : autoDigits(v));
    return fmt(v);
  }
  function fmtNutrient(key, v) {
    const n = NUTRIENTS[key];
    return fmtAmount(key, v) + (n ? (n.unit === 'kcal' ? ' kcal' : ' ' + n.unit) : '');
  }
  function fmtPct(p) {
    if (p == null) return '';
    return Math.round(p * 100) + '%';
  }
  // Amounts like 0.5 -> "½" for household measures.
  const FRACTIONS = { 0.25: '¼', 0.5: '½', 0.75: '¾', 0.33: '⅓', 0.67: '⅔' };
  function fmtQty(q) {
    if (q == null) return '';
    const whole = Math.floor(q + 1e-9);
    const frac = Math.round((q - whole) * 100) / 100;
    if (frac === 0) return String(whole);
    const f = FRACTIONS[frac];
    if (f) return whole ? whole + f : f;
    return fmt(q, 2);
  }

  // ---------------------------------------------------------------------------
  // Dates (local, YYYY-MM-DD)
  const pad = (n) => String(n).padStart(2, '0');
  function ymd(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function parseYmd(s) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  function today() {
    return ymd(new Date());
  }
  function addDays(s, n) {
    const d = parseYmd(s);
    d.setDate(d.getDate() + n);
    return ymd(d);
  }
  function daysBetween(a, b) {
    return Math.round((parseYmd(b) - parseYmd(a)) / 86400000);
  }
  function fmtDay(s, style = 'long') {
    const d = parseYmd(s);
    const t = today();
    const diff = daysBetween(t, s);
    const rel = diff === 0 ? 'Today' : diff === -1 ? 'Yesterday' : diff === 1 ? 'Tomorrow' : null;
    if (style === 'short') return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    if (style === 'weekday') return d.toLocaleDateString('en-US', { weekday: 'short' });
    const full = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    return rel ? { rel, full } : { rel: d.toLocaleDateString('en-US', { weekday: 'long' }), full: d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' }) };
  }

  function uid(prefix) {
    return (prefix || '') + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function mealForNow() {
    const h = new Date().getHours();
    if (h < 10) return 'breakfast';
    if (h < 15) return 'lunch';
    if (h < 21) return 'dinner';
    return 'snacks';
  }

  DV.core = {
    NUTRIENT_LIST, NUTRIENTS, TRACKED, GROUPS, INFO, AI_KEYS, ACTIVITY, PLANS, EXERCISES,
    energy, targets, macroSplit, waterGoal, status, targetValue, exerciseKcal, ageOf, goalUnits, goalAmount,
  };
  DV.util = {
    units, fmt, fmtAmount, fmtNutrient, fmtPct, fmtQty, fmtWeight, fmtHeight, fmtWater,
    ymd, parseYmd, today, addDays, daysBetween, fmtDay, uid, mealForNow,
  };
  DV.MEALS = [
    ['breakfast', 'Breakfast'],
    ['lunch', 'Lunch'],
    ['dinner', 'Dinner'],
    ['snacks', 'Snacks'],
  ];
})();
