/* Daily Value: shared UI components (icons, sheets, meters, the Nutrition Facts label, charts). */
(function () {
  'use strict';
  const { html, useState, useEffect, useRef, useLayoutEffect } = window.htmPreact;
  const DV = window.DV;
  const U = DV.util;
  const C = DV.core;

  // ---------------------------------------------------------------------------
  // Icons: [type, ...args] where p = path d, c = circle cx cy r [filled], r = rect x y w h rx
  const ICONS = {
    plus: [['p', 'M12 5v14M5 12h14']],
    minus: [['p', 'M5 12h14']],
    x: [['p', 'M18 6 6 18M6 6l12 12']],
    check: [['p', 'M20 6 9 17l-5-5']],
    left: [['p', 'm15 18-6-6 6-6']],
    right: [['p', 'm9 18 6-6-6-6']],
    down: [['p', 'm6 9 6 6 6-6']],
    search: [['c', 11, 11, 7], ['p', 'm20 20-3.5-3.5']],
    star: [['p', 'M12 2.8l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.6l-5.8 3.1 1.1-6.5-4.7-4.6 6.5-.9z']],
    trash: [['p', 'M3 6h18M8 6V4.5A1.5 1.5 0 0 1 9.5 3h5A1.5 1.5 0 0 1 16 4.5V6M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6']],
    calendar: [['r', 3, 4.5, 18, 17, 2], ['p', 'M16 2.5v4M8 2.5v4M3 10h18']],
    droplet: [['p', 'M12 2.7s6.5 6.9 6.5 11.8a6.5 6.5 0 0 1-13 0C5.5 9.6 12 2.7 12 2.7z']],
    flame: [['p', 'M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z']],
    sparkles: [['p', 'M11 3.5l1.8 4.9 4.9 1.8-4.9 1.8L11 16.9l-1.8-4.9-4.9-1.8 4.9-1.8z'], ['p', 'M18.5 14.5l.9 2.3 2.3.9-2.3.9-.9 2.3-.9-2.3-2.3-.9 2.3-.9z']],
    camera: [['p', 'M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z'], ['c', 12, 13, 3.5]],
    user: [['c', 12, 8, 4], ['p', 'M4 21a8 8 0 0 1 16 0']],
    chart: [['p', 'M3 3v18h18'], ['p', 'M8 17v-4M13 17V8M18 17v-7']],
    diary: [['r', 5, 3, 14, 18, 2], ['p', 'M9 7.5h6M9 11.5h6M9 15.5h3.5']],
    apple: [['p', 'M12 7c-1.5-1.2-3.3-1.6-5-1-2.6 1-3.6 4.2-2.6 7.6C5.6 18 8 21 10 21c.8 0 1.3-.4 2-.4s1.2.4 2 .4c2 0 4.4-3 5.6-7.4 1-3.4 0-6.6-2.6-7.6-1.7-.6-3.5-.2-5 1z'], ['p', 'M12 7c0-2 1-3.5 3-4']],
    scale: [['r', 3, 3, 18, 18, 4], ['p', 'M8 9.5a5.5 5.5 0 0 1 8 0L12 13z']],
    pencil: [['p', 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z']],
    dots: [['c', 5, 12, 1.4, 1], ['c', 12, 12, 1.4, 1], ['c', 19, 12, 1.4, 1]],
    copy: [['r', 9, 9, 12, 12, 2], ['p', 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1']],
    download: [['p', 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3']],
    upload: [['p', 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12']],
    share: [['p', 'M12 3v12M8 7l4-4 4 4'], ['p', 'M8.5 10H6a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1h-2.5']],
    cloud: [['p', 'M17.5 19H9a7 7 0 1 1 6.7-9h1.8a4.5 4.5 0 0 1 0 9z']],
    device: [['r', 3, 4, 18, 12, 2], ['p', 'M2 20h20']],
    alert: [['c', 12, 12, 9.5], ['p', 'M12 7.5v5.5M12 16.5v.01']],
    info: [['c', 12, 12, 9.5], ['p', 'M12 11v5.5M12 7.5v.01']],
    list: [['p', 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01']],
    bolt: [['p', 'M13 2 4 14h7l-1 8 9-12h-7z']],
    bowl: [['p', 'M3 11h18a9 9 0 0 1-18 0z'], ['p', 'M8 7.5c0-1.5 1-2 1-3.5M12 7.5c0-1.5 1-2 1-3.5M16 7.5c0-1.5 1-2 1-3.5']],
    stop: [['r', 6, 6, 12, 12, 2]],
    arrowUp: [['p', 'M12 19V5M6 11l6-6 6 6']],
    arrowDown: [['p', 'M12 5v14M6 13l6 6 6-6']],
    target: [['c', 12, 12, 9], ['c', 12, 12, 5], ['c', 12, 12, 1.2, 1]],
    table: [['r', 3, 4, 18, 16, 2], ['p', 'M3 10h18M3 15h18M9 4v16']],
    barcode: [['p', 'M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 8v8M10.5 8v8M14 8v8M17 8v8']],
  };
  function Icon({ name, size = 20, stroke = 2, fill = false }) {
    const parts = ICONS[name] || [];
    return html`<svg class="ic" width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width=${stroke} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
      ${parts.map((p, i) =>
        p[0] === 'p'
          ? html`<path key=${i} d=${p[1]} fill=${fill ? 'currentColor' : 'none'} />`
          : p[0] === 'c'
          ? html`<circle key=${i} cx=${p[1]} cy=${p[2]} r=${p[3]} fill=${p[4] || fill ? 'currentColor' : 'none'} />`
          : html`<rect key=${i} x=${p[1]} y=${p[2]} width=${p[3]} height=${p[4]} rx=${p[5] || 0} fill="none" />`
      )}
    </svg>`;
  }

  // ---------------------------------------------------------------------------
  // Sheet (bottom sheet on phones, dialog on larger screens)
  function Sheet({ title, onClose, children, footer, wide, tall, onBack, focus }) {
    const ref = useRef(null);
    useEffect(() => {
      const prev = document.activeElement;
      const onKey = (e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        } else if (e.key === 'Tab' && ref.current) trapTab(e, ref.current);
      };
      document.addEventListener('keydown', onKey);
      const t = setTimeout(() => {
        const el = ref.current;
        if (!el) return;
        const target = (focus && el.querySelector(focus)) || el;
        try {
          target.focus({ preventScroll: true });
        } catch (e) {}
      }, 40);
      const html0 = document.documentElement.style.overflow;
      document.documentElement.style.overflow = 'hidden';
      return () => {
        clearTimeout(t);
        document.removeEventListener('keydown', onKey);
        document.documentElement.style.overflow = html0;
        if (prev && prev.focus) {
          try {
            prev.focus({ preventScroll: true });
          } catch (e) {}
        }
      };
    }, []);
    return html`<div class="scrim" onMouseDown=${(e) => e.target === e.currentTarget && onClose()}>
      <div class=${'sheet' + (wide ? ' wide' : '') + (tall ? ' tall' : '')} role="dialog" aria-modal="true" aria-label=${title} tabindex="-1" ref=${ref}>
        <div class="sheet-h">
          ${onBack ? html`<button class="iconbtn quiet" type="button" onClick=${onBack} aria-label="Back"><${Icon} name="left" /></button>` : null}
          <h2>${title}</h2>
          <button class="iconbtn quiet" type="button" onClick=${onClose} aria-label="Close"><${Icon} name="x" /></button>
        </div>
        <div class="sheet-b">${children}</div>
        ${footer ? html`<div class="sheet-f">${footer}</div>` : null}
      </div>
    </div>`;
  }
  function trapTab(e, root) {
    const items = Array.from(root.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter((x) => !x.disabled && x.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  // ---------------------------------------------------------------------------
  // Meters and status marks
  function Meter({ pct, state, color, thick, marker }) {
    const w = Math.max(0, Math.min(1, pct || 0)) * 100;
    const style = 'width:' + w.toFixed(1) + '%' + (color ? ';background:' + color : '');
    return html`<div class=${'meter' + (thick ? ' thick' : '')} aria-hidden="true">
      <i class=${state ? 's-' + state : ''} style=${style}></i>
      ${marker != null ? html`<b class="meter-mark" style=${'left:' + Math.min(100, marker * 100).toFixed(1) + '%'}></b>` : null}
    </div>`;
  }
  const STATE_TEXT = { met: 'Target met', over: 'Above upper limit', high: 'Above target', low: 'Below target', ok: 'Under limit', none: '' };
  function Mark({ state }) {
    if (state === 'met') return html`<span class="mark good" title=${STATE_TEXT.met}><${Icon} name="check" size=${13} stroke=${3} /><span class="sr">${STATE_TEXT.met}</span></span>`;
    if (state === 'over') return html`<span class="mark bad" title=${STATE_TEXT.over}><${Icon} name="alert" size=${13} stroke=${2.5} /><span class="sr">${STATE_TEXT.over}</span></span>`;
    if (state === 'high') return html`<span class="mark warn" title=${STATE_TEXT.high}><${Icon} name="arrowUp" size=${13} stroke=${2.5} /><span class="sr">${STATE_TEXT.high}</span></span>`;
    return null;
  }

  // One nutrient against its target, as used in the diary and in reports.
  // `coverage` is the share of calories from foods that have data for this nutrient; below 60% the
  // total is too incomplete to judge, so the row says so instead of showing a shortfall.
  function NutrientRow({ k, value, target, missing, coverage, onClick }) {
    const n = C.NUTRIENTS[k];
    const limited = coverage != null && coverage < 0.6;
    const st = limited ? { state: 'none', pct: C.status(value, target).pct } : C.status(value, target);
    const tv = C.targetValue(target);
    const amt = U.fmtAmount(k, value) + (tv != null ? ' / ' + U.fmtAmount(k, tv) : '') + ' ' + n.unit;
    const pct = limited ? '' : st.pct == null ? '' : U.fmtPct(st.pct);
    const miss = missing > 0 && (coverage == null || coverage < 0.95);
    const label = n.label + ', ' + amt + (limited ? ', limited data' : pct ? ', ' + pct + (target && target.kind === 'max' ? ' of limit' : ' of target') : '') + (STATE_TEXT[st.state] ? ', ' + STATE_TEXT[st.state] : '');
    return html`<button type="button" class=${'nrow st-' + st.state + (limited ? ' limited' : '')} onClick=${onClick} aria-label=${label}>
      <span class="nm">${n.label}${miss ? html`<sup class="miss" title=${missing + (missing === 1 ? ' food has' : ' foods have') + ' no data for this nutrient'}>*</sup>` : null}${target && target.kind === 'max' ? html`<span class="lim">limit</span>` : null}</span>
      <span class="amt">${amt}</span>
      <span class="pct">${limited ? html`<span class="nodata" title=${'Only ' + Math.round(coverage * 100) + '% of calories came from foods with data for this nutrient'}>no data</span>` : pct}<${Mark} state=${st.state} /></span>
      ${tv != null ? html`<${Meter} pct=${limited ? 0 : st.pct} state=${st.state} />` : html`<span class="meter meter-none" aria-hidden="true"></span>`}
    </button>`;
  }

  // ---------------------------------------------------------------------------
  // Nutrition Facts label (per selected amount, % of the person's own targets)
  function NutritionLabel({ n, serving, T, title = 'Nutrition Facts', compact, onNutrient }) {
    const [more, setMore] = useState(false);
    const pctOf = (k) => {
      const t = T && T[k];
      const tv = C.targetValue(t);
      if (!tv || n[k] == null) return '';
      return Math.round((n[k] / tv) * 100) + '%';
    };
    const amt = (k, digits) => (n[k] == null ? '—' : U.fmtAmount(k, n[k]) + (C.NUTRIENTS[k].unit === 'kcal' ? '' : C.NUTRIENTS[k].unit === 'g' ? 'g' : C.NUTRIENTS[k].unit));
    const row = (k, label, opts = {}) => html`<div class=${'lrow' + (opts.indent ? ' indent' : '') + (opts.thick ? ' thick' : '')}>
      <span>${opts.bold ? html`<b>${label}</b>` : label} ${amt(k)}</span><span class="dv">${opts.noPct ? '' : pctOf(k)}</span>
    </div>`;
    const extra = ['vitA', 'vitC', 'vitE', 'vitK', 'b1', 'b2', 'b3', 'b5', 'b6', 'folate', 'b12', 'choline', 'mg', 'zn', 'p', 'se', 'cu', 'mn', 'o3', 'o6', 'caffeine', 'alcohol', 'water'];
    return html`<div class=${'factlabel' + (compact ? ' compact' : '')}>
      <div class="fl-title">${title}</div>
      <div class="fl-serv"><span>Amount</span><b>${serving}</b></div>
      <div class="rule-xl"></div>
      <div class="fl-per">Amount per serving</div>
      <div class="fl-cal"><b>Calories</b><span class="n">${n.kcal == null ? '—' : Math.round(n.kcal)}</span></div>
      <div class="rule-l"></div>
      <div class="lrow head"><span></span><span class="dv">% of your target*</span></div>
      ${row('fat', 'Total Fat', { bold: true })}
      ${row('sat', 'Saturated Fat', { indent: true })}
      ${row('trans', 'Trans Fat', { indent: true, noPct: true })}
      ${row('chol', 'Cholesterol', { bold: true })}
      ${row('na', 'Sodium', { bold: true })}
      ${row('carbs', 'Total Carbohydrate', { bold: true })}
      ${row('fiber', 'Dietary Fiber', { indent: true })}
      ${row('sugars', 'Total Sugars', { indent: true, noPct: true })}
      ${row('prot', 'Protein', { bold: true })}
      <div class="rule-xl"></div>
      ${row('vitD', 'Vitamin D')}
      ${row('ca', 'Calcium')}
      ${row('fe', 'Iron')}
      ${row('k', 'Potassium')}
      ${more ? extra.map((k) => html`<div key=${k}>${row(k, C.NUTRIENTS[k].label)}</div>`) : null}
      <div class="rule-l"></div>
      <div class="fl-foot">
        <button type="button" class="linkbtn" onClick=${() => setMore(!more)}>${more ? 'Show fewer nutrients' : 'Show all vitamins and minerals'}</button>
        <p>* How much of your daily target one serving provides. Limits (sodium, saturated fat, cholesterol) show how much of the limit it uses.</p>
      </div>
    </div>`;
  }

  // ---------------------------------------------------------------------------
  // Controls
  function Seg({ value, options, onChange, label, small }) {
    return html`<div class=${'seg' + (small ? ' small' : '')} role="group" aria-label=${label}>
      ${options.map(([v, text]) => html`<button type="button" key=${v} aria-pressed=${value === v ? 'true' : 'false'} onClick=${() => onChange(v)}>${text}</button>`)}
    </div>`;
  }

  function Field({ label, hint, children, id }) {
    return html`<label class="field" for=${id}>
      <span class="lbl">${label}</span>
      ${children}
      ${hint ? html`<span class="hint">${hint}</span>` : null}
    </label>`;
  }

  function Spinner() {
    return html`<span class="spinner" aria-hidden="true"></span>`;
  }

  // ---------------------------------------------------------------------------
  // Chart helpers
  function useWidth() {
    const ref = useRef(null);
    const [w, setW] = useState(0);
    useLayoutEffect(() => {
      const el = ref.current;
      if (!el) return;
      setW(el.clientWidth);
      if (typeof ResizeObserver === 'undefined') return;
      const ro = new ResizeObserver((entries) => {
        const cw = Math.round(entries[0].contentRect.width);
        setW((prev) => (prev === cw ? prev : cw));
      });
      ro.observe(el);
      return () => ro.disconnect();
    }, []);
    return [ref, w];
  }

  function niceTicks(max, count = 4) {
    if (!(max > 0)) return { max: 1, ticks: [0, 1] };
    const raw = max / count;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
    const top = Math.ceil(max / step) * step;
    const ticks = [];
    for (let v = 0; v <= top + step / 2; v += step) ticks.push(Math.round(v * 1000) / 1000);
    return { max: top, ticks };
  }

  // Path for a bar with rounded top corners only (square at the baseline).
  function barPath(x, y, w, h, r) {
    if (h <= 0) return '';
    const rr = Math.min(r, w / 2, h);
    return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
  }

  function ChartFrame({ title, sub, legend, table, children, actions }) {
    const [showTable, setShowTable] = useState(false);
    return html`<figure class="chart-card">
      <figcaption class="chart-h">
        <div>
          <h3>${title}</h3>
          ${sub ? html`<p class="chart-sub">${sub}</p>` : null}
        </div>
        <div class="chart-actions">
          ${actions}
          ${table
            ? html`<button type="button" class="btn btn-sm btn-quiet" aria-pressed=${showTable ? 'true' : 'false'} onClick=${() => setShowTable(!showTable)}>
                <${Icon} name=${showTable ? 'chart' : 'table'} size=${16} /> ${showTable ? 'Chart' : 'Table'}
              </button>`
            : null}
        </div>
      </figcaption>
      ${legend && !showTable ? html`<div class="legend">${legend}</div>` : null}
      ${showTable ? html`<div class="table-wrap">${table()}</div>` : children}
    </figure>`;
  }

  // Stacked columns (e.g. calories per day by macro) with an optional target line.
  function StackedColumns({ data, series, target, targetLabel, height = 220, fmtV, onPick }) {
    const [ref, width] = useWidth();
    const [hover, setHover] = useState(-1);
    const W = width || 600;
    const m = { l: 44, r: 12, t: 14, b: 28 };
    const pw = Math.max(10, W - m.l - m.r);
    const ph = height - m.t - m.b;
    const maxV = Math.max(target || 0, ...data.map((d) => d.total || 0)) * 1.08;
    const { max, ticks } = niceTicks(maxV || 1);
    const y = (v) => m.t + ph - (v / max) * ph;
    const n = data.length;
    const band = pw / Math.max(1, n);
    const bw = Math.max(2, Math.min(24, band * 0.68));
    const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(pw / 52))));
    const fmt = fmtV || ((v) => U.fmt(v, 0));
    const onMove = (e) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left - m.l;
      const i = Math.floor(x / band);
      setHover(i >= 0 && i < n ? i : -1);
    };
    const onKey = (e) => {
      if (e.key === 'ArrowRight') setHover((h) => Math.min(n - 1, h < 0 ? n - 1 : h + 1));
      else if (e.key === 'ArrowLeft') setHover((h) => Math.max(0, h < 0 ? n - 1 : h - 1));
      else return;
      e.preventDefault();
    };
    const hd = hover >= 0 ? data[hover] : null;
    const tipLeft = hd ? Math.min(W - 170, Math.max(0, m.l + hover * band + band / 2 - 80)) : 0;
    return html`<div class="chart" ref=${ref}>
      <svg width=${W} height=${height} role="img" aria-label=${'Column chart, ' + n + ' days'} tabindex="0" onKeyDown=${onKey} onFocus=${() => hover < 0 && setHover(n - 1)} onBlur=${() => setHover(-1)}
        onPointerMove=${onMove} onPointerLeave=${() => setHover(-1)} onClick=${() => hd && onPick && onPick(hd)}>
        ${ticks.map((t) => html`<g key=${'t' + t}>
          <line class=${t === 0 ? 'axis-line' : 'grid-line'} x1=${m.l} x2=${W - m.r} y1=${y(t)} y2=${y(t)} />
          <text x=${m.l - 8} y=${y(t) + 4} text-anchor="end">${fmt(t)}</text>
        </g>`)}
        ${data.map((d, i) => {
          const x = m.l + i * band + (band - bw) / 2;
          let acc = 0;
          const segs = series.map((s) => ({ s, v: (d.values && d.values[s.key]) || 0 })).filter((z) => z.v > 0);
          const dim = hover >= 0 && hover !== i;
          return html`<g key=${d.key} opacity=${dim ? 0.45 : 1}>
            ${segs.map((z, j) => {
              const y0 = y(acc);
              acc += z.v;
              const y1 = y(acc);
              const top = j === segs.length - 1;
              const hgt = Math.max(0, y0 - y1 - (top ? 0 : 2));
              return top
                ? html`<path key=${z.s.key} d=${barPath(x, y1, bw, hgt, 4)} style=${'fill:' + z.s.color} />`
                : html`<rect key=${z.s.key} x=${x} y=${y1 + 2} width=${bw} height=${hgt} style=${'fill:' + z.s.color} />`;
            })}
          </g>`;
        })}
        ${target
          ? html`<g>
              <line class="target-line" x1=${m.l} x2=${W - m.r} y1=${y(target)} y2=${y(target)} />
              <text class="target-text" x=${W - m.r} y=${y(target) - 6} text-anchor="end">${targetLabel || 'Target'} ${fmt(target)}</text>
            </g>`
          : null}
        ${data.map((d, i) =>
          (n - 1 - i) % every === 0
            ? html`<text key=${'x' + d.key} x=${m.l + i * band + band / 2} y=${height - 8} text-anchor=${i === n - 1 && n > 1 ? 'end' : 'middle'}>${d.label}</text>`
            : null
        )}
        ${hover >= 0 ? html`<rect x=${m.l + hover * band} y=${m.t} width=${band} height=${ph} class="hover-band" />` : null}
      </svg>
      ${hd
        ? html`<div class="tip" style=${'left:' + tipLeft + 'px;top:4px'}>
            <div class="tip-h">${hd.title || hd.label}</div>
            <div class="tip-row"><span class="v">${fmt(hd.total)}</span><span>${hd.unit || 'total'}</span></div>
            ${series.map((s) =>
              hd.values && hd.values[s.key] > 0
                ? html`<div class="tip-row" key=${s.key}><i class="key line" style=${'background:' + s.color}></i><span class="v">${fmt(hd.values[s.key])}</span><span>${s.label}</span></div>`
                : null
            )}
            ${hd.note ? html`<div class="tip-note">${hd.note}</div>` : null}
          </div>`
        : null}
    </div>`;
  }

  // Body weight: weigh-ins as dots, the smoothed trend as a line, and the goal as a dashed line when
  // it's close enough not to flatten everything else. points: [{ date, value, trend }] in display units.
  function WeightChart({ points, height = 220, fmtV, unit, goal }) {
    const [ref, width] = useWidth();
    const [hover, setHover] = useState(-1);
    const W = width || 600;
    const m = { l: 44, r: 16, t: 16, b: 28 };
    const pw = Math.max(10, W - m.l - m.r);
    const ph = height - m.t - m.b;
    const fmt = fmtV || ((v) => U.fmt(v, 1));
    if (!points.length) return html`<div class="chart empty" ref=${ref}><p>No weigh-ins in this range yet.</p></div>`;
    const t0 = U.parseYmd(points[0].date).getTime();
    const t1 = U.parseYmd(points[points.length - 1].date).getTime();
    const span = Math.max(1, t1 - t0);
    const vals = points.map((p) => p.value).concat(points.map((p) => p.trend));
    let lo = Math.min(...vals);
    let hi = Math.max(...vals);
    const near = Math.max(hi - lo, hi * 0.05);
    const showGoal = goal > 0 && goal >= lo - near && goal <= hi + near;
    if (showGoal) {
      lo = Math.min(lo, goal);
      hi = Math.max(hi, goal);
    }
    const pad = Math.max(0.5, (hi - lo) * 0.15);
    lo -= pad;
    hi += pad;
    const step = niceStep((hi - lo) / 4);
    lo = Math.floor(lo / step) * step;
    hi = Math.ceil(hi / step) * step;
    const ticks = [];
    for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 100) / 100);
    const x = (d) => m.l + (points.length === 1 ? pw / 2 : ((U.parseYmd(d).getTime() - t0) / span) * pw);
    const y = (v) => m.t + ph - ((v - lo) / (hi - lo)) * ph;
    const path = points.map((p, i) => (i ? 'L' : 'M') + x(p.date).toFixed(1) + ',' + y(p.trend).toFixed(1)).join('');
    const onMove = (e) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const px = e.clientX - rect.left;
      let best = -1;
      let bd = Infinity;
      points.forEach((p, i) => {
        const d = Math.abs(x(p.date) - px);
        if (d < bd) {
          bd = d;
          best = i;
        }
      });
      setHover(best);
    };
    const onKey = (e) => {
      if (e.key === 'ArrowRight') setHover((h) => Math.min(points.length - 1, h < 0 ? points.length - 1 : h + 1));
      else if (e.key === 'ArrowLeft') setHover((h) => Math.max(0, h < 0 ? points.length - 1 : h - 1));
      else return;
      e.preventDefault();
    };
    const hp = hover >= 0 ? points[hover] : null;
    const last = points[points.length - 1];
    // Date labels at an even step (1, 2, 3 days, a week, …), counted back from the latest weigh-in.
    const first = points[0].date;
    const days = U.daysBetween(first, last.date);
    const fit = Math.max(1, Math.floor(pw / 80) - 1);
    const stepDays = [1, 2, 3, 7, 14, 28, 56, 91, 182, 365, 730].find((s) => days / s <= fit) || Math.ceil(days / fit);
    const xLabels = [];
    for (let k = 0; k <= days / stepDays; k++) {
      const d = U.addDays(last.date, -k * stepDays);
      const lx = x(d);
      xLabels.push({ d, x: lx, a: points.length === 1 ? 'middle' : k === 0 ? 'end' : lx - m.l < 24 ? 'start' : 'middle' });
    }
    const u = unit ? ' ' + unit : '';
    const tipX = hp ? x(hp.date) : 0;
    return html`<div class="chart" ref=${ref}>
      <svg width=${W} height=${height} role="img" aria-label=${'Weight chart, ' + points.length + (points.length === 1 ? ' weigh-in' : ' weigh-ins') + ', trend ' + fmt(last.trend) + u + (showGoal ? ', goal ' + fmt(goal) + u : '')} tabindex="0" onKeyDown=${onKey}
        onFocus=${() => hover < 0 && setHover(points.length - 1)} onBlur=${() => setHover(-1)} onPointerMove=${onMove} onPointerLeave=${() => setHover(-1)}>
        ${ticks.map((t, i) => html`<g key=${'t' + i}>
          <line class=${i === 0 ? 'axis-line' : 'grid-line'} x1=${m.l} x2=${W - m.r} y1=${y(t)} y2=${y(t)} />
          <text x=${m.l - 8} y=${y(t) + 4} text-anchor="end">${fmt(t)}</text>
        </g>`)}
        ${showGoal
          ? html`<g>
              <line class="goal-line" x1=${m.l} x2=${W - m.r} y1=${y(goal)} y2=${y(goal)} />
              <text class="target-text" x=${m.l + 6} y=${y(goal) + (goal < last.trend ? 16 : -6)} text-anchor="start">Goal ${fmt(goal)}</text>
            </g>`
          : null}
        ${points.map((p, i) => html`<circle key=${p.date} class=${'wdot' + (i === hover ? ' on' : '')} cx=${x(p.date)} cy=${y(p.value)} r=${i === hover ? 5 : 3.5} />`)}
        ${points.length > 1 ? html`<path class="wtrend" d=${path} />` : null}
        <text class="end-label" x=${Math.min(W - m.r, x(last.date))} y=${y(last.trend) + (last.value > last.trend ? 18 : -10)} text-anchor="end">${fmt(last.trend)}${u}</text>
        ${xLabels.map((l, i) => html`<text key=${'x' + i} x=${l.x} y=${height - 8} text-anchor=${l.a}>${U.fmtDay(l.d, 'short')}</text>`)}
        ${hp ? html`<line class="crosshair" x1=${tipX} x2=${tipX} y1=${m.t} y2=${m.t + ph} />` : null}
      </svg>
      ${hp
        ? html`<div class="tip" style=${'left:' + Math.min(W - 160, Math.max(0, tipX - 75)) + 'px;top:4px'}>
            <div class="tip-h">${U.fmtDay(hp.date).full}</div>
            <div class="tip-row"><i class="key dot"></i><span class="v">${fmt(hp.value)}${u}</span><span>weigh-in</span></div>
            <div class="tip-row"><i class="key line" style="background:var(--ink)"></i><span class="v">${fmt(hp.trend)}${u}</span><span>trend</span></div>
          </div>`
        : null}
    </div>`;
  }
  function niceStep(raw) {
    if (!(raw > 0)) return 1;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / mag;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
  }

  // Horizontal split bar (calories by source) with 2px surface gaps.
  function SplitBar({ parts, height = 14 }) {
    const total = parts.reduce((a, p) => a + (p.value || 0), 0);
    if (!total) return html`<div class="split empty" style=${'height:' + height + 'px'}></div>`;
    return html`<div class="split" style=${'height:' + height + 'px'} role="img" aria-label=${parts.map((p) => p.label + ' ' + Math.round((p.value / total) * 100) + '%').join(', ')}>
      ${parts.filter((p) => p.value > 0).map((p) => html`<i key=${p.key} style=${'flex:' + p.value + ';background:' + p.color} title=${p.label + ' ' + Math.round((p.value / total) * 100) + '%'}></i>`)}
    </div>`;
  }

  DV.UI = { Icon, Sheet, Meter, Mark, NutrientRow, NutritionLabel, Seg, Field, Spinner, ChartFrame, StackedColumns, WeightChart, SplitBar, useWidth, STATE_TEXT };
})();
