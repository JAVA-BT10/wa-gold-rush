# Staged release, rollback and tenant acceptance matrix

> **Status:** nothing here is live-verified. Repository tests (`node --test`) use mocks and harnesses only; they are **not** proof of deployment. Every gate below is **unchecked** until a person records evidence (redacted: no PINs, signed URLs, API keys or student-identifying run history).

## Stages

| Stage | Description | Gate |
| --- | --- | --- |
| 0 | Design review of this draft PR | ☐ Reviewer approval |
| 1 | **Schema and backups.** Export `GGR_Students`, `GGR_StudentProgress` and the checkpoint/approval lists. Record internal column names. Add the new columns (`Revision`, `RunGeneration`, `RunId`, `StartingNetWorth`, `ContentHash`, `LastSaveRequestId`/`RecentRequests`, `LeaderboardStatus`, `StorageSchemaVersion`). Enforce unique values on `ProgressKey`. Create `GGR_SaveReceipts`. | ☐ Backups stored ☐ Internal names recorded ☐ Uniqueness verified |
| 2 | **Backend new versions** of `GGR_SaveProgress` (v2), `GGR_GetStudentProgress` (v2), `GGR_GetDashboardData` (per-level rows + baseline) and `GGR_ResetLevelProgress`, deployed alongside the legacy behaviour. Student auth proof designed and implemented. | ☐ Acceptance rows S*, R*, D*, X* pass |
| 3 | **Disabled frontend foundation** (this PR) deployed, with all flags OFF. Per-level local slots, migration, device board and per-level dashboard ranking are active; v2/restore are inactive. | ☐ Smoke test on a pilot device ☐ No console errors ☐ Legacy saves still succeed |
| 4 | **Manual repair** of the two reported cases ([template](manual-repair-mixed-history.md)) | ☐ Both case reports complete (private) |
| 5 | **Teacher pilot:** one class, with flags `saveProtocolV2`, `fullCloudRestore` ON via runtime config | ☐ Pilot sign-off ☐ Conflict UX understood |
| 6 | **Gated rollout:** remaining classes | ☐ Monitoring of quarantine/conflict counts |
| 7 | **Level 6:** later implementation per the [blueprint](../architecture/level-6-goldfields-mastery-blueprint.md#9-enablement-checklist-all-unchecked) | ☐ (all blueprint gates) |

## Backups and version markers

- **Lists:** export before every schema or flow change, and keep the version history setting ON.
- **Browser:** the client never deletes `level2_autosave`. It copies it to `wa_gr_legacy_autosave_backups_v1` before migration and records a migration marker in `wa_gr_progression_v1|…`.
- **Version markers:**
  - Envelopes carry `storageSchemaVersion`. An unsupported (e.g. newer) version fails closed: the level is locked, the slot is neither loaded nor overwritten (test-covered).
  - v2 payloads carry `protocolVersion: 2`.

## Rollback

| Situation | Action | Never do |
| --- | --- | --- |
| v2 server problem | Turn `saveProtocolV2` OFF. v2 queue items are **held**, not replayed to the legacy flow. | Replay obsolete queued saves; strip v2 fields and resend |
| Restore problem | Turn `fullCloudRestore` OFF. The checkpoint-only compatibility mode continues. | Treat errors as "missing" |
| Frontend regression | Redeploy a previous **per-level** build | Re-enable the old shared-slot (`level2_autosave`) writer against vNext rows |
| Bad backend data | Restore rows from the export or version history manually; record a report | Bulk resets; net-worth-only "contamination" filters |

## Tenant acceptance matrix

Record the date, the tester (role), the redacted evidence location, and pass/fail for each row.

| ID | Flow / area | Test | Expected | Result |
| --- | --- | --- | --- | --- |
| L1 | GGR_LoginStudent | Valid login | Full identity + `assignedLevel`/`progressedLevel`/`currentLevel`; no PIN/hash/economy in the response | ☐ |
| L2 | GGR_LoginStudent | Wrong PIN; inactive student | Generic failure; no enumeration | ☐ |
| L3 | GGR_UpsertStudentProfile | Re-import an existing student | Unlocks, credentials and CurrentLevel preserved | ☐ |
| L4 | GGR_UpsertStudentProfile | Level 6 in import | Rejected while Level 6 is planned | ☐ |
| S1 | SaveProgress v2 | First save, no row | ok, revision 1 | ☐ |
| S2 | SaveProgress v2 | Second create (`baseRevision:null`) for the same key | `row_exists` | ☐ |
| S3 | SaveProgress v2 | Two devices, same base revision, concurrently | One ok, one `revision_conflict` (both orders) | ☐ |
| S4 | SaveProgress v2 | Lost-response retry (same ID) | Original success, `deduplicated:true` | ☐ |
| S5 | SaveProgress v2 | Retry of A after B and C accepted | Original A success; no reapply or downgrade | ☐ |
| S6 | SaveProgress v2 | Same ID, altered payload | `request_id_reused` | ☐ |
| S7 | SaveProgress v2 | Simulated failure after row write, before receipt | Retry deduplicated; receipt repaired | ☐ |
| S8 | SaveProgress v2 | Concurrent runs racing on the same row (ETag) | No lost update; HTTP 412 branch exercised | ☐ |
| S9 | SaveProgress v2 | Response time under load | Bounded below the client timeout; response on every branch | ☐ |
| S10 | SaveProgress | Level 2 save while roster CurrentLevel = 4 | Writes `|2` row only; roster `Level` unchanged | ☐ |
| S11 | SaveProgress | Student save after teacher approval | Approval fields not downgraded | ☐ |
| S12 | SaveProgress | Legacy client payload (v1) against the new flow | Legacy behaviour unchanged | ☐ |
| R1 | GetStudentProgress v2 | Existing slot | `found` with a complete envelope and revision | ☐ |
| R2 | GetStudentProgress v2 | No row | Explicit `found:false` with progressKey + contractVersion | ☐ |
| R3 | GetStudentProgress v2 | Another student's class/code | Refused | ☐ |
| R4 | GetStudentProgress v2 | Timeout / list throttling | Error response, **never** `found:false` | ☐ |
| D1 | GetDashboardData | Student with Level 2 and Level 4 rows | Both rows returned with StartingNetWorth/Revision/RunGeneration | ☐ |
| D2 | GetDashboardData | Teacher of another class | No rows from the other class (server-enforced) | ☐ |
| A1 | SaveCheckpointApproval | Approve Level 5 | `ProgressedLevel` capped at 5; no Level 6 | ☐ |
| A2 | SaveCheckpointApproval | Repeat approval | Idempotent | ☐ |
| X1 | ResetLevelProgress | Reset Level 3 | Generation+1, archived; Levels 2/4 untouched; PIN/unlocks kept | ☐ |
| X2 | ResetLevelProgress | Pre-reset queued save arrives | `generation_stale` | ☐ |
| X3 | ResetLevelProgress | Unauthorised caller | Refused, audited | ☐ |
| C1 | Client | All flags OFF | No calls to planned/unconfigured flows (check network log) | ☐ |
| C2 | Client | Shared device, two students | Separate games; no cross-loading | ☐ |
| C3 | Client | Legacy device with `level2_autosave` | Migrated to its recorded level only; original kept | ☐ |
| C4 | Client | Level 6 | Card shows "Not available yet"; `?level=6` redirects; teacher cannot assign 6 | ☐ |
| P1 | Regression | PIN first-time setup and change | Unchanged behaviour | ☐ |
| P2 | Regression | Teacher login, admin role from flow | Unchanged | ☐ |

## Repository test evidence (mock only)

Command: `node --test` (from the repository root).

- `tests/wiring-reliability.test.js` covers the existing behaviour (updated for per-level slots).
- `tests/per-level-architecture.test.js` covers the per-level architecture, the reference save server, gated sync/restore, leaderboards and Level 6 gating.

Results are recorded in the PR description.
