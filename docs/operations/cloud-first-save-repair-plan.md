# Cloud-first save repair plan

> Status: approved plan (Nov 8, 2026). Not implemented. No tenant flow or List
> has been changed by this document.

## Owner requirements

- Cloud progress is the normal source of truth.
- Local storage is used only as a pending queue when the network or flow is
  unreachable; queued saves retry automatically and via the Retry button.
- Existing student and teacher login flows remain unchanged.
- Use the existing Azure-protected Power Automate flows and Microsoft Lists.
- **Authorization decision:** save and student-read flows keep the pre-PR-72
  shared API-key trust level for this repair. Tightening (for example a
  login-issued session token) is a later, separate phase. Risk accepted: the
  key is browser-visible, so a caller holding it could address any row.

## PR 68–75 review outcome

| PR | Purpose | Save impact | Open findings on `main` |
| --- | --- | --- | --- |
| 68 | Competition baselines (default OFF) | None | 3, fixed by #69 |
| 69 | Save protection, retry/migration integrity | None alone | 2, fixed by #70/#71 |
| 70 | CI build-output isolation | None | None |
| 71 | Dispatch protection, migration fallback | None alone | None |
| 72 | Prevent local runs overwriting newer cloud progress | Holds all uploads until v2, restore, proof and startup lookup exist | 4 present |
| 73 | Dashboard row matching, `LaastPlayedUtc` alias | Dashboard only | 1 present |
| 74 | Roster level read-back (open) | None | Superseded by #75 |
| 75 | Levels 2–5 gates (open) | None | 4 open |

PR 72's overwrite concern is valid. The regression is that its prerequisites
(proof provider, exact-slot read, v2 writer) were never built, so every upload
is held before any HTTP request (`shared/sharepoint-sync.js` `_uploadHold`).

### Defects confirmed present on `main`

1. `levels/level-2-tycoon/game-state.js:772` – snapshot capture prefers the
   profile store over the in-memory profile; `investment-profile.js` `_save`
   swallows write failures, so defaults can overwrite a valid profile.
2. `shared/level-save-store.js:658` – adoption re-reads the ledger instead of
   using the validated `sourceLedger`; a failed read erases other levels.
3. `shared/level-save-store.js` – no cross-tab lock around ledger writes.
4. `levels/level-2-tycoon/script.js:1580` – unchanged legacy/converted saves
   compare as changed, producing false `both_changed` conflicts.
5. `teacher/dashboard-state.js:694` – date-only `LaastPlayedUtc` precedes
   precise timestamps, so same-day rows can show older progress.

## Flow work (tenant)

1. Back up `GGR_StudentProgress` again; confirm the restore procedure.
2. Add columns: `Revision` (number), `RunId`, `RunGeneration` (number),
   `LastSaveRequestId` (text). Set `Revision = 1` on existing rows.
3. Upgrade `GGR_SaveProgress`:
   - Require explicit `level`; reject instead of defaulting to 2.
   - Get items by exact `ProgressKey`, top 2; duplicates → 409 `duplicate_rows`.
   - Same `saveRequestId` as `LastSaveRequestId` → return original ack,
     `deduplicated:true`.
   - `baseRevision` must equal `Revision` (null only when no row) else 409
     `revision_conflict`; older `runGeneration` → 422 `generation_stale`.
   - Update via *Send an HTTP request to SharePoint* (MERGE) with the read
     ETag in `IF-MATCH`; HTTP 412 → 409 `precondition_failed`.
   - Map `CheckpointPassed` from `quiz_passed`/`approved`, not `Passed`.
   - Do not write teacher approval fields from student saves.
   - Success: `{ok:true,protocolVersion:2,saveRequestId,progressKey,
     runGeneration,revision,deduplicated}`; errors `{ok:false,code,retryable}`.
4. Create `GGR_GetStudentProgress`: API key, exact `ProgressKey` lookup, top 2,
   return only that slot (`found`, `revision`, `runGeneration`, envelope).
   Never reuse `GGR_GetDashboardData` for student restore.

## Client work (repository)

1. Load: read cloud slot first and play from it; local slot is cache/queue.
2. Save: send each save; network failure/timeout → queue and retry; Retry
   button drains the queue.
3. 409 conflict: export local copy, show "newer progress on another device",
   load cloud copy. 401/422: stop sending, show error, keep export available.
4. Saves stranded since Nov 7: upload only when `runId` matches the cloud
   snapshot's `run.runId` and local round ≥ cloud round; otherwise flag for
   teacher review.
5. Replace the proof-provider requirement with the agreed API-key check; keep
   envelope/ledger protection and conflict checks.
6. Fix defects 1–5 with regression tests.

## Rollout

1. One dedicated test account (not the forensic account) on two browsers:
   save on A, restore on B, exact economy match.
2. One class pilot, then all classes. Rollback: turn `saveProtocolV2` and
   `fullCloudRestore` OFF; queued saves remain local and exportable.
