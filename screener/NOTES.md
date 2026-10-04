# Screener Improvements Notes & Decisions

## Phase 0 - Hygiene
- Added `eslint`, `prettier`, `vitest` for better code quality and testing.
- Removed `dist/` from version control and added to `.gitignore`.
- Reorganized `test_*.js` scripts into `scripts/dev/` as they were cluttering the root and screener directories.
- Moved `keys.txt` to `screener/src/data/keys.txt` to ensure it's treated as data, not a top-level file.
- Added `@tanstack/react-query`, `react-router-dom`, `lightweight-charts`, and other dependencies specified in the plan.
- The `eslint.config.js` was copied from the main `frontend/` directory to ensure consistency.

## Open Questions
- Need to verify `/api/screener` integration on the backend side in Phase 5 to make sure we have all required NLP/sentiment data correctly connected.
- For Phase 1 (Correctness), the demo data will need to be seeded correctly to be deterministic, possibly using a lightweight PRNG.
