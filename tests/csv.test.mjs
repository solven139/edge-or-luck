import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const C = createRequire(import.meta.url)('../src/csv.js');

const rows = (n, f) => Array.from({ length: n }, (_, i) => f(i));
const day = i => new Date(Date.UTC(2020, 0, 1) + i * 864e5);

test('Yahoo-style OHLC with Adj Close, newest first', () => {
  const body = rows(400, i => { const p = 100 + i * 0.1; return `${day(i).toISOString().slice(0, 10)},${p},${p + 1},${p - 1},${p + 0.5},${(p + 0.5) / 2},1000`; }).reverse();
  const m = C.parseCSV(['Date,Open,High,Low,Close,Adj Close,Volume', ...body].join('\n'), 'x');
  assert.equal(m.n, 400);
  assert.equal(m.dates[0], '2020-01-01');
  assert.equal(m.c[0], 50.25);           // rescaled to adjusted close
  assert.equal(m.o[0], 50);
  assert.ok(m.hasOHLC);
});

test('close-only, semicolon delimited, day-first dates, thousands separators', () => {
  const body = rows(350, i => { const d = day(i); return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()};"1,${200 + i}.5"`; });
  const m = C.parseCSV(['Date;Price', ...body].join('\n'), 'y');
  assert.equal(m.n, 350);
  assert.equal(m.c[0], 1200.5);
  assert.equal(m.hasOHLC, false);
  assert.ok(m.h.every((h, i) => h >= m.l[i]));
});

test('date formats', () => {
  assert.deepEqual(C.parseDates(['15/03/2024', '01/02/2024']), ['2024-03-15', '2024-02-01']);
  assert.deepEqual(C.parseDates(['03/15/2024']), ['2024-03-15']);
  assert.deepEqual(C.parseDates(['20240315']), ['2024-03-15']);
  assert.deepEqual(C.parseDates(['2024-03-15 09:30']), ['2024-03-15 09:30']);
  assert.deepEqual(C.parseDates(['1710460800']), ['2024-03-15']);
});

test('bars per year detection', () => {
  const wk = []; for (let i = 0; wk.length < 300; i++) { const d = day(i); if (d.getUTCDay() % 6) wk.push(d.toISOString().slice(0, 10)); }
  assert.equal(C.detectBpy(wk), 252);
  assert.equal(C.detectBpy(rows(300, i => day(i).toISOString().slice(0, 10))), 365);
});

test('rejects files that are too short', () => {
  assert.throws(() => C.parseCSV('Date,Close\n2020-01-01,1', 'z'), /fewer than 30 rows/);
});
