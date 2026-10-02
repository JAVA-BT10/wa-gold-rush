# GGR_SaveProgress Repair Spec

## Scope of this PR

This repository PR adds client-side reliability, telemetry, queue normalization, and documentation for `GGR_SaveProgress`.

The following remain manual, flow-side, or otherwise out of scope for this PR:

- Power Automate flow edits and deployment
- SharePoint data migration and duplicate cleanup execution
- `GGR_LoginStudent` activation
- `GGR_TeacherResetStudentPin`
- PIN lifecycle completion and teacher approval gating changes outside this SaveProgress work
- Teacher approval workflow changes
- Dashboard correctness fixes unrelated to SaveProgress reliability

## Known Power Automate Findings

### A) Legacy ProgressKey mismatch

Legacy `GGR_StudentProgress` rows exist with pre-ClassCode keys such as `|HG-NB5-018|2`, while the canonical key format is `NB5|HG-NB5-018|2`.

This can cause:

1. canonical `Get items` lookup returns zero rows
2. flow falls into `Create item`
3. create collides with existing `StudentCode`/`Level` data and produces duplicate/conflict behavior

### B) Timeout-after-success evidence

Some SaveProgress runs appear to time out after a successful body such as `{"ok":true,"saved":true}` was already observed.

**Timeout != Save Failed.**

A timeout or HTTP 504 must be treated as an **unknown outcome** until SharePoint state is verified. Client retry logic should therefore preserve correlation metadata and avoid assuming the original write definitely failed.

## Canonical key contract

The server must recompute the canonical key and must not trust the client-provided value.

Canonical formula:

`UPPER(ClassCode)|UPPER(StudentCode)|Level`

The client now includes `progressKey` for diagnostics only.

## Required flow lookup and migration behavior

1. Recompute canonical `ProgressKey` server-side from request `ClassCode`, `StudentCode`, and `Level`.
2. Lookup by canonical `ProgressKey`.
3. If canonical lookup returns zero rows, perform legacy lookup by `StudentCode + Level`.
4. If a legacy row is found, migrate it to the canonical key and record operation `migrated_legacy`.
5. Return the canonical `progressKey` and original `saveRequestId` in the response.

## Upsert order (fixes the duplicate `StudentCode` create failure)

The flow run that failed with a duplicate `StudentCode` error was taking the `Create item` branch for a student who already had a `GGR_StudentProgress` row. The flow must be an **upsert keyed on the canonical `ProgressKey`**:

1. Compose `ProgressKey` = `UPPER(ClassCode)|UPPER(StudentCode)|Level` from the request body.
2. `Get items` on `GGR_StudentProgress` with Filter Query `ProgressKey eq '<composed key>'` (Top Count 1, newest first).
3. If a row is returned → `Update item` on that row's ID.
4. If no row is returned → run the legacy lookup (`StudentCode eq '<code>' and Level eq <level>`); if found → `Update item` that row and rewrite its `ProgressKey` (`migrated_legacy`).
5. Only if both lookups return zero rows → `Create item`.

Do not run `Create item` first and fall back to update on error. Also remove any "Enforce unique values" setting on the `StudentCode` column: a student has one row **per level**, so `StudentCode` is not unique. Only `ProgressKey` may be unique.

## Checkpoint columns persisted by SaveProgress

The client payload (built by `shared/sharepoint-sync.js` via `shared/progression-snapshot.js`) now includes the checkpoint fields for the saved level. `GGR_StudentProgress` needs these columns (add any that are missing), and both the `Update item` and `Create item` actions must map them:

| Payload field | List column | Type |
| --- | --- | --- |
| `checkpointStatus` | `CheckpointStatus` | Single line of text (`quiz_available`, `quiz_passed`, …) |
| `quizScore` | `QuizScore` | Number |
| `quizPassedAt` | `QuizPassedAt` | Single line of text (ISO timestamp) |
| `quizAttemptsJson` | `QuizAttemptsJson` | Multiple lines of text (plain) |
| `approvalStatus` | `ApprovalStatus` | Single line of text |
| `approverName` | `ApproverName` | Single line of text |
| `approvalTimestamp` | `ApprovalTimestamp` | Single line of text (ISO timestamp) |
| `progressionStateJson` | `ProgressionStateJson` | Multiple lines of text (plain) |

`GGR_GetDashboardData` must return these columns in each `Progress` row so the Teacher Dashboard checkpoint tabs can show them on any device. `ProgressionMarkersJson` already carries the same state as a fallback.

## GGR_SaveCheckpointApproval (new, optional)

The Teacher Dashboard approval/retake buttons call the `saveCheckpointApproval` endpoint. Until that endpoint is configured, the buttons stay disabled and show an "unavailable" message; nothing is stored in the browser.

Request body:

```json
{
  "studentCode": "HG-NB5-018",
  "classCode": "NB5",
  "level": 2,
  "progressKey": "NB5|HG-NB5-018|2",
  "approvalStatus": "approved",
  "approverName": "Teacher Name",
  "approverEmail": "teacher@example.com",
  "approvalTimestamp": "2026-01-01T00:00:00.000Z"
}
```

The flow must recompute `ProgressKey`, check that the calling teacher is assigned to `ClassCode` (or has `Role=admin` in `GGR_Teachers`), then `Update item` the matching `GGR_StudentProgress` row's `ApprovalStatus`, `ApproverName` and `ApprovalTimestamp`. For `retake_requested`, it should also set `CheckpointStatus` to `quiz_available`. Respond with `{ "ok": true }` or `{ "ok": false, "error": "..." }`.

## Cross-device unlock (`getStudentProgress`)

The game unlocks the next level from the saved `quiz_passed` state on the same device. To unlock on another device, add a `getStudentProgress` endpoint to the student pages' flow endpoints. It receives `{ studentCode, classCode, level }` and returns `{ ok: true, progress: [ ...GGR_StudentProgress rows... ] }`. If this endpoint is not configured, unlocks stay same-device.

## Duplicate handling

If duplicates already exist:

1. select the newest complete record as the authoritative source
2. update exactly one authoritative record
3. log duplicate record identifiers for manual cleanup/reporting
4. do not loop indefinitely across duplicates or retries

## Response behavior

Every branch must terminate through guaranteed `Try / Catch / Finally` response handling.

### Success example

```json
{
  "ok": true,
  "saved": true,
  "operation": "updated",
  "saveRequestId": "7b5bc90a-6d0d-4f8b-a7b4-2d7f8a2f7f8d",
  "progressKey": "NB5|HG-NB5-018|2"
}
```

### Legacy migration success example

```json
{
  "ok": true,
  "saved": true,
  "operation": "migrated_legacy",
  "saveRequestId": "7b5bc90a-6d0d-4f8b-a7b4-2d7f8a2f7f8d",
  "progressKey": "NB5|HG-NB5-018|2"
}
```

### Failure example

```json
{
  "ok": false,
  "saved": false,
  "message": "Duplicate conflict requires manual resolution",
  "saveRequestId": "7b5bc90a-6d0d-4f8b-a7b4-2d7f8a2f7f8d",
  "progressKey": "NB5|HG-NB5-018|2"
}
```

## One-time SharePoint migration steps

1. export and back up the `GGR_StudentProgress` list before changes
2. identify rows with blank `ClassCode`
3. identify rows whose `ProgressKey` still uses legacy format such as `|StudentCode|Level`
4. recalculate canonical `ProgressKey` values where `ClassCode` can be recovered
5. resolve duplicates by retaining the newest complete record
6. enforce uniqueness on canonical `ProgressKey`
7. capture a migration report listing repaired rows and unresolved duplicates

## Diagnostic telemetry contract

The following fields must be preserved across client payloads, flow responses, retry queue items, and console diagnostics:

- `saveRequestId`
- `progressKey`
- `clientTimestampUtc`
- `clientVersion`

The flow must echo `saveRequestId` and canonical `progressKey` in success and failure responses.

## Verification plan

1. one student: perform ten consecutive saves and confirm no indefinite flow runs
2. concurrent multi-student saves: confirm independent saves do not block each other
3. legacy migration: verify a legacy record such as `|HG-NB5-018|2` is found, repaired, and returned as `migrated_legacy`
4. timeout-after-success: verify a timed-out request can later be confirmed as saved without treating the original timeout as definite failure
5. confirm flow runs always end with a response and no indefinite `Apply to each`, `Do until`, `Update item`, or `Response` hangs remain

## Progress retrieval investigation before building `GGR_GetStudentProgress`

Before implementing `GGR_GetStudentProgress`, inspect the actual `GGR_GetDashboardData` response and verify whether each progress record already contains:

- `ProgressionMarkersJson`
- `BadgesJson`
- `CurrentCash`
- `CurrentAssets`
- `SessionStatus`

If those fields are present and sufficient to fully restore student gameplay state, defer `GGR_GetStudentProgress` and document the required restoration parsing work instead.

If those fields are absent or insufficient, produce a follow-up design proposal for `GGR_GetStudentProgress` rather than implementing that flow in this PR.
