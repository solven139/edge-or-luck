// Correctness tests for the backtest engine: no look-ahead, consistent accounting, valid permutations.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const E = createRequire(import.meta.url)('../src/engine.js');
E._hooks(() => {}, () => {});

const defaults = s => Object.fromEntries(E.STRATS[s].params.map(p => [p.k, p.def]));
function market(seed, n = 3000, trend = 0) { E.setSeed(seed); return E.synthRW(n, 0.01, 0, trend); }

test('signals never use future prices', () => {
  const m = market(7);
  for (const [id, s] of Object.entries(E.STRATS)) {
    const a = new Int8Array(m.n); s.signal(new E.Ctx(m), defaults(id), a);
    const m2 = E.cloneMarket(m);
    for (let i = 1500; i < m.n; i++) { m2.lc[i] += 0.3 * Math.sin(i); m2.lo[i] = m2.lc[i]; m2.lh[i] = m2.lc[i] + 0.5; m2.ll[i] = m2.lc[i] - 0.5; }
    const b = new Int8Array(m.n); s.signal(new E.Ctx(m2), defaults(id), b);
    assert.deepEqual(Array.from(a.slice(0, 1500)), Array.from(b.slice(0, 1500)), `look-ahead in ${id}`);
  }
});

for (const exec of ['close', 'open']) {
  test(`bar returns up to t depend only on prices up to t (${exec} fills, stops, targets, time exits)`, () => {
    const m = market(8), sig = new Int8Array(m.n);
    E.STRATS.ma_cross.signal(new E.Ctx(m), { fast: 10, slow: 50 }, sig);
    const risk = { dir: 'both', sl: 0.02, tp: 0.04, maxBars: 15, cost: 0.0005, exec };
    const o1 = new Float64Array(m.n - 51); E.simulate(m, sig, risk, 51, m.n, o1, null);
    const m2 = E.cloneMarket(m);
    for (let i = 1501; i < m.n; i++) { m2.lc[i] += 0.2; m2.lo[i] += 0.2; m2.lh[i] += 0.2; m2.ll[i] += 0.2; }
    const o2 = new Float64Array(m.n - 51); E.simulate(m2, sig, risk, 51, m.n, o2, null);
    assert.deepEqual(Array.from(o1.slice(0, 1500 - 51 + 1)), Array.from(o2.slice(0, 1500 - 51 + 1)));
  });

  test(`bar-by-bar returns add up to trade returns (${exec} fills)`, () => {
    const m = market(9), sig = new Int8Array(m.n);
    E.STRATS.ma_cross.signal(new E.Ctx(m), { fast: 10, slow: 50 }, sig);
    const rec = { pos: new Int8Array(m.n - 51), trades: [] }, out = new Float64Array(m.n - 51);
    E.simulate(m, sig, { dir: 'both', sl: 0.02, tp: 0.04, maxBars: 15, cost: 0, exec }, 51, m.n, out, rec);
    const bars = out.reduce((a, b) => a + b, 0), trades = rec.trades.reduce((a, t) => a + t.ret, 0);
    assert.ok(Math.abs(bars - trades) < 1e-9, `${bars} vs ${trades}`);
    assert.ok(rec.trades.some(t => t.why === 'stop') && rec.trades.some(t => t.why === 'target') && rec.trades.some(t => t.why === 'time'));
  });
}

test('long-only and short-only filters are respected', () => {
  const m = market(10), sig = new Int8Array(m.n);
  for (const [dir, bad] of [['long', -1], ['short', 1]]) {
    E.STRATS.momentum.signal(new E.Ctx(m), { look: 20 }, sig);
    const B = E.buildReturns(m, E.STRATS.momentum, [{ look: 20 }], { dir, exec: 'open' }, 21);
    assert.ok(!Array.from(B.P).includes(bad), dir);
  }
});

test('bar permutation keeps the basis bars, the final close and valid OHLC', () => {
  const m = market(11), P = E.preparePermute(m, 200, m.n), w = E.cloneMarket(m);
  E.doPermute(P, w);
  assert.ok(Math.abs(w.lc[m.n - 1] - m.lc[m.n - 1]) < 1e-9);
  for (let i = 0; i < 200; i++) assert.equal(w.lc[i], m.lc[i]);
  for (let i = 0; i < m.n; i++) {
    assert.ok(w.lh[i] >= Math.max(w.lo[i], w.lc[i]) - 1e-12 && w.ll[i] <= Math.min(w.lo[i], w.lc[i]) + 1e-12);
  }
  let moved = 0; for (let i = 200; i < m.n - 1; i++) if (w.lc[i] !== m.lc[i]) moved++;
  assert.ok(moved > m.n * 0.9);
});

test('grid enumeration respects parameter constraints', () => {
  const g = E.enumerateGrid(E.STRATS.ma_cross, { fast: { min: 5, max: 50, step: 5 }, slow: { min: 20, max: 200, step: 20 } });
  assert.ok(g.combos.length > 0 && g.combos.every(p => p.fast < p.slow));
  const z = E.enumerateGrid(E.STRATS.zscore, { look: { min: 10, max: 20, step: 10 }, entry: { min: 1, max: 2, step: 1 }, exit: { min: 0, max: 1, step: 1 } });
  assert.ok(z.combos.every(p => p.exit < p.entry));
});

test('full metrics on a known series', () => {
  const r = [0.1, -0.2, 0.05, 0.05, 0, 0.1], pos = [1, 1, 1, -1, 0, 1];
  const t = E.tradesFromRuns(r, pos);
  assert.equal(t.length, 3);
  const m = E.fullMetrics(r, pos, t, 252);
  assert.ok(Math.abs(m.total - 0.1) < 1e-12);
  assert.ok(Math.abs(m.maxDD - (1 - Math.exp(-0.2))) < 1e-12);
  assert.ok(Math.abs(m.winRate - 2 / 3) < 1e-12);   // runs: long -0.05, short +0.05, long +0.10
  assert.ok(Math.abs(m.inMarket - 5 / 6) < 1e-12);
});
