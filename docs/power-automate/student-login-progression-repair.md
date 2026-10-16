# Student login and progression deployment guide

## Canonical roster contract

`GGR_Students.Level` is the teacher-assigned starting level from the CSV/JSON
roster. Keep that SharePoint column named `Level`; do not add or rename an
`AssignedLevel` column. The application maps it to API/session
`assignedLevel`. The two new Number columns are `ProgressedLevel` (highest
unlocked, 1–5) and `CurrentLevel` (currently played, 1–5). Until those columns
are deployed, a valid `Level` initializes both fields in the client session;
their absence must not reject login or imply a higher unlock.

`GGR_StudentProgress.Level` is a different field: it identifies the game level
for that progress row and is part of the canonical
`UPPER(ClassCode)|UPPER(StudentCode)|Level` `ProgressKey`. Keep that column,
the existing checkpoint fields/status vocabulary, and the `StudentCode` /
`StudentID` distinction.

## Repository audit

| Area | Fixed or confirmed in this repository | Still requires live deployment / evidence |
| --- | --- | --- |
| Student login | The client accepts `Level`, `level`, or `assignedLevel` (including SharePoint `{Value}` wrappers), rejects invalid/conflicting roster-level aliases, then retains `ok:true`, complete-identity and request-match checks. | `GGR_LoginStudent` must return `Level` as `assignedLevel` from the matched active `GGR_Students` row. Inspect its actual run history to distinguish response mapping from PIN/lookup failure. |
| Session and PIN | PIN hashes are sent to the flow but never included in saved sessions. PIN change continues to require transport success **and** `data.ok === true`; a success-only response is not accepted. | Verify PIN validation, first-time setup/old-PIN requirements, lockout policy, and persistence in `GGR_ChangeStudentPin`. Do not make PIN change update progression. |
| Import/dashboard | CSV/JSON `Level` is checked as an integer 1–5; new/imported records initialize ProgressedLevel and CurrentLevel from that student's validated Level. Dashboard normalization reads the three distinct levels. | Update `GGR_UpsertStudentProfile` and `GGR_GetDashboardData`; ordinary reimport must preserve legitimate progression/current state and credentials. Verify SharePoint internal field names. |
| Starting access | A student may start at their teacher-assigned level (and practice earlier levels) without checkpoints for levels below that assignment. Existing home/game behavior unlocks later levels from `quiz_passed`; approval fields are not currently a mandatory access gate. | Confirm whether teacher approval is intended to gate play. No new teacher-approval gate is introduced here; any policy change must be made consistently in home, game, and remote access. A client-side saved quiz is not backend authorization. |
| Saves and retry | Saves retain per-level `Level`, canonical ProgressKey, request IDs and the existing queue/retry behavior. Student payloads distinguish the played `currentLevel` from roster assignment. | `GGR_SaveProgress` must validate the roster server-side, preserve `GGR_Students.Level` and teacher decision fields, and update only roster CurrentLevel when it is valid and no higher than the stored ProgressedLevel. |
| Restore | Same-device autosave is only loaded when it belongs to the signed-in student. Configured `getStudentProgress` failures are bounded and do not block login. | Remote progress currently restores checkpoint evidence, not the complete game state. Full cloud/cross-device game restore requires a separately verified retrieval payload and mapping. No such live restore is claimed here. |
| Approval and unlock | Existing status strings and progress-row schema remain intact; no per-approval increment is performed in client code. | The approval flow must authenticate/authorize the teacher, verify a passed checkpoint, update one canonical per-level progress row idempotently, and set roster ProgressedLevel to `max(existing, approved checkpoint level + 1)` capped at 5. |
| Flow/deployment | `Current Flow Inventory.docx` contains human-readable flow notes and copied action metadata, not importable/deployable flow definitions. | Deploy and test the flow changes below. A repository build/test cannot prove a live tenant login, SharePoint write, or student gameplay path. |

## Flow contracts to implement and verify

Use the actual actions already present in each flow. The example Power Automate
expressions below deliberately use `<actual action name>` placeholders: replace
them with the action's real name, not a guessed name. Before mapping, inspect
the target list's **internal** column names in List settings/API output.
Renaming a displayed column does not reliably change its internal name.
Never paste a signed trigger URL, API key, student PIN/hash, or unredacted run
history into source control or documentation.

### `GGR_LoginStudent`

Request sent by the app:

```json
{
  "classCode": "CLASS-CODE",
  "studentId": "STUDENT-ID",
  "pinHash": "SHA-256 supplied at runtime"
}
```

Look up an active row using both class and `StudentID`; compare the submitted
hash using the existing credential policy. Do not echo identity/level from the
request. The success response must map the matching roster row:

```json
{
  "ok": true,
  "studentCode": "ROSTER-StudentCode",
  "studentId": "ROSTER-StudentID",
  "studentName": "ROSTER-StudentName",
  "leaderboardName": "ROSTER-LeaderboardName",
  "classCode": "ROSTER-ClassCode",
  "assignedLevel": 2,
  "progressedLevel": 2,
  "currentLevel": 2
}
```

`assignedLevel` is sourced from `GGR_Students.Level`; `progressedLevel` and
`currentLevel` are sourced from their corresponding columns when present and
valid. When either optional field is absent/blank, return `Level` for that
field during migration. Never create an `AssignedLevel` list column or use a
game-save/current-level field as the teacher assignment. Return
`{"ok":false,"message":"..."}` for unknown, inactive, wrong-PIN, or incomplete
identity; never return a success-shaped identity for a negative result.

For a `Level` value wrapped as a SharePoint object, a response mapping can use
the equivalent of:

```text
int(first(body('<actual Get items action name>')?['value'])?['Level'])
```

If the connector returns a Choice/Lookup-style object, select its `Value`
before converting. Confirm the actual output shape in a redacted test run.

### `GGR_ChangeStudentPin`

Normal change request includes `classCode`, `studentId`, `oldPinHash`, and
`newPinHash`. First-time setup includes `classCode`, `studentId`,
`newPinHash`, and `firstTimeSetup:true`, and omits `oldPinHash`. The flow must
independently authorize first-time setup/reset and require the old hash for an
ordinary change. Keep the response contract:

```json
{"ok": true}
```

or:

```json
{"ok": false, "message": "PIN update was not completed"}
```

The frontend requires HTTP/transport success and `ok:true`; `success:true`
alone is not confirmation. Update only credential/lockout fields. Never
advance/reset levels as a side effect of PIN changes.

### `GGR_UpsertStudentProfile` and imports

The dashboard sends JSON properties `studentCode`, `studentId`,
`studentName`, `leaderboardName`, `classCode`, `Level`, `ProgressedLevel`,
`CurrentLevel`, `active`, `teacherEmailPrimary`, and `timestampUtc`.
`studentCode` maps to SharePoint `StudentCode`; `studentId` maps to
`StudentID` (not `StudentCode`). The ordinary roster import supplies `Level`;
the client includes its validated Level as the initial-state suggestion for
both new progression columns.

Implement an upsert by `StudentCode` and apply this policy on the server:

1. Validate `Level` as an integer 1–5. On create set SharePoint `Level`,
   `ProgressedLevel`, and `CurrentLevel` to that value.
2. On ordinary reimport, update teacher-assigned `Level` from the import.
   Preserve an existing valid ProgressedLevel and CurrentLevel; initialize
   only blank/missing new fields from that student's own valid `Level`.
   Ensure `ProgressedLevel` is at least the newly assigned Level. Keep
   CurrentLevel only if it remains valid and no higher than ProgressedLevel;
   otherwise set it to the assigned Level.
3. Do not overwrite PIN/hash, active/lockout state, or progression based on
   default values sent by an ordinary reimport. Treat a teacher reset as a
   separate explicitly authorized operation, not as a side effect of import.
4. If a teacher changes a student's assigned Level, make that reassignment
   visible in the result/audit trail. The higher of existing progression and
   new assignment is retained. To intentionally remove old unlocks, the
   teacher must run the explicit reset process below.

An import of ProgressedLevel/CurrentLevel from CSV/JSON is not currently an
authorized progression import. Do not treat those columns as trusted unlock
authority. If that workflow is later required, use a separately authorized
admin operation with validation and audit logging.

### `GGR_GetDashboardData`

Return the existing `Students`, `Teachers`, and `Progress` arrays. Each student
row must contain distinct `StudentCode` and `StudentID`, `StudentName`,
`LeaderboardName`, `ClassCode`, `Level`, `ProgressedLevel`, `CurrentLevel`,
and status needed by the existing dashboard. The app exposes canonical
`assignedLevel` from `Level`, with the other two canonical names unchanged.
Return progress rows with their own per-record `Level`, canonical
`ProgressKey`, and existing checkpoint fields
(`CheckpointStatus`, `QuizScore`, `QuizPassedAt`, `QuizAttemptsJson`,
`ApprovalStatus`, `ApproverName`, `ApprovalTimestamp`, and
`ProgressionStateJson`). Do not replace those fields with new duplicate
approval columns or change the existing `pending`, `approved`, and
`retake_requested` vocabulary.

### `GGR_SaveProgress` and progress retrieval

The save request retains `studentCode`, `classCode`, per-record `level`,
`currentLevel`, `rosterAssignedLevel`, `progressKey` (diagnostic only),
`saveRequestId`, game state, and existing checkpoint/snapshot fields. The
server must:

* revalidate active roster identity/class and `level` (integer 2–5);
* derive `ProgressKey = UPPER(ClassCode)|UPPER(StudentCode)|Level` on the
  server, migrate legacy keys safely, and upsert idempotently using
  `saveRequestId`/canonical key;
* keep `GGR_StudentProgress.Level` as the game-level dimension;
* never write a student's supplied `rosterAssignedLevel` back to
  `GGR_Students.Level`, and never let a student save overwrite teacher-owned
  approval fields;
* update only `GGR_Students.CurrentLevel` after checking it does not exceed
  the stored valid ProgressedLevel. Do not accept a client-supplied
  ProgressedLevel as authorization or change ProgressedLevel during autosave.

Preserve existing response semantics, including `ok:false` for explicit
rejections and the same `saveRequestId` for safe retries. A missing
`getStudentProgress` endpoint means same-device checkpoint recovery only; it
must not stall login. If configured, retrieval receives
`{studentCode,classCode,level}` and returns
`{"ok":true,"progress":[...GGR_StudentProgress rows...]}`. Filter and authorize
the roster student/class in the flow. That contract currently supports
checkpoint retrieval; do not describe it as full game-state/cloud restore
unless the returned game-state fields are present and actually hydrated.

### `GGR_SaveCheckpointApproval` and teacher reset

Keep the current approval request names:
`studentCode`, `classCode`, `level` (the progress-row level),
`progressKey`, `approvalStatus`, `approverName`, `approverEmail`, and
`approvalTimestamp`. Keep lower-case `approved` and `retake_requested`.
Recompute the key on the server, authorize the active teacher against
`GGR_Teachers`/class membership (or verified admin role), and verify the
checkpoint passed before approval. Do not trust browser session fields or the
shared API key as proof of teacher identity.

The current client unlock behavior treats `quiz_passed` as sufficient, even
when an approval-status value is absent; this patch does not silently convert
the optional review flow into a mandatory gate. Confirm the intended policy
with teachers before changing it. When an authorized approval is the
progression event under that policy, use a conditional update/ETag or
equivalent serialization to prevent duplicate or concurrent decisions from
incrementing twice. For approval of checkpoint level `N`, set roster
ProgressedLevel to `max(valid stored ProgressedLevel, min(5, N + 1))`; never
use `ProgressedLevel + 1`. Repeated or out-of-order approvals are idempotent and
cannot downgrade progression. Level 5 approval remains capped at 5.
`retake_requested` changes only the existing progress/checkpoint status fields
according to the current flow's policy; it does not lower roster progression.
Approval does not change teacher-assigned `Level` or student `CurrentLevel`.

No deployed teacher-reset endpoint is defined in the repository. If reset is
needed, deploy a separately authenticated teacher/admin flow that confirms
student/class, sets `ProgressedLevel` and `CurrentLevel` to the current valid
roster `Level`, and applies an explicitly chosen policy to per-level checkpoint
rows. Require confirmation/audit logging and do not touch PIN fields. Do not
invent a client endpoint name or imply this reset exists.

## Safe deployment and verification

1. Export/back up `GGR_Students` and `GGR_StudentProgress`. Record the real
   internal names for all mapped columns. Keep `Level` unchanged. Add
   `ProgressedLevel` and `CurrentLevel` as Number columns.
2. Backfill only rows where each new field is blank, using that row's own
   validated `Level` 1–5. Do not bulk-set all students to 2. Preserve existing
   higher valid progression/current state; quarantine invalid rows for teacher
   review.
3. Update/deploy flows in order: profile upsert and dashboard retrieval;
   login response mapping; PIN response confirmation; save/retrieval; approval
   and (if needed) separate teacher reset. Verify exact connector internal
   names and response shape after each deployment.
4. Keep a rollback export. If a flow fails, restore its prior version and the
   backup data rather than renaming `Level` or deleting per-level progress.
   The existing shared endpoint registry contains signed trigger URLs; assume
   these values are already public and rotate them in the tenant. Do not copy
   trigger URLs or keys into a PR. GitHub Pages runtime configuration is
   browser-visible, not confidential; move sensitive calls behind an
   authenticated server-side service rather than republishing them as build
   secrets.
5. Inspect each flow's live run history with identifiers and credentials
   redacted. No flow definitions or tenant run history are available to this
   repository change, and no real student credentials or tenant rows were
   changed here.
6. Teacher smoke test using a designated test roster row: change PIN, log out,
   log in with the changed PIN; confirm returned `assignedLevel` equals that
   row's SharePoint `Level`; open its assigned game; save; reload on the same
   browser and verify only that student's save returns; test a second device
   separately and record whether only checkpoint data or full game state is
   available; pass a checkpoint and have an authorized teacher approve it;
   verify one monotonic unlock/read-back; finally practice an earlier level
   without changing roster `Level`. Stop and inspect the flow/list on any
   mismatched identity, negative response, or duplicate write. This is a
   deployment checklist, not evidence that the live tenant has passed it.
