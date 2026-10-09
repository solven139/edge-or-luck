'use strict';
/* CSV loading for Edge or Luck: delimiter and header detection, flexible dates,
   adjusted-close rescaling, OHLC repair, and bars-per-year detection.
   Runs in the page; exported for Node tests. */
function detectBpy(dates) {
  const ts = dates.map(s => Date.parse(s.length <= 10 ? s + 'T00:00:00Z' : s.replace(' ', 'T') + 'Z')).filter(isFinite);
  if (ts.length < 3) return 252;
  const diffs = []; for (let i = 1; i < ts.length; i++) diffs.push((ts[i] - ts[i - 1]) / 864e5);
  diffs.sort((a, b) => a - b); const med = diffs[Math.floor(diffs.length / 2)];
  let wk = 0; ts.forEach(t => { const d = new Date(t).getUTCDay(); if (d === 0 || d === 6) wk++; });
  const weekends = wk / ts.length > 0.05;
  if (med >= 25) return 12; if (med >= 5) return 52;
  if (med >= 0.9) return weekends ? 365 : 252;
  const spanYears = (ts[ts.length - 1] - ts[0]) / (365.25 * 864e5);
  return Math.max(1, Math.round(ts.length / Math.max(spanYears, 1e-3)));
}

function finishMarket(name, dates, o, h, l, c, hasOHLC) {
  const n = c.length; let fixed = 0;
  for (let i = 0; i < n; i++) {
    const hh = Math.max(h[i], o[i], c[i]), ll = Math.min(l[i], o[i], c[i]);
    if (hh !== h[i] || ll !== l[i]) fixed++;
    h[i] = hh; l[i] = ll;
  }
  return { name, dates, o, h, l, c, n, hasOHLC, fixed };
}

function splitLine(line, d) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (ch === d && !q) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur); return out.map(s => s.trim());
}

function parseNum(s) { if (s == null) return NaN; s = s.replace(/[\s$€£¥]/g, ''); if (/^-?[\d,]+(\.\d+)?$/.test(s)) s = s.replace(/,/g, ''); return s === '' ? NaN : Number(s); }

function parseDates(raw) {
  // returns array of ISO strings (YYYY-MM-DD or YYYY-MM-DD HH:MM[:SS]) or null
  const s0 = raw.find(x => x) || '';
  const out = [];
  if (/^\d{10}(\.\d+)?$|^\d{13}$/.test(s0)) {
    for (const s of raw) { const n = Number(s); const d = new Date(n > 1e11 ? n : n * 1000); out.push(isNaN(d) ? null : d.toISOString().slice(0, 19).replace('T', ' ').replace(/ 00:00:00$/, '')); }
    return out;
  }
  if (/^\d{8}$/.test(s0)) return raw.map(s => /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null);
  const ymd = /^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/;
  const dmy = /^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/;
  const p2 = n => String(n).padStart(2, '0');
  const tm = (H, M, Sx) => H != null ? ` ${p2(H)}:${M}${Sx ? ':' + Sx : ''}` : '';
  if (ymd.test(s0)) return raw.map(s => { const m = ymd.exec(s); return m ? `${m[1]}-${p2(m[2])}-${p2(m[3])}${tm(m[4], m[5], m[6])}` : null; });
  if (dmy.test(s0)) {
    let firstBig = false, secondBig = false;
    raw.forEach(s => { const m = dmy.exec(s); if (m) { if (+m[1] > 12) firstBig = true; if (+m[2] > 12) secondBig = true; } });
    const dayFirst = firstBig || (!secondBig && /\./.test(s0));
    return raw.map(s => { const m = dmy.exec(s); if (!m) return null; let y = +m[3]; if (y < 100) y += y < 70 ? 2000 : 1900; const dd = dayFirst ? m[1] : m[2], mm = dayFirst ? m[2] : m[1]; return `${y}-${p2(mm)}-${p2(dd)}${tm(m[4], m[5], m[6])}`; });
  }
  return raw.map(s => { const t = Date.parse(s); return isNaN(t) ? null : new Date(t - new Date(t).getTimezoneOffset() * 6e4).toISOString().slice(0, 10); });
}

function parseCSV(text, name) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 30) throw new Error('The file has fewer than 30 rows. Upload a longer price history.');
  const first = lines[0];
  const delim = [',', ';', '\t', '|'].map(d => [d, splitLine(first, d).length]).sort((a, b) => b[1] - a[1])[0][0];
  let rows = lines.map(l => splitLine(l, delim));
  let hdr = null;
  if (rows[0].some(c => /[a-z]/i.test(c) && isNaN(parseNum(c)) && !/^\d{4}[-\/]/.test(c))) { hdr = rows[0].map(c => c.toLowerCase().replace(/[^a-z]/g, '')); rows = rows.slice(1); }
  const find = (re) => hdr ? hdr.findIndex(h => re.test(h)) : -1;
  let di = find(/^(date|time|timestamp|datetime|day|gmttime|localtime)/); if (di < 0) di = 0;
  let oi = find(/^open/), hi = find(/^high/), li = find(/^low/);
  let ci = find(/^(close|last|price|settle|px)/), ai = find(/^adj(usted)?close/);
  if (!hdr) { const w = rows[0].length; if (w >= 5) { oi = 1; hi = 2; li = 3; ci = 4; } else ci = w - 1; }
  if (ci < 0 && ai >= 0) ci = ai;
  if (ci < 0) { // last numeric column
    for (let j = rows[0].length - 1; j > 0; j--) if (isFinite(parseNum(rows[0][j]))) { ci = j; break; }
  }
  if (ci < 0) throw new Error('No close/price column found. Name a column "Close" or "Price".');
  const dates = parseDates(rows.map(r => r[di] || ''));
  if (dates.filter(Boolean).length < rows.length * 0.9) throw new Error('Could not read the dates. Use a format like 2024-03-15, 20240315, 15/03/2024 or a Unix timestamp.');
  const hasOHLC = oi >= 0 && hi >= 0 && li >= 0;
  let recs = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i], d = dates[i]; if (!d) continue;
    let c = parseNum(r[ci]); if (!(c > 0)) continue;
    let o = hasOHLC ? parseNum(r[oi]) : NaN, h = hasOHLC ? parseNum(r[hi]) : NaN, l = hasOHLC ? parseNum(r[li]) : NaN;
    if (ai >= 0 && ai !== ci) { const a = parseNum(r[ai]); if (a > 0) { const k = a / c; o *= k; h *= k; l *= k; c = a; } }
    recs.push({ d, o, h, l, c });
  }
  recs.sort((a, b) => a.d < b.d ? -1 : a.d > b.d ? 1 : 0);
  recs = recs.filter((r, i) => i === 0 || r.d !== recs[i - 1].d);
  if (recs.length < 300) throw new Error(`Only ${recs.length} usable rows. The tests need at least 300 bars, ideally thousands.`);
  const okOHLC = hasOHLC && recs.every(r => r.o > 0 && r.h > 0 && r.l > 0);
  const D = recs.map(r => r.d), C = recs.map(r => r.c);
  let O, H, L;
  if (okOHLC) { O = recs.map(r => r.o); H = recs.map(r => r.h); L = recs.map(r => r.l); }
  else { O = C.map((c, i) => i ? C[i - 1] : c); H = C.map((c, i) => Math.max(c, O[i])); L = C.map((c, i) => Math.min(c, O[i])); }
  return finishMarket(name, D, O, H, L, C, okOHLC);
}

if (typeof module !== 'undefined' && module.exports) module.exports = { detectBpy, finishMarket, splitLine, parseNum, parseDates, parseCSV };
