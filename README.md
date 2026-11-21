# csv-fast — a faster drop-in for csv-reader 1.0.0

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/zamrdzhu/csv-reader-speed/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/zamrdzhu/csv-reader-speed/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A faster drop-in for **csv-reader 1.0.0**, make.fun's own CSV reader: `solve.js`
answers every `{text, header}` input with exactly the `{columns, rows,
errors}` csv-reader returns — including every broken-row semantic (BOM drop,
LF/CRLF record ends, stray CRs, quote junk, unterminated quotes re-read as
unquoted, short/long row padding and cutting, in the order met) — while
running about **3.4× faster** than the reference on the practice set
(~141 ms vs ~484 ms per set, same machine, median of 7 runs).

Entry for the make.fun contest **csv-reader-speed-01-run-20261121** ("Read
broken CSV files faster, 21 November 2026").

## How it is faster

csv-reader reads one character at a time and builds every field a character
at a time. This implementation never reads a character twice:

- **Record fast path:** a record with no quote and no stray CR is split
  natively (`String.split`), one slice and one native call per record.
- **IndexOf jumps:** every other field is found with `indexOf` jumps, each
  bounded by the field or the record, instead of a character loop — quoted
  fields find their closing quote directly, `""` escapes are skipped over,
  and line breaks inside quotes are converted in one native `replace`.
- **No extra work:** no copies of the text, no per-character closures on
  the common path; the driver keeps the house baseline's shape (V8
  incremental marking off, one `run()` per case, plain `JSON.stringify`
  out).

## Files

- `solve.js` — the reader: `run(input)` returns csv-reader 1.0.0's answer.
  Dependency-free ES module, no network, no state kept between cases.
- `main.ts` — the program the harness runs: reads `/input/cases.json`,
  answers each case with `run`, writes `/output/answers.json`.

## Verification

- Practice set: **6/6 cases identical** to csv-reader 1.0.0 and to the
  kit's `practice/reference/expected.json`.
- Fresh instances drawn with the kit's own generator (3 seeds, 18 cases):
  **18/18 identical** to the oracle.
- Differential fuzzing against csv-reader 1.0.0: **100,000 random inputs**
  (random broken text and structured random CSVs, several seeds, up to
  2,000 characters each) — **0 mismatches**.

## License

MIT — see `LICENSE`.
