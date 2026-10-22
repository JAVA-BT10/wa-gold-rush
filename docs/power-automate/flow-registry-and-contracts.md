# Flow registry and contracts (current, planned and unverified)

> **Status legend:**
>
> | Label | Meaning |
> | --- | --- |
> | **Existing endpoint** | A URL default or runtime override exists in repository config. That is **not** evidence that the flow behaves as documented. |
> | **Optional / unconfigured** | The client has a hook for the flow, but no production URL is configured. |
> | **Planned** | Proposed name and contract only. No flow exists, and the client never calls it, because of a feature flag that defaults OFF plus endpoint resolution. |
>
> No flow below is live-verified by this PR. `Current Flow Inventory.docx` contains notes, not importable definitions.
>
> Registry keys come from `shared/level-capabilities.js` (`FLOWS`). Endpoints are resolved by `shared/flow-endpoints.js` and `teacher/dashboard-config.js`; placeholder values (`REPLACE-WITH…`) and empty strings mean *unconfigured* and the client does not call them.
>
> Architecture context: [future-state-architecture](../architecture/future-state-architecture.md). The save concurrency rules are in [save-protocol-v2](save-protocol-v2.md).

## Cross-cutting rules (apply to every flow)

1. **Authentication prerequisite:**
   - `X-GGR-Key` and Pages-injected URLs are public browser configuration, not user authentication. See [checkpoint-approval-security](checkpoint-approval-security.md); that guidance is retained.
   - A request whose class/student fields match its source is **not** an authenticated server session. Every student-scoped flow needs a server-verifiable student proof before it is enabled for data that is restorable or competitive. Candidates are a short-lived signed session token issued by `GGR_LoginStudent`, or Entra-backed auth. Every teacher-scoped flow needs a server-verifiable teacher proof.
   - Until that exists, read flows that expose a full save to students must stay disabled (`fullCloudRestore` OFF).
2. **The server recomputes the key.** It computes `ProgressKey = UPPER(ClassCode)|UPPER(StudentCode)|Level` itself. A client-supplied `progressKey` is used for diagnostics and for agreement checks only.
3. **Verify internal column names** in List settings / the REST `$select` output before mapping. A display name change does not change the internal name. Placeholders like `<actual action name>` stand for the real action names in your flow; do not guess them.
4. **Bounded responses:**
   - Every flow returns a JSON body with `ok` and a machine-readable `code` within the client timeout.
   - Use *Response* actions on every branch, including failure branches (configure-run-after on failed/timed-out).
   - A timeout is an **unknown outcome**, never "not saved" and never "not found".
5. **Private fields** must never appear in any response, log or public record: `StudentName` (except in teacher responses), `StudentID` (teacher only), PIN, PIN hash, salt, signed URLs, API keys.
6. **No secrets or tenant traces in source.** Never paste a signed trigger URL, API key, student PIN/hash or unredacted run history into the repository.
7. **Versioned capability:** new behaviour is negotiated through `contractVersion` / `protocolVersion` in the request and must be echoed in the response. Otherwise the client classifies the response as unconfirmed or incomplete and fails closed.

## Inventory

| Flow | Registry key | Repo status | Caller(s) | Flag / gate |
| --- | --- | --- | --- | --- |
| GGR_LoginStudent | `loginStudent` | Existing endpoint | `index.html` via `shared/student-auth-client.js` | — |
| GGR_LoginTeacher | `loginTeacher` | Existing endpoint | `teacher/dashboard-state.js` | — |
| GGR_ChangeStudentPin | `changeStudentPin` | Existing endpoint | `index.html` | — |
| GGR_UpsertStudentProfile (+ CSV/JSON imports) | `upsertStudentProfile` | Existing endpoint | teacher dashboard | — |
| GGR_UpsertTeacher | `upsertTeacher` | Existing endpoint | teacher dashboard | — |
| GGR_SaveProgress | `saveProgress` | Existing endpoint (legacy contract) | `shared/sharepoint-sync.js` | v2 fields only with `saveProtocolV2` |
| GGR_GetDashboardData | `getDashboardData` | Existing endpoint | teacher dashboard | — |
| GGR_TeacherUnlockStudent | `teacherUnlockStudent` | Existing endpoint | `teacher/dashboard-state.js` | — |
| GGR_SaveCheckpointApproval | `saveCheckpointApproval` | Optional; injected at Pages build if the secret exists | `teacher/checkpoint-approval.js` | — |
| GGR_GetStudentProgress | `getStudentProgress` | Optional / unconfigured | access guard (checkpoint compatibility mode); `shared/cloud-restore.js` (v2) | v2 restore needs `fullCloudRestore` |
| GGR_TeacherResetStudentPin | `teacherResetStudentPin` | Optional / unconfigured (placeholder) | none in production | — |
| GGR_RebuildLevelLeaderboard_OnProgressChange | `rebuildLeaderboardOnProgressChange` | Optional / unconfigured (placeholder) | none (trigger-based concept) | — |
| GGR_UpsertInvestmentProfile_OnProgressChange | `upsertInvestmentProfileOnProgressChange` | Optional / unconfigured (placeholder) | none | — |
| GGR_ImportAuditLogger | `importAuditLogger` | Optional / unconfigured (placeholder) | none | — |
| GGR_ResetLevelProgress | `resetLevelProgress` | **Planned** | none | `levelResetFlow` |
| GGR_GetLeaderboard | `getLeaderboard` | **Planned** | none | `serverLeaderboard` |
| GGR_CopyCompetitionSnapshot | `copyCompetitionSnapshot` | **Planned** | none | `competitionSnapshots` |
| GGR_Level6HistoricalResults | `level6HistoricalResults` | **Planned** | none | `level6Analytics` |

Notes on the optional flows:

- The rebuild-leaderboard, investment-profile and audit flows are listed with placeholders in `teacher/dashboard-config.js`. They are not labelled complete.
- If they are built, the rebuild flow should be replaced by, or must agree with, the per-level ranking rules below. A materialised leaderboard list must never rank by roster level fields.

---

## GGR_LoginStudent

- **Status:** Existing endpoint. Behaviour for the three-level fields is per [student-login-progression-repair](student-login-progression-repair.md) and is not verified here.
- **Request:** `{ classCode, studentId, pinHash }`, plus existing optional fields. The PIN hash is transport only and is never stored in the session.
- **Response (success):**
  ```json
  { "ok": true, "studentCode": "…", "studentId": "…", "studentName": "…",
    "leaderboardName": "…", "classCode": "…", "assignedLevel": 2,
    "progressedLevel": 3, "currentLevel": 3 }
  ```
  - `assignedLevel` comes from `GGR_Students.Level`.
  - It must **not** echo the PIN, hash, salt or any economy.
  - Future: a short-lived signed student session token, for the authentication prerequisite.
- **Errors:** `{ ok:false, code:'invalid_credentials'|'inactive'|'locked'|'server_error' }`. Errors are generic; no user enumeration.
- **Columns to verify:** `Level`, `ProgressedLevel`, `CurrentLevel`, `Active`, `LeaderboardName`, `StudentCode`, `StudentID`, `ClassCode`, `PinHash` (internal names).
- **Ownership:** match one active row by Class + StudentID. Duplicates → fail closed.
- **Level 6:** while Level 6 is planned, the login validator keeps 1–5. A stored `ProgressedLevel`/`CurrentLevel` of 6 must not be produced by any flow. If one exists, the client falls back to `assignedLevel` without rejecting the session.
- **Acceptance:**
  - valid login returns complete identity and levels;
  - wrong PIN → generic error;
  - response contains no PIN or hash;
  - the session stores no PIN.
- **Rollback:** previous flow version; the client is unchanged.

## GGR_UpsertStudentProfile (and imports)

- **Status:** Existing endpoint.
- **Request:** camelCase `studentCode`, `studentId`, `studentName`, `leaderboardName`, `classCode`, `Level`, `active`, `teacherEmailPrimary`, `timestampUtc`.
- **Rules:**
  - An ordinary re-import **preserves** `ProgressedLevel`, `CurrentLevel`, PIN hash/salt and lockout state.
  - New rows initialise `ProgressedLevel = CurrentLevel = Level`.
  - Defaults never escalate privilege. A missing column ≠ 1, and an import never raises `ProgressedLevel` unless it is an explicit, authorised teacher action.
  - Never writes economy fields.
- **Auth:** teacher session with class scope (server-verified, planned).
- **Acceptance:**
  - a re-import of an existing student leaves unlocks and credentials unchanged;
  - a Level 6 value is rejected while it is planned.
- **Rollback:** previous version; restore the roster backup.

## GGR_SaveProgress

- **Status:** Existing endpoint, legacy contract (the [repair spec](GGR_SaveProgress-repair-spec.md) applies). v2 is **planned** and needs [save-protocol-v2](save-protocol-v2.md) on the server before `saveProtocolV2` is turned ON.
- **Legacy request (default):** per-level payload with `classCode`, `studentCode`, `level` (the game played for **this** request), `progressKey` (diagnostic), `saveRequestId`, economy summary (integers), `progressionMarkersJson` (snapshot incl. optional `run`), checkpoint fields, `clientTimestampUtc`.
- **v2 additions:** `protocolVersion:2`, `runGeneration`, `runId`, `baseRevision` (null = create-only), `contentHash`, `startingNetWorth`, `storageSchemaVersion`.
- **v2 responses:**
  - **Success:** `{ ok:true, protocolVersion:2, saveRequestId, progressKey, runGeneration, revision, deduplicated? }`
  - **Errors:** `{ ok:false, protocolVersion:2, code, currentRevision?, currentGeneration? }`, where `code` is one of `revision_conflict`, `row_exists`, `precondition_failed`, `generation_stale`, `request_id_reused`, `invalid_request`, `identity_mismatch`, `server_error`.
  - A legacy-shaped `200` is **unconfirmed** for v2.
- **Server rules:**
  - Validate the roster row and that `level` ≤ the roster's highest unlocked level (or the assigned level).
  - Recompute the key.
  - Never write `GGR_Students.Level`.
  - Optionally update roster `CurrentLevel` only when valid and ≤ `ProgressedLevel`. This is a preference, never routing.
  - Preserve teacher approval fields; a student save cannot downgrade them.
  - Migrate legacy keys per the repair spec.
- **Columns to add or verify (progress list, internal names):**
  - `ProgressKey` (unique, indexed), `Revision` (Number), `RunGeneration` (Number), `RunId` (Text), `StartingNetWorth` (Number), `ContentHash` (Text), `LastSaveRequestId` (Text), `LeaderboardStatus` (Choice/Text), `StorageSchemaVersion` (Number);
  - existing: `Level`, `ClassCode`, `StudentCode`, `NetWorth`, `CurrentRound`, `ProgressionMarkersJson`, checkpoint columns.
  - Only add index columns that are actually queried.
- **Acceptance:** see the [tenant acceptance matrix](../operations/release-and-acceptance.md#tenant-acceptance-matrix), rows S1–S12.
- **Rollback:** keep v2 columns. Turn `saveProtocolV2` OFF; the client holds v2 queue items and does not replay them. **Never** re-enable the old shared-slot browser writer against vNext rows.

## GGR_GetStudentProgress

- **Status:**
  - Checkpoint-only compatibility mode: optional/unconfigured.
  - Full exact-slot retrieval (`ggr.getStudentProgress.v2`): **planned and unverified**.
- **Request (v2):** `{ contractVersion:'ggr.getStudentProgress.v2', mode:'full_save', classCode, studentCode, level, progressKey }`, plus the student auth proof (prerequisite).
- **Responses (v2):**
  - **Found:**
    ```json
    { "ok": true, "contractVersion": "ggr.getStudentProgress.v2",
      "found": true, "progressKey": "…", "revision": 7, "runGeneration": 1,
      "save": { "kind": "wa_gr_level_save", "storageSchemaVersion": 1, "…": "…" } }
    ```
  - **Definitively missing:** `{ ok:true, contractVersion, found:false, progressKey }`. Return this only after a successful, complete query that returned zero rows for that exact key.
  - **Failure:** `{ ok:false, contractVersion, code:'unauthorized'|'identity_mismatch'|'server_error'|'timeout' }`. A response without the matching `contractVersion` is classified `incomplete`, never missing.
  - `save` is the complete envelope as stored by the client (identity, level, progressKey, generation, runId, startingNetWorth, snapshot). If `runGeneration` is present it must equal `save.generation`. A missing response may include `runGeneration` (the server's current generation, e.g. after a reset).
- **Auth:** student scope only. The server derives the identity from the auth proof and refuses a mismatched class/student. Never return another student's row. **Never** expose `GGR_GetDashboardData` for this purpose.
- **Private fields:** the response includes no `StudentName`, `StudentID` or credentials.
- **Acceptance:**
  - found / missing / failure are each distinguishable;
  - a timeout is not missing;
  - a partial checkpoint-only response is classified `incomplete`;
  - a cross-student request is refused.
- **Rollback:** turn `fullCloudRestore` OFF; the access guard's compatibility mode continues.

## GGR_GetDashboardData

- **Status:** Existing endpoint. Per-level rows and baseline fields are **unverified**.
- **Response:** `{ ok:true, students:[…roster incl. three level fields…], progress:[{ProgressKey, ClassCode, StudentCode, Level, NetWorth, CurrentRound, StartingNetWorth, Revision, RunGeneration, LeaderboardStatus, LastPlayed, checkpoint fields}] }`. It returns one row per `ProgressKey` and no economy on roster rows.
- **Auth:** teacher-only, with class scope enforced **on the server**. The dashboard's class filter is display-only.
- **Acceptance:**
  - one student with Level 2 and Level 4 rows appears on both boards;
  - a teacher from another class sees neither row.
- **Rollback:** previous version. The client tolerates missing baseline fields; profit and ROI become unrankable.

## GGR_SaveCheckpointApproval

- **Status:** Optional and injected at build. Security limits are in [checkpoint-approval-security](checkpoint-approval-security.md).
- **Rules:**
  - The teacher must be authorised for the class.
  - The approval updates one canonical per-level row idempotently.
  - `ProgressedLevel = max(existing, level + 1)`, capped at the **highest enabled playable level**, which is currently 5. This keeps the Level 5 → 6 unlock capped.
  - No implicit policy change: quiz pass remains sufficient for access.
  - A student save never overwrites teacher decision fields.
- **Acceptance:**
  - a repeat approval is a no-op;
  - approving Level 5 never sets 6;
  - another class's teacher is refused.

## GGR_ResetLevelProgress (planned)

- **Purpose:** an authorised, audited reset of **one** level for one student.
- **Request:** `{ classCode, studentCode, level, expectedRevision, expectedGeneration, reason, confirm:'RESET <level>' }`, plus the teacher (or student self-service, if policy allows) auth proof.
- **Effect (single conditional update):**
  - Archive the current row's snapshot, either to `GGR_ProgressArchive` or as a JSON copy;
  - set `RunGeneration = +1`, a new server `RunId`, `Revision = +1`, and `StartingNetWorth` = the level's configured starting cash;
  - write an audit record.
  - Preserve PIN/credentials, `ProgressedLevel`, other levels and approval history.
- **Response:** `{ ok:true, progressKey, runGeneration, runId, revision }`.
- **Generation protection:** subsequent saves with an older generation → `generation_stale`.
- **Client:** the call is gated by `levelResetFlow`. Until then, "Restart This Level" is local, and under v2 the restarted level fails closed (see architecture §12).
- **Acceptance:**
  - a pre-reset queued save is rejected;
  - other levels are unchanged;
  - an unauthorised caller is refused;
  - a double submit is idempotent.

## GGR_GetLeaderboard (planned)

- **Request:** `{ classCode(s), level, metric:'netWorth'|'profit'|'roi', limit }`, plus the auth proof.
- **Response:** `{ ok:true, level, metric, rows:[{rank, leaderboardName, classCode, level, value, netWorth, startingNetWorth, round, strategyLabel, lastPlayed}], excludedCount, unrankableCount }`.
- **Rules:** the same as `shared/leaderboard.js` (implemented and mock-tested client-side), with class scope enforced server-side. The response never contains `StudentName`, `StudentID`, `StudentCode` or credentials.
- **Gate:** `serverLeaderboard`.

## GGR_CopyCompetitionSnapshot (planned)

- **Request:** `{ competitionId, classCodes, level, metric, scoringVersion, cutoffUtc, rules }`, plus teacher auth.
- **Effect:**
  - Copy the ranked rows as they stand at the cutoff into an immutable `GGR_CompetitionResults` record set, with rules and scoring version.
  - Never modify progress rows.
  - This **does not** create a separate live game and cannot create equal fresh starts (see architecture §9).
- **Gate:** `competitionSnapshots`.

## GGR_Level6HistoricalResults (planned)

- **Purpose:** versioned Level 6 event, decision and mastery analytics.
- **Request:** `{ progressKey, runGeneration, runId, contentVersion, scoringVersion, rngSeedId, events:[…], decisions:[…] }`.
- **Rules:**
  - The server recomputes or validates mastery components.
  - A client-asserted `masteryScore` is **never** authoritative for competitive ranking.
  - Bounded payloads, with archival of the event log.
- **Details:** see the [Level 6 blueprint](../architecture/level-6-goldfields-mastery-blueprint.md#flows-data-and-telemetry). Gated by `level6Analytics`.

## Other existing optional flows (inventory only)

| Flow | Notes / dependencies |
| --- | --- |
| GGR_TeacherUnlockStudent | Must follow the same monotonic, capped-at-highest-playable rule as approval. |
| GGR_TeacherResetStudentPin | Resets credentials only; must not touch progress or unlocks. |
| GGR_RebuildLevelLeaderboard_OnProgressChange | If built, rank per-level rows per the rules above. |
| GGR_UpsertInvestmentProfile_OnProgressChange | Key per Class\|Student\|Level (the browser profile currently uses Student+Level — see the architecture). |
| GGR_ImportAuditLogger | Must never log PIN/hash or full payloads containing them. |

## Legacy status mapping

- **Existing v1 statuses keep their meaning.** HTTP 400/410/422 or `ok:false` → quarantine. 5xx, timeout or network failure → retry queue, with the outcome *unknown*.
- **v2-specific handling** applies only to v2 payloads with a v2 response:
  - `409`/`412` or a conflict code → conflict, held for reconciliation;
  - `generation_stale` → discard as superseded;
  - `request_id_reused` → reject.
