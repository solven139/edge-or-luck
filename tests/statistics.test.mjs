// Calibration: the tests must say "no edge" on random walks and find an edge that is planted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const E = createRequire(import.meta.url)('../src/engine.js');
E._hooks(() => {}, () => {});
const ranges = { fast: { min: 5, max: 50, step: 5 }, slow: { min: 20, max: 200, step: 20 } };
const base = { strat: 'ma_cross', ranges, crit: 'total', risk: { dir: 'both', exec: 'open' } };

test('training permutation p-values are roughly uniform on random walks', () => {
  const ps = [];
  for (let k = 0; k < 16; k++) { E.setSeed(100 + k); E._set(E.synthRW(2000, 0.01, 0), 252); E.setSeed(9 + k); ps.push(E.JOBS.mcpt({ ...base, nperm: 39 }).p); }
  const mean = ps.reduce((a, b) => a + b) / ps.length;
  assert.ok(mean > 0.3 && mean < 0.75, `mean p ${mean}`);
  assert.ok(ps.filter(p => p <= 0.05).length <= 3, `too many false positives: ${ps}`);
});

test('a planted trend is detected by the training and walkforward permutation tests', () => {
  for (const seed of [203, 205]) {
    E.setSeed(seed); E._set(E.synthRW(3500, 0.01, 0, 1.5), 252);
    E.setSeed(1); assert.ok(E.JOBS.mcpt({ ...base, nperm: 39 }).p <= 0.05);
    E.setSeed(2); assert.ok(E.JOBS.wf({ ...base, train: 750, test: 250, nperm: 39 }).p <= 0.1);
  }
});

test('nested walkforward: no edge on a random walk, edge on a planted trend', () => {
  const def = id => Object.fromEntries(E.STRATS[id].params.map(p => [p.k, { min: p.min, max: p.max, step: p.step }]));
  const comps = ['ma_cross', 'donchian', 'zscore'].map(s => ({ strat: s, ranges: def(s) }));
  const cfg = { comps, risk: { dir: 'both', exec: 'open', cost: 0.0001 }, crit: 'total', train: 1000, test: 250, anchored: false, oos1n: 500, step: 21, nperm: 29 };
  E.setSeed(77); E._set(E.synthRW(4000, 0.01, 0), 252); E.setSeed(3);
  assert.ok(E.JOBS.nested(cfg).p > 0.05);
  E.setSeed(205); E._set(E.synthRW(4000, 0.01, 0, 1.5), 252); E.setSeed(3);
  assert.ok(E.JOBS.nested(cfg).p <= 0.1);
});

test('CSCV and bootstrap bounds return sane values', () => {
  E.setSeed(5); E._set(E.synthRW(3000, 0.01, 0), 252);
  const c = E.JOBS.cscv({ ...base, blocks: 8 });
  assert.equal(c.nComb, 70);
  assert.ok(c.pbo >= 0 && c.pbo <= 1);
  const w = E.JOBS.wf({ ...base, train: 750, test: 250, nperm: 0 });
  const b = E.JOBS.bounds({ returns: w.pooled, pos: w.pos, inMarketOnly: true, horizon: 252, ddConf: 0.9, boundConf: 0.7, alpha: 0.05, nOuter: 60, nInner: 200 });
  assert.ok(b.bcaLower < b.mean && b.dd.bound >= b.dd.naive * 0.9);
});

test('Student t and normal helpers', () => {
  assert.ok(Math.abs(E.tCdf(2.086, 20) - 0.975) < 1e-3);
  assert.ok(Math.abs(E.normInv(0.975) - 1.959964) < 1e-5);
});
