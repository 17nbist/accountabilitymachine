# bank-mini: synthetic fixture bank

Everything in this folder is synthetic content written for the tests. No text is copied or
paraphrased from any book, course or library file, and no copyrighted material is included.
Every question, answer and solution was written from scratch for this fixture and relies only
on widely known facts and puzzles.

`prep.html?fixture=1` and `sidepanel.html?fixture=1` load this folder instead of `bank/`, and
the unit, static and e2e tests read it directly.

| File | Contents |
|---|---|
| `bank.json` | Practice items: probability, brainteaser, statistics, finance |
| `decks/cpp.json` | C++ cards |
| `decks/systems.json` | Systems and low-latency cards |
| `lists/neetcode150.json` | A 12-problem stand-in with the real list's shape (not the real list) |
| `library/index.json` | Library index. The files it names do not exist: no PDFs are committed |

Notes:

- Every item id is `<source key>-<locator>-<hash8>`, where `hash8` is the first 8 hex characters
  of the SHA-256 of `prompt + answerKey(item)` (`V4-CONTRACTS.md` §E3). Changing an item's
  prompt or answer changes its id, so ids must be recomputed after any edit.
- The ten named items (`FX_*`) are fixed by `V4-CONTRACTS.md` Appendix A and must not change.
- Counts and coverage follow `V4-CONTRACTS.md` §L2: every (area, type), (area, status) and
  (type, status) pair occurs at least once.
- Each library entry's `file` is exactly the `source.file` its items cite, with no category
  folder prefix. The category only groups entries. `fixture-empty.pdf` is cited by no item.
- Files under `tests/` are locked by `tests/LOCK.json`, so edit them only through the dispute
  process.
