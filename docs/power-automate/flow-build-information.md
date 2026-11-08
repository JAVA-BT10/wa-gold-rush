# Goldfields Goldrush W.A. — Power Automate flow build information

> **Scope and confidence:** This page reconciles the checked-in application,
> flow registry, build workflow and `Current Flow Inventory.docx`, supplemented
> by run-history screenshots supplied by the owner. The repository does not
> contain exportable flow definitions or a complete tenant acceptance record.
> Screenshots establish that Power Automate displayed runs as successful, not
> that the intended SharePoint changes, authorization checks or end-to-end user
> outcomes were correct. Consequently, **no flow can be certified as fully
> accepted from this page**. Historical inventory notes are undated and may
> conflict with current code; they are identified as historical, not treated
> as current tenant proof.
>
> Signed trigger URLs, API keys, student credentials and raw flow-definition
> metadata are intentionally not reproduced here. Treat browser-published
> runtime configuration and trigger URLs as public, not confidential.

## Status key

- **Endpoint wired:** a non-placeholder endpoint is defined or supported by
  checked-in configuration. This does not prove that the endpoint currently
  resolves or that its flow works.
- **Client-integrated / used:** checked-in application code invokes the flow
  for the indicated user action. This describes the client path, not whether
  a tenant run succeeds.
- **Guarded / held:** integration exists, but the normal deployment is gated
  or sends no request until prerequisites are met.
- **Optional / unused:** a hook or placeholder exists, but no normal production
  caller is wired or the endpoint is unconfigured.
- **Planned:** a contract or scaffold exists; no deployed flow is established.
- **Successful run observed:** a supplied run-history screenshot shows one or
  more runs marked Succeeded. This does not confirm the intended data change or
  satisfy tenant acceptance.
- **Completed / accepted:** requires recorded tenant acceptance evidence,
  including verified outcomes and authorization checks. No flow has that
  complete evidence here.

## At-a-glance inventory

| Power Automate flow | Repository build state | Checked-in client usage | Tenant evidence / acceptance |
|---|---|---|---|
| `GGR_LoginStudent` | Endpoint wired; student login integrated | Used by student sign-in | Successful runs shown Nov 6–7; response/roster outcome not verified |
| `GGR_LoginTeacher` | Endpoint wired; teacher login integrated | Used by teacher sign-in | Successful runs shown Oct 27–29 and Nov 6–8; owner reports teacher login worked |
| `GGR_ChangeStudentPin` | Endpoint wired; PIN setup/change integrated | Used by student PIN form | Successful runs shown Oct 20–22 and Nov 7; recent PIN change not independently tested |
| `GGR_UpsertStudentProfile` | Endpoint wired; roster import integrated | Used by teacher dashboard/import | Run entries shown Nov 7; per-run status not visible; persisted roster behavior not verified |
| `GGR_UpsertTeacher` | Endpoint configured; teacher upsert integrated | Used by dashboard teacher management/import | Owner reports never run; screenshot shows no runs in 28-day history; live routing and writes unverified |
| `GGR_SaveProgress` | Endpoint wired; legacy and v2 contracts documented | Capture/retry infrastructure exists; uploads are held by default pending gates | Successful runs shown Nov 6; historical cloud snapshot supplied; current saves and writer provenance unverified |
| `GGR_GetDashboardData` | Endpoint wired; dashboard data load integrated | Used by teacher dashboard | Successful runs shown Nov 7–8; owner reports dashboard still works; device-only game saves are absent |
| `GGR_TeacherUnlockStudent` | Endpoint wired; dashboard action integrated | Used by teacher unlock action | Successful runs shown Oct 18–19 and Nov 8; owner reports it still works; authorization/effect not verified |
| `GGR_SaveCheckpointApproval` | Optional Pages-build endpoint injection and UI integration | Used only when configured; otherwise unavailable/disabled | Successful runs shown Oct 18–19; approval outcome not verified |
| `GGR_GetStudentProgress` | Optional endpoint; checkpoint compatibility and v2 restore contracts | Compatibility hook exists; full restore is gated OFF | Optional/unconfigured; full restore planned |
| `GGR_TeacherResetStudentPin` | Placeholder endpoint only | No production caller | Optional/unused |
| `GGR_RebuildLevelLeaderboard_OnProgressChange` | Placeholder endpoint only | No production caller | Optional/unused |
| `GGR_UpsertInvestmentProfile_OnProgressChange` | Placeholder endpoint only | No production caller | Optional/unused |
| `GGR_ImportAuditLogger` | Placeholder endpoint only | No production caller | Optional/unused |
| `GGR_ResetLevelProgress` | Contract and client capability planned | No live caller; `levelResetFlow` defaults OFF | Planned |
| `GGR_GetLeaderboard` | Server contract planned | No live caller; `serverLeaderboard` defaults OFF | Planned |
| `GGR_CopyCompetitionSnapshot` | Baseline/freeze contract planned | No live caller; flags default OFF | Planned |
| `GGR_Level6HistoricalResults` | Level 6 analytics contract planned | No live caller; `level6Analytics` defaults OFF | Planned |

### Historical inventory notes

The bundled `Current Flow Inventory.docx` reports `GGR_UpsertStudentProfile`
and `GGR_UpsertTeacher` as working, including observed successful runs. The
owner's later report that `GGR_UpsertTeacher` has never run conflicts with
that claim; the screenshot shows an empty 28-day history but cannot establish
whether older runs occurred. Treat the old claim as unconfirmed. The inventory
reports `GGR_TeacherUnlockStudent` as built/published with saves, but still
requests endpoint wiring confirmation and a first live run. It calls
`GGR_LoginTeacher` and `GGR_SaveProgress` unverified, `GGR_LoginStudent`
unknown, and `GGR_ChangeStudentPin` not built/not wired. Those PIN notes
conflict with current source, which contains both the endpoint wiring and the
student form integration; the old document is not a current deployment
record. These reports do not establish present-day flow behavior.

### Owner-supplied run-history evidence

Screenshots supplied Nov 8, 2026 show `GGR_LoginStudent` runs marked
**Succeeded** on Nov 6–7; `GGR_ChangeStudentPin` runs marked **Succeeded** on
Oct 20–22 and Nov 7; `GGR_SaveCheckpointApproval` runs marked **Succeeded**
on Oct 18–19; `GGR_SaveProgress` runs marked **Succeeded** on Nov 6; and
`GGR_UpsertStudentProfile` run entries on Nov 7 with the per-run status column
not visible. The owner described the latter runs as successful, but their
statuses cannot be independently read from the screenshot.
`GGR_GetDashboardData` is on and its screenshot shows runs marked **Succeeded**
on Nov 7–8; the owner reports that the dashboard still works. The owner also
reports that saved games are currently device-only and are missing from the
dashboard data. `GGR_LoginTeacher` is on with runs marked **Succeeded** on
Oct 27–29 and Nov 6–8; the owner reports their teacher login worked. The PIN
screenshot shows the flow is on, but the owner has not
recently changed a PIN and cannot independently confirm that the current
PIN-change path works. `GGR_TeacherUnlockStudent` is on and its screenshot
shows runs marked **Succeeded** on Oct 18–19 and Nov 8; the owner reports that
the unlock flow still works. `GGR_UpsertTeacher` is on, its 28-day run history
is empty, and the owner reports that it has never run.
Screenshots show run status (and, for some flows, selected input columns), not
the action outputs, resulting SharePoint rows or subsequent application
behavior. They therefore improve the evidence to “successful run observed,”
but do not establish correctness or acceptance.

The gameplay screenshot reports cloud saving paused and local-only saving.
Its successful browser asset requests are not Power Automate runs and do not
show that gameplay progress was saved by `GGR_SaveProgress`.

## How flows are built and wired

### Previously working behavior and current interruption

The owner reports that cross-device saving and progress tracking worked before
the upgrades associated with PRs 68–72, which were intended to address
backlogged runs and errors. This is the reported historical baseline, not a
claim that cloud saving or restoration never existed. The historical Oct 28
snapshot retrieved by Get Progress corroborates cloud storage and retrieval,
but by itself does not demonstrate cross-device game restoration.

Repository history confirms that PR 72, merged Nov 7, 2026, introduced an
explicit hold on unconditional legacy progress uploads. The current client
requires enabled v2 conditional saving, configured exact-slot retrieval,
server-verifiable student proof and a verified startup lookup before dispatch.
Its local-only/paused messages are therefore not evidence that the legacy
Power Automate flow stopped executing. The supplied gameplay screenshot shows
these prerequisites are not configured or verified for that session.

The supplied legacy save flow does not implement the v2 response contract.
This establishes a gap between the current client's prerequisites and the
supplied tenant save definition; it does not establish the exact first failing
deployment or exclude other changes in PRs 68–71. Restoring the previously
working user outcome requires resolving that integration gap safely, not
merely marking the legacy flow failed or turning off save protections.

1. **Endpoint registry:** `shared/flow-endpoints.js` provides endpoint defaults
   for the core flows and merges runtime/dashboard overrides. Placeholder and
   empty values are treated as unconfigured. Do not copy endpoint values into
   documentation or public messages.
2. **Capability registry:** `shared/level-capabilities.js` is the canonical
   flow-status and feature-gate registry. Planned flows require both a
   literal-`true` runtime flag and a configured endpoint. Flags default OFF.
3. **Pages build:** `.github/workflows/build-and-deploy.yml` creates
   `teacher/runtime-config.js` during a GitHub Pages build. It may inject
   endpoint overrides and feature flags from Actions secrets/variables. The
   generated file is browser-visible; Actions secret storage does not make
   values confidential after publication. Pull-request builds use validation
   configuration, not deployment credentials.
4. **Callers:** student authentication is in `shared/student-auth-client.js`;
   progress sync in `shared/sharepoint-sync.js`; full restore in
   `shared/cloud-restore.js`; teacher API methods in
   `teacher/dashboard-state.js`; approval UI wiring in
   `teacher/checkpoint-approval.js`.
5. **Validation:** repository checks use `node --test tests/*.test.js` and
   in-memory mocks. They validate client behavior and contracts, not a live
   Power Automate flow, SharePoint mapping, tenant authorization or student
   gameplay.

## Flow build details

### `GGR_LoginStudent` — student roster authentication

- **Build / use:** existing endpoint in the shared registry; called by the
  home-page sign-in through `shared/student-auth-client.js`.
- **Request:** class code, student ID and a runtime SHA-256 PIN hash. PINs and
  hashes are not saved in the browser session.
- **Expected flow work:** find one active `GGR_Students` row matching class
  and `StudentID`; verify the credential; return authoritative identity and
  level fields from that roster row. Success requires `ok:true` plus complete
  identity (`studentCode`, `studentId`, `studentName`, `leaderboardName`,
  `classCode`, `assignedLevel`). The roster's `Level` is the teacher-assigned
  level; `ProgressedLevel` and `CurrentLevel` are separate fields.
- **Security / data rules:** do not echo request identity as verified roster
  data or return PIN/hash/salt. Generic failures should not reveal whether a
  student exists. The browser session is not a server-issued authorization
  token; student-scoped backend operations need server-verifiable proof.
- **Build verification:** supplied screenshots show runs marked Succeeded on
  Nov 6–7, but do not show the response or verify roster mapping, PIN policy,
  active-row behavior or the returned identity. Historical inventory marks
  this flow unknown.
- **References:** [student login and progression guide](student-login-progression-repair.md#canonical-roster-contract),
  [flow contract](flow-registry-and-contracts.md#ggr_loginstudent).

### `GGR_LoginTeacher` — teacher sign-in

- **Build / use:** existing endpoint; `teacher/dashboard-state.js` calls it
  when a teacher signs in, with teacher email and a required class code.
- **Expected flow work:** validate an active `GGR_Teachers` row and return
  authoritative teacher identity, role and class scope. Admin status comes
  from the teacher row; there is no client-side admin bypass.
- **Security / data rules:** dashboard filtering is presentation only.
  `GGR_GetDashboardData` and all teacher mutations must enforce teacher/class
  authorization on the server. Browser `sessionStorage` fields are not proof
  of identity.
- **Build verification:** the owner reports their teacher login worked, and a
  supplied screenshot shows runs marked Succeeded on Oct 27–29 and Nov 6–8.
  The screenshot does not show the response or establish active-row checks,
  role/class mapping or rejection of unauthorized requests.

### `GGR_ChangeStudentPin` — student PIN setup/change

- **Build / use:** endpoint wired and called from the home-page PIN form by
  `shared/student-auth-client.js`.
- **Request:** class code and student ID, `newPinHash`, and for ordinary
  changes `oldPinHash`. First-time setup sets `firstTimeSetup:true` and omits
  `oldPinHash`.
- **Expected response:** explicit `{ "ok": true }` only after a persisted
  update; errors return `ok:false` and a message. The client does not treat a
  generic success-shaped response as confirmation.
- **Flow rules:** independently authorize first-time setup/reset; require the
  old credential for normal changes; update credential/lockout fields only.
  Do not reset progression or change assigned/current levels as a side effect.
- **Build verification:** supplied screenshots show runs marked Succeeded on
  Oct 20–22 and Nov 7, but do not show whether a PIN was changed or persisted.
  The owner has not recently changed a PIN, so current PIN-change behavior and
  subsequent login have not been independently tested. Tenant PIN policy and
  first-time authorization remain unverified. The legacy inventory says
  “not built / not wired,” which is inconsistent with current client code and
  does not prove whether the tenant flow exists.
- **Reference:** [student login and progression guide](student-login-progression-repair.md#ggr_changestudentpin).

### `GGR_UpsertStudentProfile` — roster creation and import

- **Build / use:** existing endpoint called by teacher dashboard student
  creation and CSV/JSON import.
- **Payload:** student code and ID (distinct SharePoint fields), student and
  leaderboard names, class code, assigned `Level`, active state, primary
  teacher email and timestamp. Optional progression fields may be present in
  current client payloads as initialization suggestions, not trusted unlock
  authority.
- **Expected flow work:** upsert by `StudentCode`; validate `Level` 1–5;
  initialize new `ProgressedLevel`/`CurrentLevel` from assigned `Level`;
  preserve valid progression/current state, PIN data and lockout fields on
  ordinary re-import. Do not write economy state.
- **Build verification:** the legacy inventory reports runs, success,
  SharePoint student creation and authentication fixed. A supplied screenshot
  also shows Nov 7 run entries with student/class/progression columns selected,
  but not their status. The owner describes these runs as successful. Neither
  source verifies the resulting SharePoint values, server preservation rules
  or current schema mapping.
- **Reference:** [student login and progression guide](student-login-progression-repair.md#ggr_upsertstudentprofile-and-imports).

### `GGR_UpsertTeacher` — teacher creation/import

- **Build / use:** existing endpoint called by dashboard teacher management
  and teacher import.
- **Purpose and wiring:** create or update `GGR_Teachers` records by email
  from the dashboard's Add Teacher form, Teacher Import, or teacher rows in a
  mixed roster import. A single Add Teacher action uses `upsertTeacher`;
  imports use `bulkImportTeachers` if configured, otherwise send each valid
  teacher row to `upsertTeacher`. Dashboard reads and teacher sign-in use
  separate flows, so they can work without this flow running. Existing teacher
  rows can also be maintained directly in the Microsoft List.
- **Whether needed:** the checked-in client already has an endpoint and caller;
  no new client wiring is needed in principle. Verify that the deployed
  endpoint targets this actual tenant flow before relying on dashboard teacher
  writes. It is not required for dashboard reads or existing teacher sign-in;
  it is needed for dashboard Add Teacher and, absent a bulk alternative,
  teacher imports. Direct List management is an alternative if authorized.
- **Expected flow work:** upsert teacher roster data and preserve the
  established teacher schema (`TeacherEmail`, `TeacherName`, `Role`, `Active`,
  `AllowedDashboardAccess`, `ClassCodes`, `DomainValidated`,
  `LastUpdatedUtc`). Teacher role/class decisions must be backed by trusted
  administrative policy, not client-supplied session claims.
- **Build verification:** the owner reports this flow has never run. The
  screenshot shows it enabled and no runs in the 28-day history; it does not
  establish older history. This conflicts with the legacy inventory's claims
  of successful runs and working imports, which cannot be relied on here.
  The reason for the empty history is unknown: teacher write actions may not
  have been used, imports may use a bulk endpoint, requests may fail before
  reaching the flow, or the configured endpoint may target another flow.
  Do not assume any one cause. With an authorized test account, inspect
  dashboard `?diagnostics=1`, submit a valid test teacher, check the last
  upsert request and matching flow run, then verify the List row and dashboard
  read-back. Keep URLs, keys and personal data out of shared diagnostics.
  Verify admin-only server authorization, class scope, schema mapping and
  denial cases before enabling routine use.

### `GGR_SaveProgress` — per-level progress save

- **Owner-supplied deployed definition (Nov 8, 2026):** the HTTP POST trigger
  has a schema describing a snapshot with nested `player` fields. The schema
  does not list top-level `studentCode`, `classCode`, `level` or
  `progressionMarkersJson`, but the supplied compose expressions read those
  top-level fields. The schema has no top-level `required` list. This
  discrepancy does not by itself prove a request is rejected: actual trigger
  validation and action inputs require a redacted run or further verification.
  The checked-in client builds a flat progress payload and holds its cloud
  uploads pending safety gates; it does not send the snapshot as the entire
  request body.
- **Observed lookup and write:** `StudentCodeNorm` and `ClassCodeNorm` trim
  and uppercase the top-level request fields. `LevelIn` uses
  `int(coalesce(triggerBody()?['level'], 2))`, so a missing or null level
  defaults to 2. `Get items` queries `GGR_StudentProgress` by normalized
  student code, class code and level with a limit of one row. If a row is
  returned the flow updates the first match using its existing `ProgressKey`;
  otherwise it creates a row with `CLASS|STUDENT|LEVEL` as the key. A limit of
  one cannot detect duplicate matching rows. `MarkersIn` reads the top-level
  `progressionMarkersJson`, defaulting to `{}`. Missing or null `currentRound`
  defaults to 1; `currentCash`, `currentAssets`, `netWorth`, `score` and
  `achievementsCount` default to 0; `badgesJson` defaults to `[]`;
  `sessionStatus` to `active`; `needsSupport` to false; and `supportReason`
  to an empty string.
- **Observed mappings and response:** create/update map progress, economy,
  checkpoint and quiz fields, including the existing `LaastPlayedUtc` internal
  name. The supplied update parameters do not explicitly map approval fields;
  that alone does not establish whether the connector preserves them in every
  case. `CheckpointPassed` compares `checkpointStatus` with `Passed`, whereas
  the checked-in checkpoint UI uses `quiz_passed`; confirm the tenant's actual
  values and resulting behavior. After the condition succeeds the supplied
  response is HTTP 200 with `{ "ok": true, "saved": true }`; it does not
  contain the v2 revision, generation and request receipt expected by the v2
  client. The supplied API-key condition compares `IncomingKey` with
  `ExpectedKey`; its false branch returns HTTP 401 with
  `{ "ok": false, "error": "unauthorized" }`. The sources of those compose
  outputs were not supplied. A shared browser key is not student
  authentication.
- **Safety:** do not enable or replay cloud writes based on the successful
  legacy run history. The supplied flow does not establish the authenticated
  conditional writes and exact-slot retrieval required by the current client.
  Verify concurrency, duplicate handling, authorization, checkpoint values
  and approval preservation before any rollout; see the acceptance runbook.
- **Build / use:** existing endpoint key, called through
  `shared/sharepoint-sync.js`. Client capture, queue, retry, quarantine and
  protocol-v2 code exist. Cloud uploads are held by default until the
  authenticated writer/retrieval gates pass; v2 behavior is gated OFF.
- **Save identity:** one `GGR_StudentProgress` row per canonical
  `UPPER(ClassCode)|UPPER(StudentCode)|Level` key. The `Level` is the game
  played, not the roster's assigned level or mutable current level.
- **Legacy contract:** per-level save data, correlation ID
  (`saveRequestId`), timestamps/version, economy summary, progression
  snapshot and checkpoint evidence. The server must validate the active
  roster identity, recompute the key, safely handle legacy keys and preserve
  teacher-owned approval fields.
- **v2 contract (implemented client, not tenant-deployed):** protocol version,
  run generation/run ID, base revision, content hash and starting cash;
  server-assigned monotonic revision, exact idempotency, durable receipts and
  conditional/ETag write. Conflicts are held for reconciliation, not blindly
  overwritten. The reference server is a test mock.
- **Build verification:** a supplied screenshot shows multiple runs marked
  Succeeded on Nov 6, including a `studentCode` column. A subsequently supplied
  SharePoint progress row contains a Level 2 snapshot saved and modified on
  Oct 28, 2026, including economy, mines, machinery and round history. This is
  evidence of a historical cloud-stored snapshot, not only a summary row.
  The owner confirmed the row came from `GGR_GetDashboardData`'s Get Progress
  output. It cannot be attributed to a particular save run, and the final
  dashboard response and rendered UI have not been inspected for this row. Its
  snapshot includes run metadata, but no top-level v2 revision or receipt is
  shown; a SharePoint ETag/version is not proof of the application's v2
  protocol. Current-device synchronization and cross-device restoration
  remain unverified. The supplied gameplay screenshot reports cloud saving
  paused and local-only saving. Timeouts are unknown outcomes, not proof of
  failure.
- **References:** [save repair spec](GGR_SaveProgress-repair-spec.md),
  [save protocol v2](save-protocol-v2.md),
  [controlling release and acceptance runbook](../operations/release-and-acceptance.md).

### `GGR_GetDashboardData` — teacher dashboard read

- **Build / use:** existing endpoint; the teacher dashboard uses it as the
  source for `Teachers`, `Students` and `Progress`. On failure the UI clears
  tables and provides retry; it does not substitute cached dashboard data.
- **Owner-supplied deployed actions (Nov 8, 2026):** `Get_Students`,
  `Get_Progress` and `Get_Teachers` are SharePoint Get items actions. Their
  supplied code views contain no filter, explicit column selection or row
  limit; pagination settings have not been verified. The supplied HTTP 200
  response returns `success:true` and each action's `body/value` directly as
  the `students`, `progress` and `teachers` arrays. The supplied diagram shows
  `ExpectedKey` and `IncomingKey` followed by an `API Key Valid` condition;
  its true branch runs `TeacherEmailNorm`, `Get Teacher` and a `Teacher Exists`
  condition before the three list reads. Its false branches have response
  actions. The expressions for the key check and teacher lookup and the failure
  responses have not been supplied. A teacher lookup alone does not establish
  authenticated identity or class-scoped authorization. Verify which columns,
  including private fields, the connector actually returns; avoid sharing
  unredacted response bodies.
- **Observed behavior:** the owner reports the dashboard still works, and a
  supplied screenshot shows runs marked Succeeded on Nov 7–8. The owner says
  current saved games are device-only and absent from the dashboard data.
  A subsequently supplied progress row contains a historical Oct 28 cloud
  snapshot; this means not all historical game data is device-only. The owner
  confirmed it came from Get Progress output, establishing that this action
  retrieved the historical snapshot. Final response delivery and UI rendering
  for this row remain unverified. A successful dashboard read cannot include newer local
  saves that have not reached its cloud data source.
- **Observed row shape:** the supplied progress row includes
  `ProgressionMarkersJson`, economy fields, checkpoint fields and SharePoint
  author/editor and link metadata. Its `LaastPlayedUtc` and `UpdatedUtc`
  values contain dates only, while `Modified` and the nested snapshot
  `savedAt` include times. The raw row therefore carries more information than
  the dashboard needs; verify the final response projection and authorized
  access. Personal details and raw row contents are not reproduced here.
- **Expected response:** teacher-authorized roster and progress arrays.
  Progress rows carry their per-level `Level`, class/student matching fields
  and checkpoint/approval fields used by the dashboard.
- **Flow rules:** authorize the teacher and class scope server-side; never
  expose data from another class to a non-admin. Client-side filtering is not
  authorization. Keep private student identifiers teacher-only.
- **Build verification:** live response completeness, exact SharePoint
  internal column mappings and class scoping are not established by code.
  The run-history screenshot and owner observation support that the dashboard
  read path is currently operating, but do not verify its full response,
  authorization or cloud game-save coverage. Legacy inventory says not to
  change the working path but does not include acceptance evidence.

### `GGR_TeacherUnlockStudent` — teacher account unlock

- **Build / use:** existing endpoint; a teacher dashboard state method posts
  the teacher email, student code, class code and reason for an unlock.
- **Expected flow work:** verify the active teacher's class/admin authority,
  identify the student in that class, then apply only the intended account
  lockout/unlock change. Do not alter PINs, assigned level or saved progress.
  Any progression effect must be monotonic and capped at the highest playable
  level.
- **Historical build information:** the bundled inventory says the flow was
  built/published and saved successfully, while endpoint wiring and the first
  live run were still to be confirmed. It also contains HTTP-trigger metadata;
  this page omits the trigger URL and does not treat client-supplied email as
  authenticated identity.
- **Build verification:** the owner reports that the flow still works, and a
  supplied screenshot shows runs marked Succeeded on Oct 18–19 and Nov 8.
  The run history does not verify current trigger authorization, server-side
  class authorization or the exact account change.

### `GGR_SaveCheckpointApproval` — teacher checkpoint approval

- **Build / use:** optional flow. The UI caller exists; Pages may inject an
  endpoint during deployment when configured. Without it, approval buttons
  remain disabled and no local-only approval is recorded.
- **Request:** student code, class code, level, diagnostic progress key,
  decision (`approved` or `retake_requested`), approver name/email and
  timestamp.
- **Expected flow work:** authenticate the teacher, verify class scope and
  passed checkpoint, recompute the canonical key and update exactly one
  progress row. Derive reviewer identity/time from trusted server identity;
  browser-supplied reviewer fields and shared API key do not authenticate a
  teacher. Approval progression must be monotonic and capped at level 5.
- **Build verification:** a supplied screenshot shows runs marked Succeeded
  on Oct 18–19. It does not show the action outputs or verify the approval
  update, authorization or progression effect. Approval is optional and is
  not currently a mandatory level-access gate.
- **References:** [approval security and migration contract](checkpoint-approval-security.md),
  [save repair spec](GGR_SaveProgress-repair-spec.md#ggr_savecheckpointapproval-new-optional).

### `GGR_GetStudentProgress` — checkpoint lookup / full restore

- **Build / use:** optional/unconfigured endpoint. The access guard has a
  checkpoint-compatibility hook. `shared/cloud-restore.js` supports a separate
  full exact-slot v2 restore, but it requires `fullCloudRestore:true` and a
  configured endpoint; the flag defaults OFF.
- **Checkpoint compatibility:** may return checkpoint evidence for an
  authorized student. This does not restore the full economy or game state.
- **Planned full restore:** `ggr.getStudentProgress.v2` request includes
  contract version, full-save mode, class/student/level/key and server-verifiable
  student proof. The response distinguishes a complete `found:true` save, a
  definitively queried `found:false`, and errors. Timeout, partial response or
  unauthorized request is never treated as “not found.”
- **Flow rules:** return only the authenticated student's exact progress
  slot; never use the teacher dashboard data endpoint for student restore.
- **Build verification:** no tenant endpoint, full-save payload or cross-device
  gameplay restoration is verified.
- **Reference:** [flow contract](flow-registry-and-contracts.md#ggr_getstudentprogress).

### `GGR_TeacherResetStudentPin` — teacher-forced PIN reset

- **Build / use:** optional placeholder in dashboard configuration; no normal
  production caller and no configured endpoint are established.
- **Proposed scope:** reset credentials only through a teacher/admin-authorized
  operation; do not touch progression, game state or unlocks. A reset should
  require an audit trail and explicit authorization.
- **Build verification:** no request/response contract, deployed flow or
  completed behavior is documented. The student self-service
  `GGR_ChangeStudentPin` is a separate flow.

### `GGR_RebuildLevelLeaderboard_OnProgressChange` — materialized leaderboard

- **Build / use:** optional placeholder; no production caller. The name
  suggests a progress-change-triggered/background flow, but trigger details
  are not present in the repository.
- **Proposed rules:** rank per-level progress rows using the same exclusions
  and metrics as `shared/leaderboard.js`; never rank by roster level or mix
  different level slots. Public output must use leaderboard nicknames and
  exclude private identifiers.
- **Build verification:** no definition, endpoint, trigger, or tenant test is
  provided. This is not the planned server leaderboard query; see
  `GGR_GetLeaderboard`.

### `GGR_UpsertInvestmentProfile_OnProgressChange` — investment profile

- **Build / use:** optional placeholder; no production caller. Trigger and
  action sequence are not specified.
- **Proposed keying:** profile data should be isolated by class, student and
  game level. The current browser investment profile is already scoped by
  class, student and level; legacy student-only entries remain unclaimed.
  Browser storage is not evidence of a deployed SharePoint contract.
- **Build verification:** no flow definition, list schema or tenant run
  evidence is present.

### `GGR_ImportAuditLogger` — import/action audit

- **Build / use:** optional placeholder; no production caller.
- **Proposed responsibility:** record authorized import/dashboard actions
  with bounded metadata and a useful audit trail.
- **Data restrictions:** never log PINs, hashes, signed trigger URLs, API keys,
  or full request bodies that contain them. Apply retention and access control
  to audit data.
- **Build verification:** no schema, trigger, endpoint or deployed flow
  evidence is present.

### `GGR_ResetLevelProgress` — one-level reset (planned)

- **Build / use:** planned contract; registry gate is `levelResetFlow`,
  default OFF; no deployed flow is evidenced.
- **Planned operation:** authorize and audit a reset for one student's one
  level; archive the existing snapshot; conditionally advance server-owned
  `RunGeneration`, create a new server `RunId`, and increment `Revision`.
  Preserve other levels, credentials, approvals and `ProgressedLevel`.
- **Required safety:** stale queued saves from the previous generation must
  fail; reset must be idempotent and conditional to prevent overwrites.
- **References:** [save protocol v2, reset generation](save-protocol-v2.md#4-reset-generation),
  [flow contract](flow-registry-and-contracts.md#ggr_resetlevelprogress-planned).

### `GGR_GetLeaderboard` — server leaderboard (planned)

- **Build / use:** planned contract; `serverLeaderboard` defaults OFF; no
  production caller or endpoint is established.
- **Planned request:** class scope(s), level, metric (`netWorth`, `profit` or
  `roi`) and limit, plus server-verifiable teacher proof.
- **Planned response/rules:** ranked public leaderboard names and public score
  fields; enforce class scope on the server; exclude held, conflicted,
  unrankable or under-review rows. Never expose student code, ID, name or
  credentials.
- **Reference:** [flow contract](flow-registry-and-contracts.md#ggr_getleaderboard-planned).

### `GGR_CopyCompetitionSnapshot` — competition baseline/freeze (planned)

- **Build / use:** planned canonical operation flow under
  `ggr.competitionSnapshot.v1`; `competitionBaselines` defaults OFF.
  Freeze/close/export additionally require `competitionSnapshots:true`.
- **Operations:** `capture_baseline`, `freeze`, `close`, and `export`.
- **Planned flow work:** authorize teacher and each class; capture baseline
  net worth, revision and generation from the canonical progress row; freeze
  immutable results; only close/export frozen snapshots. Never accept
  student-supplied baseline amounts or modify the progress row.
- **Privacy:** exports contain public nicknames and scores, not student
  identifiers or credentials.
- **Reference:** [competition baselines and freeze runbook](../operations/competition-baselines.md).

### `GGR_Level6HistoricalResults` — Level 6 analytics (planned)

- **Build / use:** planned and gated by `level6Analytics`, default OFF. No
  playable Level 6 or deployed analytics flow exists.
- **Planned payload:** versioned historical event/decision data, content and
  scoring versions, run identity and bounded event logs.
- **Planned flow work:** validate event IDs and versions; recompute/validate
  mastery components server-side; never trust a client-asserted competitive
  `masteryScore`; archive bounded historical event data.
- **Dependency:** Level 6 gameplay, history/cultural review, curriculum,
  scoring and save/restore acceptance must be completed first.
- **Reference:** [Level 6 blueprint](../architecture/level-6-goldfields-mastery-blueprint.md#8-flows-data-and-telemetry).

## What “complete” means for this project

The codebase contains active client integrations, endpoint configuration, and
detailed proposed contracts, but these are different milestones. To mark any
flow **completed**, record the deployed definition/version, verified list
internal names, redacted request/response and run evidence, authorization
checks, positive and negative test results, and rollback point in the tenant
acceptance record. Repository tests alone cannot satisfy that bar.

For rollout order, data backups, authentication, old-writer containment,
conditional save/retrieval, rollback and acceptance tests, use the
[staged release and tenant acceptance runbook](../operations/release-and-acceptance.md).
