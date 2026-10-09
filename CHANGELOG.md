# Changelog

## 1.1.0
- Deflated and probabilistic Sharpe ratio for the optimizer's winner, with the expected best Sharpe from luck and minimum track record length (López de Prado, AFML ch. 14). The deflated Sharpe is now a core verdict test.
- Probabilistic Sharpe on the walkforward record.
- Probability of strategy failure from walkforward trades, plus a win-rate calculator in the Lab (AFML ch. 15).
- Seven sins of quantitative investing check on the Verdict tab, with live diagnostics for costs, outliers, long/short split and the number of trials searched this session (Palomar ch. 8).

## 1.0.0
- Backtest engine, grid optimization, training and walkforward permutation tests, CSCV, bootstrap bounds, selection-bias shootout, nested walkforward, full performance reports, CSV import, lab experiments, tests, CI and GitHub Pages deployment.
