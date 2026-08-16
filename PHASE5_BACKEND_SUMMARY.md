# MLB Prediction Engine — Phase 1 Backend Enhancements — Summary

All edits made to `/home/user/workspace/sports-predictor/server/routes.ts`. Build verified clean with `npm run build` (project's actual build tool, tsx + esbuild). 141 lines inserted, **0 lines removed** (confirmed via `git diff --stat`).

## Important deviation from task brief

The task brief assumed local scoring-component variables (`form`, `contact`, `hardContact`, `matchup`,
`opportunity`, `bvpScore`, `formW`, `matchupW`, `totalW`, `bvpWeight`, `venueScore`, `projectedPA`,
`platoonComponent`) would be in scope at the pick-push site inside `buildCandidates`. **They are not** —
these are private to the `scoreHitter()` function closure (lines ~9995-10433) and are never exposed outside it;
`scoreHitter` only returns `clampedRaw` (the final `rawScore`).

Since modifying `scoreHitter`'s signature/return value was out of scope for a purely additive change, I
**recomputed lightweight equivalents** of each driver score at the pick-push site using only the variables
that genuinely are in scope there (`stats`, `savant`, `pitcherXera`, `platoonSplitScore`, `lineupSlot`, `bvp`,
`bats`, `venueCareerAvg`, `venueCareerAB`, `oppPitcherSeasonStats`). These mirror the same normalization
formulas and weights used inside `scoreHitter` (verified line-by-line against the real function body), so the
relative ranking of "top drivers" should closely match the real internal component scores. `expectedPA` uses
the exact same lineup-slot tiering as `scoreHitter`'s internal `projectedPA` (4.6 / 4.0 / 3.6 / 3.2).

For the team-win picks, I used `finalPickSub` / `finalOppSub` — the pre-existing per-side score objects
already assembled in-code (which correctly account for the sim-flip logic) — instead of manually rebuilding
`homeWins`-based ternaries as the brief suggested. This is more correct and avoids duplicating logic that
could drift out of sync after a sim flip.

## Changes made

### 1. Hitter picks (`/api/bts-picks` candidate building, ~line 11069)
Added after `analyticsNote,` and before `steamerProjection:`:
- `expectedPA`: number, based on lineup slot tiering.
- `topDrivers`: array of top 3 `{ name, icon, label, score }` driver objects, recomputed from in-scope raw
  signals (recent form, contact quality, pitcher matchup/xERA, opportunity/lineup slot, BvP edge, hard
  contact, platoon split, venue history).

### 2. `valueOverBaseline` (after `candidatePicks.sort(...)`, ~line 11304)
- Computes slate median `hitProbability` (decimal, fallback 0.68).
- Adds `p.valueOverBaseline` (percentage-point delta vs. median) and `p.slateMedian` to every candidate pick.

### 3. Team win picks (`/api/team-wins-today`, pick object push, ~line 20032)
Added after `parkFactor,` inside the `scoredGames.push({...})` object:
- `expectedRuns`: `{ pickRpg, oppRpg, runDiff, pythagoreanWinPct }` — Pythagorean-win-expectancy style estimate
  derived from `finalWinnerScore` / `finalLoserScore`.
- `edgeDrivers`: top 3 `{ name, icon, gap, value }` categories where the pick has a positive edge over the
  opponent, sourced from `finalPickSub` / `finalOppSub` (starter edge, bullpen, offense vs. hand, lineup
  depth, market edge).

### 4 & 5. `/api/bts-analytics` endpoint (~line 12061 and res.json ~line 12130)
Added:
- `byDriver`: win/loss split grouped by `topDrivers[].name` frequency across historical picks.
- `byVob`: win/loss split grouped by `valueOverBaseline` band (`Above median +5%` / `Near median` /
  `Below median`).
- `teamWin`: aggregated win/loss record (and by-tier split) pulled from `mlbTeamWinsHistory` (`pick1`/`pick2`
  entries). Confirmed `mlbTeamWinsHistory` (declared later in the same `registerRoutes` function, ~line
  19475+) is safely referenceable inside this earlier-defined route handler because the handler executes at
  request time, after the entire `registerRoutes` body — including that `let` declaration — has already run.

## Verification performed
- `grep -n` used to find exact anchor lines before every edit.
- Read ~450 lines of `scoreHitter()` body to confirm real internal variable names and formulas.
- Confirmed via `grep`/`sed` that none of the brief's assumed variable names (`formW`, `matchupW`, `totalW`,
  `bvpWeight`, `projectedPA`, etc.) exist outside `scoreHitter`.
- Confirmed `bats`, `stats`, `savant`, `pitcherXera`, `platoonSplitScore`, `venueCareerAvg`/`venueCareerAB`,
  `bvp`, `lineupSlot` are genuinely in scope at the hitter pick-push site.
- Confirmed `finalPickSub`/`finalOppSub`/`finalWinnerScore`/`finalLoserScore` are genuinely in scope at the
  team-win pick-push site.
- Ran `npm run build` (project's real build pipeline: tsx + esbuild) — **succeeded**. Pre-existing warnings
  (duplicate "Giants"/"Cardinals" object keys, a `??` operator warning in `LinemateProps.tsx`) are unrelated
  pre-existing issues, not introduced by these changes.
- Ran `npx tsc --noEmit` (strict standalone check) — the codebase has many pre-existing strict-mode errors
  throughout (function declarations in blocks, `Set`/`Map` iteration without `downlevelIteration`, implicit
  `any`s, some genuinely mismatched types in unrelated sections). None of the errors reported fall on lines
  touched by this change (confirmed by line-range grep against the 5 edited regions).
- `git diff --stat` on `server/routes.ts`: **141 insertions(+), 0 deletions(-)** — fully additive.

## Note on unrelated pre-existing workspace state
`client/src/pages/BTS.tsx` already had a `+147` line uncommitted diff in the workspace before I started
(not authored by this task) that renders `pick.topDrivers` and `pick.expectedPA` — i.e., a frontend
counterpart already expects exactly the field names/shapes I added on the backend. This confirms the field
naming used here is correctly aligned with the frontend consumer. `dist/` build artifacts also show as
modified/untracked because `npm run build` was run — expected side effect, not a manual edit.

## Not done (explicitly out of scope per instructions)
- No git push/commit performed — edits are local only, awaiting explicit instruction to push.
