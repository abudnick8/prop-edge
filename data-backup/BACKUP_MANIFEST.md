# Clubhouse IQ Data Backup Manifest

**Backup Date/Time:** 2026-05-14 22:46:44 UTC

## Files Backed Up

| File | Size | Description |
|------|------|-------------|
| server/ml_data/bet_outcome_log.json | 2058555 bytes (2.0M) | Historical bet outcome log — graded bets with scores, results, edge grades, and outcome data used for ML training |
| server/ml_data/bts_picks.json | 58464 bytes (60K) | Beat the Streak (BTS) daily picks cache — player hit probability picks keyed by date |
| server/ml_data/bts_ml_weights.json | 187 bytes (4.0K) | BTS ML weights — learned weights/correlations for BTS player picks (populated after sufficient outcomes accumulate) |
| server/ml_data/graded_ids.json | 150614 bytes (148K) | Graded pick IDs — set of all bet IDs that have been graded/processed to prevent duplicate grading |
| server/ml_data/ml_insights.json | 21669 bytes (24K) | ML insights summary — current win rate (59.5%), accuracy stats, sport/bet-type performance breakdowns |
| server/ml_data/ml_weights.json | 2021 bytes (4.0K) | ML weights — learned sport weights (NBA 4.33, MLB 5.8, NHL 5.32) and bet-type weights (spread 6.19, player_prop 4.84) |
| server/ml_data/pick_snapshots.json | 1141300 bytes (1.1M) | Pick snapshots — full historical record of all picks at time of grading, used for ML training and CIQ streak tracking |

## Summary

- **Total files:** 7
- **Total size:** 3.3M
- **Source directory:** server/ml_data/
- **Backup directory:** data-backup/server/ml_data/

## Data Descriptions

### bet_outcome_log.json
Full log of every graded bet including away/home scores, teams, bet type, confidence score, edge grade, and outcome. This is the primary training dataset for the ML models.

### bts_picks.json
Daily cache of Beat the Streak player picks. Keyed by date (YYYY-MM-DD), each entry contains player ID, name, team, hit probability, and lock timestamp.

### bts_ml_weights.json
Machine learning weights specific to the BTS feature. Currently at version 0 (unfilled), will be populated by nightly ML learning once enough pick outcomes accumulate.

### graded_ids.json
A flat array of bet IDs that have already been graded. Acts as a deduplication guard to prevent picks from being graded more than once.

### ml_insights.json
Aggregated ML performance stats: last run time (2026-04-27), sample size (2,902 graded bets), overall win rate (59.5%), and sport/bet-type breakdowns.

### ml_weights.json
Learned regression weights by sport and bet type used to score and rank picks. Reflects model state as of the last nightly ML run.

### pick_snapshots.json
Full snapshots of every pick at the time it was graded, capturing title, sport, bet type, and all relevant metadata. Used for training and CIQ streak evaluation.
