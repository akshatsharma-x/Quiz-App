/* =====================================================================================
   QuizMUJ charts (window.QMCharts) – dependency-free SVG/HTML charts.
   Spec: single-hue marks, <=24px bars with 4px rounded data-ends, 2px lines, >=8px
   ringed markers, hairline recessive grid, hover + keyboard tooltips, table-view twin.
   ===================================================================================== */
(function () {
  'use strict';
  const { html, setHTML, fmt } = window.QM;
  const NS = 'http://www.w3.org/2000/svg';

  const svgEl = (tag, attrs = {}, parent) => {
    const el = document.createElementNS(NS, tag);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    if (parent) parent.appendChild(el);
    return el;
  };

  const niceScale = (max, ticks = 4, integer = false) => {
    if (!(max > 0)) return { max: integer ? ticks : 1, step: integer ? 1 : 0.25 };
    const rough = max / ticks;
    const pow = Math.pow(10, Math.floor(Math.log10(rough)));
    const n = rough / pow;
    let step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pow;
    if (integer) step = Math.max(1, Math.ceil(step));
    return { max: Math.ceil(max / step) * step, step };
  };

  // Column path: 4px rounded data-end, square at the baseline
  const columnPath = (x, y, w, h) => {
    const r = Math.min(4, w / 2, h);
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  };

  /**
   * Chart frame: title, subtitle, chart/table toggle, tooltip.
   * Returns { plot, tooltip, table, showTip, hideTip }.
   */
  const frame = (container, { title, subtitle, columns: cols, rows }) => {
    container.classList.add('viz');
    setHTML(container, html`
      <div class="viz-head">
        <div>
          ${title ? html`<div class="viz-title">${title}</div>` : ''}
          ${subtitle ? html`<div class="viz-sub">${subtitle}</div>` : ''}
        </div>
        <button type="button" class="btn btn-ghost btn-sm viz-toggle" aria-pressed="false">Table</button>
      </div>
      <div class="viz-plot"></div>
      <div class="viz-table-wrap" hidden>
        <table class="viz-table">
          <thead><tr>${cols.map((c) => html`<th scope="col">${c}</th>`)}</tr></thead>
          <tbody>${rows.map((r) => html`<tr>${r.map((c) => html`<td>${c}</td>`)}</tr>`)}</tbody>
        </table>
      </div>
      <div class="viz-tooltip" role="status" aria-live="polite"></div>`);
    const plot = container.querySelector('.viz-plot');
    const tableWrap = container.querySelector('.viz-table-wrap');
    const toggle = container.querySelector('.viz-toggle');
    const tooltip = container.querySelector('.viz-tooltip');
    toggle.addEventListener('click', () => {
      const showTable = tableWrap.hidden;
      tableWrap.hidden = !showTable;
      plot.hidden = showTable;
      toggle.textContent = showTable ? 'Chart' : 'Table';
      toggle.setAttribute('aria-pressed', String(showTable));
    });

    const showTip = (content, anchorX, anchorY) => {
      setHTML(tooltip, content);
      tooltip.classList.add('show');
      const cRect = container.getBoundingClientRect();
      const pRect = plot.getBoundingClientRect();
      const tw = tooltip.offsetWidth;
      const th = tooltip.offsetHeight;
      let left = pRect.left - cRect.left + anchorX - tw / 2;
      left = Math.max(0, Math.min(left, cRect.width - tw));
      let top = pRect.top - cRect.top + anchorY - th - 12;
      if (top < 0) top = pRect.top - cRect.top + anchorY + 14;
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${top}px`;
    };
    const hideTip = () => tooltip.classList.remove('show');
    return { plot, tooltip, showTip, hideTip };
  };

  const observe = (container, render) => {
    let lastW = 0;
    const ro = new ResizeObserver(() => {
      const w = container.clientWidth;
      if (Math.abs(w - lastW) > 4) { lastW = w; render(); }
    });
    ro.observe(container);
    return ro;
  };

  const emptyState = (container, title, subtitle, text) => {
    container.classList.add('viz');
    setHTML(container, html`
      <div class="viz-head"><div>${title ? html`<div class="viz-title">${title}</div>` : ''}${subtitle ? html`<div class="viz-sub">${subtitle}</div>` : ''}</div></div>
      <div class="empty" style="padding:2rem 1rem"><div class="empty-icon">${window.QM.icon('chart')}</div><p>${text}</p></div>`);
  };

  // ------------------------------------------------------------------------------------
  // Column chart (single series)
  // ------------------------------------------------------------------------------------
  const columns = (container, opts) => {
    const {
      data = [], title, subtitle, height = 220, format = fmt.number, integer = true,
      valueName = 'Value', categoryName = 'Category', tooltipLabel = (d) => d.label, emptyText = 'No data yet', labelLast = false
    } = opts;
    if (!data.length || (data.every((d) => !d.value) && opts.hideWhenEmpty)) {
      emptyState(container, title, subtitle, emptyText);
      return { destroy() {} };
    }
    const f = frame(container, {
      title, subtitle,
      columns: [categoryName, valueName],
      rows: data.map((d) => [tooltipLabel(d), format(d.value)])
    });

    const render = () => {
      const W = Math.max(260, f.plot.clientWidth || container.clientWidth || 600);
      const max = Math.max(...data.map((d) => d.value), 0);
      const scale = niceScale(max, 4, integer);
      const tickLabels = [];
      for (let v = 0; v <= scale.max + 1e-9; v += scale.step) tickLabels.push(v);
      const left = 12 + Math.max(...tickLabels.map((t) => format(t).length)) * 7;
      const right = 6;
      const top = 22;
      const bottom = 28;
      const plotW = W - left - right;
      const plotH = height - top - bottom;
      const band = plotW / data.length;
      const barW = Math.max(4, Math.min(24, band * 0.62));
      const yOf = (v) => top + plotH - (v / scale.max) * plotH;

      f.plot.innerHTML = '';
      const svg = svgEl('svg', { viewBox: `0 0 ${W} ${height}`, role: 'img', 'aria-label': title || 'Column chart' }, f.plot);

      tickLabels.forEach((t) => {
        const y = Math.round(yOf(t)) + 0.5;
        svgEl('line', { class: t === 0 ? 'axis-line' : 'grid-line', x1: left, x2: W - right, y1: y, y2: y }, svg);
        const label = svgEl('text', { x: left - 8, y: y + 4, 'text-anchor': 'end' }, svg);
        label.textContent = format(t);
      });

      const every = Math.max(1, Math.ceil((data.length * 46) / plotW));
      const maxIdx = data.reduce((best, d, i) => (d.value > data[best].value ? i : best), 0);

      data.forEach((d, i) => {
        const cx = left + band * i + band / 2;
        const x = cx - barW / 2;
        const h = (d.value / scale.max) * plotH;
        const g = svgEl('g', {}, svg);
        const hit = svgEl('rect', {
          class: 'hit', x: left + band * i, y: top, width: band, height: plotH + 4, tabindex: 0,
          'aria-label': `${tooltipLabel(d)}: ${format(d.value)}`
        }, g);
        const mark = d.value > 0 ? svgEl('path', { class: 'mark', d: columnPath(x, top + plotH - h, barW, h) }, g) : null;

        // Thin out x labels so they never collide; keep the last one if it has room
        const isLast = i === data.length - 1;
        if (i % every === 0 || (labelLast && isLast && i % every >= Math.ceil(every / 2))) {
          const xl = svgEl('text', { x: cx, y: height - 8, 'text-anchor': 'middle' }, svg);
          xl.textContent = d.label;
        }
        if (i === maxIdx && d.value > 0) {
          const cap = svgEl('text', { class: 'viz-label', x: cx, y: top + plotH - h - 7, 'text-anchor': 'middle' }, svg);
          cap.textContent = format(d.value);
        }
        const show = () => {
          if (mark) mark.classList.add('is-active');
          f.showTip(html`<strong>${format(d.value)}</strong><span>${tooltipLabel(d)}</span>`, cx, top + plotH - h);
        };
        const hide = () => { if (mark) mark.classList.remove('is-active'); f.hideTip(); };
        hit.addEventListener('pointerenter', show);
        hit.addEventListener('pointerleave', hide);
        hit.addEventListener('focus', show);
        hit.addEventListener('blur', hide);
      });
    };
    render();
    const ro = observe(container, render);
    return { destroy: () => ro.disconnect() };
  };

  // ------------------------------------------------------------------------------------
  // Line chart (single series, crosshair snapping to nearest point)
  // ------------------------------------------------------------------------------------
  const line = (container, opts) => {
    const {
      data = [], title, subtitle, height = 240, yMax = 100, yStep = 25, format = (v) => `${Math.round(v)}%`,
      valueName = 'Score', categoryName = 'Attempt', tooltipLabel = (d) => d.label, emptyText = 'No data yet'
    } = opts;
    if (!data.length) {
      emptyState(container, title, subtitle, emptyText);
      return { destroy() {} };
    }
    const f = frame(container, {
      title, subtitle,
      columns: [categoryName, valueName],
      rows: data.map((d) => [tooltipLabel(d), format(d.value)])
    });

    const render = () => {
      const W = Math.max(260, f.plot.clientWidth || container.clientWidth || 600);
      const left = 44;
      const right = 46;
      const top = 16;
      const bottom = 28;
      const plotW = W - left - right;
      const plotH = height - top - bottom;
      const n = data.length;
      const xOf = (i) => left + (n === 1 ? plotW / 2 : (plotW * i) / (n - 1));
      const yOf = (v) => top + plotH - (Math.max(0, Math.min(v, yMax)) / yMax) * plotH;

      f.plot.innerHTML = '';
      const svg = svgEl('svg', { viewBox: `0 0 ${W} ${height}`, role: 'img', 'aria-label': title || 'Line chart' }, f.plot);

      for (let t = 0; t <= yMax; t += yStep) {
        const y = Math.round(yOf(t)) + 0.5;
        svgEl('line', { class: t === 0 ? 'axis-line' : 'grid-line', x1: left, x2: W - right, y1: y, y2: y }, svg);
        const label = svgEl('text', { x: left - 8, y: y + 4, 'text-anchor': 'end' }, svg);
        label.textContent = format(t);
      }

      const pts = data.map((d, i) => [xOf(i), yOf(d.value)]);
      if (n > 1) {
        const linePath = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join('');
        svgEl('path', { class: 'area', d: `${linePath}L${pts[n - 1][0]},${top + plotH}L${pts[0][0]},${top + plotH}Z` }, svg);
        svgEl('path', { class: 'line', d: linePath }, svg);
      }

      const every = Math.max(1, Math.ceil((n * 56) / plotW));
      data.forEach((d, i) => {
        if (i % every === 0 || i === n - 1) {
          const xl = svgEl('text', { x: xOf(i), y: height - 8, 'text-anchor': n === 1 ? 'middle' : i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle' }, svg);
          xl.textContent = d.label;
        }
      });

      const markers = pts.map((p) => svgEl('circle', { class: 'marker', cx: p[0], cy: p[1], r: 4 }, svg));
      // Direct label on the latest value only
      const endLabel = svgEl('text', { class: 'viz-label', x: pts[n - 1][0] + 9, y: pts[n - 1][1] + 4, 'text-anchor': 'start' }, svg);
      endLabel.textContent = format(data[n - 1].value);

      const cross = svgEl('line', { class: 'crosshair', x1: 0, x2: 0, y1: top, y2: top + plotH, visibility: 'hidden' }, svg);
      const overlay = svgEl('rect', { class: 'hit', x: left - 10, y: top, width: plotW + 20, height: plotH, tabindex: 0, 'aria-label': `${title || 'Chart'}: use arrow keys to read values` }, svg);

      let active = -1;
      const activate = (i) => {
        if (i === active) return;
        if (active >= 0) markers[active].setAttribute('r', 4);
        active = i;
        markers[i].setAttribute('r', 5.5);
        cross.setAttribute('x1', pts[i][0]);
        cross.setAttribute('x2', pts[i][0]);
        cross.setAttribute('visibility', 'visible');
        const d = data[i];
        f.showTip(html`<strong><i class="key"></i>${format(d.value)}</strong><span>${tooltipLabel(d)}</span>${d.detail ? html`<br><span>${d.detail}</span>` : ''}`, pts[i][0], pts[i][1]);
      };
      const deactivate = () => {
        if (active >= 0) markers[active].setAttribute('r', 4);
        active = -1;
        cross.setAttribute('visibility', 'hidden');
        f.hideTip();
      };
      overlay.addEventListener('pointermove', (e) => {
        const rect = svg.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * W;
        let best = 0;
        pts.forEach((p, i) => { if (Math.abs(p[0] - x) < Math.abs(pts[best][0] - x)) best = i; });
        activate(best);
      });
      overlay.addEventListener('pointerleave', deactivate);
      overlay.addEventListener('blur', deactivate);
      overlay.addEventListener('focus', () => activate(n - 1));
      overlay.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight') { activate(Math.min(n - 1, (active < 0 ? 0 : active + 1))); e.preventDefault(); }
        if (e.key === 'ArrowLeft') { activate(Math.max(0, (active < 0 ? n - 1 : active - 1))); e.preventDefault(); }
      });
    };
    render();
    const ro = observe(container, render);
    return { destroy: () => ro.disconnect() };
  };

  // ------------------------------------------------------------------------------------
  // Meter list – ranked ratios, one per named row
  // ------------------------------------------------------------------------------------
  const meterList = (container, rows, { emptyText = 'No data yet' } = {}) => {
    if (!rows.length) {
      setHTML(container, html`<div class="empty" style="padding:1.5rem 1rem"><p>${emptyText}</p></div>`);
      return;
    }
    setHTML(container, html`<div class="meter-list">${rows.map((r) => html`
      <div class="meter-row" title="${r.name}: ${r.figure}">
        <div class="name">${r.name}${r.sub ? html`<small>${r.sub}</small>` : ''}</div>
        <div class="meter" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(r.value)}" aria-label="${r.name}">
          <span data-w="${Math.max(0, Math.min(100, r.value))}"></span>
        </div>
        <div class="fig">${r.figure}</div>
      </div>`)}</div>`);
    requestAnimationFrame(() => {
      container.querySelectorAll('.meter > span').forEach((s) => { s.style.width = `${s.dataset.w}%`; });
    });
  };

  // ------------------------------------------------------------------------------------
  // Tall segmented bar – one whole split into parts (with legend)
  // ------------------------------------------------------------------------------------
  const segmented = (container, parts, { format = (v) => String(v) } = {}) => {
    const total = parts.reduce((s, p) => s + p.value, 0);
    const visible = parts.filter((p) => p.value > 0);
    setHTML(container, html`
      <div class="segbar" role="img" aria-label="${parts.map((p) => `${p.label}: ${p.value}`).join(', ')}">
        ${visible.map((p) => html`<div class="${p.cls}" style="flex:${p.value} 1 0" tabindex="0"
              title="${p.label}: ${format(p.value)} (${total ? Math.round((p.value / total) * 100) : 0}%)"
              aria-label="${p.label}: ${format(p.value)}"><span>${format(p.value)}</span></div>`)}
      </div>
      <div class="legend">${parts.map((p) => html`<span data-legend="${p.label}"><i class="${p.cls}" style="background:var(--${p.swatch || 'viz-mark'})"></i>${p.label}</span>`)}</div>`);
    // Blocks too narrow for their label print none; the value moves into the legend
    requestAnimationFrame(() => {
      container.querySelectorAll('.segbar > div').forEach((seg, i) => {
        const label = seg.querySelector('span');
        if (label && label.offsetWidth + 14 > seg.clientWidth) {
          label.remove();
          const legend = container.querySelector(`[data-legend="${CSS.escape(visible[i].label)}"]`);
          if (legend) legend.append(` (${format(visible[i].value)})`);
        }
      });
    });
  };

  window.QMCharts = { columns, line, meterList, segmented, niceScale };
})();
