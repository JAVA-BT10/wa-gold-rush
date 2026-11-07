# GGR_SaveProgress Repair Spec

> **Per-level architecture (draft):** browser saves are now one slot per Class|Student|Level. The planned server-authoritative revision/idempotency protocol, full student-scoped restore and other future flows are specified in [save-protocol-v2](save-protocol-v2.md), [flow-registry-and-contracts](flow-registry-and-contracts.md) and the [future-state architecture](../architecture/future-state-architecture.md). They are gated OFF and not live-verified.

> **Historical legacy repair reference, not rollout instructions.** Unconditional
> upsert guidance below must not be used on protected slots. Current clients
> hold legacy/unverified cloud writes; old cached writers must be refused
> server-side. Follow the single [phased operations runbook](../operations/release-and-acceptance.md)
> for authentication, conditional writes, migration and retrieval before activation.

## Scope of this PR

This repository PR adds client-side reliability, telemetry, queue normalization, and documentation for `GGR_SaveProgress`.

The following remain manual, flow-side, or otherwise out of scope for this PR:

- Power Automate flow edits and deployment
- SharePoint data migration and duplicate cleanup execution
- `GGR_LoginStudent` flow changes (the client now **requires** it — see [Student identity prerequisites](#student-identity-prerequisites-ggr_loginstudent--ggr_students))
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

## Student identity prerequisites (`GGR_LoginStudent` / `GGR_Students`)

The client no longer creates student sessions locally. A student can only play, take checkpoint quizzes, or save after `GGR_LoginStudent` validates Class Code + Student ID + PIN hash against `GGR_Students`. The client rejects the login unless the response is:

```json
{
  "ok": true,
  "studentCode": "HG-NB5-018",
  "studentId": "123456",
  "studentName": "Alex Smith",
  "leaderboardName": "Golddigger",
  "classCode": "NB5",
  "assignedLevel": 2
}
```

- All six identity fields are required and must come from the `GGR_Students` row (never echoed from the request).
- `studentCode` / `classCode`: letters, digits, and inner hyphens only (no spaces or `|`).
- `assignedLevel`: integer 1–5 (the roster level). It is separate from the level being played, which SaveProgress receives as `level` (2–5) with `rosterAssignedLevel` alongside it.
- `studentId` and `classCode` in the response must match the request, or the client rejects the login.
- Return `ok:false` with a `message` for an unknown student, a wrong PIN, or an inactive student. The client never stores PINs or PIN hashes.

The browser session is not a server-issued token, so `GGR_SaveProgress` must still re-validate identity against `GGR_Students` on every write. See the checklist below.

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
| `progressionStateJson` | `ProgressionStateByLevel` (observed internal name; confirm tenant type/mapping) | JSON-bearing text; verify actual column configuration |

**Teacher decisions are owned by GGR_SaveCheckpointApproval.** The student's browser never learns of a teacher decision, so its payload always carries its own local `approvalStatus` (`pending` after a pass). To stop student saves from undoing approvals, SaveProgress must follow these rules:

- **Create item:** map `ApprovalStatus`, `ApproverName` and `ApprovalTimestamp` from the payload. These start as `pending`/blank.
- **Update item:** never write `ApprovalStatus`, `ApproverName` or `ApprovalTimestamp`. Keep the existing column values.
- **Update item when the existing `ApprovalStatus` is `retake_requested`:** keep the existing `CheckpointStatus` unless the payload's `quizPassedAt` is later than the row's `ApprovalTimestamp`, which means the student passed the retake. If the student did pass the retake, write `CheckpointStatus` and set `ApprovalStatus` back to `pending`.

`GGR_GetDashboardData` must return these columns in each `Progress` row so the Teacher Dashboard checkpoint tabs can show them on any device. `ProgressionMarkersJson` already carries the same state as a fallback.

## GGR_SaveCheckpointApproval (new, optional)

The Teacher Dashboard approval/retake buttons call the `saveCheckpointApproval` endpoint. Until that endpoint is configured, the buttons stay disabled and show an "unavailable" message; nothing is stored in the browser.

**Current mode is direct browser integration, not confidential.** GitHub Actions reads `WA_GGR_SAVE_CHECKPOINT_APPROVAL_URL` and `WA_GGR_API_KEY`, then publishes their values in the Pages `teacher/runtime-config.js`. They remain out of tracked source but are visible in downloaded JavaScript/devtools and network requests. The browser has generated JS values, not access to Actions environment variables. Do not commit or log credentials. Preserve this deployment wiring until an authenticated backend is deployed; see the [SHA-pinned approval audit and migration contract](checkpoint-approval-security.md). GitHub Pages cannot host that confidential backend.

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

The flow must recompute `ProgressKey`, check that the calling teacher is assigned to `ClassCode` (or has `Role=admin` in `GGR_Teachers`), then `Update item` the matching `GGR_StudentProgress` row's `ApprovalStatus`, `ApproverName` and `ApprovalTimestamp`. These are server-side requirements, not verified properties of the deployed flow. Browser-supplied `approverEmail`, role, class checks and `sessionStorage` are not authenticated identity proof; neither the shared API key nor CORS authenticates an individual teacher. The migration must verify an authenticated active teacher and current role/class authorization, validate the target student/level/decision, and derive reviewer fields and timestamp server-side while retaining this flow payload shape. For `retake_requested`, the flow should also set `CheckpointStatus` to `quiz_available`. Respond with `{ "ok": true }` or `{ "ok": false, "error": "..." }` without leaking credentials or internal errors.

## Cross-device unlock (`getStudentProgress`)

The game unlocks the next level from the saved `quiz_passed` state on the same device. To unlock on another device, add a `getStudentProgress` endpoint to the student pages' flow endpoints. It receives `{ studentCode, classCode, level }` and returns `{ ok: true, progress: [ ...GGR_StudentProgress rows... ] }`. If this endpoint is not configured, unlocks stay same-device.

## Validation before lookup

Before any `Get items` / `Create item` / `Update item`:

1. Reject (`ok:false`, HTTP 400 or 422) when `classCode` is blank, `studentCode` is blank or malformed, or `level` is not an integer 2–5. Never default `level` to 1.
2. Look up `GGR_Students` by `StudentCode` and reject (`ok:false`) if there is no active row or if its `ClassCode` differs from the request.
3. Recompute the canonical `ProgressKey` (do not trust the client `progressKey`).

The client treats HTTP 400/410/422 and any `ok:false` body (even at HTTP 200) as a **permanent rejection**. It quarantines the save in `wa_gr_sync_quarantine` and does not retry. Return `ok:false, retryable:true` only for transient conditions such as throttling. Timeouts, network errors, 404/409 (missing endpoint / create conflict), and 5xx responses are retried with the same `saveRequestId`.

## Concurrent create recovery

If two requests for the same key race and `Create item` fails because of the unique `ProgressKey` constraint, **do not create again**. Re-run `Get items` by the canonical `ProgressKey` and `Update item` on the row that is returned (`operation: "updated_after_conflict"`).

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
6. submit a save with blank `classCode`, blank `level`, or an unknown `studentCode` and confirm `ok:false` with no list write
7. send two simultaneous first saves for one student and level and confirm exactly one `GGR_StudentProgress` row exists afterwards

## Backend deployment checklist (not changed by repo PRs)

- [ ] `GGR_LoginStudent` returns authoritative `studentCode`, `studentId`, `studentName`, `leaderboardName`, `classCode`, `assignedLevel` from `GGR_Students`
- [ ] `GGR_LoginStudent` returns `ok:false` for an unknown, inactive, or wrong-PIN student
- [ ] `GGR_SaveProgress` validates ClassCode / StudentCode / Level (and the `GGR_Students` row) before any lookup or write
- [ ] `GGR_SaveProgress` upserts by the canonical server-computed `ProgressKey`
- [ ] concurrent create conflicts re-read and update the canonical row rather than creating duplicates
- [ ] `StudentCode` column is not unique; `ProgressKey` is unique
- [ ] `GGR_Students` remains the only source of student identity truth
- [ ] malformed or incomplete identity is rejected before any write attempt

## Progress retrieval findings and boundaries

User-supplied tenant evidence reports a complete correct record from
`GGR_GetDashboardData` Response_2, including:

- `ProgressionMarkersJson`
- `BadgesJson`
- `CurrentCash`
- `CurrentAssets`
- `SessionStatus`

Full state already travels in `ProgressionMarkersJson`; summary columns are not
the only saved state. Do not reconstruct precise economy from rounded totals.

That evidence does **not** establish a historical dashboard-to-playable-game
restore path. Current home login normalizes roster identity and progression,
not economy; the same normalizer predates per-level saves. Dashboard hydration
is teacher-scoped. Never send dashboard datasets/endpoints to student pages.

`GGR_GetStudentProgress` full retrieval remains planned/unverified and optional/
unconfigured in the repository. It requires authenticated exact-slot lookup
and `ggr.getStudentProgress.v2` with validated `save` envelope, persistent
revision and explicit matched `found:false` only for confirmed absence.
Deploying it is a tenant operator action, after server write protection, not
proof that adding an endpoint or login response field restores games safely.
