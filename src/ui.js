(function () {
'use strict';
const $ = s => document.querySelector(s);
const cssv = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ================= formatting =================
const f2 = v => (v == null || !isFinite(v)) ? '—' : v.toFixed(2);
const f3 = v => (v == null || !isFinite(v)) ? '—' : v.toFixed(3);
const sgn = v => v > 0 ? '+' : '';
const pct = (v, d = 1) => (v == null || !isFinite(v)) ? '—' : sgn(v) + (v * 100).toFixed(d) + '%';
const pctU = (v, d = 1) => (v == null || !isFinite(v)) ? '—' : (v * 100).toFixed(d) + '%';
const simple = lg => Math.exp(lg) - 1; // log return -> simple return
const pval = p => p == null ? '—' : (p < 0.001 ? '<0.001' : p.toFixed(3));
const int = v => Math.round(v).toLocaleString('en-US');
function critName(c) { return { total: 'total log return', sharpe: 'Sharpe ratio', pf: 'profit factor' }[c]; }
function critFmt(c, v) { if (!isFinite(v)) return '—'; return c === 'total' ? sgn(v) + (v * 100).toFixed(1) + '% log' : v.toFixed(2); }
function paramStr(p) { return Object.entries(p || {}).map(([k, v]) => `${k} ${v}`).join(', '); }

// ================= charts (canvas) =================
const charts = new Set();
function niceTicks(min, max, n) {
  n = n || 5;
  if (!isFinite(min) || !isFinite(max)) return [0];
  if (min === max) { min -= Math.abs(min) * 0.1 + 1e-6; max += Math.abs(max) * 0.1 + 1e-6; }
  const span = max - min, step0 = span / n, mag = Math.pow(10, Math.floor(Math.log10(step0))), err = step0 / mag;
  const step = (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1) * mag;
  const t = []; for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) t.push(+v.toFixed(12));
  return t;
}
function hexToRgb(h) { h = h.replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join(''); const n = parseInt(h, 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
function mix(a, b, t) { const A = hexToRgb(a), B = hexToRgb(b); return `rgb(${A.map((x, i) => Math.round(x + (B[i] - x) * t)).join(',')})`; }
function withAlpha(hex, a) { const [r, g, b] = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; }

function makeChart(host, height, draw) {
  host.innerHTML = '';
  const cv = document.createElement('canvas'); host.appendChild(cv);
  const st = { host, cv, height, draw, hover: null };
  const render = () => {
    if (!host.isConnected) { charts.delete(st); return; }
    const w = host.clientWidth; if (!w) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(w * dpr); cv.height = Math.round(height * dpr); cv.style.height = height + 'px';
    const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, height);
    const C = { ink: cssv('--ink'), ink2: cssv('--ink-2'), ink3: cssv('--ink-3'), line: cssv('--line'), surface: cssv('--surface'), surface2: cssv('--surface-2'), accent: cssv('--accent'), real: cssv('--real'), mark: cssv('--mark'), neg: cssv('--neg'), good: cssv('--good'), bad: cssv('--bad'), c2: cssv('--c2'), c3: cssv('--c3'), c4: cssv('--c4'), c5: cssv('--c5'), c6: cssv('--c6'), c7: cssv('--c7') };
    ctx.font = '11px "IBM Plex Mono", ui-monospace, monospace';
    st.draw(ctx, w, height, st.hover, C);
  };
  st.render = render;
  cv.addEventListener('mousemove', e => { const r = cv.getBoundingClientRect(); st.hover = { x: e.clientX - r.left, y: e.clientY - r.top }; render(); });
  cv.addEventListener('mouseleave', () => { st.hover = null; render(); });
  cv.addEventListener('touchstart', e => { const r = cv.getBoundingClientRect(), t = e.touches[0]; st.hover = { x: t.clientX - r.left, y: t.clientY - r.top }; render(); }, { passive: true });
  charts.add(st);
  requestAnimationFrame(render);
  return st;
}
function redrawAll() { charts.forEach(c => c.render()); }
let rzT; window.addEventListener('resize', () => { clearTimeout(rzT); rzT = setTimeout(redrawAll, 120); });
try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => setTimeout(redrawAll, 30)); } catch (e) { }
new MutationObserver(() => setTimeout(redrawAll, 30)).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });

function tooltip(ctx, w, h, x, y, lines, C) {
  ctx.font = '11.5px "IBM Plex Mono", ui-monospace, monospace';
  const pad = 7, lh = 16; let tw = 0; lines.forEach(l => tw = Math.max(tw, ctx.measureText(l.t).width + (l.c ? 14 : 0)));
  const bw = tw + pad * 2, bh = lines.length * lh + pad * 2 - 4;
  let bx = x + 12, by = y - bh - 8; if (bx + bw > w - 2) bx = x - bw - 12; if (bx < 2) bx = 2; if (by < 2) by = Math.min(y + 14, h - bh - 2);
  ctx.fillStyle = C.ink; ctx.globalAlpha = 0.94; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(bx, by, bw, bh, 4) : ctx.rect(bx, by, bw, bh); ctx.fill(); ctx.globalAlpha = 1;
  lines.forEach((l, i) => {
    const ty = by + pad + i * lh + 9;
    if (l.c) { ctx.fillStyle = l.c; ctx.fillRect(bx + pad, ty - 6, 9, 3); }
    ctx.fillStyle = C.surface; ctx.textBaseline = 'middle'; ctx.fillText(l.t, bx + pad + (l.c ? 14 : 0), ty);
  });
}
function axisY(ctx, ticks, sy, L, R, fmt, C) {
  ctx.textBaseline = 'middle'; ctx.textAlign = 'right';
  ticks.forEach(t => { const y = sy(t); ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(L, Math.round(y) + .5); ctx.lineTo(R, Math.round(y) + .5); ctx.stroke(); ctx.fillStyle = C.ink3; ctx.fillText(fmt(t), L - 6, y); });
  ctx.textAlign = 'left';
}

// line chart over an index axis with date labels
function lineChart(host, o) {
  return makeChart(host, o.height || 260, (ctx, w, h, hv, C) => {
    const L = 58, R = w - 12, T = 10, B = h - 24;
    const ser = o.series.map(s => Object.assign({}, s, { color: C[s.color] || s.color }));
    const n = Math.max(...ser.map(s => s.y.length));
    let mn = Infinity, mx = -Infinity;
    ser.forEach(s => s.y.forEach(v => { if (isFinite(v)) { if (v < mn) mn = v; if (v > mx) mx = v; } }));
    if (o.zero) { mn = Math.min(mn, 0); mx = Math.max(mx, 0); }
    const pad = (mx - mn) * 0.06 || 1; mn -= pad; mx += pad;
    const sx = i => L + (n <= 1 ? 0 : i / (n - 1) * (R - L)), sy = v => B - (v - mn) / (mx - mn) * (B - T);
    axisY(ctx, niceTicks(mn, mx, 5), sy, L, R, o.yFmt || (v => v.toFixed(0)), C);
    // vertical markers (fold boundaries)
    if (o.vlines) { ctx.strokeStyle = C.line; ctx.setLineDash([3, 3]); o.vlines.forEach(i => { const x = Math.round(sx(i)) + .5; ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, B); ctx.stroke(); }); ctx.setLineDash([]); }
    // x labels
    if (o.x) { ctx.fillStyle = C.ink3; ctx.textBaseline = 'top'; const k = Math.max(2, Math.min(6, Math.floor((R - L) / 110))); for (let j = 0; j <= k; j++) { const i = Math.round(j / k * (n - 1)); const lab = (o.xFmt || (s => String(s).slice(0, 7)))(o.x[i]); ctx.textAlign = j === 0 ? 'left' : j === k ? 'right' : 'center'; ctx.fillText(lab, sx(i), B + 7); } ctx.textAlign = 'left'; }
    // area under first series
    const s0 = ser[0];
    if (o.area !== false && s0) {
      const base = sy(Math.max(mn, Math.min(mx, 0)));
      ctx.beginPath(); ctx.moveTo(sx(0), base); s0.y.forEach((v, i) => ctx.lineTo(sx(i), sy(v))); ctx.lineTo(sx(s0.y.length - 1), base); ctx.closePath();
      ctx.fillStyle = withAlpha(cssv(o.series[0].color.startsWith('#') ? '' : '--' + o.series[0].color) || '#888888', 0.08); ctx.fill();
    }
    if (o.zero) { ctx.strokeStyle = C.ink3; ctx.lineWidth = 1; const y = Math.round(sy(0)) + .5; ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(R, y); ctx.stroke(); }
    ser.slice().reverse().forEach(s => {
      ctx.strokeStyle = s.color; ctx.lineWidth = s.width || 2; ctx.lineJoin = 'round'; if (s.dash) ctx.setLineDash(s.dash);
      ctx.beginPath(); let started = false;
      s.y.forEach((v, i) => { if (!isFinite(v)) { started = false; return; } const x = sx(i), y = sy(v); if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y); });
      ctx.stroke(); ctx.setLineDash([]);
      const li = s.y.length - 1; if (isFinite(s.y[li])) { ctx.fillStyle = s.color; ctx.beginPath(); ctx.arc(sx(li), sy(s.y[li]), 3.5, 0, 7); ctx.fill(); }
    });
    if (hv && hv.x >= L && hv.x <= R) {
      const i = Math.max(0, Math.min(n - 1, Math.round((hv.x - L) / (R - L) * (n - 1))));
      const x = sx(i); ctx.strokeStyle = C.ink3; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, B); ctx.stroke();
      const lines = [{ t: o.x ? String(o.x[i]) : 'bar ' + i }];
      ser.forEach(s => { const v = s.y[i]; if (isFinite(v)) { ctx.fillStyle = s.color; ctx.beginPath(); ctx.arc(x, sy(v), 4, 0, 7); ctx.fill(); ctx.strokeStyle = C.surface; ctx.lineWidth = 2; ctx.stroke(); lines.push({ t: `${s.name}: ${(o.tipFmt || o.yFmt || (v => v.toFixed(2)))(v)}`, c: s.color }); } });
      tooltip(ctx, w, h, x, hv.y, lines, C);
    }
  });
}

// histogram with a vertical "real result" marker; bars at or beyond the marker are tinted (the p-value area)
function histChart(host, o) {
  return makeChart(host, o.height || 220, (ctx, w, h, hv, C) => {
    const L = 40, R = w - 14, T = 22, B = h - 24;
    const vals = o.values.filter(isFinite);
    let mn = Math.min(...vals, o.marker != null ? o.marker : Infinity), mx = Math.max(...vals, o.marker != null ? o.marker : -Infinity);
    (o.refs || []).forEach(r => { mn = Math.min(mn, r.x); mx = Math.max(mx, r.x); });
    if (mn === mx) { mn -= 1; mx += 1; }
    const span = mx - mn; mn -= span * 0.04; mx += span * 0.04;
    const nb = o.bins || Math.max(12, Math.min(40, Math.round(Math.sqrt(vals.length) * 1.6)));
    const bw = (mx - mn) / nb, cnt = new Array(nb).fill(0);
    vals.forEach(v => { let b = Math.floor((v - mn) / bw); if (b >= nb) b = nb - 1; if (b < 0) b = 0; cnt[b]++; });
    const cm = Math.max(...cnt, 1);
    const sx = v => L + (v - mn) / (mx - mn) * (R - L), sy = c => B - c / cm * (B - T);
    axisY(ctx, niceTicks(0, cm, 4).filter(t => Number.isInteger(t)), sy, L, R, v => String(v), C);
    ctx.fillStyle = C.ink3; ctx.textBaseline = 'top';
    niceTicks(mn, mx, Math.max(3, Math.floor((R - L) / 90))).forEach(t => { const x = sx(t); if (x < L - 1 || x > R + 1) return; ctx.textAlign = 'center'; ctx.fillText((o.fmt || (v => v.toFixed(2)))(t), x, B + 7); });
    ctx.textAlign = 'left';
    const pw = (R - L) / nb;
    for (let b = 0; b < nb; b++) {
      if (!cnt[b]) continue;
      const lo = mn + b * bw, x0 = sx(lo) + 1, y = sy(cnt[b]);
      const right = o.marker != null && (o.shadeLeft ? lo + bw <= o.marker + 1e-12 : lo + bw > o.marker);
      ctx.fillStyle = right ? C.real : C.mark; ctx.globalAlpha = right ? 0.55 : 1;
      ctx.beginPath(); const bwPx = Math.max(1, pw - 2); if (ctx.roundRect) ctx.roundRect(x0, y, bwPx, B - y, [2, 2, 0, 0]); else ctx.rect(x0, y, bwPx, B - y); ctx.fill(); ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = C.ink3; ctx.beginPath(); ctx.moveTo(L, B + .5); ctx.lineTo(R, B + .5); ctx.stroke();
    (o.refs || []).forEach(r => { const x = Math.round(sx(r.x)) + .5; ctx.strokeStyle = C.ink2; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(x, T - 4); ctx.lineTo(x, B); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = C.ink2; ctx.textBaseline = 'bottom'; ctx.textAlign = x > (L + R) / 2 ? 'right' : 'left'; ctx.fillText(r.label, x + (ctx.textAlign === 'left' ? 4 : -4), T + 8); ctx.textAlign = 'left'; });
    if (o.marker != null) {
      const x = Math.round(sx(o.marker)) + .5; ctx.strokeStyle = C.real; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(x, T - 8); ctx.lineTo(x, B); ctx.stroke(); ctx.lineWidth = 1;
      ctx.font = '600 11.5px "IBM Plex Mono", ui-monospace, monospace'; ctx.fillStyle = C.real; ctx.textBaseline = 'bottom';
      const lab = o.markerLabel || 'Real'; const tw = ctx.measureText(lab).width;
      ctx.textAlign = x + tw + 6 > R ? 'right' : 'left'; ctx.fillText(lab, x + (ctx.textAlign === 'left' ? 5 : -5), T - 6); ctx.textAlign = 'left';
    }
    if (hv && hv.x >= L && hv.x <= R) {
      const b = Math.max(0, Math.min(nb - 1, Math.floor((hv.x - L) / pw))); const lo = mn + b * bw, f = o.fmt || (v => v.toFixed(2));
      tooltip(ctx, w, h, hv.x, hv.y, [{ t: `${f(lo)} to ${f(lo + bw)}` }, { t: `${cnt[b]} ${o.unit || 'runs'}` }], C);
    }
  });
}

// heatmap for a 2-parameter slice of the grid; diverging around o.center
function heatChart(host, o) {
  return makeChart(host, o.height || 300, (ctx, w, h, hv, C) => {
    const L = 56, R = w - 10, T = 8, B = h - 40;
    const nx = o.xs.length, ny = o.ys.length, cw = (R - L) / nx, ch = (B - T) / ny;
    let amax = 0; for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const v = o.z(i, j); if (isFinite(v)) amax = Math.max(amax, Math.abs(v - o.center)); }
    amax = amax || 1;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const v = o.z(i, j), x = L + i * cw, y = B - (j + 1) * ch;
      if (!isFinite(v)) { ctx.fillStyle = C.surface2; ctx.globalAlpha = .45; ctx.fillRect(x + 1, y + 1, cw - 2, ch - 2); ctx.globalAlpha = 1; continue; }
      const t = Math.min(1, Math.abs(v - o.center) / amax);
      ctx.fillStyle = mix(C.surface2, v >= o.center ? C.accent : C.neg, 0.12 + 0.88 * Math.pow(t, 0.8));
      ctx.fillRect(x + 1, y + 1, cw - 2, ch - 2);
    }
    if (o.best) { const [bi, bj] = o.best; ctx.strokeStyle = C.ink; ctx.lineWidth = 2; ctx.strokeRect(L + bi * cw + 1, B - (bj + 1) * ch + 1, cw - 2, ch - 2); ctx.lineWidth = 1; }
    ctx.fillStyle = C.ink3; ctx.textBaseline = 'top'; ctx.textAlign = 'center';
    const xe = Math.max(1, Math.ceil(nx / Math.floor((R - L) / 34)));
    o.xs.forEach((v, i) => { if (i % xe === 0) ctx.fillText(String(v), L + (i + .5) * cw, B + 5); });
    ctx.fillText(o.xTitle, (L + R) / 2, B + 22);
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    const ye = Math.max(1, Math.ceil(ny / Math.floor((B - T) / 16)));
    o.ys.forEach((v, j) => { if (j % ye === 0) ctx.fillText(String(v), L - 6, B - (j + .5) * ch); });
    ctx.save(); ctx.translate(12, (T + B) / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.fillText(o.yTitle, 0, 0); ctx.restore(); ctx.textAlign = 'left';
    if (hv && hv.x >= L && hv.x <= R && hv.y >= T && hv.y <= B) {
      const i = Math.floor((hv.x - L) / cw), j = Math.floor((B - hv.y) / ch); const v = o.z(i, j);
      tooltip(ctx, w, h, hv.x, hv.y, [{ t: `${o.xTitle} ${o.xs[i]}, ${o.yTitle} ${o.ys[j]}` }, { t: isFinite(v) ? o.fmt(v) : 'not allowed' }], C);
    }
  });
}

// numeric x/y chart: line (sensitivity) or scatter (CSCV)
function xyChart(host, o) {
  return makeChart(host, o.height || 200, (ctx, w, h, hv, C) => {
    const L = 52, R = w - 12, T = 12, B = h - 36;
    const xs = o.pts.map(p => p[0]), ys = o.pts.map(p => p[1]).filter(isFinite);
    let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    if (o.zeroY) { y0 = Math.min(y0, 0); y1 = Math.max(y1, 0); }
    if (x0 === x1) { x0 -= 1; x1 += 1; } if (y0 === y1) { y0 -= 1; y1 += 1; }
    const py = (y1 - y0) * 0.08; y0 -= py; y1 += py; const px = o.mode === 'scatter' ? (x1 - x0) * 0.05 : 0; x0 -= px; x1 += px;
    const sx = v => L + (v - x0) / (x1 - x0) * (R - L), sy = v => B - (v - y0) / (y1 - y0) * (B - T);
    axisY(ctx, niceTicks(y0, y1, 4), sy, L, R, o.yFmt || (v => v.toFixed(2)), C);
    ctx.fillStyle = C.ink3; ctx.textBaseline = 'top'; ctx.textAlign = 'center';
    const xt = o.xTicks || niceTicks(x0, x1, Math.max(3, Math.floor((R - L) / 70)));
    xt.forEach(t => { const x = sx(t); if (x >= L - 2 && x <= R + 2) ctx.fillText((o.xFmt || String)(t), x, B + 6); });
    if (o.xTitle) ctx.fillText(o.xTitle, (L + R) / 2, B + 21);
    ctx.textAlign = 'left';
    if (o.zeroY) { ctx.strokeStyle = C.ink3; const y = Math.round(sy(0)) + .5; ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(R, y); ctx.stroke(); }
    if (o.zeroX) { ctx.strokeStyle = C.ink3; const x = Math.round(sx(0)) + .5; ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, B); ctx.stroke(); }
    const col = C[o.color || 'accent'];
    if (o.mode === 'scatter') {
      ctx.fillStyle = withAlpha(cssv('--' + (o.color || 'accent')), 0.35);
      o.pts.forEach(p => { if (!isFinite(p[1])) return; ctx.beginPath(); ctx.arc(sx(p[0]), sy(p[1]), 2.6, 0, 7); ctx.fill(); });
    } else {
      ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath(); let st = false;
      o.pts.forEach(p => { if (!isFinite(p[1])) { st = false; return; } if (!st) { ctx.moveTo(sx(p[0]), sy(p[1])); st = true; } else ctx.lineTo(sx(p[0]), sy(p[1])); }); ctx.stroke();
      o.pts.forEach(p => { if (!isFinite(p[1])) return; ctx.fillStyle = col; ctx.beginPath(); ctx.arc(sx(p[0]), sy(p[1]), 3, 0, 7); ctx.fill(); });
      if (o.markX != null) { const p = o.pts.find(q => q[0] === o.markX); if (p) { ctx.fillStyle = C.real; ctx.beginPath(); ctx.arc(sx(p[0]), sy(p[1]), 5.5, 0, 7); ctx.fill(); ctx.strokeStyle = C.surface; ctx.lineWidth = 2; ctx.stroke(); } }
      if (o.series2) { ctx.strokeStyle = C[o.series2.color]; ctx.lineWidth = 2; ctx.setLineDash([5, 4]); ctx.beginPath(); o.series2.pts.forEach((p, i) => i ? ctx.lineTo(sx(p[0]), sy(p[1])) : ctx.moveTo(sx(p[0]), sy(p[1]))); ctx.stroke(); ctx.setLineDash([]); o.series2.pts.forEach(p => { ctx.fillStyle = C[o.series2.color]; ctx.beginPath(); ctx.arc(sx(p[0]), sy(p[1]), 3, 0, 7); ctx.fill(); }); }
    }
    if (hv && hv.x >= L && hv.x <= R && o.mode !== 'scatter') {
      let bi = 0, bd = Infinity; o.pts.forEach((p, i) => { const d = Math.abs(sx(p[0]) - hv.x); if (d < bd) { bd = d; bi = i; } });
      const p = o.pts[bi]; const lines = [{ t: `${o.xTitle || 'x'} ${(o.xFmt || String)(p[0])}` }, { t: `${o.name || 'value'}: ${(o.tipFmt || o.yFmt || (v => v.toFixed(2)))(p[1])}`, c: col }];
      if (o.series2) { const q = o.series2.pts[bi]; if (q) lines.push({ t: `${o.series2.name}: ${(o.tipFmt || o.yFmt)(q[1])}`, c: C[o.series2.color] }); }
      tooltip(ctx, w, h, sx(p[0]), hv.y, lines, C);
    }
  });
}

// grouped bars per fold: in-sample vs out-of-sample annual return
function foldChart(host, o) {
  return makeChart(host, o.height || 220, (ctx, w, h, hv, C) => {
    const L = 52, R = w - 10, T = 10, B = h - 26, n = o.a.length;
    const all = o.a.concat(o.b).filter(isFinite);
    let y0 = Math.min(0, ...all), y1 = Math.max(0, ...all); const p = (y1 - y0) * 0.08 || 0.01; y0 -= p; y1 += p;
    const sy = v => B - (v - y0) / (y1 - y0) * (B - T), gw = (R - L) / n;
    axisY(ctx, niceTicks(y0, y1, 4), sy, L, R, v => (v * 100).toFixed(0) + '%', C);
    const bw = Math.max(1, Math.min(18, (gw - 4) / 2 - 1));
    for (let i = 0; i < n; i++) {
      const cx = L + (i + .5) * gw;
      [[o.a[i], C.mark, -1], [o.b[i], C.accent, 1]].forEach(([v, col, side]) => {
        if (!isFinite(v)) return; const x = side < 0 ? cx - bw - 1 : cx + 1; const ya = sy(Math.max(v, 0)), yb = sy(Math.min(v, 0));
        ctx.fillStyle = col; ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, ya, bw, Math.max(1, yb - ya), v >= 0 ? [2, 2, 0, 0] : [0, 0, 2, 2]); else ctx.rect(x, ya, bw, yb - ya); ctx.fill();
      });
    }
    ctx.strokeStyle = C.ink3; const zy = Math.round(sy(0)) + .5; ctx.beginPath(); ctx.moveTo(L, zy); ctx.lineTo(R, zy); ctx.stroke();
    ctx.fillStyle = C.ink3; ctx.textBaseline = 'top'; ctx.textAlign = 'center';
    const step = Math.max(1, Math.ceil(n / Math.floor((R - L) / 48)));
    o.labels.forEach((l, i) => { if (i % step === 0) ctx.fillText(l, L + (i + .5) * gw, B + 7); }); ctx.textAlign = 'left';
    if (hv && hv.x >= L && hv.x <= R) { const i = Math.max(0, Math.min(n - 1, Math.floor((hv.x - L) / gw))); tooltip(ctx, w, h, hv.x, hv.y, [{ t: `Fold ${i + 1} · ${o.labels[i]}` }, { t: `In-sample: ${pct(o.a[i])}`, c: C.mark }, { t: `Out-of-sample: ${pct(o.b[i])}`, c: C.accent }], C); }
  });
}

// ================= data =================
const S = { market: null, res: {}, busy: false, paramMemo: {}, autoRan: false };

function bizDates(n, y0) {
  const out = []; const d = new Date(Date.UTC(y0, 0, 4));
  while (out.length < n) { const wd = d.getUTCDay(); if (wd !== 0 && wd !== 6) out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
  return out;
}
// ----- CSV parsing -----
// ================= worker =================
const engineSrc = document.getElementById('engine-src').textContent;
const workerURL = URL.createObjectURL(new Blob([engineSrc], { type: 'text/javascript' }));
let worker, jobId = 0, pending = null, stepInfo = { i: 0, n: 1 };
function startWorker() {
  worker = new Worker(workerURL);
  worker.onmessage = e => {
    const m = e.data;
    if (!pending || m.id !== pending.id) return;
    if (m.type === 'progress') setProgress(m.frac, m.msg);
    else if (m.type === 'result') { const p = pending; pending = null; p.res(m.res); }
    else if (m.type === 'error') { const p = pending; pending = null; p.rej(new Error(m.error)); }
  };
  worker.onerror = e => { if (pending) { const p = pending; pending = null; p.rej(new Error(e.message || 'Engine error')); } };
  if (S.market) sendMarket();
}
function sendMarket() { const m = S.market; worker.postMessage({ type: 'market', o: m.o, h: m.h, l: m.l, c: m.c, bpy: bpy() }); }
function runJob(job, cfg, label) {
  return new Promise((res, rej) => {
    const id = ++jobId; pending = { id, res, rej };
    setProgress(0, label || 'Working');
    worker.postMessage({ type: 'run', id, job, cfg, seed: num('#seedIn', 2018) + job.length * 7919 });
  });
}
function setProgress(f, msg) {
  const tot = (stepInfo.i + Math.min(1, f || 0)) / stepInfo.n;
  $('#runFill').style.width = (tot * 100).toFixed(1) + '%';
  if (msg) $('#runMsg').textContent = (stepInfo.n > 1 ? `Step ${stepInfo.i + 1}/${stepInfo.n} · ` : '') + msg;
}
$('#cancelBtn').addEventListener('click', () => {
  if (!pending) return; worker.terminate(); const p = pending; pending = null; p.rej(new Error('cancelled')); startWorker();
});
function toast(msg, ms) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(t._h); t._h = setTimeout(() => t.hidden = true, ms || 4200); }

// ================= controls =================
const num = (sel, d) => { const v = parseFloat($(sel).value); return isFinite(v) ? v : d; };
const bpy = () => Math.max(1, num('#bpyIn', 252));
const COSTS = { fx: 1, equity: 5, bond: 2, crypto: 10, other: 2 };

function buildStratSelect() {
  const sel = $('#stratSel');
  sel.innerHTML = Object.entries(STRATS).map(([id, s]) => `<option value="${id}">${esc(s.name)}</option>`).join('');
  sel.addEventListener('change', () => { buildParams(); onConfigChange(); });
}
function saveParamMemo() {
  const id = S.curStrat; if (!id) return; const s = STRATS[id]; const memo = {};
  s.params.forEach(p => memo[p.k] = { val: $(`#pv_${p.k}`).value, min: $(`#pmin_${p.k}`).value, max: $(`#pmax_${p.k}`).value, step: $(`#pstep_${p.k}`).value });
  S.paramMemo[id] = memo;
}
function buildParams() {
  saveParamMemo();
  const id = $('#stratSel').value, s = STRATS[id]; S.curStrat = id;
  $('#stratBlurb').textContent = s.blurb; $('#famBadge').textContent = s.family;
  const memo = S.paramMemo[id] || {};
  $('#ptable').innerHTML = `<thead><tr><th>Parameter</th><th>Value</th><th>Min</th><th>Max</th><th>Step</th></tr></thead><tbody>` +
    s.params.map(p => { const m = memo[p.k] || {}; const st = p.int ? 1 : 0.1; return `<tr><td>${esc(p.label)}</td>
      <td><input type="number" id="pv_${p.k}" step="${st}" value="${m.val ?? p.def}" aria-label="${esc(p.label)} value"></td>
      <td><input type="number" id="pmin_${p.k}" step="${st}" value="${m.min ?? p.min}" aria-label="${esc(p.label)} min"></td>
      <td><input type="number" id="pmax_${p.k}" step="${st}" value="${m.max ?? p.max}" aria-label="${esc(p.label)} max"></td>
      <td><input type="number" id="pstep_${p.k}" step="${st}" min="${st}" value="${m.step ?? p.step}" aria-label="${esc(p.label)} step"></td></tr>`; }).join('') + '</tbody>';
  $('#ptable').querySelectorAll('input').forEach(i => i.addEventListener('input', onConfigChange));
  updateGridCount();
}
function getCfg() {
  const id = $('#stratSel').value, s = STRATS[id];
  const params = {}, ranges = {};
  s.params.forEach(p => {
    const rd = v => p.int ? Math.round(v) : v;
    params[p.k] = rd(num(`#pv_${p.k}`, p.def));
    ranges[p.k] = { min: rd(num(`#pmin_${p.k}`, p.min)), max: rd(num(`#pmax_${p.k}`, p.max)), step: Math.max(p.int ? 1 : 0.05, num(`#pstep_${p.k}`, p.step)) };
    if (ranges[p.k].max < ranges[p.k].min) ranges[p.k].max = ranges[p.k].min;
  });
  const hasOHLC = S.market ? S.market.hasOHLC : true;
  return {
    data: S.market ? S.market.name + ':' + S.market.n : '', strat: id, params, ranges,
    risk: { dir: $('#dirSel').value, exec: hasOHLC ? $('#execSel').value : 'close', sl: Math.min(0.95, num('#slIn', 0) / 100), tp: Math.min(0.95, num('#tpIn', 0) / 100), maxBars: Math.max(0, Math.round(num('#mbIn', 0))), cost: Math.max(0, num('#costIn', 0)) / 1e4 },
    crit: $('#critSel').value, nperm: Math.max(19, Math.round(num('#npermIn', 199))), train: Math.max(50, Math.round(num('#trainIn', 1000))), test: Math.max(5, Math.round(num('#testIn', 250))),
    anchored: $('#anchorChk').checked, wfPerm: Math.max(0, Math.round(num('#wfPermIn', 99))), blocks: +$('#blocksSel').value, alpha: +$('#alphaSel').value,
    horizon: Math.max(20, Math.round(num('#horizonIn', 252))), ddConf: +$('#ddConfSel').value, boundConf: 0.7, seed: num('#seedIn', 2018), bpy: bpy()
  };
}
function gridInfo(cfg) {
  const s = STRATS[cfg.strat]; const g = enumerateGrid(s, cfg.ranges); const start = g.combos.length ? gridStartFor(s, g.combos) : 0;
  return { n: g.combos.length, start, lists: g.lists };
}
function updateGridCount() {
  const cfg = getCfg(), gi = gridInfo(cfg), n = S.market ? S.market.n : 0;
  const el = $('#gridCount'); const cells = gi.n * Math.max(0, n - gi.start);
  let msg = `${gi.n.toLocaleString()} parameter sets in the grid`;
  el.classList.remove('over');
  if (gi.n === 0) { msg = 'The ranges allow no valid parameter set.'; el.classList.add('over'); }
  else if (gi.n > 1500 || cells > 9e6) { msg += ' · too many, coarsen the steps'; el.classList.add('over'); }
  else if (gi.n > 400) msg += ' · permutation tests will be slow';
  if (n && gi.start >= n - 100) { msg = 'Lookbacks are longer than the data allows.'; el.classList.add('over'); }
  el.textContent = msg;
  return !el.classList.contains('over');
}
const HASHES = {
  backtest: c => [c.data, c.strat, c.params, c.risk, c.bpy],
  optimize: c => [c.data, c.strat, c.ranges, c.risk, c.crit, c.bpy],
  mcpt: c => [c.data, c.strat, c.ranges, c.risk, c.crit, c.nperm, c.seed, c.bpy],
  wf: c => [c.data, c.strat, c.ranges, c.risk, c.crit, c.train, c.test, c.anchored, c.wfPerm, c.seed, c.bpy],
  cscv: c => [c.data, c.strat, c.ranges, c.risk, c.crit, c.blocks, c.bpy],
  bounds: c => [HASHES.wf(c), c.alpha, c.horizon, c.ddConf],
  shootout: c => [c.data, c.risk, c.crit, c.nperm, c.seed, shootSel(), c.bpy],
  nested: c => [c.data, c.risk, c.crit, c.train, c.test, c.anchored, c.seed, c.bpy, nestSel(), $('#nestLook') && $('#nestLook').value, $('#nestStep') && $('#nestStep').value, $('#nestPerm') && $('#nestPerm').value],
};
const hashOf = (k, c) => JSON.stringify(HASHES[k](c));
function onConfigChange() {
  updateGridCount();
  const c = getCfg();
  Object.keys(HASHES).forEach(k => { const r = S.res[k]; const st = $(`#stale_${k}`); if (st) st.hidden = !(r && r.hash !== hashOf(k, c)); });
  const anyStale = Object.keys(HASHES).some(k => S.res[k] && S.res[k].hash !== hashOf(k, c) && k !== 'shootout' && k !== 'nested');
  const vs = $('#stale_verdict'); if (vs) vs.hidden = !anyStale;
}
['#dirSel', '#execSel', '#slIn', '#tpIn', '#mbIn', '#costIn', '#critSel', '#npermIn', '#trainIn', '#testIn', '#wfPermIn', '#anchorChk', '#blocksSel', '#alphaSel', '#horizonIn', '#ddConfSel', '#seedIn', '#bpyIn']
  .forEach(s => $(s).addEventListener('input', onConfigChange));
$('#bpyIn').addEventListener('change', () => { if (S.market) sendMarket(); });
$('#capIn').addEventListener('change', () => { if (S.res.backtest) renderBacktest(); if (S.res.wf) renderWF(); if (S.res.nested) renderNested(); });
$('#assetSel').addEventListener('change', () => { $('#costIn').value = COSTS[$('#assetSel').value]; onConfigChange(); });

// ================= panels =================
const TABS = [
  { id: 'verdict', label: 'Verdict' },
  { id: 'backtest', n: '1', label: 'Backtest' },
  { id: 'optimize', n: '2', label: 'Optimize' },
  { id: 'mcpt', n: '3', label: 'Permutation' },
  { id: 'wf', n: '4', label: 'Walkforward' },
  { id: 'cscv', n: '5', label: 'Overfit odds' },
  { id: 'bounds', n: '6', label: 'Bounds' },
  { id: 'shootout', n: '7', label: 'Shootout' },
  { id: 'nested', n: '8', label: 'Nested WF' },
  { id: 'lab', label: 'Lab' },
  { id: 'method', label: 'Method' },
];
function head(id, title, q, btnLabel) {
  return `<div class="panel-head"><div><h2>${title}</h2><p class="q">${q}</p></div>${btnLabel ? `<button class="btn primary runbtn" type="button" data-run="${id}">${btnLabel}</button>` : ''}</div>
  <div class="stale" id="stale_${id}" hidden>Settings changed since this ran. Run it again to update.</div>`;
}
const HOW = {};
HOW.backtest = `<details class="how"><summary>How this backtest works, and why you shouldn't believe it yet</summary><div class="how-body">
<p>The rule decides at each bar's close using only data up to that close. With <b>Next bar open</b> the trade fills at the following open, the conservative choice. With <b>Signal bar close</b> it fills at the same close (market-on-close), which is slightly optimistic. Every bar is marked to market, so the system produces one return per bar, the granularity the later tests need.</p>
<p>Returns are differences of log prices: a move from 100 to 110 and back scores exactly zero, while percent returns would score a fake +0.9%. Costs are charged per side on every position change, so a reversal pays twice.</p>
<p><b>Why this number is optimistic.</b> If you picked these parameters after seeing any chart of this market, the result is in-sample. Markets are mostly noise, and parameters chosen on a history fit its noise as well as any real pattern. The noise will not repeat. Masters calls the gap between in-sample and future performance <i>training bias</i>. The rest of this app exists to measure it.</p>
<p><b>The percent-wins fallacy.</b> A high win rate proves nothing on its own. Expected return per trade is</p>
<div class="formula">E[R] = P(win) × avg win − P(loss) × avg loss</div>
<p>A tight profit target and a wide stop give you a high win rate in a pure random walk, with zero expectation. The Lab tab demonstrates it.</p>
<p><b>Stops and time exits add memory.</b> After a stop, the rule waits for a fresh signal, so today's decision depends on past decisions. Masters warns that this makes the effective lookback unbounded, which matters when you split data into training and test windows. Exponential averages (MACD) and Wilder's RSI have the same property in a milder form.</p>
<p class="cite">Masters ch.1 (log returns, future leak, percent-wins fallacy), ch.5 (single-bar returns, unbounded lookback).</p></div></details>`;
HOW.optimize = `<details class="how"><summary>Why the best parameter set is a biased estimate</summary><div class="how-body">
<p>The optimizer runs every parameter set in the grid over the same bars and keeps the one with the highest ${'criterion'}. Each result is skill plus luck. Picking the maximum picks the luckiest draw too, so the best in-sample figure overstates what the same parameters will do next. More parameter sets mean a higher maximum even when no set has any skill.</p>
<p><b>Read the distribution, not just the winner.</b> If most of the grid loses money and a handful of sets shine, you are probably looking at the luckiest corner of noise.</p>
<p><b>Sensitivity curves.</b> Masters treats these as minimal due diligence. Vary one parameter at a time around the optimum. You want a broad, smooth hill. A narrow spike means the system will fall off the cliff as markets drift. Several nearby peaks mean the score depends on catching or missing a few specific trades.</p>
<p>The stability figure in the summary is the average score of the immediate grid neighbours of the best set, as a share of the best score. Near 1 is a plateau. Below about 0.4 is a spike.</p>
<p class="cite">Masters ch.4, "Parameter Sensitivity Curves"; ch.5, "In-Sample and Out-of-Sample Performance".</p></div></details>`;
HOW.mcpt = `<details class="how"><summary>How the training permutation test works</summary><div class="how-body">
<p>Shuffle the market's price changes and the patterns are destroyed, but the distribution of moves, the volatility and the overall trend survive. If the strategy and its optimizer are finding real structure, the real market should score better than almost all shuffled markets. If the optimizer is powerful enough to fit noise, it will fit the shuffled markets just as well, and the real result will not stand out.</p>
<ol><li>Optimize on the real data and record the best score.</li><li>Shuffle the bars after the first bar where a decision is possible, then optimize again from scratch. Repeat <i>m</i> times.</li><li>Count <i>k</i>, the shuffled runs that scored at least as well as the real one.</li></ol>
<div class="formula">p = (k + 1) / (m + 1)</div>
<p>That is the probability that a worthless strategy-plus-optimizer would score this well by luck. Masters suggests treating anything above 0.05 with suspicion. It is <i>not</i> the probability that the strategy works.</p>
<p><b>How bars are shuffled.</b> The close-to-open gaps and the open-to-high/low/close moves are shuffled as two separate series. Shuffling opens alone would create impossible gaps between one bar's close and the next bar's open. The first decision bar stays fixed and the last close is preserved, so the net trend is identical in every permutation. The method assumes gaps and intrabar moves are independent; on daily FX and crypto, where gaps are tiny, that holds well.</p>
<p><b>Partitioning the in-sample return.</b> Total return = Skill + Trend + Training bias.</p>
<div class="formula">Trend         = (long bars − short bars) × (net log change / bars)
Training bias = mean over permutations of (best return − its trend part)
Unbiased      = Total − Training bias
Skill         = Unbiased − Trend</div>
<p>Trend is what a coin-flipper with the same long/short balance would earn from the market's drift. Skill is what's left after removing that and the noise-fitting. Whether profiting from a long-term trend counts as "intelligence" is a real debate; this shows you both numbers.</p>
<p class="cite">Masters ch.7, "Testing the Training Process", "Permuting Price Bars", "Partitioning Total Return of a Trading System".</p></div></details>`;
HOW.wf = `<details class="how"><summary>How the walkforward and its permutation test work</summary><div class="how-body">
<p>Walkforward simulates real life. At each fold, optimize on the training window that ends just before the test window, trade the winning parameters on the test window, then roll forward by one test window. The test returns are pooled into one contiguous out-of-sample record, so order-dependent figures like drawdown are legitimate.</p>
<p><b>What it tests.</b> Not one parameter set but the whole <i>model factory</i>: the rule plus the recipe for choosing its parameters. If the factory works, a system built from today's data should behave like this record.</p>
<p><b>Leakage at the fold boundary.</b> Trades that are still open at the end of a training window are marked to market there; the training score never sees bars past the window. Test returns use only the parameters chosen before the window started. With single-bar marked-to-market returns no guard buffer is needed (Masters' fifth method).</p>
<p><b>Walkforward efficiency</b> is out-of-sample annual return divided by the average in-sample annual return. Values well below 1 are normal. Near zero or negative means the in-sample results were mostly training bias.</p>
<p><b>The permutation test</b> repeats the entire walkforward on shuffled markets. The first training window is shuffled on its own and everything after it as one group, so unusual moves in that first window can never leak into a shuffled test window. p = (k+1)/(m+1) again.</p>
<p><b>Nonstationarity.</b> Try different test-window lengths. Performance usually peaks with frequent retraining and decays as the test window lengthens; how fast it decays tells you how often the system must be retrained.</p>
<p class="cite">Masters ch.5, "Walkforward Analysis", "Special Precautions for Algorithmic Trading", "Testing Robustness Against Nonstationarity"; ch.7, "Walkforward Testing a Trading System Factory".</p></div></details>`;
HOW.cscv = `<details class="how"><summary>How combinatorially symmetric cross validation works</summary><div class="how-body">
<p>Take the bar-by-bar returns of every parameter set in the grid over the same bars. Cut the bars into <i>S</i> equal blocks. For every way of choosing half the blocks as training data (252 ways for 10 blocks), find the best parameter set on the training half and check how it ranks on the other half.</p>
<p>If the optimizer is worthless, the in-sample winner is a random draw out-of-sample and lands below the median about half the time. The share of splits where it does is the <b>probability of backtest overfitting (PBO)</b>. You want it low.</p>
<div class="formula">rank fractile w = rank of IS-best on the OOS half / (systems + 1)
PBO = share of splits with w ≤ 0.5          logit = ln(w / (1 − w))</div>
<p><b>Read with care.</b> The answer depends on the competitors. Pad the grid with absurd parameters and any sensible set looks dominant; restrict it to near-identical sets and nothing can dominate. Each training half is only half the data, which biases toward pessimism, while nonstationary markets bias slightly toward optimism.</p>
<p class="cite">Masters ch.5, "Computationally Symmetric Cross Validation", after Bailey, Borwein, López de Prado and Zhu (2015), "The Probability of Backtest Overfitting".</p></div></details>`;
HOW.bounds = `<details class="how"><summary>How the bounds are computed</summary><div class="how-body">
<p>These use only the pooled walkforward out-of-sample returns, the one record free of training bias. By default the bars when the system was flat are dropped, as Masters usually does.</p>
<p><b>Student's t.</b> Assumes returns are roughly bell-shaped without extreme values. Market returns rarely are.</p>
<p><b>BCa bootstrap.</b> Resample the returns with replacement thousands of times and read the lower percentile of the resampled means, corrected for bias (z₀) and skew (acceleration, from a jackknife). Masters calls it the single most important bounding technique. A lower bound above zero is the bar to clear.</p>
<p><b>Profit factor</b> is bounded through its logarithm. Bootstrapping the Sharpe ratio is unreliable, so it is left out.</p>
<p><b>Drawdown.</b> The intuitive method resamples your returns and reads off drawdown percentiles. It forgets that your out-of-sample record is itself a random sample, maybe a lucky one, and it underestimates the chance of a severe drawdown, sometimes by a factor of 10 for catastrophic levels. The double bootstrap wraps that calculation in an outer bootstrap and reports a bound on the bound.</p>
<div class="formula">repeat outer: resample OOS returns
   repeat inner: resample a horizon-length path, record its max drawdown
   q_outer = DD-confidence quantile of the inner drawdowns
bound = 70th percentile of q_outer</div>
<p class="cite">Masters ch.6, "Bootstrap Confidence Intervals", "The BCa Bootstrap Algorithm", "Beware of Bootstrapping Ratios", "Bounding Drawdown".</p></div></details>`;
HOW.shootout = `<details class="how"><summary>Selection bias, and the story of John and Phil</summary><div class="how-body">
<p>Masters tells it like this. Two developers bring a manager their backtests. She picks John's, the more impressive one, and it loses the money: he had fit noise. The next manager holds back a year of data and tests both systems on it. Phil's out-of-sample result is slightly better, so she trades Phil's.</p>
<p>That out-of-sample result was unbiased until she compared it with John's and picked the winner. Choosing the best of several unbiased results favours the luckiest one, so the chosen figure is now optimistically biased. This is selection bias, and it grows with the number of candidates.</p>
<p>This test optimizes every chosen strategy on the same shuffled markets. The <b>solo p-value</b> asks how often a shuffled market beat that strategy's real score. The <b>selection-adjusted p-value</b> asks how often the <i>best</i> shuffled score among all strategies beat it, which is the honest question once you plan to trade the winner. For the top strategy it is exact; for the others it is conservative.</p>
<p class="cite">Masters ch.5, "Selection Bias"; ch.7, "Extending the Algorithm for Selection Bias".</p></div></details>`;

HOW.nested = `<details class="how"><summary>How the nested walkforward works</summary><div class="how-body">
<p>Masters' rule for any second-stage decision, such as picking a strategy, a market or a performance measure: base it on out-of-sample results from the first stage, and validate it out-of-sample too. That needs two levels of walkforward.</p>
<ol><li><b>Level 1.</b> Walk every competing strategy forward on its own, exactly as on the Walkforward tab. Each produces a stream of out-of-sample returns.</li>
<li><b>Level 2.</b> Every few bars, score each strategy on its most recent Level-1 returns and trade the best one until the next reselection. Only past Level-1 returns are used.</li>
<li>The Level-2 returns are out-of-sample for both the parameter choice and the strategy choice. They are the honest record of “trade whatever has been working”.</li></ol>
<div class="formula">first training window │ Level-1 OOS warm-up (selector lookback) │ Level-2 OOS: the result
        permuted      │          permuted separately            │  permuted separately</div>
<p><b>Read it against the competitors.</b> The chart shows every competitor's Level-1 record over the same bars. If one strategy beat the selector, you only know that in hindsight; picking it now would be selection bias. The selector's record is what you could actually have achieved.</p>
<p><b>Switching costs.</b> When the selector changes strategy, the position change between the two strategies is charged at your cost per side.</p>
<p><b>The permutation test</b> reruns both levels on shuffled markets. The three segments are shuffled separately so that unusual moves in the training or warm-up periods never land in the final out-of-sample period, following Masters' CHOOSER program.</p>
<p class="cite">Masters ch.5, "Nested Walkforward Analysis", "A Practical Application of Nested Walkforward"; ch.7, "Example: Permuting Multiple Markets".</p></div></details>`;

function buildPanels() {
  $('#tabs').innerHTML = TABS.map((t, i) => `<button class="tab" role="tab" type="button" id="tab_${t.id}" aria-controls="panel_${t.id}" aria-selected="${i === 0}" data-tab="${t.id}">${t.n ? `<span class="n">${t.n}</span>` : ''}${t.label}${['verdict', 'lab', 'method', 'backtest', 'optimize'].includes(t.id) ? '' : '<span class="dot" id="dot_' + t.id + '"></span>'}</button>`).join('');
  const P = {};
  P.verdict = `${head('verdict', 'Verdict', 'Each test can reject “this strategy is worthless”. An in-sample backtest can’t, so it doesn’t count.')}
    <div id="out_verdict"></div>`;
  P.backtest = `${head('backtest', 'In-sample backtest', 'What your chosen parameters would have done over the whole history. Treat it as a sales pitch, not evidence.', 'Run backtest')}<div id="out_backtest"></div>${HOW.backtest}`;
  P.optimize = `${head('optimize', 'Grid optimization', 'Every parameter set in your grid, run on the same bars. How special is the winner, and is it a plateau or a spike?', 'Run optimizer')}<div id="out_optimize"></div>${HOW.optimize}`;
  P.mcpt = `${head('mcpt', 'Training permutation test', 'Would the optimizer have found something this good in a market with no patterns at all?', 'Run permutation test')}<div id="out_mcpt"></div>${HOW.mcpt}`;
  P.wf = `${head('wf', 'Walkforward', 'Re-optimize on the past, trade the next window, repeat. The pooled test windows are the closest thing to a live track record.', 'Run walkforward')}<div id="out_wf"></div>${HOW.wf}`;
  P.cscv = `${head('cscv', 'Probability of backtest overfitting', 'Split the history every possible way. How often does the in-sample winner finish in the bottom half out-of-sample?', 'Run CSCV')}<div id="out_cscv"></div>${HOW.cscv}`;
  P.bounds = `${head('bounds', 'Bounds on the future', 'From walkforward returns only: how low could the true mean return be, and how deep could the next year’s drawdown go?', 'Compute bounds')}
    <div class="chk"><label><input type="checkbox" id="inMktChk" checked> Use only bars with an open position</label></div><div id="out_bounds"></div>${HOW.bounds}`;
  P.shootout = `${head('shootout', 'Strategy shootout', 'Throw several strategies at the wall and keep the best. How much of its p-value survives the fact that you picked it?', 'Run shootout')}
    <div class="card"><div class="card-head"><h3>Competitors</h3><span class="small muted">Each uses its default grid, except the strategy selected on the left, which uses yours.</span></div><div class="chk" id="shootChk"></div></div>
    <div id="out_shootout"></div>${HOW.shootout}`;
  P.nested = `${head('nested', 'Nested walkforward', 'Let each strategy’s recent out-of-sample record decide which one to trade next. Is the switching itself an edge, or would one strategy picked in hindsight have done as well?', 'Run nested walkforward')}
    <div class="card"><div class="card-head"><h3>Competitors and selector</h3><span class="small muted">Inner walkforward uses the train/test windows on the left. Defaults grids, except the strategy selected on the left, which uses yours.</span></div>
      <div class="chk" id="nestChk"></div>
      <div class="inline-fields"><label for="nestLook">Selector lookback (OOS bars)<input type="number" id="nestLook" min="20" step="10" value="500"></label><label for="nestStep">Reselect every (bars)<input type="number" id="nestStep" min="1" step="1" value="21"></label><label for="nestPerm">Permutations<input type="number" id="nestPerm" min="0" step="1" value="99"></label></div></div>
    <div id="out_nested"></div>${HOW.nested}`;
  P.lab = `<div class="panel-head"><div><h2>Lab</h2><p class="q">Short experiments on markets where the answer is known in advance. Each one isolates a trap from the book.</p></div></div><div class="lessons" id="labOut"></div>`;
  P.method = `<div id="methodOut"></div>`;
  $('#panels').innerHTML = TABS.map((t, i) => `<section class="panel" role="tabpanel" id="panel_${t.id}" aria-labelledby="tab_${t.id}" ${i ? 'hidden' : ''}>${P[t.id]}</section>`).join('');
  $('#tabs').addEventListener('click', e => { const b = e.target.closest('.tab'); if (b) showTab(b.dataset.tab); });
  document.querySelectorAll('.runbtn').forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.run; if (id === 'verdict') return runAudit();
    guarded(() => RUN[id]());
  }));
  $('#runAll').addEventListener('click', () => runAudit());
  $('#inMktChk').addEventListener('change', () => { if (S.res.bounds) S.res.bounds.hash = 'x'; onConfigChange(); });
  $('#shootChk').innerHTML = Object.entries(STRATS).map(([id, s]) => `<label><input type="checkbox" value="${id}" ${['ma_cross', 'momentum', 'donchian', 'zscore', 'rsi', 'macd'].includes(id) ? 'checked' : ''}> ${esc(s.name)}</label>`).join('');
  $('#shootChk').addEventListener('change', onConfigChange);
  $('#nestChk').innerHTML = Object.entries(STRATS).map(([id, s]) => `<label><input type="checkbox" value="${id}" ${['ma_cross', 'donchian', 'zscore', 'rsi'].includes(id) ? 'checked' : ''}> ${esc(s.name)}</label>`).join('');
  ['#nestChk', '#nestLook', '#nestStep', '#nestPerm'].forEach(sel => $(sel).addEventListener('input', onConfigChange));
  buildLab(); buildMethod();
  emptyStates();
}
function nestSel() { return Array.from(document.querySelectorAll('#nestChk input:checked')).map(i => i.value); }
function shootSel() { return Array.from(document.querySelectorAll('#shootChk input:checked')).map(i => i.value); }
function showTab(id) {
  TABS.forEach(t => { $(`#tab_${t.id}`).setAttribute('aria-selected', t.id === id); $(`#panel_${t.id}`).hidden = t.id !== id; });
  try { localStorage.setItem('edge_tab', id); } catch (e) { }
  requestAnimationFrame(redrawAll);
}
function emptyStates() {
  const msgs = { backtest: 'Run the backtest to see the equity curve.', optimize: 'Run the optimizer to search the grid.', mcpt: 'Run the permutation test to see whether the optimizer beats shuffled markets.', wf: 'Run the walkforward to build an out-of-sample record.', cscv: 'Run CSCV to estimate the probability of backtest overfitting.', bounds: 'Compute bounds after a walkforward. If none has run, it runs one first.', shootout: 'Pick competitors above and run the shootout.', nested: 'Pick at least two competitors and run the nested walkforward.', verdict: 'Run the full audit to fill in the verdict.' };
  Object.entries(msgs).forEach(([k, m]) => { const o = $(`#out_${k}`); if (o && !o.innerHTML) o.innerHTML = `<div class="empty"><p>${m}</p></div>`; });
}

// ================= runners =================
async function guarded(fn) {
  if (S.busy) { toast('A test is already running. Wait for it or cancel it.'); return; }
  if (!S.market) return;
  if (!updateGridCount()) { toast('Fix the parameter grid first: it is empty or too large.'); return; }
  S.busy = true; $('#runbar').hidden = false; document.querySelectorAll('.runbtn, #runAll').forEach(b => b.disabled = true);
  try { await fn(); }
  catch (e) { if (e.message !== 'cancelled') toast(e.message, 7000); else toast('Cancelled.'); }
  finally { S.busy = false; $('#runbar').hidden = true; stepInfo = { i: 0, n: 1 }; document.querySelectorAll('.runbtn, #runAll').forEach(b => b.disabled = false); onConfigChange(); }
}
const RUN = {
  async backtest() { const c = getCfg(); const r = await runJob('backtest', { strat: c.strat, params: c.params, risk: c.risk }, 'Backtesting'); S.res.backtest = { r, c, hash: hashOf('backtest', c) }; renderBacktest(); },
  async optimize() { const c = getCfg(); const r = await runJob('optimize', { strat: c.strat, ranges: c.ranges, risk: c.risk, crit: c.crit }, 'Searching the grid'); S.res.optimize = { r, c, hash: hashOf('optimize', c) }; renderOptimize(); },
  async mcpt() { const c = getCfg(); const r = await runJob('mcpt', { strat: c.strat, ranges: c.ranges, risk: c.risk, crit: c.crit, nperm: c.nperm }, 'Permutation test'); S.res.mcpt = { r, c, hash: hashOf('mcpt', c) }; renderMCPT(); },
  async wf() { const c = getCfg(); const r = await runJob('wf', { strat: c.strat, ranges: c.ranges, risk: c.risk, crit: c.crit, train: c.train, test: c.test, anchored: c.anchored, nperm: c.wfPerm }, 'Walkforward'); S.res.wf = { r, c, hash: hashOf('wf', c) }; renderWF(); },
  async cscv() { const c = getCfg(); const r = await runJob('cscv', { strat: c.strat, ranges: c.ranges, risk: c.risk, crit: c.crit, blocks: c.blocks }, 'Cross validation'); S.res.cscv = { r, c, hash: hashOf('cscv', c) }; renderCSCV(); },
  async bounds() {
    const c = getCfg();
    if (!S.res.wf || S.res.wf.hash !== hashOf('wf', c)) { stepInfo = { i: 0, n: 2 }; await RUN.wf(); stepInfo.i = 1; }
    const w = S.res.wf.r;
    const r = await runJob('bounds', { returns: w.pooled, pos: w.pos, inMarketOnly: $('#inMktChk').checked, horizon: c.horizon, ddConf: c.ddConf, boundConf: c.boundConf, alpha: c.alpha }, 'Bootstrap');
    S.res.bounds = { r, c, hash: hashOf('bounds', c) }; renderBounds();
  },
  async nested() {
    const c = getCfg(); const sel = nestSel();
    if (sel.length < 2) throw new Error('Pick at least two competitors.');
    const comps = sel.map(id => ({ strat: id, ranges: id === c.strat ? c.ranges : Object.fromEntries(STRATS[id].params.map(p => [p.k, { min: p.min, max: p.max, step: p.step }])) }));
    const cfg = { comps, risk: c.risk, crit: c.crit, train: c.train, test: c.test, anchored: c.anchored, oos1n: Math.max(20, Math.round(num('#nestLook', 500))), step: Math.max(1, Math.round(num('#nestStep', 21))), nperm: Math.max(0, Math.round(num('#nestPerm', 99))) };
    const r = await runJob('nested', cfg, 'Nested walkforward');
    S.res.nested = { r, c, cfg, hash: hashOf('nested', c) }; renderNested(); if (document.querySelector('.verdict-hero')) renderVerdict();
  },
  async shootout() {
    const c = getCfg(); const sel = shootSel();
    if (sel.length < 2) throw new Error('Pick at least two competitors.');
    const comps = sel.map(id => ({ strat: id, ranges: id === c.strat ? c.ranges : Object.fromEntries(STRATS[id].params.map(p => [p.k, { min: p.min, max: p.max, step: p.step }])) }));
    const r = await runJob('shootout', { comps, risk: c.risk, crit: c.crit, nperm: c.nperm }, 'Shootout');
    S.res.shootout = { r, c, hash: hashOf('shootout', c) }; renderShootout();
  }
};
async function runAudit() {
  await guarded(async () => {
    const steps = ['backtest', 'optimize', 'mcpt', 'wf', 'cscv', 'bounds'];
    stepInfo = { i: 0, n: steps.length };
    for (let i = 0; i < steps.length; i++) {
      stepInfo.i = i; const k = steps[i];
      if (k === 'bounds') { const c = getCfg(); const w = S.res.wf.r; const r = await runJob('bounds', { returns: w.pooled, pos: w.pos, inMarketOnly: $('#inMktChk').checked, horizon: c.horizon, ddConf: c.ddConf, boundConf: c.boundConf, alpha: c.alpha }, 'Bootstrap bounds'); S.res.bounds = { r, c, hash: hashOf('bounds', c) }; renderBounds(); }
      else await RUN[k]();
    }
    renderVerdict(); showTab('verdict');
  });
}

// ================= renderers =================
function kpis(items) { return `<div class="kpis">${items.map(i => `<div class="kpi"><span class="k">${i.k}</span><span class="v ${i.cls || ''}">${i.v}</span>${i.s ? `<span class="s">${i.s}</span>` : ''}</div>`).join('')}</div>`; }
function cum(arr) { let s = 0; return arr.map(v => (s += v)); }
function reading(cls, html) { return `<div class="reading ${cls}">${html}</div>`; }
const statusOf = { p: p => p <= 0.05 ? 'good' : p <= 0.15 ? 'warn' : 'bad' };
function pill(cls, text) { return `<span class="pill ${cls}">${text}</span>`; }
function setDot(id, cls) { const d = $(`#dot_${id}`); if (d) d.className = 'dot ' + (cls || ''); }
function dates() { return S.market.dates; }

// ================= performance report =================
const capital = () => Math.max(1, num('#capIn', 100000));
const money = v => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 });
const fmtBars = (b, bp) => `${int(b)} bars · ${(b / bp).toFixed(1)} yr`;
function bhMetrics(r, bp) { const pos = r.map(() => 1); return Object.assign(fullMetrics(r, pos, [{ side: 1, ret: r.reduce((a, b) => a + b, 0), bars: r.length }], bp), { noTrades: true }); }
function reportHTML(cols, bp) {
  const cap = capital();
  const rows = [
    ['Returns'],
    ['Cumulative P&L', m => money(cap * (Math.exp(m.total) - 1)), `on ${cap.toLocaleString('en-US')} starting capital, fully reinvested`],
    ['Total return', m => pct(simple(m.total))],
    ['CAGR', m => pct(m.cagr)],
    ['Risk'],
    ['Annual volatility', m => pctU(m.annVol)],
    ['Max drawdown', m => pctU(m.maxDD)],
    ['Longest time under water', m => fmtBars(m.ddBars, bp)],
    ['Ulcer index', m => pctU(m.ulcer), 'root-mean-square drawdown'],
    ['Risk-adjusted'],
    ['Sharpe ratio', m => f2(m.sharpe), 'annualized, zero risk-free rate'],
    ['Sortino ratio', m => f2(m.sortino), 'penalizes only downside volatility'],
    ['Calmar ratio', m => f2(m.calmar), 'CAGR ÷ max drawdown'],
    ['Trades'],
    ['Number of trades', (m) => m.noTrades ? '—' : (`${int(m.trades)} · ${m.tradesPerYear.toFixed(1)}/yr`)],
    ['Win rate', (m) => m.noTrades ? '—' : (pctU(m.winRate, 1))],
    ['Average gain', (m) => m.noTrades ? '—' : (pct(simple(m.avgWin), 2))],
    ['Average loss', (m) => m.noTrades ? '—' : (pct(simple(m.avgLoss), 2))],
    ['Payoff ratio', (m) => m.noTrades ? '—' : (f2(m.payoff)), 'average gain ÷ average loss'],
    ['Expectancy per trade', (m) => m.noTrades ? '—' : (pct(simple(m.expectancy), 2)), 'win rate × gain − loss rate × loss'],
    ['Profit factor', (m) => m.noTrades ? '—' : (f2(m.pfTrades)), 'gross gains ÷ gross losses'],
    ['Best / worst trade', (m) => m.noTrades ? '—' : (`${pct(simple(m.best), 1)} / ${pct(simple(m.worst), 1)}`)],
    ['Longest losing streak', (m) => m.noTrades ? '—' : (`${m.maxLossStreak} trades`)],
    ['Average holding period', (m) => m.noTrades ? '—' : (`${m.avgBars.toFixed(1)} bars`)],
    ['Exposure & shape'],
    ['Time in market', m => pctU(m.inMarket, 0)],
    ['Long trades', m => pctU(m.longShare, 0)],
    ['Skewness', m => f2(m.skew), 'of bar returns while in the market'],
    ['Excess kurtosis', m => f2(m.kurt), 'fat tails above 0'],
  ];
  return `<div class="tablewrap"><table class="data"><thead><tr><th>Metric</th>${cols.map(c => `<th class="num">${esc(c.name)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => r.length === 1 ? `<tr class="grp"><td colspan="${cols.length + 1}">${r[0]}</td></tr>` : `<tr><td class="lab"${r[2] ? ` title="${esc(r[2])}"` : ''}>${r[0]}${r[2] ? `<div class="small" style="color:var(--ink-3)">${esc(r[2])}</div>` : ''}</td>${cols.map(c => `<td class="num">${r[1](c.m)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function yearlyHTML(series, D) {
  const years = []; const acc = series.map(() => new Map());
  series.forEach((s, k) => s.r.forEach((v, i) => { const y = D[i].slice(0, 4); if (!acc[k].has(y)) { acc[k].set(y, 0); if (k === 0) years.push(y); } acc[k].set(y, acc[k].get(y) + v); }));
  return `<div class="tablewrap"><table class="data"><thead><tr><th>Year</th>${series.map(s => `<th class="num">${esc(s.name)}</th>`).join('')}</tr></thead><tbody>${years.map(y => `<tr><td class="mono">${y}</td>${acc.map(a => { const v = a.get(y); return v == null ? '<td class="num">—</td>' : `<td class="num ${v >= 0 ? 'pos' : 'negv'}">${pct(simple(v))}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function reportCard(title, cols, yearlySeries, D, bp) {
  return `<div class="grid2" style="grid-template-columns:minmax(0,1.6fr) minmax(0,1fr)"><div class="card"><div class="card-head"><h3>${title}</h3><span class="small muted">bar-by-bar, marked to market</span></div>${reportHTML(cols, bp)}</div>
  <div class="card"><div class="card-head"><h3>Returns by calendar year</h3></div>${yearlyHTML(yearlySeries, D)}</div></div>`;
}

// equity curve (log % or currency) with an underwater chart beneath
S.eqMode = 'log';
const EQ = {};
function equityHTML(key, title, series, note) {
  return `<div class="card"><div class="card-head"><h3>${title}</h3><div class="seg" role="group" aria-label="Equity scale"><button type="button" data-eq="log" aria-pressed="${S.eqMode === 'log'}">Log return %</button><button type="button" data-eq="cash" aria-pressed="${S.eqMode === 'cash'}">Equity</button></div></div>
  <div class="legend">${series.map(s => `<span><i style="background:var(--${s.color === 'ink3' ? 'ink-3' : s.color})${s.dash ? ';opacity:.7' : ''}"></i>${esc(s.name)}</span>`).join('')}</div>
  <div class="chart" id="eq_${key}"></div><div class="eyebrow">Drawdown</div><div class="chart" id="dd_${key}"></div>${note ? `<p class="small muted">${note}</p>` : ''}</div>`;
}
function drawEquity(key, series, D, vlines) {
  EQ[key] = () => drawEquity(key, series, D, vlines);
  const cap = capital(), cash = S.eqMode === 'cash';
  const curves = series.map(s => { const c = cum(s.r); return Object.assign({}, s, { c }); });
  lineChart($(`#eq_${key}`), { series: curves.map(s => ({ y: cash ? s.c.map(v => cap * Math.exp(v)) : s.c.map(v => v * 100), color: s.color, name: s.name, width: s.width || 2, dash: s.dash })), x: D, vlines,
    yFmt: cash ? (v => Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : (v / 1e3).toFixed(0) + 'k') : (v => v.toFixed(0) + '%'),
    tipFmt: cash ? (v => v.toLocaleString('en-US', { maximumFractionDigits: 0 })) : (v => `${v.toFixed(1)}% log (${pct(simple(v / 100))})`), zero: !cash, height: 270 });
  const dd = curves.map(s => { let pk = 0; return s.c.map(v => { if (v > pk) pk = v; return (Math.exp(v - pk) - 1) * 100; }); });
  lineChart($(`#dd_${key}`), { series: curves.map((s, i) => ({ y: dd[i], color: s.color, name: s.name, width: i ? 1.2 : 1.6, dash: s.dash })), x: D, vlines, yFmt: v => v.toFixed(0) + '%', tipFmt: v => v.toFixed(1) + '%', height: 120 });
}
document.addEventListener('click', e => { const b = e.target.closest('[data-eq]'); if (!b) return; S.eqMode = b.dataset.eq; document.querySelectorAll('[data-eq]').forEach(x => x.setAttribute('aria-pressed', x.dataset.eq === S.eqMode)); Object.values(EQ).forEach(f => { try { f(); } catch (err) { } }); });

function renderBacktest() {
  const { r, c } = S.res.backtest, st = r.stats, b = r.bh, ts = r.tstats, D = dates().slice(r.start);
  const yrs = st.n / c.bpy;
  const why = Object.entries(ts.byWhy).map(([k, v]) => `${k} ${v}`).join(' · ');
  let warn = '';
  if (ts.n && ts.winRate > 0.6 && ts.expectancy < Math.abs(ts.avgLoss) * 0.15) warn = `<p>Win rate is ${pctU(ts.winRate, 0)}, yet the average trade makes only ${pct(simple(ts.expectancy), 2)}. Wins are small and losses are large. See the percent-wins fallacy below.</p>`;
  $('#out_backtest').innerHTML = kpis([
    { k: 'Total return', v: pct(simple(st.total)), cls: st.total >= 0 ? 'pos' : 'negv', s: `buy & hold ${pct(simple(b.total))}` },
    { k: 'Annualized', v: pct(simple(st.annRet)), s: `buy & hold ${pct(simple(b.annRet))}` },
    { k: 'Sharpe', v: f2(st.sharpe), s: `buy & hold ${f2(b.sharpe)}` },
    { k: 'Max drawdown', v: pctU(st.maxDD), s: `buy & hold ${pctU(b.maxDD)}` },
    { k: 'Profit factor', v: f2(st.pf), s: 'bar returns' },
    { k: 'Trades', v: int(ts.n), s: `${f2(ts.n / Math.max(yrs, 1e-9))} per year` },
    { k: 'Win rate', v: pctU(ts.winRate, 0), s: `avg ${pct(simple(ts.avgWin), 2)} / ${pct(simple(ts.avgLoss), 2)}` },
    { k: 'Time in market', v: pctU(st.inMarket, 0), s: `${int(r.nL)} long · ${int(r.nS)} short bars` },
  ]) + equityHTML('bt', 'Cumulative return', [{ name: `${STRATS[c.strat].name} (${paramStr(c.params)})`, color: 'accent' }, { name: 'Buy & hold', color: 'real' }], `${D[0]} to ${D[D.length - 1]}, ${int(st.n)} bars. Log scale: +69% log is a doubling.`) + `
  ${reading('warn', `<p><b>In-sample.</b> ${st.total > 0 ? 'It made money over this history.' : 'It lost money over this history.'} Nothing on this tab can tell you whether that came from a real pattern or from parameters that happen to fit this particular noise. ${c.risk.cost === 0 ? 'Costs are set to zero, which flatters every result.' : ''}</p>${warn}`)}
  <div class="card"><div class="card-head"><h3>Last trades</h3><span class="small muted">Exits: ${esc(why) || 'none'}</span></div><div class="tablewrap"><table class="data"><thead><tr><th>Side</th><th>Entry</th><th>Exit</th><th class="num">Bars</th><th class="num">Return</th><th>Exit reason</th></tr></thead><tbody>
  ${r.trades.slice(-12).reverse().map(t => `<tr><td>${t.side > 0 ? 'Long' : 'Short'}</td><td class="mono">${dates()[t.entT] || ''}</td><td class="mono">${dates()[t.exT] || ''}</td><td class="num">${t.bars}</td><td class="num ${t.ret >= 0 ? 'pos' : 'negv'}">${pct(simple(t.ret), 2)}</td><td>${t.why}</td></tr>`).join('') || '<tr><td colspan="6">No trades.</td></tr>'}</tbody></table></div></div>`
  + reportCard('Performance report, in-sample', [{ name: 'Strategy', m: fullMetrics(r.returns, r.pos, r.trades.filter(t => t.why !== 'open' || true), c.bpy) }, { name: 'Buy & hold', m: bhMetrics(r.bhRet, c.bpy) }], [{ name: 'Strategy', r: r.returns }, { name: 'Buy & hold', r: r.bhRet }], D, c.bpy);
  drawEquity('bt', [{ r: r.returns, color: 'accent', name: 'Strategy' }, { r: r.bhRet, color: 'real', name: 'Buy & hold', width: 1.5 }], D);
}

function neighbourStability(r) {
  const best = r.combos[r.best], bv = r.vals[r.best], c = S.res.optimize.c.crit;
  const idx = new Map(r.combos.map((p, i) => [r.keys.map(k => p[k]).join('|'), i]));
  const vals = [];
  r.keys.forEach((k, ki) => {
    const list = r.lists[ki], pos = list.indexOf(best[k]);
    [pos - 1, pos + 1].forEach(j => { if (j < 0 || j >= list.length) return; const q = Object.assign({}, best, { [k]: list[j] }); const i = idx.get(r.keys.map(kk => q[kk]).join('|')); if (i != null) vals.push(r.vals[i]); });
  });
  if (!vals.length) return { ratio: NaN, n: 0 };
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const base = c === 'pf' ? 1 : 0;
  if (bv <= base) return { ratio: 0, n: vals.length, mean };
  return { ratio: Math.max(-1, (mean - base) / (bv - base)), n: vals.length, mean };
}
function renderOptimize() {
  const { r, c } = S.res.optimize, s = STRATS[c.strat];
  const vals = r.vals, sorted = vals.slice().sort((a, b) => a - b), med = sorted[Math.floor(sorted.length / 2)], best = r.combos[r.best];
  const profitable = r.sharpes.filter(v => v > 0).length / vals.length;
  const stab = neighbourStability(r); S.res.optimize.stab = stab;
  const scls = !isFinite(stab.ratio) ? 'info' : stab.ratio >= 0.7 ? 'good' : stab.ratio >= 0.4 ? 'warn' : 'bad';
  const nk = r.keys.length;
  let heatSel = '';
  if (nk >= 2) heatSel = `<div class="chk"><label>x <select id="hx">${r.keys.map((k, i) => `<option value="${i}" ${i === 0 ? 'selected' : ''}>${k}</option>`).join('')}</select></label><label>y <select id="hy">${r.keys.map((k, i) => `<option value="${i}" ${i === 1 ? 'selected' : ''}>${k}</option>`).join('')}</select></label>${nk > 2 ? '<span class="small muted">Other parameters held at their best values.</span>' : ''}</div>`;
  $('#out_optimize').innerHTML = kpis([
    { k: 'Parameter sets tried', v: int(vals.length), s: `${int(r.N)} bars each` },
    { k: 'Best set', v: esc(paramStr(best)), s: `${critName(c.crit)} ${critFmt(c.crit, vals[r.best])}` },
    { k: 'Median set', v: critFmt(c.crit, med), s: 'what a typical choice scores' },
    { k: 'Sets with Sharpe > 0', v: pctU(profitable, 0), s: 'in-sample' },
    { k: 'Neighbour stability', v: isFinite(stab.ratio) ? f2(stab.ratio) : '—', s: `${stab.n} grid neighbours of the best`, cls: scls === 'good' ? 'pos' : scls === 'bad' ? 'negv' : '' },
  ]) + `<div class="grid2">
    <div class="card"><div class="card-head"><h3>Every set in the grid</h3><span class="small muted">${critName(c.crit)}</span></div><div class="chart" id="ch_dist"></div><p class="small muted">The amber line is the set you would report. It is the maximum of ${int(vals.length)} noisy numbers.</p></div>
    <div class="card"><div class="card-head"><h3>${nk >= 2 ? 'Parameter surface' : 'Sensitivity'}</h3>${heatSel}</div><div class="chart" id="ch_heat"></div>${nk >= 2 ? '<p class="small muted">Blue scores above zero, orange below. The outlined cell is the best set. Look for a broad blue region, not one bright cell.</p>' : ''}</div>
  </div>
  <div class="card"><div class="card-head"><h3>Sensitivity curves</h3><span class="small muted">One parameter varied, others held at the optimum (amber dot)</span></div><div class="grid3" id="sensGrid"></div></div>
  ${reading(scls === 'info' ? '' : scls, `<p>${stab.ratio >= 0.7 ? 'The best set sits on a plateau: its neighbours score almost as well. That is the shape you want.' : stab.ratio >= 0.4 ? 'The neighbours of the best set score noticeably worse. The optimum is a hill with steep sides, so small shifts in market behaviour could cost a lot.' : isFinite(stab.ratio) ? 'The best set is an isolated spike. Its neighbours score far worse, a classic sign that the winner caught a few lucky trades.' : 'Not enough neighbours to judge stability.'} The real question, whether even the plateau is just fitted noise, is for the permutation test.</p>`)}
  <div class="chk"><button class="btn sm" type="button" id="useBest">Use the best set as backtest values</button></div>`;
  histChart($('#ch_dist'), { values: vals, marker: vals[r.best], markerLabel: 'Best ' + critFmt(c.crit, vals[r.best]), fmt: v => c.crit === 'total' ? (v * 100).toFixed(0) + '%' : v.toFixed(2), unit: 'sets', shadeLeft: false, height: 230 });
  const idx = new Map(r.combos.map((p, i) => [r.keys.map(k => p[k]).join('|'), i]));
  const lookup = q => { const i = idx.get(r.keys.map(k => q[k]).join('|')); return i == null ? NaN : vals[i]; };
  const fmt = v => critFmt(c.crit, v);
  const drawHeat = () => {
    if (nk < 2) { const k = r.keys[0]; xyChart($('#ch_heat'), { pts: r.lists[0].map(v => [v, lookup({ [k]: v })]), markX: best[k], xTitle: k, yFmt: c.crit === 'total' ? v => (v * 100).toFixed(0) + '%' : v => v.toFixed(2), tipFmt: fmt, zeroY: c.crit !== 'pf', name: critName(c.crit), height: 260 }); return; }
    let xi = +$('#hx').value, yi = +$('#hy').value; if (xi === yi) yi = (xi + 1) % nk;
    const xk = r.keys[xi], yk = r.keys[yi], xs = r.lists[xi], ys = r.lists[yi];
    heatChart($('#ch_heat'), { xs, ys, xTitle: xk, yTitle: yk, center: c.crit === 'pf' ? 1 : 0, fmt, best: [xs.indexOf(best[xk]), ys.indexOf(best[yk])], z: (i, j) => lookup(Object.assign({}, best, { [xk]: xs[i], [yk]: ys[j] })), height: 300 });
  };
  drawHeat(); if (nk >= 2) { $('#hx').addEventListener('change', drawHeat); $('#hy').addEventListener('change', drawHeat); }
  const sg = $('#sensGrid'); sg.innerHTML = r.keys.map((k, i) => `<div><div class="small muted mono">${esc(s.params[i].label)}</div><div class="chart" id="sens_${i}"></div></div>`).join('');
  r.keys.forEach((k, i) => xyChart($(`#sens_${i}`), { pts: r.lists[i].map(v => [v, lookup(Object.assign({}, best, { [k]: v }))]), markX: best[k], xTitle: k, yFmt: c.crit === 'total' ? v => (v * 100).toFixed(0) + '%' : v => v.toFixed(2), tipFmt: fmt, zeroY: c.crit !== 'pf', name: critName(c.crit), height: 180 }));
  $('#useBest').addEventListener('click', () => { r.keys.forEach(k => { const el = $(`#pv_${k}`); if (el) el.value = best[k]; }); onConfigChange(); toast('Backtest values set to the best set. Run the backtest again to see it.'); });
}

function renderMCPT() {
  const { r, c } = S.res.mcpt, cls = statusOf.p(r.p); setDot('mcpt', cls);
  const permSorted = r.permVals.slice().sort((a, b) => a - b), med = permSorted[Math.floor(permSorted.length / 2)];
  const k = Math.round(r.p * (r.permVals.length + 1)) - 1;
  const yrs = r.N / c.bpy, ann = v => v / yrs;
  const parts = [
    { k: 'Total in-sample', v: r.origTotal, col: 'var(--ink-2)' },
    { k: 'Trend', v: r.origTrend, col: 'var(--real)' },
    { k: 'Training bias', v: r.meanBias, col: 'var(--mark)' },
    { k: 'Skill', v: r.skill, col: 'var(--accent)' },
  ];
  const amax = Math.max(...parts.map(p => Math.abs(p.v)), 1e-9);
  const lo = Math.min(0, ...parts.map(p => p.v)), hi = Math.max(0, ...parts.map(p => p.v)), span = (hi - lo) || 1;
  const xp = v => (v - lo) / span * 100;
  $('#out_mcpt').innerHTML = kpis([
    { k: 'p-value', v: pval(r.p), cls: cls === 'good' ? 'pos' : cls === 'bad' ? 'negv' : '', s: `${k} of ${r.permVals.length} shuffles did as well` },
    { k: 'Real market, best set', v: critFmt(c.crit, r.original), s: esc(paramStr(r.bestParams)) },
    { k: 'Shuffled markets, median', v: critFmt(c.crit, med), s: 'what fitting pure noise earns' },
    { k: 'Unbiased return', v: pct(simple(ann(r.unbiased))), s: 'per year, trend included' },
    { k: 'Skill', v: pct(simple(ann(r.skill))), s: 'per year, trend removed' },
  ]) + `<div class="grid2">
    <div class="card"><div class="card-head"><h3>Best score: real vs ${r.permVals.length} shuffled markets</h3>${pill(cls, 'p = ' + pval(r.p))}</div><div class="chart" id="ch_mcpt"></div><p class="small muted">Grey bars: the optimizer's best ${critName(c.crit)} on each shuffled market. Tinted bars score at or beyond the real result; their share is the p-value.</p></div>
    <div class="card"><div class="card-head"><h3>Where the in-sample return came from</h3><span class="small muted">per year, log</span></div>
      <div class="decomp">${parts.map(p => `<div class="drow"><span>${p.k}</span><div class="dtrack"><span class="zero" style="left:${xp(0)}%"></span><span class="bar" style="left:${Math.min(xp(0), xp(p.v))}%;width:${Math.abs(xp(p.v) - xp(0))}%;background:${p.col}"></span></div><span class="num">${sgn(p.v)}${(ann(p.v) * 100).toFixed(1)}%</span></div>`).join('')}</div>
      <p class="small muted">Total = Trend + Training bias + Skill. Trend is (${int(r.origNL)} long − ${int(r.origNS)} short bars) × the market's drift per bar. Training bias is what the optimizer earned on shuffled markets after removing their trend part. ${c.crit !== 'total' ? 'Computed on total return even though the optimizer ranked by ' + critName(c.crit) + '.' : ''}</p>
    </div></div>
  ${reading(cls, `<p>${r.p <= 0.05 ? `Only ${k} of ${r.permVals.length} pattern-free markets let the optimizer do as well as the real one. That is evidence the rule is reacting to something in the order of real price moves, not just fitting noise.` : r.p <= 0.15 ? `The real result beats most shuffled markets but not convincingly: ${k} of ${r.permVals.length} did as well. Masters would stay suspicious at this level.` : `The optimizer did about as well on shuffled, pattern-free markets as on the real one (${k} of ${r.permVals.length} matched it). Whatever it found in-sample, it would also have “found” in noise.`}</p>
  <p>${r.meanBias > 0 ? `On noise alone the optimizer earns about ${pct(simple(ann(r.meanBias)))} a year beyond trend. That is the training bias baked into the in-sample backtest.` : 'Training bias is small here.'} ${Math.abs(r.origTrend) > Math.abs(r.skill) && r.origTrend > 0 ? 'More of the return comes from riding the market’s drift than from skill.' : ''}</p>`)}`;
  histChart($('#ch_mcpt'), { values: r.permVals, marker: r.original, markerLabel: 'Real ' + critFmt(c.crit, r.original), fmt: v => c.crit === 'total' ? (v * 100).toFixed(0) + '%' : v.toFixed(2), height: 240 });
}

function renderWF() {
  const { r, c } = S.res.wf, st = r.stats, b = r.bhStats, D = dates().slice(r.oosStart);
  const eff = r.isAvgAnn !== 0 ? st.annRet / r.isAvgAnn : NaN;
  const pcls = r.p != null ? statusOf.p(r.p) : 'info';
  const ocls = st.annRet > 0 && st.sharpe > 0.3 ? 'good' : st.annRet > 0 ? 'warn' : 'bad';
  setDot('wf', r.p != null ? (pcls === 'good' && ocls !== 'bad' ? 'good' : pcls === 'bad' || ocls === 'bad' ? 'bad' : 'warn') : ocls);
  const changes = r.folds.reduce((a, f, i) => a + (i && paramStr(f.params) !== paramStr(r.folds[i - 1].params) ? 1 : 0), 0);
  const fstart = r.folds.map(f => f.ts - r.oosStart).slice(1);
  $('#out_wf').innerHTML = kpis([
    { k: 'Out-of-sample annual', v: pct(simple(st.annRet)), cls: st.annRet > 0 ? 'pos' : 'negv', s: `buy & hold ${pct(simple(b.annRet))}` },
    { k: 'OOS Sharpe', v: f2(st.sharpe), s: `buy & hold ${f2(b.sharpe)}` },
    { k: 'Avg in-sample annual', v: pct(simple(r.isAvgAnn)), s: 'training windows' },
    { k: 'Walkforward efficiency', v: f2(eff), s: 'OOS ÷ in-sample' },
    { k: 'OOS max drawdown', v: pctU(st.maxDD), s: `${int(st.n)} bars` },
    { k: 'Factory p-value', v: r.p != null ? pval(r.p) : 'not run', cls: pcls === 'good' ? 'pos' : pcls === 'bad' ? 'negv' : '', s: r.p != null ? `${r.permVals.length} shuffled walkforwards` : 'set permutations > 0' },
  ]) + equityHTML('wf', 'Pooled out-of-sample record', [{ name: 'Walkforward strategy', color: 'accent' }, { name: 'Buy & hold, same period', color: 'real' }], `Dashed lines mark refits: ${r.folds.length} folds of ${c.test} bars, each trained on ${c.anchored ? 'all prior data' : 'the previous ' + c.train + ' bars'}.`) + `
  <div class="grid2">
    <div class="card"><div class="card-head"><h3>In-sample vs out-of-sample, by fold</h3><div class="legend"><span><i class="sq" style="background:var(--mark)"></i>In-sample</span><span><i class="sq" style="background:var(--accent)"></i>Out-of-sample</span></div></div><div class="chart" id="ch_folds"></div><p class="small muted">Annualized log return. The gap between grey and blue is training bias, fold by fold.</p></div>
    <div class="card"><div class="card-head"><h3>Factory permutation test</h3>${r.p != null ? pill(pcls, 'p = ' + pval(r.p)) : ''}</div>${r.p != null ? '<div class="chart" id="ch_wfp"></div><p class="small muted">Grey: pooled out-of-sample ' + critName(c.crit) + ' of the whole walkforward rerun on shuffled markets.</p>' : '<div class="empty"><p>Set walkforward permutations above 0 to test the model factory.</p></div>'}</div>
  </div>
  ${reading(ocls === 'good' && pcls !== 'bad' ? 'good' : ocls === 'bad' || pcls === 'bad' ? 'bad' : 'warn', `<p>${st.annRet > 0 ? `Trading only on parameters chosen from the past, the system made ${pct(simple(st.annRet))} a year with a Sharpe of ${f2(st.sharpe)}.` : `Trading only on parameters chosen from the past, the system lost ${pct(simple(st.annRet))} a year.`} ${isFinite(eff) ? `It kept ${eff > 0 ? (eff * 100).toFixed(0) + '%' : 'none'} of its average in-sample performance.` : ''} ${r.p != null ? (r.p <= 0.05 ? 'The factory beat almost every shuffled market, which is real evidence.' : 'Shuffled markets produced comparable out-of-sample records, so this result is within what luck delivers.') : ''}</p>
  <p>The chosen parameters changed at ${changes} of ${r.folds.length - 1} refits. ${changes > (r.folds.length - 1) * 0.6 ? 'Frequent jumps suggest the optimizer is chasing noise rather than tracking a stable pattern.' : 'Fairly stable choices are a good sign.'}</p>`)}
  <div class="card"><div class="card-head"><h3>Folds</h3></div><div class="tablewrap"><table class="data"><thead><tr><th>#</th><th>Test window</th><th>Chosen parameters</th><th class="num">In-sample / yr</th><th class="num">Out-of-sample / yr</th></tr></thead><tbody>
  ${r.folds.map((f, i) => `<tr><td class="mono">${i + 1}</td><td class="mono">${dates()[f.ts]} → ${dates()[f.te - 1]}</td><td>${esc(paramStr(f.params))}</td><td class="num">${pct(simple(f.isAnn))}</td><td class="num ${f.oosAnn >= 0 ? 'pos' : 'negv'}">${pct(simple(f.oosAnn))}</td></tr>`).join('')}</tbody></table></div></div>`
  + reportCard('Performance report, out-of-sample', [{ name: 'Walkforward', m: fullMetrics(r.pooled, r.pos, tradesFromRuns(r.pooled, r.pos), c.bpy) }, { name: 'Buy & hold', m: bhMetrics(r.bh, c.bpy) }], [{ name: 'Walkforward', r: r.pooled }, { name: 'Buy & hold', r: r.bh }], D, c.bpy);
  drawEquity('wf', [{ r: r.pooled, color: 'accent', name: 'Walkforward' }, { r: r.bh, color: 'real', name: 'Buy & hold', width: 1.5 }], D, fstart);
  foldChart($('#ch_folds'), { a: r.folds.map(f => f.isAnn), b: r.folds.map(f => f.oosAnn), labels: r.folds.map(f => dates()[f.ts].slice(0, 7)) });
  if (r.p != null) histChart($('#ch_wfp'), { values: r.permVals, marker: r.oosCrit, markerLabel: 'Real ' + critFmt(c.crit, r.oosCrit), fmt: v => c.crit === 'total' ? (v * 100).toFixed(0) + '%' : v.toFixed(2), height: 200 });
}

function renderCSCV() {
  const { r, c } = S.res.cscv, cls = cscvStatus(r); setDot('cscv', cls);
  const robust = r.pbo > 0.2 && r.pLoss <= 0.2;
  const degr = r.pairs.filter(p => p[1] < p[0]).length / r.pairs.length;
  $('#out_cscv').innerHTML = kpis([
    { k: 'PBO', v: pctU(r.pbo, 0), cls: cls === 'good' ? 'pos' : cls === 'bad' ? 'negv' : '', s: 'IS winner below OOS median' },
    { k: 'Train/test splits', v: int(r.nComb), s: `${r.S} blocks of ${int(r.blockLen)} bars` },
    { k: 'Competing sets', v: int(r.nSys), s: 'your grid' },
    { k: 'Winner lost money OOS', v: pctU(r.pLoss, 0), s: 'of splits' },
    { k: 'Winner got worse OOS', v: pctU(degr, 0), s: 'of splits' },
  ]) + `<div class="grid2">
    <div class="card"><div class="card-head"><h3>Out-of-sample rank of the in-sample winner</h3>${pill(cls, 'PBO ' + pctU(r.pbo, 0))}</div><div class="chart" id="ch_logit"></div><p class="small muted">Logit of the winner's out-of-sample rank fractile, one per split. Left of zero (tinted) it finished in the bottom half. A worthless optimizer centres on zero.</p></div>
    <div class="card"><div class="card-head"><h3>In-sample vs out-of-sample score of the winner</h3></div><div class="chart" id="ch_sc"></div><p class="small muted">Each dot is one split. Annualized ${critName(c.crit === 'total' ? 'total' : c.crit)}${c.crit === 'total' ? ' (mean per bar × bars per year)' : ''}. Dots below the dashed diagonal did worse out-of-sample.</p></div>
  </div>
  ${reading(cls, `<p>${robust ? `In ${pctU(r.pbo, 0)} of splits the in-sample winner finished in the bottom half, yet it lost money out-of-sample in only ${pctU(r.pLoss, 0)} of them. Most of the grid works, so choosing the “best” set adds little over choosing any reasonable one. That says nothing bad about the rule itself; it says the optimizer is not where the value comes from.` : r.pbo <= 0.2 ? `In ${pctU(r.pbo, 0)} of splits the in-sample winner finished in the bottom half out-of-sample. Selecting by in-sample score usually picks a genuinely better set within this grid.` : r.pbo <= 0.5 ? `In ${pctU(r.pbo, 0)} of splits the in-sample winner finished in the bottom half. Selection helps a little, but not much more than picking at random.` : `In ${pctU(r.pbo, 0)} of splits the in-sample winner finished in the bottom half: worse than picking a parameter set at random. The optimizer is mostly selecting noise.`}</p><p>This is relative to the grid you defined. Remember the competitor caveat below.</p>`)}`;
  histChart($('#ch_logit'), { values: r.logits, marker: 0, markerLabel: 'random selection', fmt: v => v.toFixed(1), shadeLeft: true, unit: 'splits', height: 220 });
  const pts = r.pairs.map(p => [p[0], p[1]]);
  const f = c.crit === 'total' ? v => (v * 100).toFixed(0) + '%' : v => v.toFixed(2);
  const sc = xyChart($('#ch_sc'), { pts, mode: 'scatter', xTitle: 'in-sample', yFmt: f, xFmt: f, height: 220, zeroY: c.crit !== 'pf' });
  const origDraw = sc.draw;
  sc.draw = (ctx, w, h, hv, C) => {
    origDraw(ctx, w, h, hv, C);
    const L = 52, R = w - 12, T = 12, B = h - 36, xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys); if (c.crit !== 'pf') { y0 = Math.min(y0, 0); y1 = Math.max(y1, 0); }
    if (x0 === x1) { x0 -= 1; x1 += 1; } if (y0 === y1) { y0 -= 1; y1 += 1; }
    const py = (y1 - y0) * 0.08; y0 -= py; y1 += py; const px = (x1 - x0) * 0.05; x0 -= px; x1 += px;
    const sx = v => L + (v - x0) / (x1 - x0) * (R - L), sy = v => B - (v - y0) / (y1 - y0) * (B - T);
    const a = Math.max(x0, y0), bb = Math.min(x1, y1); if (a < bb) { ctx.save(); ctx.beginPath(); ctx.rect(L, T, R - L, B - T); ctx.clip(); ctx.strokeStyle = C.ink2; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(sx(a), sy(a)); ctx.lineTo(sx(bb), sy(bb)); ctx.stroke(); ctx.restore(); }
  };
  sc.render();
}

function renderBounds() {
  const { r, c } = S.res.bounds, bp = c.bpy;
  const cls = r.bcaLower > 0 ? 'good' : r.mean > 0 ? 'warn' : 'bad'; setDot('bounds', cls);
  const conf = Math.round((1 - r.alpha) * 100), ddc = Math.round(c.ddConf * 100);
  $('#out_bounds').innerHTML = kpis([
    { k: 'Mean per bar', v: (r.mean * 1e4).toFixed(2) + ' bp', s: `${int(r.n)} bars · ${pct(simple(r.mean * bp))}/yr if always in` },
    { k: `BCa ${conf}% lower bound`, v: (r.bcaLower * 1e4).toFixed(2) + ' bp', cls: r.bcaLower > 0 ? 'pos' : 'negv', s: `t-test bound ${(r.tLower * 1e4).toFixed(2)} bp` },
    { k: 't-statistic', v: f2(r.t), s: `one-sided p ${pval(r.pT)}` },
    { k: 'Profit factor', v: f2(r.pf), s: `${conf}% lower bound ${f2(r.pfLower)}` },
    { k: `${ddc}% drawdown, naive`, v: pctU(r.dd.naive), s: `over ${c.horizon} bars` },
    { k: `${ddc}% drawdown, double bootstrap`, v: pctU(r.dd.bound), cls: 'negv', s: '70% confidence in the bound' },
  ]) + `<div class="grid2">
    <div class="card"><div class="card-head"><h3>Bootstrap distribution of the mean bar return</h3>${pill(cls, r.bcaLower > 0 ? 'lower bound > 0' : 'bound includes zero')}</div><div class="chart" id="ch_boot"></div><p class="small muted">Resampled means, in basis points per bar. Dashed: zero and the BCa lower bound.</p></div>
    <div class="card"><div class="card-head"><h3>How deep the next ${c.horizon} bars could go</h3></div><div class="chart" id="ch_dd"></div><p class="small muted">Grey: the ${ddc}% drawdown estimated from each outer bootstrap sample. The spread is the uncertainty the naive method ignores.</p></div>
  </div>
  ${reading(cls, `<p>${r.bcaLower > 0 ? `With ${conf}% confidence the true mean return per bar in the market is above ${(r.bcaLower * 1e4).toFixed(2)} bp. The bound clears zero.` : `The ${conf}% lower bound on the mean return per bar is ${(r.bcaLower * 1e4).toFixed(2)} bp, below zero. The out-of-sample record cannot rule out a strategy that loses money on average.`}</p>
  <p>The naive bootstrap says there is a ${ddc}% chance the drawdown over the next ${c.horizon} bars stays under ${pctU(r.dd.naive)}. Allowing for the fact that the out-of-sample record could itself have been lucky, there is a 70% chance that this ${ddc}% bound is no worse than <b>${pctU(r.dd.bound)}</b>. Size positions for the larger number.</p>`)}`;
  const bootBp = r.boots.map(v => v * 1e4);
  histChart($('#ch_boot'), { values: bootBp, marker: r.bcaLower * 1e4, markerLabel: 'BCa bound ' + (r.bcaLower * 1e4).toFixed(2), refs: [{ x: 0, label: '0' }], fmt: v => v.toFixed(1), shadeLeft: true, unit: 'resamples', height: 220 });
  histChart($('#ch_dd'), { values: r.dd.outerQ.map(v => v * 100), marker: r.dd.bound * 100, markerLabel: 'Bound ' + pctU(r.dd.bound), refs: [{ x: r.dd.naive * 100, label: 'naive ' + pctU(r.dd.naive) }], fmt: v => v.toFixed(0) + '%', unit: 'outer samples', height: 220 });
}

function renderShootout() {
  const { r, c } = S.res.shootout; const rows = r.rows.slice().sort((a, b) => a.unbiased - b.unbiased || a.solo - b.solo);
  const top = r.rows.reduce((a, b) => (a.solo < b.solo ? a : b));
  const bestUn = Math.min(...r.rows.map(x => x.unbiased));
  setDot('shootout', statusOf.p(bestUn));
  $('#out_shootout').innerHTML = `<div class="card"><div class="card-head"><h3>Results</h3><span class="small muted">${r.rows[0] ? (c.nperm) : ''} permutations, every competitor re-optimized on each shuffled market</span></div><div class="tablewrap"><table class="data"><thead><tr><th>Strategy</th><th>Best parameters</th><th class="num">Sets</th><th class="num">Real ${critName(c.crit)}</th><th class="num">Solo p</th><th class="num">Selection-adjusted p</th></tr></thead><tbody>
  ${rows.map(x => `<tr><td>${esc(x.name)}</td><td>${esc(paramStr(x.params))}</td><td class="num">${int(x.nCombos)}</td><td class="num">${critFmt(c.crit, x.orig)}</td><td class="num">${pill(statusOf.p(x.solo), pval(x.solo))}</td><td class="num">${pill(statusOf.p(x.unbiased), pval(x.unbiased))}</td></tr>`).join('')}</tbody></table></div></div>
  ${reading(statusOf.p(bestUn), `<p>Taken alone, ${esc(top.name)} looks best with a solo p-value of ${pval(top.solo)}. But you looked at ${r.rows.length} strategies. Once that choice is accounted for, the best selection-adjusted p-value is ${pval(bestUn)}. ${bestUn <= 0.05 ? 'Something here survives the multiple comparisons.' : top.solo <= 0.05 ? 'A solo result that looked significant does not survive the fact that you picked it from a field. This is selection bias at work.' : 'Nothing here stands out even before adjusting.'}</p>`)}`;
}

function cscvStatus(r) { return r.pbo <= 0.2 ? 'good' : r.pLoss <= 0.2 ? 'warn' : r.pbo <= 0.5 ? 'warn' : 'bad'; }
const CCOL = ['c2', 'c3', 'c4', 'c5', 'c6', 'c7'];
function renderNested() {
  const { r, c, cfg } = S.res.nested, D = dates().slice(r.o2), bp = c.bpy;
  const m = fullMetrics(r.out, r.pos, tradesFromRuns(r.out, r.pos), bp);
  const pcls = r.p != null ? statusOf.p(r.p) : 'info'; setDot('nested', r.p != null ? pcls : '');
  const compM = r.comps.map(k => fullMetrics(k.ret, k.pos, tradesFromRuns(k.ret, k.pos), bp));
  const bestK = compM.reduce((a, x, i) => x.cagr > compM[a].cagr ? i : a, 0);
  const avgC = compM.reduce((a, x) => a + x.cagr, 0) / compM.length;
  const switches = r.picks.reduce((a, p, i) => a + (i && p.k !== r.picks[i - 1].k ? 1 : 0), 0);
  $('#out_nested').innerHTML = kpis([
    { k: 'Selector CAGR', v: pct(m.cagr), cls: m.cagr > 0 ? 'pos' : 'negv', s: `${int(m.bars)} fully out-of-sample bars` },
    { k: 'Selector Sharpe', v: f2(m.sharpe), s: `max drawdown ${pctU(m.maxDD)}` },
    { k: 'p-value', v: r.p != null ? pval(r.p) : 'not run', cls: pcls === 'good' ? 'pos' : pcls === 'bad' ? 'negv' : '', s: r.p != null ? `${r.permVals.length} shuffled nested runs` : 'set permutations > 0' },
    { k: 'Best single strategy', v: esc(r.comps[bestK].name), s: `CAGR ${pct(compM[bestK].cagr)}, known only in hindsight` },
    { k: 'Average competitor', v: pct(avgC), s: 'CAGR over the same bars' },
    { k: 'Strategy switches', v: int(switches), s: `${r.picks.length} reselections every ${cfg.step} bars` },
  ]) + equityHTML('nest', 'Selector vs each competitor, same bars', [{ name: 'Selector (nested)', color: 'accent' }, ...r.comps.map((k, i) => ({ name: k.name, color: CCOL[i % 6] })), { name: 'Buy & hold', color: 'ink3', dash: [5, 4] }], `Competitor lines are their own Level-1 walkforward records. ${D[0]} to ${D[D.length - 1]}.`)
  + `<div class="card"><div class="card-head"><h3>Which strategy was traded, when</h3><span class="small muted">selector lookback ${cfg.oos1n} bars, reselect every ${cfg.step}</span></div><div class="chart" id="ch_pick"></div></div>
  <div class="grid2">
    <div class="card"><div class="card-head"><h3>Competitors over the final out-of-sample period</h3></div><div class="tablewrap"><table class="data"><thead><tr><th>Strategy</th><th class="num">Sets</th><th class="num">CAGR</th><th class="num">Sharpe</th><th class="num">Max DD</th><th class="num">Selected</th></tr></thead><tbody>
    <tr><td><span class="swatch" style="background:var(--accent)"></span><b>Selector</b></td><td class="num">—</td><td class="num">${pct(m.cagr)}</td><td class="num">${f2(m.sharpe)}</td><td class="num">${pctU(m.maxDD)}</td><td class="num">—</td></tr>
    ${r.comps.map((k, i) => `<tr><td><span class="swatch" style="background:var(--${CCOL[i % 6]})"></span>${esc(k.name)}</td><td class="num">${int(k.nCombos)}</td><td class="num">${pct(compM[i].cagr)}</td><td class="num">${f2(compM[i].sharpe)}</td><td class="num">${pctU(compM[i].maxDD)}</td><td class="num">${pctU(r.share[i], 0)}</td></tr>`).join('')}</tbody></table></div></div>
    <div class="card"><div class="card-head"><h3>Selector vs shuffled markets</h3>${r.p != null ? pill(pcls, 'p = ' + pval(r.p)) : ''}</div>${r.p != null ? '<div class="chart" id="ch_nestp"></div><p class="small muted">Grey: the selector’s ' + critName(c.crit) + ' when both levels are rerun on shuffled markets.</p>' : '<div class="empty"><p>Set permutations above 0 to test the selector.</p></div>'}</div>
  </div>
  ${reading(r.p == null ? (m.cagr > 0 ? 'warn' : 'bad') : pcls, `<p>${m.cagr > 0 ? `Trading whichever strategy had the best recent out-of-sample record earned ${pct(m.cagr)} a year with a Sharpe of ${f2(m.sharpe)}.` : `Trading whichever strategy had the best recent out-of-sample record lost ${pct(m.cagr)} a year.`} ${m.cagr > avgC ? 'That beats the average competitor, so recent performance carried some information.' : 'That does not beat the average competitor, so recent performance did not predict which strategy would do well next.'} ${r.p != null ? (r.p <= 0.05 ? 'Shuffled markets rarely did as well, which is evidence the whole two-level process works.' : 'Shuffled markets often did as well, so this is within what luck delivers.') : ''}</p>
  <p>${esc(r.comps[bestK].name)} was the best competitor here. You can only know that now, after the fact. Choosing it today because of this chart would reintroduce the selection bias this test was built to remove.</p>`)}`
  + reportCard('Performance report, selector (out-of-sample)', [{ name: 'Selector', m }, { name: 'Buy & hold', m: bhMetrics(r.bh, bp) }], [{ name: 'Selector', r: r.out }, { name: 'Buy & hold', r: r.bh }], D, bp);
  drawEquity('nest', [{ r: r.out, color: 'accent', name: 'Selector', width: 2.4 }, ...r.comps.map((k, i) => ({ r: k.ret, color: CCOL[i % 6], name: k.name, width: 1.3 })), { r: r.bh, color: 'ink3', name: 'Buy & hold', width: 1.2, dash: [5, 4] }], D);
  const K = r.comps.length, N = r.out.length;
  makeChart($('#ch_pick'), 26 * K + 30, (ctx, w, h, hv, C) => {
    const L = 150, R = w - 10, T = 4, B = h - 22, rh = (B - T) / K, sx = i => L + i / N * (R - L);
    r.comps.forEach((k, i) => { ctx.fillStyle = C.surface2; ctx.fillRect(L, T + i * rh + 3, R - L, rh - 6); ctx.fillStyle = C.ink2; ctx.textBaseline = 'middle'; ctx.textAlign = 'right'; ctx.font = '12px "IBM Plex Sans", system-ui, sans-serif'; let nm = k.name; while (ctx.measureText(nm).width > L - 16 && nm.length > 4) nm = nm.slice(0, -2); ctx.fillText(nm === k.name ? nm : nm + '…', L - 8, T + (i + .5) * rh); });
    ctx.textAlign = 'left';
    r.picks.forEach((p, j) => { const a = p.t - r.o2, b = j + 1 < r.picks.length ? r.picks[j + 1].t - r.o2 : N; ctx.fillStyle = C[CCOL[p.k % 6]]; ctx.fillRect(sx(a), T + p.k * rh + 3, Math.max(1, sx(b) - sx(a)), rh - 6); });
    ctx.font = '11px "IBM Plex Mono", ui-monospace, monospace'; ctx.fillStyle = C.ink3; ctx.textBaseline = 'top';
    const kk = Math.max(2, Math.min(6, Math.floor((R - L) / 110))); for (let j = 0; j <= kk; j++) { const i = Math.round(j / kk * (N - 1)); ctx.textAlign = j === 0 ? 'left' : j === kk ? 'right' : 'center'; ctx.fillText(D[i].slice(0, 7), sx(i), B + 6); }
    if (hv && hv.x >= L && hv.x <= R) { const i = Math.max(0, Math.min(N - 1, Math.floor((hv.x - L) / (R - L) * N))); const p = r.picks.filter(q => q.t - r.o2 <= i).pop(); if (p) tooltip(ctx, w, h, hv.x, hv.y, [{ t: D[i] }, { t: 'Trading: ' + r.comps[p.k].name, c: C[CCOL[p.k % 6]] }], C); }
  });
  if (r.p != null) histChart($('#ch_nestp'), { values: r.permVals, marker: r.crit, markerLabel: 'Real ' + critFmt(c.crit, r.crit), fmt: v => c.crit === 'total' ? (v * 100).toFixed(0) + '%' : v.toFixed(2), height: 210 });
}

function verdictChecks() {
  const R = S.res, out = [];
  const bt = R.backtest && R.backtest.r;
  out.push({ t: 'In-sample backtest', d: 'Profitable on the full history with your chosen parameters.', v: bt ? `Sharpe ${f2(bt.stats.sharpe)}` : '—', st: 'info', label: 'not evidence', tab: 'backtest', core: false });
  const op = R.optimize; const sr = op && op.stab ? op.stab.ratio : NaN;
  out.push({ t: 'Parameter stability', d: 'Grid neighbours of the best set score nearly as well (≥ 0.7).', v: isFinite(sr) ? f2(sr) : '—', st: !op ? 'none' : sr >= 0.7 ? 'good' : sr >= 0.4 ? 'warn' : 'bad', tab: 'optimize', core: false });
  const m = R.mcpt && R.mcpt.r;
  out.push({ t: 'Training permutation test', d: 'Optimizer beats shuffled markets (p ≤ 0.05).', v: m ? `p = ${pval(m.p)}` : '—', st: m ? statusOf.p(m.p) : 'none', tab: 'mcpt', core: true });
  const w = R.wf && R.wf.r;
  out.push({ t: 'Walkforward out-of-sample', d: 'Positive return with Sharpe ≥ 0.3 on parameters chosen from the past.', v: w ? `${pct(simple(w.stats.annRet))}/yr · Sharpe ${f2(w.stats.sharpe)}` : '—', st: !w ? 'none' : w.stats.annRet > 0 && w.stats.sharpe > 0.3 ? 'good' : w.stats.annRet > 0 ? 'warn' : 'bad', tab: 'wf', core: true });
  out.push({ t: 'Model-factory permutation test', d: 'Walkforward beats shuffled walkforwards (p ≤ 0.05).', v: w && w.p != null ? `p = ${pval(w.p)}` : '—', st: w && w.p != null ? statusOf.p(w.p) : 'none', tab: 'wf', core: true });
  const cs = R.cscv && R.cscv.r;
  out.push({ t: 'Probability of backtest overfitting', d: 'In-sample winner rarely lands in the bottom half (PBO ≤ 20%).', v: cs ? `PBO ${pctU(cs.pbo, 0)} · OOS loss ${pctU(cs.pLoss, 0)}` : '—', st: !cs ? 'none' : cscvStatus(cs), tab: 'cscv', core: true });
  const b = R.bounds && R.bounds.r;
  out.push({ t: 'Lower bound on future mean', d: `BCa ${b ? Math.round((1 - b.alpha) * 100) : 95}% lower bound of out-of-sample mean return above zero.`, v: b ? `${(b.bcaLower * 1e4).toFixed(2)} bp/bar` : '—', st: !b ? 'none' : b.bcaLower > 0 ? 'good' : b.mean > 0 ? 'warn' : 'bad', tab: 'bounds', core: true });
  const nw = R.nested && R.nested.r;
  if (nw && nw.p != null) out.push({ t: 'Strategy selection (nested walkforward)', d: 'Trading the strategy with the best recent out-of-sample record beats shuffled markets (p ≤ 0.05).', v: `p = ${pval(nw.p)}`, st: statusOf.p(nw.p), tab: 'nested', core: false });
  out.push({ t: 'Drawdown to plan for', d: `${b ? Math.round(R.bounds.c.ddConf * 100) : 90}% drawdown over ${b ? R.bounds.c.horizon : 252} bars, with 70% confidence in the bound.`, v: b ? pctU(b.dd.bound) : '—', st: 'info', label: 'size for it', tab: 'bounds', core: false });
  return out;
}
function renderVerdict() {
  const checks = verdictChecks(), core = checks.filter(c => c.core);
  const good = core.filter(c => c.st === 'good').length, bad = core.filter(c => c.st === 'bad').length, done = core.filter(c => c.st !== 'none').length;
  let big, cls, sub;
  if (done < core.length) { big = 'Audit incomplete'; cls = ''; sub = 'Run the full audit to fill in every test.'; }
  else if (good === core.length) { big = 'Evidence of an edge'; cls = 'good'; sub = 'Every core test rejected “worthless”. That is evidence, not proof. Paper-trade it and compare live results against the bounds.'; }
  else if (good >= 3 && bad === 0) { big = 'Promising but unproven'; cls = 'warn'; sub = 'Most tests lean positive and none fail outright. Gather more data before risking money.'; }
  else if (bad >= 3 || good === 0) { big = 'No evidence of an edge'; cls = 'bad'; sub = 'The results look like what a worthless system produces on this market. That is the usual outcome, and it is a useful one: it saved you from trading noise.'; }
  else { big = 'Inconclusive'; cls = 'warn'; sub = 'The tests disagree. Some reject “worthless”, others don’t. Treat any edge as unconfirmed.'; }
  const c = getCfg(), s = STRATS[c.strat];
  const m = S.res.mcpt && S.res.mcpt.r;
  let decomp = '';
  if (m) {
    const yrs = m.N / c.bpy, parts = [{ k: 'In-sample total', v: m.origTotal / yrs, col: 'var(--ink-2)' }, { k: 'Trend', v: m.origTrend / yrs, col: 'var(--real)' }, { k: 'Training bias', v: m.meanBias / yrs, col: 'var(--mark)' }, { k: 'Skill', v: m.skill / yrs, col: 'var(--accent)' }];
    const lo = Math.min(0, ...parts.map(p => p.v)), hi = Math.max(0, ...parts.map(p => p.v)), span = (hi - lo) || 1, xp = v => (v - lo) / span * 100;
    decomp = `<div class="card"><div class="card-head"><h3>What the in-sample backtest was made of</h3><span class="small muted">per year, log return</span></div><div class="decomp">${parts.map(p => `<div class="drow"><span>${p.k}</span><div class="dtrack"><span class="zero" style="left:${xp(0)}%"></span><span class="bar" style="left:${Math.min(xp(0), xp(p.v))}%;width:${Math.abs(xp(p.v) - xp(0))}%;background:${p.col}"></span></div><span class="num">${sgn(p.v)}${(p.v * 100).toFixed(1)}%</span></div>`).join('')}</div><p class="small muted">From the training permutation test. Only the skill line is plausibly yours to keep, and only while the market behaves as it did.</p></div>`;
  }
  $('#out_verdict').innerHTML = `<div class="verdict-hero"><div style="display:flex;flex-direction:column;gap:8px;min-width:0"><span class="eyebrow">${esc(S.market.name)} · ${esc(s.name)} · grid of ${gridInfo(c).n} sets · ${critName(c.crit)}</span><div class="big ${cls}">${big}</div><p class="muted" style="max-width:68ch">${sub}</p></div>
    <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-start"><span class="eyebrow">Core tests passed</span><div class="score">${core.map(x => `<span class="${x.st === 'none' ? '' : x.st}" title="${esc(x.t)}"></span>`).join('')}</div><span class="mono small">${good} of ${core.length}</span></div></div>
  <div class="checklist">${checks.map((x, i) => `<div class="check"><span class="idx">${String(i + 1).padStart(2, '0')}</span><div><div class="t">${x.t}</div><div class="d">${x.d} <button class="linkish" type="button" data-go="${x.tab}">Details</button></div></div><span class="val">${x.v}</span>${x.st === 'none' ? pill('info', 'not run') : x.st === 'info' ? pill('info', x.label) : pill(x.st, x.st === 'good' ? 'pass' : x.st === 'warn' ? 'weak' : 'fail')}</div>`).join('')}</div>
  ${decomp}
  ${reading('', `<p><b>Before you trust any of this.</b> These tests used the whole file, so the verdict is about this history. Masters' advice is to hold back the most recent data, never look at it during development, and test the final system on it once. The app also leaves out slippage beyond your fixed cost, financing and carry (FX swaps, futures roll, crypto funding), short-borrow fees, and position sizing.</p><p>Try the same strategy on the random-walk dataset. Every “pass” you see there is a false positive, which is the best way to feel how often luck looks like skill.</p>`)}`;
  $('#out_verdict').querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => showTab(b.dataset.go)));
  onConfigChange();
}

// ================= lab =================
function buildLab() {
  $('#labOut').innerHTML = `
  <div class="card"><div class="card-head"><h3>Training bias grows with the number of trials</h3><button class="btn sm" type="button" id="labBiasBtn">Run on 40 random walks</button></div>
    <p class="muted">Each run makes a fresh random walk, which by construction has no edge. Pick the best of <i>k</i> moving-average crossover settings on the first half, then trade it on the second half. Repeat and average.</p>
    <div class="chart" id="ch_labBias"><div class="empty"><p>Press run. It takes a few seconds.</p></div></div><div class="legend" id="lg_labBias" hidden><span><i style="background:var(--mark)"></i>In-sample, best of k</span><span><i style="background:var(--accent)"></i>Out-of-sample, same settings</span></div><div id="labBiasTxt"></div></div>
  <div class="card"><div class="card-head"><h3>The percent-wins fallacy</h3><button class="btn sm" type="button" id="labWinsBtn">Run 3,000 random trades each</button></div>
    <p class="muted">Random entries in a driftless random walk, exited only by a profit target or a stop-loss. The win rate depends entirely on where you put the exits. The expectancy does not move.</p><div id="labWinsOut"></div></div>
  <div class="card"><div class="card-head"><h3>A small future leak looks like genius</h3><button class="btn sm" type="button" id="labLeakBtn">Run</button></div>
    <p class="muted">A coin-flip system on a random walk, but on a small share of bars it peeks at the bar it is about to trade. Same prices and same coin flips for every line; only the leak rate changes. Masters: “Future leak is far deadlier than you imagine.”</p>
    <div class="chart" id="ch_labLeak"><div class="empty"><p>Press run.</p></div></div><div id="labLeakOut"></div></div>
  <div class="card"><div class="card-head"><h3>Calibrate the tests yourself</h3></div>
    <p class="muted">A good test says “no edge” on a random walk and “edge” when one is planted. Load each dataset, keep your strategy, and run the full audit. On the random walk roughly 1 run in 20 will still pass a 0.05 test by luck; change the seed to see it.</p>
    <div class="chk"><button class="btn sm" type="button" data-load="RW">Load random walk</button><button class="btn sm" type="button" data-load="TREND">Load planted trend</button></div></div>`;
  $('#labBiasBtn').addEventListener('click', () => guarded(async () => {
    const r = await runJob('labBias', { reps: 40, half: 1000 }, 'Random walks');
    $('#lg_labBias').hidden = false;
    xyChart($('#ch_labBias'), { pts: r.sizes.map((k, i) => [Math.log10(k), r.is[i]]), series2: { name: 'Out-of-sample', color: 'accent', pts: r.sizes.map((k, i) => [Math.log10(k), r.oos[i]]) }, color: 'mark', name: 'In-sample', xTicks: r.sizes.map(k => Math.log10(k)), xFmt: v => String(Math.round(Math.pow(10, v))), xTitle: 'settings tried (k)', yFmt: v => (v * 100).toFixed(0) + '%', tipFmt: v => pct(simple(v)) + '/yr', zeroY: true, height: 240 });
    const last = r.sizes.length - 1;
    $('#labBiasTxt').innerHTML = reading('bad', `<p>Testing one setting, the in-sample result averages ${pct(simple(r.is[0]))} a year. Testing ${r.sizes[last]} settings and keeping the best, it averages ${pct(simple(r.is[last]))} a year, and ${pctU(r.fracSharpe1[last], 0)} of those winners show an in-sample Sharpe above 1. Out-of-sample they average ${pct(simple(r.oos[last]))}. All of the in-sample gain is training bias, because there was nothing to find.</p>`);
  }));
  $('#labWinsBtn').addEventListener('click', () => guarded(async () => {
    const r = await runJob('labWins', { trades: 3000 }, 'Random trades');
    $('#labWinsOut').innerHTML = `<div class="tablewrap"><table class="data"><thead><tr><th>Exit rule</th><th class="num">Win rate</th><th class="num">Avg win</th><th class="num">Avg loss</th><th class="num">Expectancy per trade</th></tr></thead><tbody>${r.rows.map(x => `<tr><td>Target ${(x.tp * 100).toFixed(0)}%, stop ${(x.sl * 100).toFixed(0)}%</td><td class="num">${pctU(x.winRate, 0)}</td><td class="num">${pct(simple(x.avgWin), 2)}</td><td class="num">${pct(simple(x.avgLoss), 2)}</td><td class="num">${(x.expectancy * 1e4).toFixed(1)} ± ${(x.se * 1e4 * 2).toFixed(1)} bp</td></tr>`).join('')}</tbody></table></div>` +
      reading('warn', `<p>From ${pctU(r.rows[0].winRate, 0)} winners to ${pctU(r.rows[2].winRate, 0)} winners, and every expectancy is zero within its error band. A trader who “cuts losses and lets winners run” and one who “takes profits quickly” are both trading noise here. Win rate tells you about the shape of the exits, not about edge.</p>`);
  }));
  $('#labLeakBtn').addEventListener('click', () => guarded(async () => {
    const r = await runJob('labLeak', { n: 5000 }, 'Leak experiment');
    const cols = ['mark', 'accent', 'real', 'ink'];
    lineChart($('#ch_labLeak'), { series: r.curves.map((cv, i) => ({ y: cv.map(v => v * 100), color: cols[i] || 'ink', name: `${(r.leaks[i] * 100).toFixed(0)}% leak`, width: i === 0 ? 1.5 : 2 })).reverse(), yFmt: v => v.toFixed(0) + '%', tipFmt: v => v.toFixed(1) + '% log', zero: true, area: false, height: 260 });
    $('#labLeakOut').innerHTML = `<div class="legend">${r.leaks.map((q, i) => `<span><i style="background:var(--${cols[i]})"></i>${(q * 100).toFixed(0)}% of bars peek · Sharpe ${f2(r.tstats[i].sharpe)} · p ${pval(r.tstats[i].p)}</span>`).join('')}</div>` +
      reading('bad', `<p>Peeking on just ${(r.leaks[2] * 100).toFixed(0)}% of bars turns a worthless system into one with a Sharpe of ${f2(r.tstats[2].sharpe)}. Real leaks are subtler: adjusted prices that use future splits, an indicator that includes today's close when you trade at today's open, a stop-loss checked against the bar's low after you already used its close, data revised after the fact. The engine here decides on bar <i>t</i>'s close and trades on bar <i>t+1</i>.</p>`);
  }));
  $('#labOut').querySelectorAll('[data-load]').forEach(b => b.addEventListener('click', () => { $('#sampleSel').value = b.dataset.load; loadSample(b.dataset.load, false).then(() => toast('Loaded. Run the full audit to test it.')); }));
}

function buildMethod() {
  $('#methodOut').innerHTML = `<div class="method">
  <div><h2>How to develop and test a strategy</h2><p class="q muted" style="margin-top:4px">The order matters. Each step guards against a way that backtests lie.</p></div>
  <ol class="steps">
    <li><b>Write the hypothesis before you touch the data.</b> Say what market behaviour the rule exploits and choose a sensible parameter range. Every idea you try and discard on the same data is a hidden trial that inflates selection bias.</li>
    <li><b>Hold out the most recent data.</b> Keep the last year or two out of everything below. You get to use it once, at the very end.</li>
    <li><b>Clean the data and use log prices.</b> Check for future leak: split- and dividend-adjusted series built with later information, survivorship (only assets that still exist), signals that use the bar you trade on.</li>
    <li><b>Backtest and optimize, then look at the sensitivity.</b> You want a broad plateau. A spike or a jagged surface is a warning before any statistics.</li>
    <li><b>Permutation-test the training process.</b> If the optimizer does as well on shuffled markets, the in-sample result is training bias. Masters' rule of thumb: suspicious above p = 0.05.</li>
    <li><b>Walkforward the model factory and permutation-test it.</b> The pooled out-of-sample record is your best estimate of future performance; the permutation test says whether it could be luck.</li>
    <li><b>Correct for selection.</b> If you picked the best of several strategies, markets or settings, use selection-adjusted p-values or a nested walkforward that makes the choice out-of-sample too.</li>
    <li><b>Bound the future from out-of-sample returns only.</b> A BCa lower bound on the mean that clears zero, and a drawdown bound from the double bootstrap to size positions.</li>
    <li><b>Test once on the holdout, then trade small.</b> Track live results against the bounds. A month below the lower bound is a reason to stop.</li>
  </ol>
  <h3>Words that matter</h3>
  <div class="tablewrap"><table class="data"><tbody>
    <tr><td><b>In-sample (IS)</b></td><td style="white-space:normal">Data used to choose the parameters. Results here are optimistically biased.</td></tr>
    <tr><td><b>Out-of-sample (OOS)</b></td><td style="white-space:normal">Data that played no part in any choice. Results here are unbiased, which means neither optimistic nor pessimistic on average. Any single OOS result can still be lucky or unlucky.</td></tr>
    <tr><td><b>Training bias</b></td><td style="white-space:normal">How much in-sample performance exceeds future performance, mostly from fitting noise.</td></tr>
    <tr><td><b>Selection bias</b></td><td style="white-space:normal">The optimism that appears when you pick the best of several results, even unbiased ones.</td></tr>
    <tr><td><b>Future leak</b></td><td style="white-space:normal">Any information from after the decision time reaching the simulated decision.</td></tr>
    <tr><td><b>p-value</b></td><td style="white-space:normal">If the system were worthless, the probability of a result at least this good by luck. Not the probability the system works.</td></tr>
    <tr><td><b>PBO</b></td><td style="white-space:normal">Probability of backtest overfitting: how often the in-sample best set lands below the median out-of-sample.</td></tr>
  </tbody></table></div>
  <h3>What this app does not model</h3>
  <p>Slippage beyond a fixed cost per side, liquidity and market impact, financing and carry (FX swap points, futures roll, crypto funding rates), short-borrow fees, dividends unless your prices are total-return adjusted, position sizing (every trade is one unit of exposure), and portfolios of several markets. Bar permutation assumes overnight gaps and intrabar moves are independent. For bonds, upload prices, not yields: yields can be negative and do not compound like prices.</p>
  <h3>Uploading data</h3>
  <p>A CSV with a date column and either a close column or open, high, low and close. Headers like Date, Open, High, Low, Close, Adj Close, Price are recognized; if Adj Close is present the bars are rescaled to it. Dates can be 2024-03-15, 20240315, 15/03/2024, 03/15/2024 or Unix timestamps, with or without times. Rows are sorted and duplicates dropped. Close-only data fills at the close and checks stops against closes.</p>
  <p class="cite">Source: Timothy Masters, <i>Testing and Tuning Market Trading Systems: Algorithms in C++</i> (Apress, 2018), chapters 1 and 4–7. The algorithms here are reimplementations of the book's methods.</p>
  </div>`;
}

// ================= data loading =================
function setDataInfo() {
  const m = S.market; const gi = gridInfo(getCfg());
  $('#dataInfo').innerHTML = `<span>Bars</span><b>${int(m.n)}</b><span>From</span><b>${m.dates[0]}</b><span>To</span><b>${m.dates[m.n - 1]}</b><span>Fields</span><b>${m.hasOHLC ? 'Open, high, low, close' : 'Close only'}</b>${m.fixed ? `<span>Repaired</span><b>${m.fixed} bars with high/low outside open/close</b>` : ''}`;
  $('#execSel').disabled = !m.hasOHLC; if (!m.hasOHLC) $('#execSel').value = 'close';
}
function fitWalkforward() {
  const n = S.market.n, gi = gridInfo(getCfg()), avail = n - gi.start;
  let tr = num('#trainIn', 1000), te = num('#testIn', 250);
  if (tr + te * 3 > avail) { tr = Math.max(100, Math.floor(avail * 0.4 / 50) * 50); te = Math.max(20, Math.floor(avail * 0.15 / 10) * 10); $('#trainIn').value = tr; $('#testIn').value = te; }
}
function adoptMarket(m, badge, asset, cost) {
  S.market = m; S.res = {};
  sendMarket();
  $('#dataBadge').textContent = badge;
  if (asset) $('#assetSel').value = asset;
  $('#costIn').value = cost != null ? cost : COSTS[$('#assetSel').value];
  $('#bpyIn').value = detectBpy(m.dates); sendMarket();
  setDataInfo(); fitWalkforward();
  ['backtest', 'optimize', 'mcpt', 'wf', 'cscv', 'bounds', 'shootout', 'nested', 'verdict'].forEach(k => { const o = $(`#out_${k}`); if (o) o.innerHTML = ''; setDot(k, ''); });
  emptyStates(); onConfigChange();
}
async function loadSample(id, audit) {
  if (S.busy) { toast('Wait for the current test to finish.'); return; }
  if (id === 'EURUSD' || id === 'BTCUSD') {
    const d = SAMPLE_DATA[id];
    const dates = d.d.map(s => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`);
    adoptMarket(finishMarket(id === 'EURUSD' ? 'EUR/USD daily' : 'BTC/USD daily', dates, d.o.slice(), d.h.slice(), d.l.slice(), d.c.slice(), true), 'real data', id === 'EURUSD' ? 'fx' : 'crypto');
  } else {
    S.busy = true;
    try {
      const r = await runJob('synth', { n: 4000, seed: id === 'RW' ? 77 : 205, trend: id === 'TREND' ? 1.5 : 0 }, 'Generating');
      adoptMarket(finishMarket(id === 'RW' ? 'Random walk' : 'Planted trend', bizDates(4000, 2010), r.o, r.h, r.l, r.c, true), 'synthetic', 'other', 0);
    } finally { S.busy = false; $('#runbar').hidden = true; }
  }
  if (audit) await runAudit();
  else await guarded(async () => { stepInfo = { i: 0, n: 2 }; await RUN.backtest(); stepInfo.i = 1; await RUN.optimize(); });
}
$('#sampleSel').addEventListener('change', e => { if (e.target.value !== 'UPLOAD') loadSample(e.target.value, false); });
function handleFile(file) {
  if (!file) return;
  if (S.busy) { toast('Wait for the current test to finish.'); return; }
  const rd = new FileReader();
  rd.onload = async () => {
    try {
      const m = parseCSV(String(rd.result), file.name.replace(/\.[^.]+$/, ''));
      const nm = file.name.toUpperCase();
      const asset = /BTC|ETH|SOL|XRP|DOGE|USDT|CRYPTO/.test(nm) ? 'crypto' : /(EUR|USD|JPY|GBP|AUD|CHF|CAD|NZD|SGD|TWD){2}|FX/.test(nm) ? 'fx' : /BOND|TLT|IEF|TREAS|ZN|ZB|BUND/.test(nm) ? 'bond' : 'equity';
      const opt = $('#sampleSel option[value="UPLOAD"]'); opt.disabled = false; opt.textContent = 'Your upload: ' + file.name; $('#sampleSel').value = 'UPLOAD';
      adoptMarket(m, 'your file', asset);
      toast(`Loaded ${int(m.n)} bars from ${file.name}${m.hasOHLC ? '' : ' (close only)'}.`);
      await guarded(async () => { stepInfo = { i: 0, n: 2 }; await RUN.backtest(); stepInfo.i = 1; await RUN.optimize(); });
    } catch (e) { toast(e.message, 8000); }
  };
  rd.readAsText(file);
}
const drop = $('#drop');
drop.addEventListener('click', () => $('#fileIn').click());
drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#fileIn').click(); } });
$('#fileIn').addEventListener('change', e => { handleFile(e.target.files[0]); e.target.value = ''; });
['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', e => handleFile(e.dataTransfer.files[0]));

// ================= boot =================
buildStratSelect(); buildParams(); buildPanels(); startWorker();
loadSample('EURUSD', true).then(() => { try { const t = localStorage.getItem('edge_tab'); if (t && t !== 'verdict' && TABS.some(x => x.id === t)) showTab(t); } catch (e) { } });
})();
