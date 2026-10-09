'use strict';
/* =====================================================================
   Edge Lab engine. Runs inside a Web Worker (or Node for tests).
   All prices are handled as LOG prices, all returns as log returns
   (Masters, ch.1: log differences are symmetric and scale-free).
   ===================================================================== */

// ---------- RNG ----------
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let rand = mulberry32(12345);
function setSeed(s) { rand = mulberry32((s >>> 0) || 1); }
function randn() {
  let u = 0; while (u === 0) u = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}
function randInt(n) { let j = (rand() * n) | 0; return j >= n ? n - 1 : j; }

// ---------- Market ----------
function makeMarket(o, h, l, c) {
  const n = c.length;
  const m = { n, lo: new Float64Array(n), lh: new Float64Array(n), ll: new Float64Array(n), lc: new Float64Array(n) };
  for (let i = 0; i < n; i++) {
    m.lo[i] = Math.log(o[i]); m.lh[i] = Math.log(h[i]); m.ll[i] = Math.log(l[i]); m.lc[i] = Math.log(c[i]);
  }
  return m;
}
function cloneMarket(m) {
  return { n: m.n, lo: m.lo.slice(), lh: m.lh.slice(), ll: m.ll.slice(), lc: m.lc.slice() };
}

// ---------- Bar permutation (Masters ch.7, "Permuting Price Bars") ----------
// Bars a..b-1 are rebuilt from shuffled changes. Close of bar a-1 is the fixed basis,
// close of bar b-1 is preserved automatically, so the overall trend is unchanged.
// Inter-bar gaps (close->open) and intra-bar moves (open->H/L/C) are shuffled separately.
function preparePermute(m, a, b) {
  const k = b - a;
  const P = { a, b, k, ro: new Float64Array(k), rh: new Float64Array(k), rl: new Float64Array(k), rc: new Float64Array(k),
    io: new Int32Array(k), ib: new Int32Array(k) };
  for (let i = 0; i < k; i++) {
    const t = a + i;
    P.ro[i] = m.lo[t] - m.lc[t - 1];
    P.rh[i] = m.lh[t] - m.lo[t];
    P.rl[i] = m.ll[t] - m.lo[t];
    P.rc[i] = m.lc[t] - m.lo[t];
  }
  return P;
}
function shuffleIdx(idx) {
  const k = idx.length;
  for (let i = 0; i < k; i++) idx[i] = i;
  let i = k;
  while (i > 1) { const j = randInt(i); --i; const t = idx[i]; idx[i] = idx[j]; idx[j] = t; }
}
function doPermute(P, dst) {
  shuffleIdx(P.io); shuffleIdx(P.ib);
  for (let i = 0; i < P.k; i++) {
    const t = P.a + i, jo = P.io[i], jb = P.ib[i];
    dst.lo[t] = dst.lc[t - 1] + P.ro[jo];
    dst.lh[t] = dst.lo[t] + P.rh[jb];
    dst.ll[t] = dst.lo[t] + P.rl[jb];
    dst.lc[t] = dst.lo[t] + P.rc[jb];
  }
}

// ---------- Indicators (cached per market) ----------
class Ctx {
  constructor(m) { this.m = m; this.cache = new Map(); }
  get(key, fn) { let v = this.cache.get(key); if (v === undefined) { v = fn(); this.cache.set(key, v); } return v; }
  sma(L) {
    return this.get('sma' + L, () => {
      const c = this.m.lc, n = c.length, out = new Float64Array(n).fill(NaN);
      let s = 0;
      for (let i = 0; i < n; i++) {
        s += c[i]; if (i >= L) s -= c[i - L];
        if (i >= L - 1) out[i] = s / L;
      }
      return out;
    });
  }
  ema(L, src) {
    const key = 'ema' + L + (src ? src.key : '');
    return this.get(key, () => {
      const c = src ? src.v : this.m.lc, n = c.length, out = new Float64Array(n).fill(NaN), al = 2 / (L + 1);
      let e = NaN;
      for (let i = 0; i < n; i++) {
        const x = c[i]; if (isNaN(x)) continue;
        e = isNaN(e) ? x : e + al * (x - e); out[i] = e;
      }
      return out;
    });
  }
  zscore(L) {
    return this.get('z' + L, () => {
      const c = this.m.lc, n = c.length, out = new Float64Array(n).fill(NaN), mu = this.sma(L);
      for (let i = L - 1; i < n; i++) {
        let ss = 0; const m0 = mu[i];
        for (let j = i - L + 1; j <= i; j++) { const d = c[j] - m0; ss += d * d; }
        const sd = Math.sqrt(ss / (L - 1));
        out[i] = sd > 1e-12 ? (c[i] - m0) / sd : 0;
      }
      return out;
    });
  }
  rsi(p) {
    return this.get('rsi' + p, () => {
      const c = this.m.lc, n = c.length, out = new Float64Array(n).fill(NaN);
      if (n <= p) return out;
      let up = 0, dn = 0;
      for (let i = 1; i <= p; i++) { const d = c[i] - c[i - 1]; if (d > 0) up += d; else dn -= d; }
      up /= p; dn /= p;
      out[p] = dn === 0 ? 100 : 100 - 100 / (1 + up / dn);
      for (let i = p + 1; i < n; i++) {
        const d = c[i] - c[i - 1];
        up = (up * (p - 1) + (d > 0 ? d : 0)) / p;
        dn = (dn * (p - 1) + (d < 0 ? -d : 0)) / p;
        out[i] = dn === 0 ? 100 : 100 - 100 / (1 + up / dn);
      }
      return out;
    });
  }
  chanHi(L) { // highest high of the L bars BEFORE bar i
    return this.get('chh' + L, () => {
      const h = this.m.lh, n = h.length, out = new Float64Array(n).fill(NaN);
      for (let i = L; i < n; i++) { let mx = -Infinity; for (let j = i - L; j < i; j++) if (h[j] > mx) mx = h[j]; out[i] = mx; }
      return out;
    });
  }
  chanLo(L) {
    return this.get('chl' + L, () => {
      const l = this.m.ll, n = l.length, out = new Float64Array(n).fill(NaN);
      for (let i = L; i < n; i++) { let mn = Infinity; for (let j = i - L; j < i; j++) if (l[j] < mn) mn = l[j]; out[i] = mn; }
      return out;
    });
  }
}

// ---------- Strategies ----------
// signal(ctx, p, out): out[i] = desired position decided at the CLOSE of bar i, using data <= i only.
const STRATS = {
  ma_cross: {
    name: 'MA crossover', family: 'Trend following',
    blurb: 'Long when the fast simple moving average is above the slow one, short when below.',
    params: [
      { k: 'fast', label: 'Fast MA (bars)', min: 5, max: 50, step: 5, def: 20, int: true },
      { k: 'slow', label: 'Slow MA (bars)', min: 20, max: 200, step: 20, def: 100, int: true }],
    valid: p => p.fast < p.slow,
    lookback: p => p.slow,
    signal(ctx, p, out) {
      const f = ctx.sma(p.fast), s = ctx.sma(p.slow);
      for (let i = 0; i < out.length; i++) { const a = f[i], b = s[i]; out[i] = (a > b) ? 1 : (a < b) ? -1 : 0; }
    }
  },
  momentum: {
    name: 'Time-series momentum', family: 'Trend following',
    blurb: 'Long if price is higher than it was N bars ago, short if lower.',
    params: [{ k: 'look', label: 'Lookback (bars)', min: 10, max: 250, step: 10, def: 120, int: true }],
    valid: () => true,
    lookback: p => p.look,
    signal(ctx, p, out) {
      const c = ctx.m.lc, L = p.look;
      for (let i = 0; i < out.length; i++) {
        if (i < L) { out[i] = 0; continue; }
        const d = c[i] - c[i - L]; out[i] = d > 0 ? 1 : d < 0 ? -1 : 0;
      }
    }
  },
  donchian: {
    name: 'Donchian breakout', family: 'Trend following',
    blurb: 'Go long when the close breaks above the highest high of the last N bars, short on a break below the lowest low. Hold until the opposite breakout.',
    params: [{ k: 'look', label: 'Channel (bars)', min: 10, max: 120, step: 10, def: 55, int: true }],
    valid: () => true,
    lookback: p => p.look,
    signal(ctx, p, out) {
      const c = ctx.m.lc, hi = ctx.chanHi(p.look), lo = ctx.chanLo(p.look);
      let st = 0;
      for (let i = 0; i < out.length; i++) {
        if (i >= p.look) { if (c[i] > hi[i]) st = 1; else if (c[i] < lo[i]) st = -1; }
        out[i] = st;
      }
    }
  },
  zscore: {
    name: 'Z-score mean reversion', family: 'Mean reversion',
    blurb: 'Buy when price is stretched below its rolling mean (z < -entry), sell short when stretched above. Exit when z returns inside the exit band.',
    params: [
      { k: 'look', label: 'Lookback (bars)', min: 10, max: 60, step: 10, def: 20, int: true },
      { k: 'entry', label: 'Entry |z|', min: 1, max: 2.5, step: 0.5, def: 2, int: false },
      { k: 'exit', label: 'Exit |z|', min: 0, max: 0.5, step: 0.5, def: 0, int: false }],
    valid: p => p.exit < p.entry,
    lookback: p => p.look,
    signal(ctx, p, out) {
      const z = ctx.zscore(p.look);
      let st = 0;
      for (let i = 0; i < out.length; i++) {
        const v = z[i];
        if (isNaN(v)) { out[i] = 0; continue; }
        if (st === 1 && v >= -p.exit) st = 0;
        else if (st === -1 && v <= p.exit) st = 0;
        if (st === 0) { if (v < -p.entry) st = 1; else if (v > p.entry) st = -1; }
        out[i] = st;
      }
    }
  },
  rsi: {
    name: 'RSI reversion', family: 'Mean reversion',
    blurb: 'Wilder RSI. Long when RSI drops below the band, short when it rises above 100 minus the band. Exit when RSI crosses 50.',
    params: [
      { k: 'period', label: 'RSI period', min: 2, max: 20, step: 2, def: 14, int: true },
      { k: 'band', label: 'Oversold band', min: 10, max: 40, step: 5, def: 30, int: true }],
    valid: () => true,
    lookback: p => Math.max(p.period * 5, 10),
    signal(ctx, p, out) {
      const r = ctx.rsi(p.period), os = p.band, ob = 100 - p.band;
      let st = 0;
      for (let i = 0; i < out.length; i++) {
        const v = r[i];
        if (isNaN(v)) { out[i] = 0; continue; }
        if (st === 1 && v > 50) st = 0;
        else if (st === -1 && v < 50) st = 0;
        if (st === 0) { if (v < os) st = 1; else if (v > ob) st = -1; }
        out[i] = st;
      }
    }
  },
  macd: {
    name: 'MACD', family: 'Trend following',
    blurb: 'Long when the MACD line (fast EMA minus slow EMA) is above its signal line, short when below.',
    params: [
      { k: 'fast', label: 'Fast EMA', min: 6, max: 18, step: 4, def: 12, int: true },
      { k: 'slow', label: 'Slow EMA', min: 20, max: 50, step: 10, def: 26, int: true },
      { k: 'sig', label: 'Signal EMA', min: 5, max: 15, step: 5, def: 9, int: true }],
    valid: p => p.fast < p.slow,
    lookback: p => 3 * p.slow + p.sig,
    signal(ctx, p, out) {
      const f = ctx.ema(p.fast), s = ctx.ema(p.slow);
      const key = 'macd' + p.fast + '_' + p.slow;
      const line = ctx.get(key, () => { const v = new Float64Array(f.length); for (let i = 0; i < v.length; i++) v[i] = f[i] - s[i]; return v; });
      const sg = ctx.ema(p.sig, { key, v: line });
      for (let i = 0; i < out.length; i++) { const d = line[i] - sg[i]; out[i] = d > 0 ? 1 : d < 0 ? -1 : 0; }
    }
  }
};

function enumerateGrid(strat, ranges) {
  // ranges: {k:{min,max,step}}; returns array of param objects satisfying strat.valid
  const keys = strat.params.map(p => p.k);
  const lists = strat.params.map(p => {
    const r = ranges[p.k] || p; const out = [];
    const step = r.step > 0 ? r.step : 1;
    for (let v = r.min; v <= r.max + 1e-9; v += step) out.push(p.int ? Math.round(v) : Math.round(v * 1e6) / 1e6);
    if (!out.length) out.push(r.min);
    return [...new Set(out)];
  });
  const combos = [];
  const rec = (i, cur) => {
    if (i === keys.length) { const p = Object.assign({}, cur); if (strat.valid(p)) combos.push(p); return; }
    for (const v of lists[i]) { cur[keys[i]] = v; rec(i + 1, cur); }
  };
  rec(0, {});
  return { combos, lists, keys };
}

// ---------- Position engine ----------
// Decision at close of bar t-1 sets the position held during bar t.
// exec 'close': trade at close t-1 (market-on-close).  exec 'open': trade at open of bar t (conservative).
// Every bar is marked to market, giving one return per bar (Masters ch.5: single-bar returns).
function simulate(m, d, risk, from, to, out, rec) {
  const lo = m.lo, lh = m.lh, ll = m.ll, lc = m.lc;
  const sl = risk.sl || 0, tp = risk.tp || 0, mb = risk.maxBars || 0, cost = risk.cost || 0, openExec = risk.exec === 'open';
  const lslL = sl > 0 ? Math.log(1 - sl) : 0, lslS = sl > 0 ? Math.log(1 + sl) : 0;
  const ltpL = tp > 0 ? Math.log(1 + tp) : 0, ltpS = tp > 0 ? Math.log(Math.max(1e-9, 1 - tp)) : 0;
  let pos = 0, E = 0, held = 0, blocked = 0, nL = 0, nS = 0, nTrades = 0, entT = 0;
  const posArr = rec ? rec.pos : null, trades = rec ? rec.trades : null;
  for (let t = from; t < to; t++) {
    let want = d[t - 1];
    if (blocked !== 0) { if (want === blocked) want = 0; else blocked = 0; }
    let r = 0, base;
    if (want !== pos) {
      const px = openExec ? lo[t] : lc[t - 1];
      if (openExec) r += pos * (lo[t] - lc[t - 1]);
      if (pos !== 0 && trades) trades.push({ side: pos, entT, exT: openExec ? t : t - 1, ret: pos * (px - E) - 2 * cost, why: 'signal', bars: held });
      r -= cost * Math.abs(want - pos);
      pos = want;
      if (pos !== 0) { E = px; held = 0; nTrades++; entT = openExec ? t : t - 1; }
      base = px;
    } else base = lc[t - 1];
    const during = pos;
    if (pos !== 0) {
      held++;
      let ex = NaN, why = '';
      if (pos > 0) {
        if (sl > 0) { const s = E + lslL; if (lo[t] <= s) { ex = lo[t]; why = 'stop'; } else if (ll[t] <= s) { ex = s; why = 'stop'; } }
        if (ex !== ex && tp > 0) { const q = E + ltpL; if (lo[t] >= q) { ex = lo[t]; why = 'target'; } else if (lh[t] >= q) { ex = q; why = 'target'; } }
      } else {
        if (sl > 0) { const s = E + lslS; if (lo[t] >= s) { ex = lo[t]; why = 'stop'; } else if (lh[t] >= s) { ex = s; why = 'stop'; } }
        if (ex !== ex && tp > 0) { const q = E + ltpS; if (lo[t] <= q) { ex = lo[t]; why = 'target'; } else if (ll[t] <= q) { ex = q; why = 'target'; } }
      }
      if (ex !== ex && mb > 0 && held >= mb) { ex = lc[t]; why = 'time'; }
      if (ex === ex) {
        r += pos * (ex - base) - cost;
        if (trades) trades.push({ side: pos, entT, exT: t, ret: pos * (ex - E) - 2 * cost, why, bars: held });
        blocked = pos; pos = 0;
      } else r += pos * (lc[t] - base);
    }
    if (during > 0) nL++; else if (during < 0) nS++;
    if (posArr) posArr[t - from] = during;
    out[t - from] = r;
  }
  if (trades && pos !== 0) trades.push({ side: pos, entT, exT: to - 1, ret: pos * (lc[to - 1] - E) - cost, why: 'open', bars: held });
  return { nL, nS, nTrades };
}

function applyDir(sig, dir) {
  if (dir === 'long') { for (let i = 0; i < sig.length; i++) if (sig[i] < 0) sig[i] = 0; }
  else if (dir === 'short') { for (let i = 0; i < sig.length; i++) if (sig[i] > 0) sig[i] = 0; }
}

function gridStartFor(strat, combos) {
  let mx = 1; for (const p of combos) mx = Math.max(mx, strat.lookback(p));
  return mx + 1;
}

// Returns matrix for every combo, aligned on the same bars [start, n)  (needed for CSCV & fair comparison)
function buildReturns(m, strat, combos, risk, start) {
  const n = m.n, N = n - start, nc = combos.length;
  const R = new Float32Array(nc * N), P = new Int8Array(nc * N), nL = new Int32Array(nc), nS = new Int32Array(nc), nT = new Int32Array(nc);
  const ctx = new Ctx(m), sig = new Int8Array(n), tmp = new Float64Array(N), rec = { pos: new Int8Array(N), trades: null };
  for (let c = 0; c < nc; c++) {
    strat.signal(ctx, combos[c], sig);
    applyDir(sig, risk.dir);
    const st = simulate(m, sig, risk, start, n, tmp, rec);
    R.set(tmp, c * N); P.set(rec.pos, c * N);
    nL[c] = st.nL; nS[c] = st.nS; nT[c] = st.nTrades;
  }
  return { R, P, N, nc, nL, nS, nT, start };
}

// ---------- Criteria ----------
function critRange(R, off, a, b, kind, bpy) {
  let s = 0, s2 = 0, gp = 0, gl = 0; const n = b - a;
  for (let i = off + a; i < off + b; i++) { const x = R[i]; s += x; s2 += x * x; if (x > 0) gp += x; else gl -= x; }
  if (kind === 'total') return s;
  if (kind === 'sharpe') {
    if (n < 2) return 0; const mu = s / n, v = (s2 - n * mu * mu) / (n - 1);
    return v > 1e-18 ? mu / Math.sqrt(v) * Math.sqrt(bpy) : 0;
  }
  if (kind === 'pf') return gl > 0 ? gp / gl : (gp > 0 ? 10 : 0);
  return s;
}
function critArr(x, kind, bpy) { return critRange(x, 0, 0, x.length, kind, bpy); }

function bestCombo(B, a, b, kind, bpy) {
  let best = -1, bv = -Infinity;
  for (let c = 0; c < B.nc; c++) { const v = critRange(B.R, c * B.N, a, b, kind, bpy); if (v > bv) { bv = v; best = c; } }
  return { best, val: bv };
}

// ---------- Stats helpers ----------
function stats(r, bpy, pos) {
  const n = r.length; let s = 0, s2 = 0, gp = 0, gl = 0, inMkt = 0;
  for (let i = 0; i < n; i++) { const x = r[i]; s += x; s2 += x * x; if (x > 0) gp += x; else gl -= x; if (pos && pos[i] !== 0) inMkt++; }
  const mu = n ? s / n : 0, v = n > 1 ? (s2 - n * mu * mu) / (n - 1) : 0, sd = Math.sqrt(Math.max(v, 0));
  let peak = 0, eq = 0, mdd = 0;
  for (let i = 0; i < n; i++) { eq += r[i]; if (eq > peak) peak = eq; if (peak - eq > mdd) mdd = peak - eq; }
  return {
    n, total: s, annRet: mu * bpy, annVol: sd * Math.sqrt(bpy), sharpe: sd > 0 ? mu / sd * Math.sqrt(bpy) : 0,
    pf: gl > 0 ? gp / gl : (gp > 0 ? Infinity : 0), maxDD: 1 - Math.exp(-mdd), maxDDlog: mdd,
    inMarket: pos ? inMkt / Math.max(n, 1) : NaN
  };
}
function tradeStats(trades) {
  const n = trades.length; if (!n) return { n: 0, winRate: 0, avgWin: 0, avgLoss: 0, expectancy: 0, avgBars: 0, longs: 0, shorts: 0, byWhy: {} };
  let w = 0, sw = 0, sl = 0, l = 0, s = 0, bars = 0, longs = 0; const byWhy = {};
  for (const t of trades) { s += t.ret; bars += t.bars; if (t.side > 0) longs++; byWhy[t.why] = (byWhy[t.why] || 0) + 1; if (t.ret > 0) { w++; sw += t.ret; } else { l++; sl += t.ret; } }
  return { n, winRate: w / n, avgWin: w ? sw / w : 0, avgLoss: l ? sl / l : 0, expectancy: s / n, avgBars: bars / n, longs, shorts: n - longs, byWhy };
}
function quantile(sorted, q) {
  if (!sorted.length) return NaN;
  const p = q * (sorted.length - 1), i = Math.floor(p), f = p - i;
  return i + 1 < sorted.length ? sorted[i] * (1 - f) + sorted[i + 1] * f : sorted[i];
}
function normCdf(x) { // Abramowitz-Stegun 7.1.26 via erf
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x / 2);
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}
function normInv(p) { // Acklam
  if (p <= 0) return -Infinity; if (p >= 1) return Infinity;
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  const pl = 0.02425; let q, r;
  if (p < pl) { q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > 1 - pl) { q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  q = p - 0.5; r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}
function lgamma(x) {
  const g = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x, tmp = x + 5.5; tmp -= (x + 0.5) * Math.log(tmp); let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) ser += g[j] / ++y;
  return -tmp + Math.log(2.5066282746310005 * ser / x);
}
function betacf(a, b, x) {
  const MAXIT = 300, EPS = 3e-14, FPMIN = 1e-300;
  let qab = a + b, qap = a + 1, qam = a - 1, c = 1, d = 1 - qab * x / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN; d = 1 / d; let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m; let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN; c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN; d = 1 / d; h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN; c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN; d = 1 / d;
    const del = d * c; h *= del; if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}
function ibeta(a, b, x) {
  if (x <= 0) return 0; if (x >= 1) return 1;
  const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b;
}
function tCdf(t, df) { const x = df / (df + t * t), p = 0.5 * ibeta(df / 2, 0.5, x); return t > 0 ? 1 - p : p; }

// ---------- Bootstrap (Masters ch.6) ----------
function bcaLowerMean(x, B, alpha) {
  const n = x.length; let s = 0; for (const v of x) s += v; const theta = s / n;
  const boots = new Float64Array(B);
  for (let b = 0; b < B; b++) { let t = 0; for (let i = 0; i < n; i++) t += x[randInt(n)]; boots[b] = t / n; }
  let below = 0; for (const v of boots) if (v < theta) below++;
  const z0 = normInv(Math.min(Math.max(below / B, 1 / B), 1 - 1 / B));
  let num = 0, den = 0; // jackknife acceleration
  for (let i = 0; i < n; i++) { const ti = (s - x[i]) / (n - 1), d = theta - ti; num += d * d * d; den += d * d; }
  const acc = den > 0 ? num / (6 * Math.pow(den, 1.5)) : 0;
  const za = normInv(alpha), a1 = normCdf(z0 + (z0 + za) / (1 - acc * (z0 + za)));
  const sorted = Array.from(boots).sort((p, q) => p - q);
  return { theta, lower: quantile(sorted, a1), pctLower: quantile(sorted, alpha), z0, acc, boots: sorted };
}
function bootLowerPF(x, B, alpha) {
  const n = x.length; const vals = [];
  for (let b = 0; b < B; b++) {
    let gp = 0, gl = 0; for (let i = 0; i < n; i++) { const v = x[randInt(n)]; if (v > 0) gp += v; else gl -= v; }
    vals.push(gl > 0 ? Math.log(gp / gl) : 3);
  }
  vals.sort((p, q) => p - q);
  return Math.exp(quantile(vals, alpha));
}
function maxDDlog(x, start, len, src, n) {
  let eq = 0, peak = 0, mdd = 0;
  for (let i = 0; i < len; i++) { eq += src[randInt(n)]; if (eq > peak) peak = eq; const dd = peak - eq; if (dd > mdd) mdd = dd; }
  return mdd;
}
function drawdownBounds(r, horizon, ddConf, boundConf, nOuter, nInner, prog) {
  const n = r.length, outer = new Float64Array(n), q = [], inner = new Float64Array(nInner);
  // naive single bootstrap (ignores that our OOS sample is itself random)
  for (let i = 0; i < nInner * 2; i++) { }
  const naiveArr = new Float64Array(nInner * 2);
  for (let i = 0; i < naiveArr.length; i++) naiveArr[i] = maxDDlog(null, 0, horizon, r, n);
  const naiveSorted = Array.from(naiveArr).sort((a, b) => a - b);
  for (let o = 0; o < nOuter; o++) {
    for (let i = 0; i < n; i++) outer[i] = r[randInt(n)];
    for (let k = 0; k < nInner; k++) inner[k] = maxDDlog(null, 0, horizon, outer, n);
    const s = Array.from(inner).sort((a, b) => a - b);
    q.push(quantile(s, ddConf));
    if (prog && o % 10 === 0) prog(o / nOuter);
  }
  q.sort((a, b) => a - b);
  const toPct = v => 1 - Math.exp(-v);
  return { naive: toPct(quantile(naiveSorted, ddConf)), bound: toPct(quantile(q, boundConf)), median: toPct(quantile(naiveSorted, 0.5)), outerQ: q.map(toPct) };
}

// ---------- Jobs ----------
let MKT = null, BPY = 252;
let post = () => { }, progress = () => { };
let cancelFlag = false;

function prepRisk(cfg) { return Object.assign({ dir: 'both', sl: 0, tp: 0, maxBars: 0, cost: 0, exec: 'close' }, cfg.risk || {}); }

function jobBacktest(cfg) {
  const strat = STRATS[cfg.strat], p = cfg.params, risk = prepRisk(cfg);
  const start = cfg.start || (strat.lookback(p) + 1), n = MKT.n, N = n - start;
  const sig = new Int8Array(n); strat.signal(new Ctx(MKT), p, sig); applyDir(sig, risk.dir);
  const out = new Float64Array(N), rec = { pos: new Int8Array(N), trades: [] };
  const st = simulate(MKT, sig, risk, start, n, out, rec);
  const bh = new Float64Array(N); for (let t = start; t < n; t++) bh[t - start] = MKT.lc[t] - MKT.lc[t - 1];
  return { start, returns: Array.from(out), pos: Array.from(rec.pos), trades: rec.trades, stats: stats(out, BPY, rec.pos), bh: stats(bh, BPY), bhRet: Array.from(bh), tstats: tradeStats(rec.trades), nL: st.nL, nS: st.nS };
}

function jobOptimize(cfg) {
  const strat = STRATS[cfg.strat], risk = prepRisk(cfg);
  const g = enumerateGrid(strat, cfg.ranges);
  const start = gridStartFor(strat, g.combos);
  const B = buildReturns(MKT, strat, g.combos, risk, start);
  const vals = new Float64Array(B.nc), tot = new Float64Array(B.nc);
  let best = 0;
  for (let c = 0; c < B.nc; c++) {
    vals[c] = critRange(B.R, c * B.N, 0, B.N, cfg.crit, BPY);
    tot[c] = critRange(B.R, c * B.N, 0, B.N, 'sharpe', BPY);
    if (vals[c] > vals[best]) best = c;
  }
  return { combos: g.combos, lists: g.lists, keys: g.keys, vals: Array.from(vals), sharpes: Array.from(tot), best, start, N: B.N, nTrades: Array.from(B.nT) };
}

function jobMCPT(cfg) {
  const strat = STRATS[cfg.strat], risk = prepRisk(cfg);
  const g = enumerateGrid(strat, cfg.ranges), start = gridStartFor(strat, g.combos), n = MKT.n;
  const nreps = cfg.nperm + 1;
  const P = preparePermute(MKT, start, n);
  const trendPerRet = (MKT.lc[n - 1] - MKT.lc[start - 1]) / (n - start);
  const work = cloneMarket(MKT);
  let original = 0, origTotal = 0, origTrend = 0, origNL = 0, origNS = 0, count = 1, sumBias = 0, origBest = 0;
  const permVals = [], permTotals = [];
  for (let rep = 0; rep < nreps; rep++) {
    if (cancelFlag) throw new Error('cancelled');
    if (rep > 0) doPermute(P, work);
    const B = buildReturns(rep ? work : MKT, strat, g.combos, risk, start);
    const bc = bestCombo(B, 0, B.N, cfg.crit, BPY);
    const total = critRange(B.R, bc.best * B.N, 0, B.N, 'total', BPY);
    const trend = (B.nL[bc.best] - B.nS[bc.best]) * trendPerRet;
    if (rep === 0) { original = bc.val; origTotal = total; origTrend = trend; origNL = B.nL[bc.best]; origNS = B.nS[bc.best]; origBest = bc.best; }
    else {
      permVals.push(bc.val); permTotals.push(total);
      sumBias += total - trend;
      if (bc.val >= original) count++;
    }
    progress(rep / nreps, `Permutation ${rep} of ${nreps - 1}`);
  }
  const meanBias = sumBias / (nreps - 1), unbiased = origTotal - meanBias, skill = unbiased - origTrend;
  return { original, p: count / nreps, permVals, permTotals, origTotal, origTrend, meanBias, unbiased, skill, origNL, origNS,
    bestParams: g.combos[origBest], N: n - start, start, trendPerRet, nCombos: g.combos.length };
}

function wfFolds(start, n, train, test, anchored) {
  const folds = [];
  for (let ts = start + train; ts < n; ts += test) {
    const te = Math.min(ts + test, n);
    if (te - ts < Math.max(5, Math.floor(test / 4)) && folds.length) { folds[folds.length - 1].te = te; break; }
    folds.push({ trs: anchored ? start : ts - train, tre: ts, ts, te });
  }
  return folds;
}
function runWF(m, strat, combos, risk, start, folds, kind) {
  const B = buildReturns(m, strat, combos, risk, start);
  const pooled = [], pooledPos = [], info = [];
  for (const f of folds) {
    const a = f.trs - start, b = f.tre - start;
    const bc = bestCombo(B, a, b, kind, BPY);
    const off = bc.best * B.N;
    const isAnn = critRange(B.R, off, a, b, 'total', BPY) / (b - a) * BPY;
    let oosSum = 0;
    for (let t = f.ts; t < f.te; t++) { const x = B.R[off + t - start]; pooled.push(x); pooledPos.push(B.P[off + t - start]); oosSum += x; }
    info.push({ best: bc.best, isCrit: bc.val, isAnn, oosAnn: oosSum / (f.te - f.ts) * BPY, oosCrit: critRange(B.R, off, f.ts - start, f.te - start, kind, BPY) });
  }
  return { pooled, pooledPos, info, B };
}

function jobWF(cfg) {
  const strat = STRATS[cfg.strat], risk = prepRisk(cfg);
  const g = enumerateGrid(strat, cfg.ranges), start = gridStartFor(strat, g.combos), n = MKT.n;
  const folds = wfFolds(start, n, cfg.train, cfg.test, cfg.anchored);
  if (!folds.length) throw new Error('Not enough data for even one fold. Shorten the training window or the parameter lookbacks.');
  const real = runWF(MKT, strat, g.combos, risk, start, folds, cfg.crit);
  const pos = real.pooledPos;
  const oosStart = folds[0].ts;
  const bh = []; for (let t = oosStart; t < n; t++) bh.push(MKT.lc[t] - MKT.lc[t - 1]);
  const oosCrit = critArr(real.pooled, cfg.crit, BPY);
  // isPooled: average IS annualized
  let isAvg = 0; for (const i of real.info) isAvg += i.isAnn; isAvg /= real.info.length;
  const res = { folds: folds.map((f, i) => Object.assign({}, f, real.info[i], { params: g.combos[real.info[i].best] })), pooled: real.pooled, pos, oosStart, bh,
    stats: stats(Float64Array.from(real.pooled), BPY, pos), bhStats: stats(Float64Array.from(bh), BPY), oosCrit, isAvgAnn: isAvg, start, nCombos: g.combos.length };
  // Permutation test of the whole model factory (Masters ch.7)
  if (cfg.nperm > 0) {
    const firstEnd = folds[0].tre;
    const P1 = preparePermute(MKT, start, firstEnd), P2 = preparePermute(MKT, firstEnd, n);
    const work = cloneMarket(MKT);
    let count = 1; const permVals = [];
    for (let rep = 1; rep <= cfg.nperm; rep++) {
      if (cancelFlag) throw new Error('cancelled');
      doPermute(P1, work); doPermute(P2, work);
      const w = runWF(work, strat, g.combos, risk, start, folds, cfg.crit);
      const v = critArr(w.pooled, cfg.crit, BPY);
      permVals.push(v); if (v >= oosCrit) count++;
      progress(rep / (cfg.nperm + 1), `Walkforward permutation ${rep} of ${cfg.nperm}`);
    }
    res.permVals = permVals; res.p = count / (cfg.nperm + 1);
  }
  return res;
}

function combinations(n, k) { const out = []; const rec = (s, cur) => { if (cur.length === k) { out.push(cur.slice()); return; } for (let i = s; i < n; i++) { cur.push(i); rec(i + 1, cur); cur.pop(); } }; rec(0, []); return out; }

function jobCSCV(cfg) {
  const strat = STRATS[cfg.strat], risk = prepRisk(cfg);
  const g = enumerateGrid(strat, cfg.ranges), start = gridStartFor(strat, g.combos);
  if (g.combos.length < 3) throw new Error('CSCV needs at least 3 competing parameter sets. Widen the parameter ranges.');
  const B = buildReturns(MKT, strat, g.combos, risk, start);
  const S = cfg.blocks, N = B.N, ns = B.nc;
  const bs = Math.floor(N / S);
  // per system, per block: sum, sumsq, n, gp, gl
  const sum = new Float64Array(ns * S), sq = new Float64Array(ns * S), cnt = new Float64Array(S), gp = new Float64Array(ns * S), gl = new Float64Array(ns * S);
  for (let b = 0; b < S; b++) {
    const a0 = b * bs, a1 = b === S - 1 ? N : a0 + bs; cnt[b] = a1 - a0;
    for (let c = 0; c < ns; c++) {
      let s = 0, s2 = 0, p = 0, l = 0; const off = c * N;
      for (let i = a0; i < a1; i++) { const x = B.R[off + i]; s += x; s2 += x * x; if (x > 0) p += x; else l -= x; }
      sum[c * S + b] = s; sq[c * S + b] = s2; gp[c * S + b] = p; gl[c * S + b] = l;
    }
  }
  const crit = (c, blocks) => {
    let s = 0, s2 = 0, n = 0, p = 0, l = 0;
    for (const b of blocks) { s += sum[c * S + b]; s2 += sq[c * S + b]; n += cnt[b]; p += gp[c * S + b]; l += gl[c * S + b]; }
    if (cfg.crit === 'total') return s / n * BPY; // per-bar mean (sets differ slightly in size)
    if (cfg.crit === 'sharpe') { const mu = s / n, v = (s2 - n * mu * mu) / (n - 1); return v > 1e-18 ? mu / Math.sqrt(v) * Math.sqrt(BPY) : 0; }
    return l > 0 ? p / l : (p > 0 ? 10 : 0);
  };
  const combs = combinations(S, S / 2);
  let nless = 0, nloss = 0; const logits = [], pairs = [];
  const oos = new Float64Array(ns);
  for (let ci = 0; ci < combs.length; ci++) {
    const tr = combs[ci], set = new Set(tr), te = []; for (let b = 0; b < S; b++) if (!set.has(b)) te.push(b);
    let best = 0, bv = -Infinity;
    for (let c = 0; c < ns; c++) { const v = crit(c, tr); if (v > bv) { bv = v; best = c; } oos[c] = crit(c, te); }
    let rank = 1; const ob = oos[best]; // rank 1 = worst
    for (let c = 0; c < ns; c++) if (c !== best && oos[c] < ob) rank++;
    const w = rank / (ns + 1);
    if (w <= 0.5) nless++;
    if (ob <= (cfg.crit === 'pf' ? 1 : 0)) nloss++;
    logits.push(Math.log(w / (1 - w)));
    if (pairs.length < 4000) pairs.push([bv, ob]);
    if (ci % 200 === 0) progress(ci / combs.length, `Combination ${ci} of ${combs.length}`);
  }
  return { pbo: nless / combs.length, pLoss: nloss / combs.length, logits, pairs, nComb: combs.length, nSys: ns, S, blockLen: bs };
}

function jobBounds(cfg) {
  const r = cfg.returns, pos = cfg.pos;
  const inMkt = cfg.inMarketOnly ? r.filter((x, i) => pos[i] !== 0) : r.slice();
  const n = inMkt.length;
  if (n < 30) throw new Error('Fewer than 30 out-of-sample bars in the market. Run a longer walkforward first.');
  let s = 0, s2 = 0; for (const x of inMkt) { s += x; s2 += x * x; }
  const mu = s / n, sd = Math.sqrt((s2 - n * mu * mu) / (n - 1)), t = mu / (sd / Math.sqrt(n));
  const pT = 1 - tCdf(t, n - 1);
  const alpha = cfg.alpha || 0.05;
  const tLower = mu - normInv(1 - alpha) * sd / Math.sqrt(n);
  progress(0.05, 'BCa bootstrap of the mean');
  const bca = bcaLowerMean(inMkt, cfg.B || 2000, alpha);
  progress(0.2, 'Bootstrap of profit factor');
  const pfLower = bootLowerPF(inMkt, 1000, alpha);
  let gp = 0, gl = 0; for (const x of inMkt) { if (x > 0) gp += x; else gl -= x; }
  progress(0.3, 'Double bootstrap of drawdown');
  const dd = drawdownBounds(r, cfg.horizon, cfg.ddConf, cfg.boundConf, cfg.nOuter || 200, cfg.nInner || 500, f => progress(0.3 + 0.7 * f, 'Double bootstrap of drawdown'));
  const hist = []; const step = Math.max(1, Math.floor(bca.boots.length / 400)); for (let i = 0; i < bca.boots.length; i += step) hist.push(bca.boots[i]);
  return { n, mean: mu, sd, t, pT, tLower, bcaLower: bca.lower, pctLower: bca.pctLower, z0: bca.z0, acc: bca.acc, boots: hist,
    pf: gl > 0 ? gp / gl : Infinity, pfLower, dd, alpha };
}

function jobShootout(cfg) {
  const risk = prepRisk(cfg), n = MKT.n;
  const comps = cfg.comps.map(c => { const strat = STRATS[c.strat]; const g = enumerateGrid(strat, c.ranges); return { id: c.strat, strat, combos: g.combos, start: gridStartFor(strat, g.combos) }; });
  const start = Math.max(...comps.map(c => c.start));
  const P = preparePermute(MKT, start, n), work = cloneMarket(MKT);
  const nreps = cfg.nperm + 1, K = comps.length;
  const orig = new Float64Array(K), solo = new Int32Array(K).fill(1), unb = new Int32Array(K).fill(1), bestP = [], maxDist = [];
  for (let rep = 0; rep < nreps; rep++) {
    if (cancelFlag) throw new Error('cancelled');
    if (rep) doPermute(P, work);
    const vals = comps.map((c, k) => { const B = buildReturns(rep ? work : MKT, c.strat, c.combos, risk, start); const bc = bestCombo(B, 0, B.N, cfg.crit, BPY); if (!rep) bestP[k] = c.combos[bc.best]; return bc.val; });
    if (!rep) vals.forEach((v, k) => orig[k] = v);
    else {
      const mx = Math.max(...vals); maxDist.push(mx);
      for (let k = 0; k < K; k++) { if (vals[k] >= orig[k]) solo[k]++; if (mx >= orig[k]) unb[k]++; }
    }
    progress(rep / nreps, `Permutation ${rep} of ${nreps - 1}`);
  }
  return { rows: comps.map((c, k) => ({ id: c.id, name: c.strat.name, orig: orig[k], solo: solo[k] / nreps, unbiased: unb[k] / nreps, params: bestP[k], nCombos: c.combos.length })), maxDist, start };
}

// ----- Synthetic markets for the lab -----
function synthRW(n, vol, phi, trend) {
  // Gap (close->open) and intrabar move are drawn independently, as the bar permutation assumes.
  // phi: autocorrelation of returns; trend: strength of a slowly wandering drift (planted edge).
  const o = new Float64Array(n), h = new Float64Array(n), l = new Float64Array(n), c = new Float64Array(n);
  let pc = Math.log(100), prev = 0, drift = 0;
  for (let i = 0; i < n; i++) {
    if (trend) drift = 0.996 * drift + trend * vol * 0.009 * randn();
    const gap = 0.12 * vol * randn();
    const intr = (phi || 0) * prev + drift + vol * 0.99 * randn();
    const lo = pc + gap, lc = lo + intr; prev = lc - pc;
    const ext = Math.abs(randn()) * vol * 0.4, ext2 = Math.abs(randn()) * vol * 0.4;
    o[i] = lo; c[i] = lc; h[i] = Math.max(lo, lc) + ext; l[i] = Math.min(lo, lc) - ext2; pc = lc;
  }
  return { n, lo: o, lh: h, ll: l, lc: c };
}

function jobLabBias(cfg) {
  const strat = STRATS.ma_cross;
  const pool = []; for (let f = 2; f <= 40; f += 2) for (let s = 10; s <= 200; s += 10) if (f < s) pool.push({ fast: f, slow: s });
  const sizes = [1, 2, 5, 10, 25, 50, 100, 200, pool.length].filter((v, i, a) => v <= pool.length && a.indexOf(v) === i);
  const half = cfg.half || 1000, reps = cfg.reps || 40, start = 201;
  const isAcc = sizes.map(() => 0), oosAcc = sizes.map(() => 0), sigAcc = sizes.map(() => 0);
  const risk = { dir: 'both', exec: 'close' };
  for (let r = 0; r < reps; r++) {
    if (cancelFlag) throw new Error('cancelled');
    const m = synthRW(start + 2 * half, 0.01, 0);
    const B = buildReturns(m, strat, pool, risk, start);
    const isv = new Float64Array(pool.length), oov = new Float64Array(pool.length), iss = new Float64Array(pool.length);
    for (let c = 0; c < pool.length; c++) { isv[c] = critRange(B.R, c * B.N, 0, half, 'total', 252) / half * 252; oov[c] = critRange(B.R, c * B.N, half, 2 * half, 'total', 252) / half * 252; iss[c] = critRange(B.R, c * B.N, 0, half, 'sharpe', 252); }
    const idx = pool.map((_, i) => i);
    sizes.forEach((k, si) => {
      for (let i = idx.length - 1; i > 0; i--) { const j = randInt(i + 1); [idx[i], idx[j]] = [idx[j], idx[i]]; }
      let best = idx[0]; for (let i = 1; i < k; i++) if (isv[idx[i]] > isv[best]) best = idx[i];
      isAcc[si] += isv[best]; oosAcc[si] += oov[best]; if (iss[best] > 1) sigAcc[si]++;
    });
    progress((r + 1) / reps, `Random market ${r + 1} of ${reps}`);
  }
  return { sizes, is: isAcc.map(v => v / reps), oos: oosAcc.map(v => v / reps), fracSharpe1: sigAcc.map(v => v / reps), reps, half };
}

function jobLabWins(cfg) {
  // Random entries in a driftless random walk, exits only at a profit target or a stop.
  // Small steps approximate continuous prices; no clamping, so gaps through a level are realistic.
  const configs = cfg.configs || [{ tp: 0.01, sl: 0.05 }, { tp: 0.03, sl: 0.03 }, { tp: 0.05, sl: 0.01 }];
  const out = [];
  for (const k of configs) {
    let n = 0, w = 0, s = 0, s2 = 0, sw = 0, sl = 0;
    const lt = Math.log(1 + k.tp), ls = Math.log(1 - k.sl);
    while (n < (cfg.trades || 3000)) {
      let x = 0;
      for (; ;) { x += 0.002 * randn(); if (x >= lt || x <= ls) break; }
      n++; s += x; s2 += x * x; if (x > 0) { w++; sw += x; } else sl += x;
    }
    const mu = s / n, sd = Math.sqrt((s2 - n * mu * mu) / (n - 1));
    out.push({ tp: k.tp, sl: k.sl, winRate: w / n, avgWin: sw / Math.max(w, 1), avgLoss: sl / Math.max(n - w, 1), expectancy: mu, se: sd / Math.sqrt(n), n });
  }
  return { rows: out };
}

function jobLabLeak(cfg) {
  // A coin-flip system (zero expectation) that, on a small fraction of bars, peeks at the bar it is trading.
  // Same prices, same coin flips, same peek draws for every curve: only the leak rate differs.
  const n = cfg.n || 5000, leaks = cfg.leaks || [0, 0.02, 0.05, 0.1];
  const m = synthRW(n + 1, 0.01, 0);
  const coin = new Int8Array(n), u = new Float64Array(n);
  for (let t = 0; t < n; t++) { coin[t] = rand() < 0.5 ? 1 : -1; u[t] = rand(); }
  const curves = [], tstats = [];
  leaks.forEach(q => {
    let eq = 0, s = 0, s2 = 0; const cv = [0];
    for (let t = 1; t < n; t++) {
      const r = m.lc[t] - m.lc[t - 1];
      const pos = u[t] < q ? (r >= 0 ? 1 : -1) : coin[t];
      const x = pos * r; eq += x; s += x; s2 += x * x; if (t % 2 === 0) cv.push(eq);
    }
    const N = n - 1, mu = s / N, sd = Math.sqrt((s2 - N * mu * mu) / (N - 1));
    curves.push(cv);
    tstats.push({ leak: q, t: mu / sd * Math.sqrt(N), annRet: mu * 252, sharpe: mu / sd * Math.sqrt(252), p: 1 - tCdf(mu / sd * Math.sqrt(N), N - 1) });
  });
  return { curves, tstats, leaks };
}

function jobSynth(cfg) {
  setSeed(cfg.seed);
  const m = synthRW(cfg.n, cfg.vol || 0.01, 0, cfg.trend || 0);
  const ex = a => Array.from(a, v => Math.round(Math.exp(v) * 1e4) / 1e4);
  return { o: ex(m.lo), h: ex(m.lh), l: ex(m.ll), c: ex(m.lc) };
}


// ---------- Full performance metrics (shared by backtest, walkforward, nested) ----------
// Trades rebuilt from runs of identical non-zero position in a bar-by-bar record.
function tradesFromRuns(r, pos) {
  const out = []; let i = 0; const n = r.length;
  while (i < n) {
    if (!pos[i]) { i++; continue; }
    const side = pos[i]; let s = 0, j = i;
    while (j < n && pos[j] === side) { s += r[j]; j++; }
    out.push({ side, entT: i, exT: j - 1, ret: s, bars: j - i, why: 'run' });
    i = j;
  }
  return out;
}
function fullMetrics(r, pos, trades, bpy) {
  const n = r.length, b = stats(Float64Array.from(r), bpy, pos);
  let dn = 0, cnt = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0;
  for (let i = 0; i < n; i++) { const x = r[i]; if (x < 0) dn += x * x; }
  const ddev = Math.sqrt(dn / Math.max(n, 1)) * Math.sqrt(bpy);
  // distribution of bars in the market
  const xs = []; for (let i = 0; i < n; i++) if (!pos || pos[i] !== 0) xs.push(r[i]);
  const m = xs.length; let mu = 0; for (const x of xs) mu += x; mu /= Math.max(m, 1);
  for (const x of xs) { const d = x - mu; s2 += d * d; s3 += d * d * d; s4 += d * d * d * d; }
  const v = s2 / Math.max(m, 1), skew = v > 0 ? (s3 / m) / Math.pow(v, 1.5) : 0, kurt = v > 0 ? (s4 / m) / (v * v) - 3 : 0;
  // drawdown duration
  let eq = 0, peak = 0, peakAt = 0, longest = 0, ulc = 0;
  for (let i = 0; i < n; i++) { eq += r[i]; if (eq >= peak) { peak = eq; peakAt = i; } else longest = Math.max(longest, i - peakAt); const dd = 1 - Math.exp(eq - peak); ulc += dd * dd; }
  // trades
  const T = trades || [];
  let w = 0, sw = 0, sl = 0, best = -Infinity, worst = Infinity, streak = 0, maxStreak = 0, bars = 0, gpT = 0, glT = 0, longs = 0;
  for (const t of T) {
    bars += t.bars; if (t.side > 0) longs++;
    if (t.ret > best) best = t.ret; if (t.ret < worst) worst = t.ret;
    if (t.ret > 0) { w++; sw += t.ret; gpT += t.ret; streak = 0; } else { sl += t.ret; glT -= t.ret; streak++; if (streak > maxStreak) maxStreak = streak; }
  }
  const nt = T.length, avgWin = w ? sw / w : 0, avgLoss = nt - w ? sl / (nt - w) : 0;
  const cagr = Math.exp(b.annRet) - 1;
  return {
    bars: n, total: b.total, cagr, annVol: b.annVol, sharpe: b.sharpe, sortino: ddev > 0 ? b.annRet / ddev : 0,
    calmar: b.maxDD > 0 ? cagr / b.maxDD : 0, maxDD: b.maxDD, ddBars: longest, ulcer: Math.sqrt(ulc / Math.max(n, 1)),
    pfBars: b.pf, inMarket: b.inMarket, skew, kurt,
    trades: nt, winRate: nt ? w / nt : 0, avgWin, avgLoss, payoff: avgLoss ? avgWin / -avgLoss : 0, expectancy: nt ? (sw + sl) / nt : 0,
    pfTrades: glT > 0 ? gpT / glT : (gpT > 0 ? Infinity : 0), best: nt ? best : 0, worst: nt ? worst : 0, maxLossStreak: maxStreak,
    avgBars: nt ? bars / nt : 0, longShare: nt ? longs / nt : 0, tradesPerYear: nt / Math.max(n / bpy, 1e-9)
  };
}

// ---------- Nested walkforward: choosing among strategies out-of-sample (Masters ch.5, ch.7 CHOOSER) ----------
// Level 1: each competing strategy is walked forward on its own, giving its out-of-sample returns (OOS1).
// Level 2: every `step` bars, pick the strategy whose most recent `oos1n` OOS1 bars score best, trade it next.
// The Level-2 returns (OOS2) are out-of-sample for both parameter choice and strategy choice.
function nestedRun(m, comps, risk, start, folds, cfg) {
  const n = m.n, L1 = folds[0].ts, o2 = L1 + cfg.oos1n, len = n - L1;
  const lev1 = comps.map(c => { const w = runWF(m, c.strat, c.combos, risk, start, folds, cfg.crit); return { ret: w.pooled, pos: w.pooledPos }; });
  const out = [], pos = [], picks = [], share = new Float64Array(comps.length);
  let cur = -1;
  for (let t = o2; t < n; t += cfg.step) {
    let best = 0, bv = -Infinity;
    for (let k = 0; k < comps.length; k++) { const v = critRange(lev1[k].ret, 0, t - cfg.oos1n - L1, t - L1, cfg.crit, BPY); if (v > bv) { bv = v; best = k; } }
    const end = Math.min(t + cfg.step, n);
    for (let u = t; u < end; u++) {
      const i = u - L1; let x = lev1[best].ret[i];
      if (u === t && cur >= 0 && cur !== best) { // switching strategies: charge the true position change
        const np = lev1[best].pos[i], op = lev1[cur].pos[i - 1], own = lev1[best].pos[i - 1];
        x -= (risk.cost || 0) * (Math.abs(np - op) - Math.abs(np - own));
      }
      out.push(x); pos.push(lev1[best].pos[i]);
    }
    share[best] += end - t; picks.push({ t, k: best });
    cur = best;
  }
  return { out, pos, picks, share: Array.from(share, v => v / (n - o2)), lev1, o2, L1 };
}
function jobNested(cfg) {
  const risk = prepRisk(cfg), n = MKT.n;
  const comps = cfg.comps.map(c => { const strat = STRATS[c.strat]; const g = enumerateGrid(strat, c.ranges); return { id: c.strat, strat, combos: g.combos, start: gridStartFor(strat, g.combos) }; });
  const start = Math.max(...comps.map(c => c.start));
  const folds = wfFolds(start, n, cfg.train, cfg.test, cfg.anchored);
  if (!folds.length) throw new Error('Not enough data for the inner walkforward. Shorten the training window.');
  const L1 = folds[0].ts;
  if (L1 + cfg.oos1n + cfg.step * 4 > n) throw new Error('Not enough data: the inner walkforward plus the selector lookback leave too few bars to test. Shorten the training window or the selector lookback.');
  const real = nestedRun(MKT, comps, risk, start, folds, cfg);
  const o2 = real.o2;
  const critOut = critArr(real.out, cfg.crit, BPY);
  const res = {
    out: real.out, pos: real.pos, picks: real.picks, share: real.share, o2, L1, start, crit: critOut,
    comps: comps.map((c, k) => { const r = real.lev1[k].ret.slice(o2 - L1); return { id: c.id, name: c.strat.name, nCombos: c.combos.length, ret: r, pos: real.lev1[k].pos.slice(o2 - L1), crit: critArr(r, cfg.crit, BPY) }; }),
    bh: Array.from({ length: n - o2 }, (_, i) => MKT.lc[o2 + i] - MKT.lc[o2 + i - 1])
  };
  progress(1 / (cfg.nperm + 1), 'Nested walkforward on real data');
  if (cfg.nperm > 0) {
    // three separately permuted segments, so no unusual moves leak between levels (Masters ch.7)
    const P1 = preparePermute(MKT, start, L1), P2 = preparePermute(MKT, L1, o2), P3 = preparePermute(MKT, o2, n);
    const work = cloneMarket(MKT); let count = 1; const permVals = [];
    for (let rep = 1; rep <= cfg.nperm; rep++) {
      if (P1.k > 1) doPermute(P1, work); doPermute(P2, work); doPermute(P3, work);
      const v = critArr(nestedRun(work, comps, risk, start, folds, cfg).out, cfg.crit, BPY);
      permVals.push(v); if (v >= critOut) count++;
      progress((rep + 1) / (cfg.nperm + 1), `Nested permutation ${rep} of ${cfg.nperm}`);
    }
    res.permVals = permVals; res.p = count / (cfg.nperm + 1);
  }
  return res;
}

const JOBS = { nested: jobNested, synth: jobSynth, backtest: jobBacktest, optimize: jobOptimize, mcpt: jobMCPT, wf: jobWF, cscv: jobCSCV, bounds: jobBounds, shootout: jobShootout, labBias: jobLabBias, labWins: jobLabWins, labLeak: jobLabLeak };

function handle(msg) {
  if (msg.type === 'market') { MKT = makeMarket(msg.o, msg.h, msg.l, msg.c); BPY = msg.bpy; return; }
  if (msg.type === 'run') {
    cancelFlag = false;
    setSeed(msg.seed || 20181);
    const t0 = Date.now();
    try {
      const res = JOBS[msg.job](msg.cfg);
      post({ type: 'result', id: msg.id, res, ms: Date.now() - t0 });
    } catch (e) { post({ type: 'error', id: msg.id, error: String(e && e.message || e) }); }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { STRATS, enumerateGrid, makeMarket, cloneMarket, preparePermute, doPermute, simulate, buildReturns, critRange, bestCombo, stats, tradeStats,
    JOBS, handle, setSeed, fullMetrics, tradesFromRuns, synthRW, tCdf, normInv, normCdf, bcaLowerMean, gridStartFor, Ctx,
    _set(m, bpy) { MKT = m; BPY = bpy; }, _hooks(p, pr) { post = p; progress = pr; } };
} else if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
  let lastProg = 0, curId = null;
  post = m => self.postMessage(m);
  progress = (f, msg) => { const now = Date.now(); if (now - lastProg > 120) { lastProg = now; self.postMessage({ type: 'progress', id: curId, frac: f, msg }); } };
  self.onmessage = e => { curId = e.data.id; handle(e.data); };
}
