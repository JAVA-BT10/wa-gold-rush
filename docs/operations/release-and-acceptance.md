# Staged release, rollback and tenant acceptance matrix

> **Status:** nothing here is live-verified. Repository tests (`node --test`) use mocks and harnesses only; they are **not** proof of deployment. Every gate below is **unchecked** until a person records evidence (redacted: no PINs, signed URLs, API keys or student-identifying run history).

**This is the controlling phased save/recovery operations runbook.** Supporting
contract documents are references, not independent activation instructions.
Client guard fixes can ship now; authenticated tenant services cannot be activated
until the gates below pass. Repository work does not deploy Power Automate flows,
modify lists, restore forensic records, or grant permission to create students.

Investigation scope: merged #67 introduced independent local slots with restore/
v2 OFF; #69/#71 hardened client protections without deploying a backend; #70
isolated Pages output. The current and pre-#67 login normalizers retain roster
identity/progression, not arbitrary game payloads. Home checkpoint hydration
and teacher dashboard hydration are not proof of an earlier dashboard-to-game
restore path. Supplied version-history evidence establishes replacement by a
different run, not safe persistence merely because SaveProgress returned 200.

**Remaining promotion blockers:** deployed server-verifiable student proof,
conditional writer/receipt feasibility, exact authorised retrieval, migration/
configuration consistency checks, run-aware profile reconciliation, measured
browser/CORS/capacity acceptance, and coordinated old-writer containment.
Cloud reset adapter/backend and bounded history archival are deferred. Shipping
this client guard repair does not clear any of these gates.

## Stages

| Stage | Description | Gate |
| --- | --- | --- |
| 0 | Design review of this draft PR | ☐ Reviewer approval |
| 1 | **Containment, backups and schema inventory** below. Stop unconditional writes to protected rows, including old clients, before retrieval rollout. | ☐ Backups stored ☐ Internal names recorded ☐ Legacy refusal verified |
| 2 | **Backend authentication, migration dry-run, then conditional writer**, then exact student retrieval. Implement services below; no dependency on a dashboard change. Reset remains disabled. | ☐ Authentication verified ☐ Migration approved ☐ S*, R* pass |
| 3 | **Client guard deployment**, all tenant flags OFF. Local play/save/export remain available; unverified and legacy cloud writes are held, including queued captures. | ☐ Local resume/export smoke test ☐ No console errors ☐ No unconditional progress requests |
| 4 | **Manual repair** of the two reported cases ([template](manual-repair-mixed-history.md)) | ☐ Both case reports complete (private) |
| 5 | **Coordinated class pilot:** only after stages 1–3 and isolated acceptance pass, ship a separately controlled pilot runtime with `saveProtocolV2` and `fullCloudRestore` together. Global Pages flags are NOT class scoping; backend entitlement and deployment audience must enforce the pilot. | ☐ Pilot sign-off ☐ Conflict UX understood ☐ Request budget passed |
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
| v2 server problem | Turn tenant flags OFF, retain server legacy-write refusal. All progress writes stay held; retain/export pending work. | Replay obsolete queued saves; strip v2 fields and resend |
| Restore problem | Turn tenant flags OFF. Local resume/export and checkpoint-only evidence remain separate from economy restore. | Treat errors/disabled/unconfigured as "missing" |
| Frontend regression | Deploy a known guard-capable build, or freeze progress writes server-side before rollback. | Re-enable any unconditional legacy writer against protected rows |
| Bad backend data | Restore rows from the export or version history manually; record a report | Bulk resets; net-worth-only "contamination" filters |

## Tenant acceptance matrix

### Phase 0 — contain and preserve (operator, not repository automation)

1. Use a dedicated approved test account, **not** the forensic demonstration
   account. Do not play/re-save the forensic account. Privately export complete
   list items, versions, original `ProgressionMarkersJson`, browser slots,
   progression ledger, pending queues, and flow definitions/connections/settings.
   Record backup checksums and a tested restore procedure in restricted storage.
2. Freeze the affected keys/classes at the writer or gateway. Enumerate *all*
   writers, including old HTTP triggers, cached tabs, retry queues and import
   jobs. Client flags cannot recall an in-flight request. Disable/replace obsolete
   triggers or enforce the same refusal at every writer before unfreezing.
3. Inventory internal names and actual tenant types. User-supplied evidence
   confirms the following **names**, not a complete schema/type export:

   | Existing internal names | Expected type / confirmation needed |
   | --- | --- |
   | `ProgressKey`, `StudentCode`, `ClassCode` | Text; inspect lengths, indexing, case normalization; unique `ProgressKey` only after duplicate remediation |
   | `Level`, `CurrentRound`, `CurrentCash`, `NetWorth`, `CurrentAssets`, `AchievementsCount` | Numeric; inspect decimals/required settings |
   | `ProgressionMarkersJson`, `BadgesJson`, `ProgressionStateByLevel`, `QuizAttemptsJson` | JSON-bearing text; confirm multiline/plain text and maximum effective size |
   | `SessionStatus`, `CheckpointStatus` | Choice; connector may return `{Value: ...}` |
   | `NeedsSupport`, `CheckpointPassed` | Confirm Boolean mapping |
   | `SupportReason`, `CheckpointLevel`, `QuizScore`, `QuizPassedAt` | Confirm exact text/number/date types and null handling |
   | `UpdatedUtc`, **`LaastPlayedUtc`** | Observed date-only; confirm date settings. Preserve the actual misspelling |
   | `Score`, `Score0` | Both observed; identify each consumer/mapping before any change |

   Do not automatically rename columns. Summary cash/net-worth rounding is
   intentional; restore from validated JSON precision, not rounded totals.
   SharePoint version/ETag is not application `Revision`; date-only fields
   cannot order competing saves.
4. Add only protocol metadata after review: persistent integer `Revision`,
   `RunGeneration`, `RunId`, nullable `StartingNetWorth`, storage-schema marker,
   and bounded row-atomic `RecentRequests`/last-request metadata. Snapshot JSON
   already exists; no redundant snapshot column is required. Back up raw state
   before any conversion.

### Phase 1 — authentication prerequisite (tenant design blocker)

The shared API key, public trigger URL, login-shaped session object and client
fingerprint do not authenticate a student. Keep flags OFF until a school-approved
server can verify identity proof and class/student/**played-level** entitlement
on **get, save and reset**. The roster assignment is not permission to overwrite
another level or another student's row.

Choose and validate either school identity (e.g. Entra-backed authorised gateway)
or an opaque, short-lived, revocable server session issued following real
`GGR_LoginStudent` verification. The login normalizer intentionally retains
identity, not economy or arbitrary tokens. A tenant integration must install the
external proof provider/transport; do not casually add economy to auth storage.
No homemade signing/encryption, client hash or PIN-derived bearer proof.
The browser's per-write `sessionInstanceId` is only a local lifecycle/race
marker. It is not sent as proof and must never be accepted as authentication.
Prefer secure same-origin HttpOnly session handling where feasible; cross-origin
cookie or Authorization transport requires actual browser/CORS testing. Never
persist bearer proof in progress envelopes, queues, diagnostics or public config.

Document expiry, revocation/logout, audience/origin, replay policy, CSRF controls
where cookies apply, secure CORS allowlist and preflight, and rejection of expired,
wrong-class, wrong-student and unauthorised-level requests. Generic errors and a
server-generated opaque correlation ID must reveal no roster or other rows.
Provider setup alone is not tenant verification. No authenticated gateway/flow
means **blocked**, not an invitation to accept the shared key as proof.

### Phase 2 — migration dry-run and immutable identity

1. Run a read-only exact-key inventory. Report zero/one/duplicate rows, invalid
   keys/ownership, schema versions, malformed JSON, unknown mine/equipment IDs,
   computed net-worth/config inconsistencies and serialized byte sizes. Do not
   pick the newest/highest-round row. Resolve duplicates privately before
   enforcing unique `ProgressKey`.
2. Use the explicit converter and its tests as a schema reference, **not a
   deployed migration service**. Existing raw shape has `assignedLevel`/
   `currentLevel`, top-level `companyName`, `player`, `progressionStateByLevel`,
   and `run`; envelope shape has `owner`, `level`, `generation`, `runId`,
   `startingNetWorth`, `snapshot.player.companyName` and `snapshot.progression`.
   Preserve mines, machinery, round history, plans, cash precision and investment
   profile. Profile, ledger/checkpoint evidence and economy are distinct.
   Profile entries now use class/student/level ownership; historical student-only
   profile entries remain untouched but are **not automatically attributed to a
   class**. Export those entries before rollout and recover only from a verified
   owned snapshot or explicit operator-approved mapping. A zero new scoped
   profile does not prove that no legacy profile existed.

   **Unresolved profile release gate:** scoped profile buckets currently have
   no run identity. Loading a cloud snapshot uses per-bucket maxima, so existing
   local class/student/level buckets can override the exact incoming profile
   even when the economy slot is missing (including history from an older run).
   The empty-profile-store roundtrip test does **not** resolve this case.
   Keep the coordinated cloud pilot blocked until profile history is retained/
   archived and either run-bound or explicitly reconciled before an approved
   exact replacement. Never silently discard genuine local profile evidence,
   combine different runs, or infer its run from the current ledger. The
   `save-contract.test.js` release-blocker vector reproduces this limitation;
   it is diagnostic evidence, not a passing acceptance gate.
3. Preserve a valid original run ID/generation. Missing metadata requires
   authorised, recorded one-time migration allocation, not a random run or a
   plausible empty snapshot on every read. Unknown baseline remains null;
   never substitute today's starting configuration. Unknown schema, ambiguous
   ownership or unsupported conversion is review-required.
4. Apply only after dry-run approval against the backed-up row's exact ETag.
   Persist initial application revision **once** and conversion provenance
   (source checksum/version + migration version) server-side. Re-run must be a
   no-op for the same source; existing new slots are preserved, not overwritten.
   Keep original raw JSON privately recoverable. Retrieval must never invent
   revisions or run metadata.

### Phase 3 — build `GGR_SaveProgress` conditional writer first

Use the [v2 wire contract](../power-automate/save-protocol-v2.md) and actual
`save-protocol.js` interpreter, not an HTTP-200 success heuristic.

1. Trigger/gateway authenticates and validates bounded JSON, exact canonical key,
   supported level/schema, finite economy, run identity and entitlement. Refuse
   legacy payloads for all protected rows/keys (`legacy_writer_refused`, HTTP
   422). Protect create paths too; a legacy writer must not race migration.
2. Recompute/compare canonical content using a validated implementation.
   **Blocker:** Power Automate expressions do not provide the JavaScript
   canonicalization/cyrb53 fingerprint semantics automatically. Trusting only
   client `contentHash` plus length is insufficient for request-ID reuse.
   Use a validated gateway/custom connector that compares canonical content
   exactly (or a server-computed collision-resistant digest with stored canonical
   request) and runs the same contract vectors. No bogus expression recipes.
3. Query unique receipt `(authorised principal, ProgressKey, saveRequestId)`.
   Same ID + exact same immutable content/base/run returns its original revision
   with `deduplicated:true`; different content returns HTTP 422
   `request_id_reused`. **Dedup precedes generation/revision checks**, including
   retries received after later accepted saves/reset.
4. Exact-key indexed lookup with top 2. Duplicates/malformed rows fail closed.
   Read the actual ETag. Check row-atomic `RecentRequests` if a separate receipt
   is absent, recover its original acknowledgement and repair the receipt.
   `baseRevision:null` is create-only: existing row → HTTP 409 `row_exists`.
   Use unique-key create and handle its duplicate race as conflict.
5. Existing row: generation and run ID must match. Old generation → HTTP 422
   `generation_stale`; same generation/different run or revision mismatch → HTTP
   409 `revision_conflict`. No client-selected winner or authoritative revision.
6. Use **Send an HTTP request to SharePoint** with PATCH/MERGE and the *exact*
   read ETag in `IF-MATCH`, never `*`. Commit economy, server-incremented Revision
   and bounded `RecentRequests` together in the **same item**. Ordinary Update
   item/read-check-write or trigger concurrency alone is not sufficient.
   HTTP 412 → re-read only to check dedup, otherwise `precondition_failed`.
7. After row commit, persist `GGR_SaveReceipts` acknowledgement. Its unique key,
   principal, key/request ID, canonical content/base/run binding, original
   revision and retention deadline must permit exact lost-response recovery.
   On failure do not reapply the economy. A retry finds row-atomic history and
   repairs the receipt. Before evicting any history entry, prove its receipt is
   durable; if that cannot be guaranteed, stop accepting writes rather than
   silently losing dedup. Never let a queued ID outlive the dedup retention
   promise; expired IDs are explicitly rejected, not treated as fresh writes.
8. Configure Try/Catch/Finally scopes with run-after failure/timeout paths and
   one bounded Response branch outside row loops. Success must echo
   `{ok:true,protocolVersion:2,saveRequestId,progressKey,runGeneration,revision,
   deduplicated}`. Errors use `{ok:false,code,retryable}`; HTTP 401/403 for auth,
   422 for permanent validation/stale/reused ID, 409/412 for conflict, 429/503
   with retryable true for throttling/unavailable. No error may return success.

**Feasibility gate:** validate exact If-Match connector behavior, uniqueness,
canonical content comparison and row/receipt crash windows in the actual tenant.
If pure flows cannot satisfy them, use a school-approved transactional service
behind the gateway (with an outbox/receipt transaction), or remain local-only.
These are build instructions, not a claim that a production backend exists.

### Phase 4 — build `GGR_GetStudentProgress`, then isolated acceptance

1. Authenticated POST receives
   `{contractVersion:"ggr.getStudentProgress.v2",mode:"full_save",classCode,
   studentCode,level,progressKey}`. Recompute key from authorised identity, never
   query a teacher dashboard dataset. Student response returns only this slot,
   no roster names, credentials, other students or teacher metadata.
2. Exact indexed lookup with top 2: zero after a successful complete query →
   `{ok:true,contractVersion,progressKey,found:false}`; one validated row →
   `{ok:true,contractVersion,progressKey,found:true,revision,runGeneration,save}`.
   `save` is the full **validated envelope**, not a raw top-level snapshot.
   `revision` integer ≥1; optional generation must match envelope. Unknown
   schema, duplicates or malformed rows → typed error, never missing.
3. Query/connector/auth/timeout failure → `{ok:false,code,retryable}` with
   appropriate non-2xx status. Catch failures; no Response actions in per-row
   loops. Verify POST/JSON headers, allowed Origin/preflight and credentials
   handling in a real browser. Complete within the measured client restore
   deadline (currently 8 seconds); don't mask late responses as absence.
4. Two independent browser storages A/B: save on A, restore on B, assert exact
   round, company, mine/equipment details, precision, run and profile; guest
   profile must not win. Test local genuine work conflicts, unknown → retry,
   malformed/duplicate rows, local quota/read/adoption failures, multi-tab and
   account switching during requests. Preserve/export conflicts before any
   operator-approved adoption. No highest-round/latest-time automatic winner.

### Phase 5 — reset, capacity and deployment promotion

Cloud-backed **Restart This Level remains disabled** in this repair. Merely
configuring a reset endpoint/flag is not implementation. Future authorised
`ggr.resetLevelProgress.v2` request must bind exact key, resetRequestId,
baseRevision, previous generation/run and reason. Dedup first, archive verified
source durably, exact If-Match advance revision/generation and assign a new run,
commit receipt, then echo key/request ID/new run/generation/revision. Stale
pre-reset saves cannot recreate the old run; first-visit create is not reset.
No changes to other levels, credentials, authoritative approvals or unlocks.
Archive/row atomicity is a separate feasibility gate; block reset if unresolved.

Deployment operator: runtime endpoint overrides and allowlisted flags are
generated by `.github/workflows/build-and-deploy.yml`, not just the tracked
stub. Use main-only secrets for endpoint values and reviewed variables for
flags. PR validation is secret-free and forces flags OFF. Do not copy signed
URLs into source or acceptance reports. Proof-provider integration is an
additional prerequisite; setting flags/secrets alone is insufficient. Verify
the **active built artifact**, version/cache-busting, configured booleans and
transport readiness with redacted runtime diagnostics, not keys or URLs.
On the active game page, `SharePointSync.getDiagnostics({level: 2})` returns
allowlisted versions/status and prerequisite booleans only. Provider-present is
not proof-valid, endpoint-configured is not deployed/accepted, and local
`found` is not cloud persistence. Do not copy runtime config itself into reports.

| GitHub setting (main deployment only) | Generated runtime field |
| --- | --- |
| Secret `WA_GGR_SAVE_PROGRESS_URL` | `flowEndpoints.saveProgress` (optional override; absent retains existing endpoint) |
| Secret `WA_GGR_GET_STUDENT_PROGRESS_URL` | `flowEndpoints.getStudentProgress` |
| Secret `WA_GGR_RESET_LEVEL_PROGRESS_URL` | `flowEndpoints.resetLevelProgress` (not an enabled reset adapter) |
| Existing `WA_GGR_SAVE_CHECKPOINT_APPROVAL_URL` / `WA_GGR_API_KEY` secrets | Existing approval endpoint / public client API-key config |
| Variable `WA_GGR_SAVE_PROTOCOL_V2` | `featureFlags.saveProtocolV2`; only exact string `true` enables, default false |
| Variable `WA_GGR_FULL_CLOUD_RESTORE` | `featureFlags.fullCloudRestore`; same literal-true rule, default false |
| Other allowlisted variables in workflow | Keep unset/false: reset, server leaderboard, competition and Level 6 analytics |

Do not set the two pilot variables until auth/provider deployment and all
preceding gates pass. `holdUnverifiedNewSlotUploads` alone is not protection
for existing slots and is no longer the dispatch safety boundary.

Budget before pilot: measure bytes for long `roundHistory`, profile, receipts
and archives; connector/list text/request limits; P50/P95/P99 response latency
below client timeout; saves per minute × concurrent students × lookup/write/
receipt operations; 429/backoff, response loss and bounded queue retention.
Do not silently truncate JSON or history. Keep archival/compaction deferred
until a versioned lossless bounded-history design and retrieval are validated.
Local archives/journals consume quota too and are not permanent backups;
export them privately before prolonged offline play or reconciliation.

Only promote a coordinated class pilot after conditional writer **and**
authenticated retrieval acceptance. Never activate retrieval against an
unconditional production writer. Keep reset/competition/Level 6 flags OFF.
Rollback retains writer refusal and receipts; it cannot replay legacy queues.

### Acceptance evidence record (one per gate/test)

```
Gate/test ID:
Environment and client build/version:
Flow/gateway exported version; schema inventory/backup reference:
Approved test-account alias (not forensic account):
Tester role/date:
Independent storages/browsers and network conditions:
Expected outcome; observed outcome; pass/fail:
Redacted correlation ID and restricted evidence reference:
Request count/serialized bytes/latency/throttle observations:
Old-client/in-flight/response-loss/rollback result:
Remaining blocker; owner; approval to promote (or remain OFF):
```

Do not include real student identifiers, tenant URLs, run IDs, credentials,
tokens or private traces. Mock test totals are not live tenant acceptance.

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
| S12 | SaveProgress | Legacy/old cached client payload (v1) against protected rows | Refused server-side, including requests already in flight; no economy mutation | ☐ |
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

Command: `node --test tests/*.test.js` (from the repository root).

- `tests/wiring-reliability.test.js` covers the existing behaviour (updated for per-level slots).
- `tests/per-level-architecture.test.js` covers the per-level architecture, the reference save server, gated sync/restore, leaderboards and Level 6 gating.
- `tests/competition-validation.test.js` covers wrapped review/conflict markers and strict snapshot count validation.
- `tests/pipeline-validation.test.js` exercises the actual validation-only build and deployment test gates without tenant secrets.
- `tests/pages-build.test.js` executes generated config through the packaged registries.
- `tests/save-recovery.test.js` covers real client-adapter/transport harness startup,
  dispatch holds, recoverable reads, session races and receipt retries.
- `tests/cloud-adoption.test.js` covers journal failure stages, strict snapshots
  and same-millisecond delayed acknowledgements.
- `tests/save-contract.test.js` covers conversion, proof transport, profile
  roundtrips and explicit unresolved profile evidence, plus reference receipt
  crash/capacity semantics. These are mocks/harnesses, not a deployed service.

PRs build and verify a validation-only Pages artifact without tenant secrets, then run all regression suites. Deployable main revisions build and verify the deployment artifact, run the same required tests, then upload and deploy that artifact. Failed builds or tests block deployment; PR and non-main artifacts are not deployed.

### Reliability-hardening boundaries

Terminology meanings are recorded here without changing repository field names:

- `YearLevel` = teacher-assigned starting game level.
- `CurrentLevel` = level currently being played.
- `ProgressedLevel` = highest authorized playable level.

This repair makes no YearLevel migration, AssignedLevel refactor, or automatic
column renaming. Canonical `Class|Student|Level` identities and slot key formats
are preserved. It ships client guards, proof/conversion extension points and
disabled runtime deployment wiring; it does **not** apply live SharePoint schema
changes or deploy Power Automate services. The conditional contracts and tenant
actions above remain acceptance-gated. Progression/teacher-approval authority
is unchanged.

Live tenant SharePoint/flow mappings remain under verification. Repository contract tests do not establish live tenant column mappings; tenant mapping evidence and acceptance remain separate from this hardening work.

All capability flags remain default OFF, including Save Protocol V2, Cloud Restore, and competition capabilities. Level 6 remains recognized but non-playable, non-assignable, and outside the save pipeline.

Upload holds prevent future dispatch for the affected key, including retries. They do not cancel or undo requests already dispatched.

Results are recorded in the PR description.
