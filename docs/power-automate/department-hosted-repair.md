# Department-hosted Release 1 repair handoff

Repository changes do not deploy Power Automate actions or change Microsoft
Lists. Cloud saving remains held until the authenticated conditional writer and
exact-slot retrieval pass the controlling
[release runbook](../operations/release-and-acceptance.md).
This repair uses Department-hosted Power Automate and SharePoint only; no
additional server hosting is assumed. Do not enable flags to bypass missing
services.

## Verified mappings to repair

Back up Lists, versions and flow definitions before applying these operator
changes. Preserve browser saves and original snapshot JSON. Test with synthetic
accounts; never put production records, PIN hashes or signed URLs in GitHub.

| Surface | Supplied definition | Required correction |
| --- | --- | --- |
| Profile update | `item/YearLevel = triggerBody()?['yearLevel']` | Validate the browser's integer `Level` (currently 1-5), then map `item/YearLevel = triggerBody()?['Level']`, as Create already does. Return valid JSON `{ "ok": true, "entity": "student" }`, without trailing backticks. |
| Profile metadata | Update rewrites `CreatedUtc` and hardcodes `Active` | Preserve creation time on update. Validate and honor requested active status with authenticated teacher/class authorization. |
| Progress lookup | StudentCode + ClassCode + Level, Top Count 1 | Preserve all three partitions. Query up to two matches and reject duplicates. Inventory/remediate duplicate canonical keys before enabling uniqueness. |
| `Progress_Exists` | Existing row uses PatchItem; missing row builds `CLASS|STUDENT|LEVEL` and uses PostItem | Both branches exist. Apply the same validated snapshot/status mappings to both; protect first-create races with canonical-key uniqueness after duplicate remediation and return explicit conflict receipts. |
| `MarkersIn` | `coalesce(triggerBody()?['progressionMarkersJson'], '{}')` | Reject absent/blank/malformed snapshot JSON before any write. Parse and validate identity, played level, supported schema and complete state; never replace a snapshot with `{}`. |
| Checkpoint Boolean | `equals(triggerBody()?['checkpointStatus'], 'Passed')` | Current wire status is `quiz_passed`. Derive Boolean from a validated quiz result using that canonical status; never trust a student-supplied Boolean or approval. |
| Quiz/progression JSON | `string(triggerBody()?['quizAttemptsJson'])` and `string(triggerBody()?['progressionStateJson'])` | These wire fields are already JSON strings. Parse once to validate array/object shape, then store their JSON text exactly once. Verify the stored field parses directly to the intended array/object, not a quoted JSON string. |
| Snapshot timestamps | List Modified/UpdatedUtc can change independently | A fresh economy save must update full snapshot and summaries together. Display snapshot `savedAt` separately from administrative modification time. |
| Save acknowledgement | HTTP 200 `{ "ok": true, "saved": true }` after `Progress_Exists` | This is not a v2 receipt: it lacks the exact key, request ID, run/generation and committed revision required by the client. Keep cloud activation blocked until the conditional writer returns the verified protocol response. |

Preserve internal names including `LaastPlayedUtc`. Identify consumers of
`Score`/`Score0` and `ApprovalTimestamp`/`ApprovalTimestamp0` before changing any
mapping. Do not delete or rename duplicate display-name columns automatically.
Unwrap SharePoint Choice `.Value`; normalize approval enum case at the boundary.

The actual current browser payload is built by
`SharePointSync.buildProgressPayload`: summary fields plus
`progressionMarkersJson`, `progressionStateJson`, `quizAttemptsJson`, checkpoint
fields and protocol metadata. The full game is inside snapshot JSON. The
previously supplied trigger schema instead describes full snapshot fields at
the root. Compare an actual redacted request with the **deployed** schema before
editing it; nested integer restrictions do not validate JSON inside a string.
When validating the decoded snapshot, preserve finite fractional economy/history
values and nullable legacy starting baselines. Never round restored game state
to fit an integer trigger schema.

## Power Automate feasibility and remaining evidence

The operator confirmed availability of **Send an HTTP request to SharePoint**.
Use an exact ETag and `If-Match` for atomic updates, with no wildcard match or
unconditional PatchItem fallback. Verify HTTP 412 conflicts using two writers
against the same captured version. Automatic retry must not turn a stale
conditional request into a fresh overwrite.

Before production activation, the operator must supply or verify:

1. Remaining save-flow normalization and authorization actions, trigger
   effective authentication and concurrency/retry settings. Create/update
   branches and the legacy Response are now supplied, but not live-tested.
2. Server-side student session issuance after the existing Class Code/Student
   ID/PIN verification, revocation/expiry and proof validation on each get/save.
   Department storage and teacher dashboard authentication do not by themselves
   establish student save authorization. No shared browser key or local session
   object is identity proof. Do not invent a signing recipe or use PIN hashes
   as bearer credentials.
3. Atomic save receipts in the same protected row as the snapshot/revision:
   repeated request ID with identical immutable request returns its original
   receipt; reused ID with changed content is rejected. Power Automate must
   compare validated request content, not trust the client's contentHash.
   Bound retained receipts and measure actual List payload limits.
4. Exact authorized retrieval of a complete versioned envelope and revision.
   A genuine missing slot must be distinguishable from errors, unauthorized
   access, duplicate records or unsupported snapshots.
5. Authenticated teacher decision persistence and read-back. Approval actions
   must recheck completed-level quiz evidence from the server, derive reviewer
   identity server-side and preserve decisions against stale student saves.
   Update roster entitlement only after the authorized decision is persisted;
   verify recovery of a partially completed cross-list update.

There is no deployed `GGR_GetStudentProgress` in the supplied evidence. Trace
the previous retrieval integration before deciding whether to add that flow or
provide the required contract through an existing authorized route. Never give
student pages the full teacher dashboard roster response to restore one save.
Checkpoint-only reads now also require the ephemeral proof provider and exact
class/student/level ownership; a passed quiz without approval remains locked.

## Agreed access and release boundaries

- Level 1: public practice, no login/placement/quiz locks and no student writes
  from guest practice. The present page has no leaderboard. Any connected
  leaderboard must authorize students for both viewing and submission.
- Levels 2-5: repaired together through the shared engine, independent saves and
  dashboard normalization. Initial teacher placement permits the starting level;
  subsequent advancement requires completion, passed quiz and teacher/admin
  approval. Preserve existing authorized roster decisions; flag historical
  conflicts for operator review, not bulk resets.
- Teachers/admins: retain Department authentication and class-scoped access.
  Filter dashboard output to authorized fields; never return PIN hashes.
- Level 6: separate agreed Release 2 using the
  [Goldfields Mastery blueprint](../architecture/level-6-goldfields-mastery-blueprint.md).
  Resolve chronology, simulation length, scoring and review decisions before
  implementation. Do not label the existing planning-only level as repaired.

## Required acceptance for every level 2, 3, 4 and 5

For each level, use an isolated synthetic student initially placed there:

1. Save a nontrivial game including fractional cash, mines, machinery, history,
   plans, investment profile and run identity. Confirm the exact row's stored
   snapshot and receipt, not merely flow HTTP 200 or LastSeenUtc.
2. Sign in on a second device with no local slot. Restore the same complete
   state, played level and run. Existing local profile history must not merge
   another run into the incoming snapshot; that remains a cloud release blocker.
3. Change the game on both devices. Reject the stale writer without losing
   either local save; offer explicit reconciliation. Retry a lost acknowledgement
   and prove it does not increment the revision or duplicate the write.
4. Test offline play/reconnect, expired proof, wrong class/student/level,
   malformed/missing snapshots, duplicate slots and blocked legacy writers.
   Errors must never be interpreted as an empty cloud slot.
5. Verify dashboard assignment remains the roster assignment while played level
   comes from the corresponding progress slot. Roster edits and teacher
   decisions must survive fresh read-back without silently changing old saves.
6. For levels 2-4, pass a quiz and verify the next level stays locked until a
   persisted approval; test direct links and home cards. For level 5, approval
   confirms completion but does not unlock the still-unimplemented Level 6.
7. Verify public Level 1 remains playable without writing student data, while
   anonymous leaderboard get/submit requests are rejected by any connected
   service.

Promotion requires operator-recorded tenant/browser evidence. Mock tests alone
are not production sign-off. Keep backups and legacy-write refusal during
rollback; never replay obsolete queued requests into protected rows.
