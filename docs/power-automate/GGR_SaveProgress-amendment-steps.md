# GGR_SaveProgress: action-by-action amendment guide

**Status: build instructions, not a deployed or tenant-tested flow.**
This guide uses the owner's Nov 8 decision to retain the existing API-key
check for this repair. It does not change login. The key does not authenticate
an individual student; roster checks below validate the addressed row, not
the caller's identity.

This supersedes the simplified writer instructions in the repair plan:
`LastSaveRequestId` alone cannot recover an old acknowledgement after a newer
save. A same-run, higher-round local game is not automatically safe to upload.
Do not replay stranded saves or enable client flags while building this flow.

## 1. Preserve the current flow and confirm tenant details

1. Export `GGR_SaveProgress` with its connection references and settings.
   Save the export privately, together with the current Lists backup.
2. Use **Save as** to create an isolated amendment/test copy. Keep its URL
   private. Do not point the live game at this copy yet.
3. Record the SharePoint **Site Address** used by the current connector.
   Use this same site, not a new Azure service.
4. In List settings, record the internal names, types, required settings and
   choice values for every column currently written. Confirm especially
   `CheckpointStatus`, `SessionStatus`, `QuizPassedAt`, `LaastPlayedUtc`,
   `UpdatedUtc`, `ProgressionStateByLevel`, `Score`, and `Score0`.
   Do not rename the misspelled `LaastPlayedUtc` column.
5. Check all other writers, including `GGR_SaveCheckpointApproval`.
   Before pilot activation, obsolete unconditional progress writers must be
   disabled/refused. Approval writers must update only their intended fields
   and preserve the revision/run/receipt metadata.
6. Keep trigger concurrency at its existing setting initially. Degree 1 is
   not a replacement for the conditional write below, and can recreate a
   backlog. Measure throughput and response latency before choosing it.

**Verification boundary:** the owner-supplied definition establishes the old
action logic, not the complete List schema or REST error shape. The REST write
body in section 9 cannot be finalized until the column types/internal names
above are confirmed. Do not guess them.

## 2. Prepare the Lists, without bulk-resetting existing records

In `GGR_StudentProgress`, add these columns if absent:

| Create with this name | Type | Purpose |
| --- | --- | --- |
| `Revision` | Number, 0 decimal places | Server-assigned accepted-save revision |
| `RunGeneration` | Number, 0 decimal places | Existing run generation |
| `RunId` | Single line of text | Existing run identity |
| `LastSaveRequestId` | Single line of text | Most recent committed request |
| `LastRequestBodyJson` | Multiple lines, plain text, append changes OFF | Exact binding of that committed request, including its base revision |

New column defaults must not make old rows look migrated. Leave them blank
until an approved migration initializes them. For each backed-up existing row:

1. Validate the full `ProgressionMarkersJson`, row identity, played level,
   canonical key and existing run identity.
2. Copy the snapshot's existing `run.runId` and `run.generation` into the new
   run columns. Do not allocate a new run for valid historical state.
3. Set `Revision` to 1 **once**, only on a validated, not-yet-migrated row.
   Leave the two last-request fields blank for this initial migration.
4. Record source version/checksum and migration result privately. Preserve the
   source snapshot. Do not rerun initialization over an existing revision.
5. Malformed, ambiguous, missing-run or mixed-level records need individual
   review; exclude them from the pilot.

Audit duplicates before setting **Enforce unique values = Yes** on
`ProgressKey`. `StudentCode` must not be unique in the progress List because
one student can have several level rows. Do not automatically choose the
highest round, newest date or highest score among duplicates.

Create one supporting List, `GGR_SaveReceipts`, on the same site:

| Column | Type / setting |
| --- | --- |
| `Title` | Set to `SaveRequestId` when creating a receipt |
| `SaveRequestId` | Single line of text; enforce unique values |
| `ProgressKey` | Single line of text; indexed |
| `RunGeneration` | Number, 0 decimal places |
| `ResultRevision` | Number, 0 decimal places |
| `RequestBodyJson` | Multiple lines, plain text, append changes OFF |

These records recover lost responses. They are not new student profiles or
another game database. Store neither API keys nor credentials in either List.
Do not purge receipts during the pilot. Production retention, request expiry
and serialized size/capacity must be approved before wider rollout.

## 3. Keep the API-key condition; replace the snapshot-shaped trigger schema

Keep `ExpectedKey`, `IncomingKey` and their current comparison/transport.
Do not change the header/body location without verifying the existing caller.
Invalid key: HTTP 401, JSON:

```json
{"ok":false,"code":"unauthorized","retryable":false}
```

The request is a **flat progress payload**, not a snapshot containing `player`.
Replace the old trigger schema with this schema. Use the same schema in a
**Parse JSON** action named `Parse_Request` in the valid-key branch, with
Content = `triggerBody()`.

```json
{
  "type": "object",
  "required": [
    "protocolVersion", "storageSchemaVersion", "classCode", "studentCode",
    "level", "progressKey", "saveRequestId", "runGeneration", "runId",
    "baseRevision", "contentHash", "startingNetWorth", "currentRound",
    "currentCash", "currentAssets", "netWorth", "score",
    "progressionMarkersJson", "clientTimestampUtc"
  ],
  "properties": {
    "protocolVersion": {"type":"integer","enum":[2]},
    "storageSchemaVersion": {"type":"integer","enum":[1]},
    "classCode": {"type":"string","minLength":1,"pattern":"^[A-Za-z0-9-]+$"},
    "studentCode": {"type":"string","minLength":1,"pattern":"^[A-Za-z0-9-]+$"},
    "level": {"type":"integer","enum":[2,3,4,5]},
    "currentLevel": {"type":"integer"},
    "rosterAssignedLevel": {"type":["integer","null"]},
    "progressKey": {"type":"string","minLength":1},
    "saveRequestId": {"type":"string","minLength":1,"maxLength":255,"pattern":"^[A-Za-z0-9_-]+$"},
    "runGeneration": {"type":"integer","minimum":1},
    "runId": {"type":"string","minLength":1,"maxLength":255},
    "baseRevision": {"type":["integer","null"],"minimum":1},
    "contentHash": {"type":"string","minLength":1},
    "startingNetWorth": {"type":["number","null"]},
    "currentRound": {"type":"integer","minimum":1},
    "currentCash": {"type":"number"},
    "currentAssets": {"type":"number"},
    "netWorth": {"type":"number"},
    "score": {"type":"number"},
    "progressionMarkersJson": {"type":"string","minLength":1},
    "checkpointStatus": {"type":"string"},
    "quizScore": {"type":["number","null"]},
    "quizPassedAt": {"type":"string"},
    "quizAttempts": {"type":"array"},
    "quizAttemptsJson": {"type":"string"},
    "approvalStatus": {"type":"string"},
    "approverName": {"type":"string"},
    "approvalTimestamp": {"type":"string"},
    "progressionStateByLevel": {"type":"object"},
    "progressionStateJson": {"type":"string"},
    "badgesJson": {"type":"string"},
    "achievementsCount": {"type":"integer","minimum":0},
    "sessionStatus": {"type":"string"},
    "needsSupport": {"type":"boolean"},
    "supportReason": {"type":"string"},
    "clientTimestampUtc": {"type":"string","minLength":1},
    "clientVersion": {"type":"string"}
  }
}
```

Test the trigger/Parse JSON enforcement of `required`, `enum`, `pattern` and
integer constraints in the tenant; don't assume its schema support. A request
rejected at the trigger may receive a platform HTTP 400 before your response
actions run. A Parse JSON failure must produce your HTTP 422
`invalid_payload` response. Restrict the pilot to Levels 2–5; public Level 1
practice is outside this writer.

## 4. Amend the compose actions

Enter these in the **Expression** tab, without a leading `@`.

| Action name | Expression |
| --- | --- |
| `StudentCodeNorm` | `toUpper(trim(body('Parse_Request')?['studentCode']))` |
| `ClassCodeNorm` | `toUpper(trim(body('Parse_Request')?['classCode']))` |
| `LevelIn` | `body('Parse_Request')?['level']` |
| `ProgressKeyIn` | `concat(outputs('ClassCodeNorm'),'|',outputs('StudentCodeNorm'),'|',string(outputs('LevelIn')))` |
| `MarkersIn` | `body('Parse_Request')?['progressionMarkersJson']` |
| `RequestBinding` | `string(body('Parse_Request'))` |

Remove `int(coalesce(...,2))` from `LevelIn`. Remove the `{}` default from
`MarkersIn`. Missing full state must be rejected, never substituted.

Add a Condition:

```text
equals(body('Parse_Request')?['progressKey'],outputs('ProgressKeyIn'))
```

False → HTTP 422 `progress_key_mismatch`. This deliberately requires the
client key to be canonical, while the flow independently recomputes it.

Add `Parse_Snapshot`, Content = `outputs('MarkersIn')`. Its schema must require
the current snapshot fields `schemaVersion`, `player`, `assignedLevel`,
`currentLevel`, `round`, `cash`, `ownedMines`, `machinery`, `roundHistory`,
`investmentPlans`, and `run`. Require snapshot schemaVersion 2, nonempty
`player.classCode`/`player.studentCode`, and `run.runId`/`run.generation`.

Before writing, explicitly check:

- Normalized snapshot player class/student equal the request identity.
- Snapshot `assignedLevel` and `currentLevel` equal `LevelIn` (these snapshot
  fields describe the played game, not the roster assignment).
- Snapshot round equals request `currentRound`.
- Snapshot run ID/generation equal request run ID/generation.
- Snapshot schema/run storage versions are supported; full economy, assets,
  history, profile and progression shape pass the repository contract vectors.

Do not compare precise snapshot cash with rounded summary cash for equality.
The existing client intentionally rounds some summary fields. Full restoration
must use snapshot precision. Unknown mine/equipment IDs or historical
configuration inconsistencies need migration review, not guessed repairs.

**Checkpoint:** the complete snapshot validation schema/configuration depends
on the historical level definitions and approved migration. A minimal
identity-only Parse JSON is not full game validation and does not clear pilot
acceptance. Test malformed assets/history/profile as well as missing identity.

## 5. Validate the roster; do not change login

Add SharePoint **Get items**, `Get_Student`, List = `GGR_Students`.
Set Top Count to 2 and enter this Filter Query expression:

```text
concat('StudentCode eq ''',outputs('StudentCodeNorm'),''' and ClassCode eq ''',outputs('ClassCodeNorm'),'''')
```

Zero/multiple matching rows or an inactive row → HTTP 422
`student_roster_invalid`. Use the actual confirmed `Active` column type.
This check does not prove the caller is that student, and roster placement
must not be used to relabel the played-level save.

## 6. Check durable receipts BEFORE revision/generation checks

Add `Get_Receipt`, List = `GGR_SaveReceipts`, Top Count = 2:

```text
concat('SaveRequestId eq ''',body('Parse_Request')?['saveRequestId'],'''')
```

More than one receipt → HTTP 503 `receipt_integrity_error`; no write.
Exactly one:

1. Its `ProgressKey` must equal `ProgressKeyIn`.
2. Compare the stored request binding with this request:

   ```text
   equals(
     base64(first(body('Get_Receipt')?['value'])?['RequestBodyJson']),
     base64(outputs('RequestBinding'))
   )
   ```

3. Different binding/key → HTTP 422 `request_id_reused`.
4. Exact binding → return the receipt's **original** ResultRevision and
   RunGeneration using the success response in section 11,
   `deduplicated:true`. Do not update the game row.

**Flow-only binding choice:** store/compare the complete parsed flat request,
including base revision, run, snapshot and timestamp. The API key must not
be in this body. `contentHash` alone is not trusted as content equality.
This is deliberately stricter than canonical-content equality: reordering
JSON properties or altering telemetry on a retry may be rejected. The current
client retains immutable sealed requests. Confirm exact retry serialization
in browser/tenant tests and document this stricter variant in the contract
before activation. No JavaScript hash expression is being invented here.

## 7. Replace Top Count 1 progress lookup

Rename/add `Get_Progress`, List = `GGR_StudentProgress`.
Set Top Count = **2**, no Order By needed:

```text
concat('ProgressKey eq ''',outputs('ProgressKeyIn'),'''')
```

Branch on:

```text
length(body('Get_Progress')?['value'])
```

- 2 → HTTP 409 `duplicate_rows`; do not select a winner.
- 0 → create path, section 10.
- 1 → update path, section 8.

Before interpreting zero as absence, complete migration of approved legacy
keys. Do not migrate a legacy row opportunistically from a student's save.
Connector failure/timeout is an error, not zero results.

## 8. Existing-row checks and lost-response recovery

Add Compose `ExistingRow`:

```text
first(body('Get_Progress')?['value'])
```

Validate the stored row's identity, key, level, revision/run metadata and
snapshot. Missing metadata → HTTP 422 `migration_required`, no replacement.

If incoming `saveRequestId` equals the row's `LastSaveRequestId`:

1. Compare `LastRequestBodyJson` with `RequestBinding`, using the base64
   equality from section 6.
2. Different content → HTTP 422 `request_id_reused`.
3. Exact content → create/repair its missing receipt from the row's revision,
   generation and saved binding; then return its original acknowledgement,
   `deduplicated:true`. Do not apply the economy again.

For a **different** incoming request, before replacing last-request metadata:

1. If the row has a `LastSaveRequestId`, get that receipt by its ID.
2. If absent, create it from the row's saved binding, key, generation and
   revision.
3. If a concurrent receipt create hits uniqueness, reread and verify the
   existing receipt's complete binding and original acknowledgement.
4. If persistence/verification fails, HTTP 503 `receipt_recovery_pending`;
   **do not write the new save**.

This pins a failed receipt in the game row until durable recovery. It avoids
the row/receipt crash gap without pretending two Lists form one transaction.
Receipts must remain immutable.

Then check, in this order:

| Condition | Response |
| --- | --- |
| Incoming generation < row generation | 422 `generation_stale` |
| Incoming generation > row generation | 409 `precondition_failed` (only a future reset operation can advance it) |
| Same generation but different run ID | 409 `revision_conflict` |
| `baseRevision` is null | 409 `row_exists` |
| `baseRevision` differs from row Revision | 409 `revision_conflict` |
| Exact base and run | Proceed to conditional write |

Add Compose `NextRevision`:

```text
add(int(outputs('ExistingRow')?['Revision']),1)
```

## 9. Replace ordinary Update item with an ETag-conditional REST write

The existing ordinary **Update item** must not remain as a second writer.
An expression checking Revision followed by an unconditional update still
has a race.

Add SharePoint **Send an HTTP request to SharePoint**, `Read_Row_REST`:

- Site Address: same connection/site as current flow.
- Method: GET.
- Uri expression:

  ```text
  concat('_api/web/lists/getbytitle(''GGR_StudentProgress'')/items(',string(outputs('ExistingRow')?['ID']),')')
  ```

- Header: `Accept: application/json;odata=verbose`.

Verbose REST normally returns `body.d.__metadata.etag`, not the connector's
`@odata.etag`. Confirm the actual run output. Recheck that this REST row's
revision/run/last-request binding still equal the row checked in section 8.
If changed, return 409 `precondition_failed`; do not use the newer ETag with
checks made against older data.

Add `Write_Row_REST`, **Send an HTTP request to SharePoint**:

- Method: POST.
- Uri: same row URI.
- Headers:

  ```text
  Accept: application/json;odata=verbose
  Content-Type: application/json;odata=verbose
  X-HTTP-Method: MERGE
  IF-MATCH: <Read_Row_REST body.d.__metadata.etag dynamic expression>
  ```

- Body must be a JSON **object** built with dynamic fields, not concatenated
  JSON text. Obtain `__metadata.type` from the REST row's metadata; do not
  guess `SP.Data...ListItem`.

Include in this ONE item write:

| REST field | Value/source |
| --- | --- |
| `__metadata.type` | REST row's actual entity type |
| `Title`, `ProgressKey` | `ProgressKeyIn` |
| `StudentCode`, `ClassCode`, `Level` | Normalized request identity/played level |
| `Revision` | `NextRevision` (JSON number) |
| `RunGeneration`, `RunId` | Validated incoming run |
| `LastSaveRequestId` | Incoming request ID |
| `LastRequestBodyJson` | `RequestBinding` |
| `ProgressionMarkersJson` | `MarkersIn`, full validated snapshot |
| Current economy/score/badge/support fields | Existing mapping, with explicit validated numeric/Boolean types |
| `CheckpointStatus`, `QuizScore`, `QuizPassedAt`, `QuizAttemptsJson` | Validated current-level quiz evidence, subject to existing teacher decision/retake policy |
| `CheckpointLevel` | Played level |
| `CheckpointPassed` | See expression below; quiz-pass evidence, not teacher approval |
| `LaastPlayedUtc`, `UpdatedUtc` | Preserve confirmed List date/date-time format; server UTC time for acceptance |

For the observed current `quiz_passed` value:

```text
equals(toLower(body('Parse_Request')?['checkpointStatus']),'quiz_passed')
```

If historical `Passed` is a confirmed supported value, normalize it explicitly
during migration. Do not accept client `approved` as teacher authority.
Confirm actual supported checkpoint status values before extending this mapping.

Do **not** send `ApprovalStatus`, `ApproverName` or `ApprovalTimestamp` in
the student MERGE. Omitted MERGE fields remain unchanged.
`ProgressionStateByLevel` and snapshot JSON can also contain approval claims:
those are not authority. Student restore/dashboard interpretation must use
server-owned approval columns and must not replace teacher evidence with
student JSON. Retake reconciliation needs its existing policy verified.

Single-value SharePoint choice fields in REST use their actual string values,
not the connector's `{Value:...}` wrappers. Confirm their allowed values.
Preserve intentional `Score`/`Score0` consumer mappings and precision policy.
Never interpolate unescaped snapshot JSON inside a quoted REST body string.

HTTP 412 → bounded reread for this request's receipt/row binding. If already
committed, return the recovered acknowledgement; otherwise return 409
`precondition_failed`. Other REST failures → typed error; no unconditional
fallback. A MERGE typically returns 204: use the already calculated revision,
not a nonexistent response body.

## 10. Create path

For zero approved/migrated rows:

1. `baseRevision` must be null; otherwise HTTP 409 `revision_conflict`.
2. Generation must be 1 for a genuinely new slot, with valid run ID/schema.
   Cloud-backed resets/deletions remain disabled; a removed historical row
   must not be treated as permission to resurrect an old request.
3. Use SharePoint **Create item**, with the same validated identity, economy,
   snapshot, revision/run/last-request mappings; Revision = 1.
4. Do not map client approval/name/timestamp. Use the verified server
   initialization policy (for example empty/pending), not browser authority.
5. Unique `ProgressKey` makes a concurrent create fail. On a *confirmed*
   uniqueness failure only, reread: recover this request if identical, else
   409 `row_exists`. Do not treat every connector failure as uniqueness.
6. After a successful create, create its receipt as below.

## 11. Persist the receipt and replace the legacy response

After either row commit, create a receipt with:

```text
Title = saveRequestId
SaveRequestId = saveRequestId
ProgressKey = ProgressKeyIn
RunGeneration = incoming generation
ResultRevision = committed revision
RequestBodyJson = RequestBinding
```

If duplicate receipt creation occurs, reread and compare the full binding and
acknowledgement. If receipt write fails for another reason, the game row's
last-request metadata remains the recovery source; return HTTP 503
`receipt_recovery_pending`. A retry must recover, not reapply, the save.
No later save may overwrite that source before its receipt is verified durable.

Replace `{ok:true,saved:true}` with HTTP 200, Content-Type `application/json`:

```json
{
  "ok": true,
  "protocolVersion": 2,
  "saveRequestId": "<incoming ID>",
  "progressKey": "<recomputed key>",
  "runGeneration": 1,
  "revision": 2,
  "deduplicated": false
}
```

Use dynamic values, with `runGeneration` and `revision` inserted as JSON
numbers. They are examples above, not constants. Retry responses echo the
**original** receipt revision, which may be lower than the row's current one.

## 12. Add failure handling; never return success after a failed write

Use Try/Catch/Finally scopes and response variables initialized at top level:
HTTP status, response object, and a completed/handled flag. Keep one final
Response outside loops. Gate later processing when an earlier condition has
set a terminal result. Catch must not overwrite a deliberately set typed
error. Configure run-after to handle failures and timeouts; inspect real
connector status/error structure before classifying 412/uniqueness/throttling.

| Situation | HTTP / body code | retryable |
| --- | --- | --- |
| Invalid API key | 401 `unauthorized` | false |
| Invalid/missing input/snapshot | 422 `invalid_payload` / `invalid_snapshot` | false |
| Existing row needs migration | 422 `migration_required` | false |
| Duplicate progress rows | 409 `duplicate_rows` | false |
| Changed revision/run/create race | 409 conflict code from above | false |
| Reused ID with different request | 422 `request_id_reused` | false |
| Missing durable receipt | 503 `receipt_recovery_pending` | true |
| Confirmed throttling | 429 `throttled` | true |
| Connector unavailable/timeout | 503 `backend_unavailable` | true |
| Unexpected failure | 500 `internal_error` | false; alert operator |

Error body: `{"ok":false,"code":"...","retryable":true|false}`.
Do not expose credentials, another student's row, or raw connector errors.
Record detailed failures privately with request ID/correlation ID.

## 13. Acceptance before touching production configuration

Use a dedicated test account, not the forensic demonstration account.

1. Missing level, missing snapshot, wrong player/key/run and unsupported schema
   fail without any List change.
2. A new slot writes Revision 1 and returns matching acknowledgement.
3. An update based on Revision 1 commits Revision 2.
4. Two different requests based on Revision 2: exactly one commits Revision 3.
5. Retry the accepted request: same original revision, no new game write.
6. Accept a newer request, then retry the earlier request: return its older
   original receipt revision; never overwrite the newer economy.
7. Reuse an ID with altered economy/base/run: reject without write.
8. Simulate row success + receipt failure; retry recovers the acknowledgement.
   A later request must repair/persist the earlier receipt before committing.
9. A concurrent teacher approval survives the student MERGE/ETag conflict.
10. Large round history/profile/request binding fits all three text writes
    (snapshot, row binding, receipt binding). No truncation. Measure timeouts,
    concurrency, requests per student and 429 behavior; this design adds I/O.
11. Two separate browsers: save on A, exact-slot restore on B, verify full
    economy, run, profile and progression—not just dashboard totals.

Flow amendments alone cannot restore uploads: the current client still
requires a proof provider. The agreed API-key integration, cloud-first behavior,
exact-slot reader and review-defect fixes are separate repository work.
Keep rollout flags OFF until that code and the tenant flow are jointly tested.

## Why a student read is needed when the dashboard works

`GGR_GetDashboardData` currently looks up a teacher and returns `teachers`,
`students` and `progress` arrays. It can retrieve cloud-stored snapshots and is
the correct teacher dashboard source. Nothing here claims it stopped working.

The student game needs a different operation: read exactly
`CLASS|STUDENT|PLAYED_LEVEL`, return its full validated save and revision, and
distinguish successful absence from errors/duplicates. It needs this before
starting a game or sending a conditional save. Without it, a fresh device
cannot safely choose between restoring an existing game and creating a new one.

The **separate operation/response contract** is necessary; a separate flow
name is not a fundamental platform requirement. `GGR_GetStudentProgress` is
recommended because it leaves the working teacher flow unchanged and avoids
sending teacher/roster/all-student data to a student browser.
An alternative is adding a student-read branch to `GGR_GetDashboardData`
before teacher lookup, with its own exact-slot query, restricted projection,
validation and response. Pointing the game at the existing dashboard response,
filtering all students client-side, or supplying teacher identity is not an
equivalent repair. That alternative requires explicit client/flow changes and
adds regression risk to the working dashboard.

This does not prove how historical student cross-device restoration worked.
Its old caller/runtime path remains to be traced. The evidence does establish
that the current full-restore adapter expects the student operation and that
no such flow currently exists.
