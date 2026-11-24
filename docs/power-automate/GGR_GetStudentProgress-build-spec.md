# `GGR_GetStudentProgress` build specification

This specifies the wire contract consumed by the game. It does not assert that
the flow, authorization provider, List migration, or deployment already exists.
Keep `fullCloudRestore` OFF until the flow and tenant acceptance checks pass.
Use the controlling [release and acceptance runbook](../operations/release-and-acceptance.md).

## HTTP trigger

- Method: `POST`
- Content type: `application/json`
- The browser sends `X-GGR-Key` when runtime configuration provides the shared
  key. It is a shared application key, not proof of the signed-in student.
- The current restore client also requires a server-verifiable student bearer
  proof in the `Authorization` header. The proof provider is an integration
  point; the repository does not implement or configure it. A flow that checks
  only `X-GGR-Key` is not authorized to return a student's row under the current
  contract.
- Do not put keys, PINs, PIN hashes, or bearer credentials in the JSON body.

## Request body schema

Configure the HTTP trigger to require this JSON object:

```json
{
  "type": "object",
  "required": [
    "contractVersion",
    "mode",
    "classCode",
    "studentCode",
    "level",
    "progressKey"
  ],
  "properties": {
    "contractVersion": { "type": "string", "enum": ["ggr.getStudentProgress.v2"] },
    "mode": { "type": "string", "enum": ["full_save"] },
    "classCode": { "type": "string", "minLength": 1 },
    "studentCode": { "type": "string", "minLength": 1 },
    "level": { "type": "integer", "minimum": 2, "maximum": 5 },
    "progressKey": { "type": "string", "minLength": 1 }
  },
  "additionalProperties": false
}
```

Example:

```json
{
  "contractVersion": "ggr.getStudentProgress.v2",
  "mode": "full_save",
  "classCode": "6B",
  "studentCode": "SC-1",
  "level": 2,
  "progressKey": "6B|SC-1|2"
}
```

The flow must derive the authorized class/student from the bearer proof, compare
the request identity to that subject, validate the played level entitlement,
and recompute the canonical key as
`UPPER(ClassCode)|UPPER(StudentCode)|Level`. Never authorize from request fields
or the shared API key alone.

## SharePoint lookup

Use the `GGR_StudentProgress` list and query the exact recomputed `ProgressKey`,
with top count `2`. Escape OData string literals and never interpolate an
unvalidated raw request value. Do not query `GGR_GetDashboardData` or return
teacher, roster, or other-student rows.

Inspect the matching row's canonical `ProgressKey`, `ClassCode`, `StudentCode`
and `Level` against the requested/authorized slot. Querying two rows is
intentional: duplicates are an error, not a choice between rows.

### Power Automate action order

1. **When an HTTP request is received:** `POST`, with the JSON schema above.
2. **Validate and authorize:** reject unsupported version/mode, invalid
   identity/key/level, missing key, or invalid/missing student proof. Resolve
   the authorized class/student from the proof; compare it with the request and
   check the student's entitlement to the played level. Request identity and
   `X-GGR-Key` alone do not authenticate the student.
3. **Compose `ExpectedKey`:** uppercase authorized `ClassCode`, `|`, uppercase
   authorized `StudentCode`, `|`, validated integer `Level`.
4. **Get items — `GGR_StudentProgress`:** filter on exact `ProgressKey =
   ExpectedKey`; top count `2`; use an indexed `ProgressKey`. Never query
   `StudentCode` alone or call/forward the dashboard flow.
5. **Duplicate condition:** more than one row → HTTP `409`, JSON
   `{"ok":false,"contractVersion":"ggr.getStudentProgress.v2","code":"duplicate_rows"}`.
   Do not choose first/newest/highest.
6. **Missing condition:** zero rows after a successful complete query → HTTP
   `200` and the missing response below. A connector failure, timeout,
   throttling or partial query must take the error path, never this branch.
7. **One-row validation:** compare the row key and partition columns; parse
   `ProgressionMarkersJson`; validate its schema, owner, played level and run
   metadata. Require positive integer `Revision` and
   `RunGeneration === snapshot.run.generation`. Any failure → HTTP `422` with
   `ok:false`, matching version and `code:"malformed_row"` (or a more specific
   typed code). Never return an empty snapshot.
8. **Found response:** HTTP `200`; map `ProgressKey`, numeric `Revision`,
   numeric `RunGeneration` and original `ProgressionMarkersJson` text to the
   response fields below.
9. **Catch/failure response:** handle all failed/timed-out SharePoint actions;
   return non-2xx JSON with `ok:false`, matching version and
   `code:"server_error"`. Put a bounded Response on every terminal branch, not
   in a row loop. Verify POST/JSON/CORS behavior in a real browser and measure
   the full request under the client's 8-second timeout.

| `GGR_StudentProgress` field | Response use |
| --- | --- |
| `ProgressKey` | Echo as `progressKey`; must equal the recomputed exact key |
| `ClassCode`, `StudentCode`, `Level` | Validate ownership and exact slot; not separate found-response fields |
| `Revision` | Emit as positive integer `revision`; must be an application revision, not a SharePoint ETag |
| `RunGeneration` | Emit as integer `runGeneration`; must equal `ProgressionMarkersJson.run.generation` |
| `ProgressionMarkersJson` | Emit as the string `progressionMarkersJson`; client converts and validates the snapshot |

`Revision` and `RunGeneration` require validated, one-time migration for legacy
rows that do not contain them. Do not invent a revision from Modified time or
an ETag, and do not infer missing run metadata.

The existing List schema and protocol metadata must be inventoried before
editing. The current save runbook also requires `RunId`, `StartingNetWorth`,
`StorageSchemaVersion`, and bounded `RecentRequests`/last-request metadata on
the save row, plus a separate receipts list for retry recovery. These are
`GGR_SaveProgress` requirements, not additional retrieval response fields.

## Responses

Return JSON with the indicated HTTP status. Never return `found:false` for a
failed, partial, unauthorized, duplicate, or malformed lookup.

### One valid row

HTTP `200`:

```json
{
  "ok": true,
  "contractVersion": "ggr.getStudentProgress.v2",
  "found": true,
  "progressKey": "6B|SC-1|2",
  "revision": 7,
  "runGeneration": 1,
  "progressionMarkersJson": "{\"schemaVersion\":2,\"savedAt\":\"2026-11-23T12:00:00.000Z\",\"assignedLevel\":2,\"currentLevel\":2,\"rosterAssignedLevel\":2,\"round\":8,\"cash\":1234.5,\"netWorth\":1534.5,\"player\":{\"classCode\":\"6B\",\"studentCode\":\"SC-1\"},\"companyName\":\"Southern Cross\",\"ownedMines\":{},\"machinery\":[],\"roundHistory\":[{\"round\":7}],\"totalProfitLoss\":10,\"investmentPlans\":{},\"investmentProfile\":null,\"strategyLabel\":\"No strategy yet\",\"checkpointStatus\":\"\",\"quizScore\":null,\"quizPassedAt\":\"\",\"quizAttempts\":[],\"approvalStatus\":\"\",\"approverName\":\"\",\"approvalTimestamp\":\"\",\"progressionStateByLevel\":{\"2\":{}},\"run\":{\"generation\":1,\"runId\":\"run_cloud\",\"startingNetWorth\":300,\"storageSchemaVersion\":1}}"
}
```

The `progressionMarkersJson` example is one JSON-encoded string containing a
snapshot; in a Power Automate Response action, map the List text column directly
to that property. `revision` must be a JSON number, not a string. `runGeneration`
must equal the snapshot's `run.generation`.

### No matching row

Only after a successful complete exact-key query returns zero rows, HTTP `200`:

```json
{
  "ok": true,
  "contractVersion": "ggr.getStudentProgress.v2",
  "found": false,
  "progressKey": "6B|SC-1|2"
}
```

If a validated reset-generation ledger exists, it may additionally return a
positive integer `runGeneration`. Otherwise omit it.

### Unauthorized request

HTTP `401` or `403`:

```json
{
  "ok": false,
  "contractVersion": "ggr.getStudentProgress.v2",
  "code": "unauthorized"
}
```

Do not disclose whether the requested student or row exists.

### Invalid request, duplicate, malformed row, or backend failure

Use a non-2xx response with `ok:false` and a typed code, for example
`invalid_request`, `identity_mismatch`, `duplicate_rows`, `malformed_row`,
`server_error`, or `timeout`. Never convert these outcomes to a missing save.
The client treats non-2xx, timeout, non-JSON, contract mismatch, bad key,
invalid revision, invalid snapshot, owner/level mismatch, or generation mismatch
as failure/incomplete and holds uploads.

## Client checks and activation gates

`CloudRestore.fetchLevelSave()` sends the body above only when the feature flag
is on and the `getStudentProgress` endpoint is configured. It calls
`StudentProgressAuth.authorize({operation:"get", identity, level, progressKey})`
before the HTTP request. The authorization module requires a Bearer value from
`WA_GOLD_RUSH_STUDENT_PROGRESS_PROOF_PROVIDER.getProof`; without one, no retrieval
request is made.

For found responses, `CloudRestore.interpretResponse()` checks HTTP success,
JSON object, exact contract version, `ok:true`, exact progress key,
`found:true`, positive integer revision, snapshot owner/level/key/schema/run
validation, and optional generation equality. For missing responses it requires
`ok:true`, exact contract version/key, `found:false`, and any supplied generation
to be a positive integer. An error is never a missing record.

The game accepts `ProgressionMarkersJson` only if its schema-2 snapshot contains
the expected identity and played level, valid economy/history/profile fields,
checkpoint evidence, and run metadata. Unknown or contradictory data fails
closed. The source JSON must be backed up and validated before migration.

## Related existing flows

### `GGR_SaveProgress`

The current endpoint has a legacy contract. Client dispatch is held until v2
conditional saving, full restore and a verified startup lookup are enabled.
Before activation:

1. Back up the List, all versions, raw snapshots and flow definition. Inventory
   duplicate and legacy keys; preserve original snapshots. Resolve duplicates
   before enabling unique `ProgressKey`.
2. Confirm internal names/types. Add or migrate unique indexed `ProgressKey`,
   integer `Revision`, `RunGeneration`, `StorageSchemaVersion`, text `RunId`,
   `ContentHash`, `LastSaveRequestId`, bounded row-atomic `RecentRequests`, and
   nullable numeric `StartingNetWorth`. Preserve valid run identity from the
   snapshot. Initialize a migrated revision once; never infer it from Modified
   time or SharePoint ETag.
3. Add `GGR_SaveReceipts` with unique `SaveRequestId` and
   `ProgressKey`, `RunGeneration`, `BaseRevision`, `ResultRevision`,
   `ContentHash`, bounded `ResponseJson`, and `CreatedUtc`. Set and test
   retention/capacity before accepting writes.
4. Align the HTTP trigger with `SharePointSync.buildProgressPayload()`: common
   identity/slot, summary and checkpoint fields, `progressionMarkersJson`,
   request ID/timestamp/version; v2 adds `protocolVersion`, `runGeneration`,
   `runId`, `startingNetWorth`, `storageSchemaVersion`, `baseRevision`, and
   `contentHash`. Check the actual request against the deployed trigger schema;
   the supplied old schema does not match the current top-level payload.
5. Authenticate/authorize each write; recompute the canonical key and validate
   the full snapshot and played-level entitlement. Refuse v1 writes to migrated
   or protected keys.
6. Before revision/generation checks, find a receipt for the exact authorized
   principal, key and `saveRequestId`; verify immutable request content/base/run.
   Return the original acknowledgement for an exact retry; reject changed
   content under a reused ID.
7. Permit `baseRevision:null` only for create-only when no row exists. Existing
   rows require exact current revision, run ID and generation. Older generation
   is `generation_stale`; stale revision/run and create collision are conflicts.
8. Commit snapshot, incremented revision and bounded request-recovery metadata
   with SharePoint REST conditional write using the exact read ETag in
   `IF-MATCH`. Never use wildcard ETag or unconditional Update item. On HTTP
   `412`, re-read only to recover an exact duplicate receipt; otherwise return
   conflict. Enforce unique-key creation.
9. Persist/verify the receipt and return HTTP `200`:

   ```json
   {
     "ok": true,
     "protocolVersion": 2,
     "saveRequestId": "<same request ID>",
     "progressKey": "<server-recomputed key>",
     "runGeneration": 1,
     "revision": 8,
     "deduplicated": false
   }
   ```

   The client requires `ok`, protocol version, matching request ID/key/run
   generation and positive integer revision. A legacy HTTP 200 is not success.
   Follow [save-protocol-v2](save-protocol-v2.md) and the [release runbook](../operations/release-and-acceptance.md)
   for the complete algorithm and S1–S12 acceptance matrix.

### `GGR_GetDashboardData`

Keep this as a teacher-dashboard endpoint. It receives
`{"teacherEmail":"<signed-in teacher email>"}` and the dashboard consumes
`students`, `teachers`, and `progress` arrays. Enforce teacher/class scope in the
flow and exclude credentials and unrelated classes. Verify the roster-level
write/read-back mapping: `GGR_UpsertStudentProfile` must map request `Level` to
the actual assigned-level column; `GGR_GetDashboardData` must return that same
column consistently. The dashboard client already verifies a level update
against fresh read-back.

Do not change this flow to provide student game restores. The full-restore
client calls `getStudentProgress`, not `getDashboardData`; the teacher-scoped
dashboard response is not a substitute for an exact authorized student slot.

Before enabling restore, pass the runbook's R1–R4 and two-browser tests for every
level 2–5. Full save dispatch additionally requires the v2 conditional
`GGR_SaveProgress` writer and its S1–S12 tests. Keep both runtime flags OFF until
these tenant checks and the proof-provider integration are verified.
