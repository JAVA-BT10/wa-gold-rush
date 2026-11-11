# Read-only historical progress pilot

This is a **private diagnostic**, not a student restore implementation or a
production flow. It targets Levels 2–5 and makes no List changes or writes.
It does not enable `fullCloudRestore`, `saveProtocolV2`, resets or competition.
It cannot establish that Device A can currently save to SharePoint or that
Device B can resume. On current main, cloud progress dispatch is held unless
the v2 and exact-slot safeguards in `shared/sharepoint-sync.js` are satisfied.

## What main actually expects

`shared/cloud-restore.js` sends the following JSON to the configured
`getStudentProgress` endpoint, after `fullCloudRestore` is enabled and an
external student proof provider authorizes the request:

```json
{
  "contractVersion": "ggr.getStudentProgress.v2",
  "mode": "full_save",
  "classCode": "NB5",
  "studentCode": "HG-NB5-011",
  "level": 2,
  "progressKey": "NB5|HG-NB5-011|2"
}
```

The transport uses the existing JSON and `X-GGR-Key` conventions, but a
server-verifiable student bearer proof is an additional client prerequisite.
There is no proof issuer in this repository. A matching roster entry or the
shared browser API key is not proof of the caller's identity.

An HTTP-success missing result requires `ok:true`, the exact contract version
and requested key, and `found:false`. `runGeneration` is optional, but if
present must be a positive integer. An HTTP-success found result requires
`ok:true`, the exact version and key, `found:true`, integer `revision >= 1`,
and `save`, an object with:

- `kind:"wa_gr_level_save"`, `storageSchemaVersion:1`, `owner` containing
  `classCode` and `studentCode`, the matching `level` and canonical
  `progressKey`;
- positive integer `generation`, nonempty string `runId`, and
  `startingNetWorth`, either a finite number or null;
- `snapshot` with matching `level` and `player` identity, positive integer
  `round`, finite numeric `cash` and `totalProfitLoss`, string
  `player.companyName`, object `progression` and `ownedMines`, arrays
  `machinery` and `roundHistory`, and object `investmentPlans`.

Snapshot `schemaVersion`, if supplied, must be 2; `investmentProfile`, if
non-null, must have five finite nonnegative buckets. If `snapshot.run` exists,
its generation, ID and baseline must match the envelope. Optional response
`runGeneration`, if present, must equal the envelope's generation. See
`validateSnapshot` and `validateEnvelope` in `shared/level-save-store.js` for
the executable rules. Extra save metadata is not required by that validator.
`savedAt` is required by the converter described below, but not by the envelope
validator. Flow failures, malformed responses, wrong identities, duplicates and
timeouts are not `found:false`.

The suggested `{found:true,snapshot:"..."}` response is **not v2**: it has no
revision or `save` envelope, and main returns `incomplete`. Do not label it v2,
fabricate a revision, or point the production endpoint at it.

## Historical snapshot compatibility

`ProgressionMarkersJson` is not directly the v2 `save` envelope.
`shared/progress-snapshot-converter.js` can preflight some raw schema-2 JSON
strings and produce a local envelope with `cloud.revision:null` and
`cloud.status:"unknown"`, not a v2 acknowledgement. It requires the exact
owner and level, valid `savedAt`, existing run ID/generation/storage schema,
valid economy, profile and checkpoint information, and rejects unknown fields,
duplicate JSON keys and contradictory evidence. It does not invent missing run
metadata. It retains a raw backup in memory and reports omitted personal/name
fields; asset/config consistency and net worth still need an operator check.

Actual historical rows have not been tested here. A converter failure means
that this converter cannot safely handle that row; it does not prove that the
row is unrecoverable. Do not edit rows or guess missing fields to make it pass.
Use approved private, original backups and agree on any separate migration
before modifying data. Even a passing conversion does not prove that gameplay
reconstructs the same state on a second device.

## Private pilot flow contract

Only build this in an access-controlled test environment for an authorized
operator. Do not publish a student-callable raw snapshot endpoint: historical
JSON can contain student and teacher names, and a shared `X-GGR-Key` or signed
URL visible in a browser does not isolate students. Keep flow URLs, keys,
student details and raw output out of source control, public issues and chat.
Protect Power Automate run history and retention under Department policy.
The existing teacher dashboard flow may be used for a restricted operator
diagnostic if its complete response and access controls are verified; never
send its broad arrays to a student browser and filter them there.

Use the **distinct** contract version `ggr.getStudentProgress.legacy-readonly.v1`.
The request has the same fields as the example above, except for that version.
The flow must reject unsupported versions/modes, invalid class/student codes,
non-integer levels outside 2–5, and a supplied key different from the
server-recomputed canonical key. Match the normalization and delimiter rules
in `shared/level-save-store.js`: trim and uppercase each code, then require
`^[A-Z0-9](?:[A-Z0-9-]{0,38}[A-Z0-9])?$`. Verify the
requested student is an active roster member using the tenant's actual roster
schema and verify the returned row's identity and level. These checks do not
authenticate the operator or student.

Read `GGR_StudentProgress` using the actual internal name of its progress-key
column, equality against the recomputed key, and **Top Count 2**. Escape
apostrophes correctly in the OData literal and verify the tenant's filter
semantics and complete-query behavior, including throttling/errors. Do not
choose a row by round, balance or timestamp. Verify indexed-column and List
threshold behavior in the tenant. A successful complete query with no matching
rows may return:

```json
{"ok":true,"contractVersion":"ggr.getStudentProgress.legacy-readonly.v1","found":false,"progressKey":"NB5|HG-NB5-011|2"}
```

For exactly one validated row return the same fields with `found:true` and
`snapshot` set to the **original raw text** of its `ProgressionMarkersJson`
column, not rounded summary columns. Validate it is present and well-formed
JSON; verify owner and level within it against the request. The snapshot is a
JSON string in the response, not an already-parsed object. Do not substitute
default data. Two rows, a roster failure, bad or missing snapshot, bad request,
authorization failure or SharePoint error must return `ok:false` with a
machine-readable `code` and an appropriate failure HTTP status, never
`found:false`. Preserve diagnostic distinction in the restricted flow logs.
No save envelope, revision or cloud acknowledgement is created.

Before creating this flow, confirm the List's actual internal names and column
types, roster active-status representation, roster uniqueness, existing
`X-GGR-Key` verification method, and an operator-only access control with the
Department owner. These tenant details are not established by this repository;
do not guess them or copy a literal example student code into a filter.

## Use the local inspector

On a trusted machine with Node.js, prepare a private JSON input containing
`request` (the pilot request above) and `response` containing `success`,
numeric HTTP `status`, and `data` (the parsed pilot flow response). Keep the
original `snapshot` JSON as a string. Save the input outside the repository in a
Department-approved protected location and feed it through standard input:

```sh
node scripts/inspect-legacy-progress.js < /path/to/private-pilot-input.json
```

Do not include the URL, API key, authorization headers or credentials in that
file. The inspector does not call a flow, alter a List, write a save, or output
the snapshot or student identity. It outputs only a status and reason. A
`compatible` result means the **existing strict converter** accepted the data,
with the separate historical configuration check still required.
`reported_missing` is only a report from the flow, not independent proof the
query was complete or authorized. `incompatible` gives the converter's reason;
`failed` means the request, response or transport wrapper was invalid. Only
`compatible` exits with code 0. Remove the private input according to local
data-handling policy after the approved pilot; retain any required backup in
the approved location.

## Operator acceptance and performance comparison

1. Select approved test accounts, with a known existing row at each available
   level 2–5 and a known missing slot. Record authorized List backups privately.
2. Verify active roster matching, exact key, returned owner/level, no duplicate
   rows and fidelity of original raw JSON. Test wrong identity, invalid key,
   duplicate rows, invalid JSON, no row, flow failure and timeout; errors must
   never look like an empty slot. Do not create real duplicate rows to test.
3. Run the inspector for each historical example and privately record only
   status/reason and level. Independently compare mine/machinery/config values,
   economy, profile and checkpoint data against the correct historical version.
   Keep both the original and evidence of any information the converter omits.
4. If comparing the dashboard and dedicated read-only flow, run both only as an
   authorized operator on the same connection and test slots. Record cold and
   warm response time from request start to complete response, HTTP status and
   uncompressed response byte count; repeat enough times to report median and
   p95 and count failures. Report aggregate figures only. Neither endpoint has
   been measured in this repository, so no speed or size advantage is claimed.
5. After compatibility and authorization are resolved, separately design and
   test a restore path including existing local-state backup, conflict handling,
   offline behavior and gameplay fidelity. Then address safe writes and verify
   Device A save followed by Device B restore on real devices. Read-only
   retrieval alone cannot pass that end-to-end acceptance.
