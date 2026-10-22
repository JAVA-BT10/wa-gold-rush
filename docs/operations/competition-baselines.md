# Competition baselines and freeze runbook

## Scope and architecture

Competition scoring is additive to the existing save model. `GGR_StudentProgress`
continues to hold exactly one progress row per `Class|Student|Level`; competition
baselines and frozen results do not create a new game, rewrite a save, or require
per-level SharePoint lists.

A baseline record has this shape:

```json
{
  "competitionId": "term-1",
  "classCode": "6B",
  "level": 2,
  "studentCode": "SC-1",
  "baselineNetWorth": 300,
  "baselineRevision": 4,
  "baselineGeneration": 1,
  "baselineCapturedAt": "2026-10-22T12:00:00.000Z",
  "status": "active"
}
```

The baseline identity is `competitionId|classCode|level|studentCode`. The tenant
implementation should keep these records in one competition-baseline store (for
example, one `GGR_CompetitionBaselines` list) and frozen results in one results
store; do not create one list per level. These stores and flows are tenant work,
not deployed by this repository.

`competitionProfit = currentNetWorth - baselineNetWorth`. It is ranked only
within the same competition, class, and level, and each class receives its own
rank sequence. Missing/duplicate/invalid baselines and duplicate progress rows
are unrankable. Held or
under-review progress is excluded. A changed generation after capture indicates
a reset and is unrankable; unresolved save/revision conflicts, missing revision
or generation proof, and stale revisions are also unrankable. Existing
`netWorth`, `profit`, and `roi` metrics are unchanged.

Live ranking accepts only `active` baselines. Frozen/closed standings must be
read from the immutable server snapshot, never recalculated from mutable current
progress rows.

Competition output contains only the public leaderboard nickname, class, level,
rank, metric, and existing public score fields. It never contains `StudentName`,
`StudentID`, `StudentCode`, PINs, hashes, or raw baseline records.

## Canonical flow contract (planned; not tenant-verified)

Use one canonical operation path: `GGR_CopyCompetitionSnapshot`, registry key
`copyCompetitionSnapshot`, contract version `ggr.competitionSnapshot.v1`.
It accepts exactly one operation per request:

- `capture_baseline`
- `freeze`
- `close`
- `export`

Request shape:

```json
{
  "contractVersion": "ggr.competitionSnapshot.v1",
  "operation": "capture_baseline",
  "competitionId": "term-1",
  "classCodes": ["6B"],
  "level": 2,
  "metric": "competitionProfit",
  "scoringVersion": "competition-profit-v1",
  "cutoffUtc": "",
  "rules": {}
}
```

The flow must authorize the teacher and each class server-side, derive identity
from trusted records, reject levels outside 2–5, and perform capture/freeze as
one bounded server operation. Baseline values and revision/generation are read
from the canonical per-level progress row; they are never accepted as
student-supplied values. The flow must hold/exclude under-review rows and saves
with revision or generation conflicts. It must not update `GGR_StudentProgress`.

Successful response:

```json
{
  "ok": true,
  "contractVersion": "ggr.competitionSnapshot.v1",
  "operation": "capture_baseline",
  "status": "active",
  "competitionId": "term-1",
  "level": 2,
  "recordCount": 18
}
```

`status` is `active` for baseline capture, `frozen` for freeze, `closed` for
close, and `exported` for export. The response must echo the requested
competition and level.

Failures return `{ "ok": false, "contractVersion": "ggr.competitionSnapshot.v1",
"operation": "...", "code": "..." }`. A timeout, malformed response, missing
endpoint, or failed flow is unavailable/unknown—not an empty baseline or a
successful freeze. Public/export rows must omit all student identifiers and
names; baseline storage and teacher-only responses remain access-controlled.

The browser scaffold is gated by `competitionBaselines`; `freeze`, `close`, and
`export` additionally require `competitionSnapshots`. Both flags default OFF.
The operation is callable only when its runtime flag(s) are literal `true` and
the endpoint is configured and non-placeholder. The scaffold fails closed with
an explicit unavailable reason. Runtime URLs and API keys are public client
configuration, not authorization; tenant-side authorization is mandatory.

## Teacher runbook

1. **Start:** create the competition and document its class scope, one level,
   start time, cutoff, metric/scoring version, and baseline/restart policy.
   Confirm the teacher is authorized for every selected class.
2. **Capture baseline:** with the competition approved and before play, invoke
   `capture_baseline`. Verify the saved row count and that each record has the
   expected competition/class/level, current net worth, revision, generation,
   capture time, and `active` status. Resolve held or conflicted saves instead
   of capturing them.
3. **Monitor:** use the level-and-class-scoped `competitionProfit` board. Review
   unrankable counts (missing/duplicate baseline, held row, changed generation,
   stale or unresolved revision). Do not manually convert these rows into
   winners. A reset after capture requires teacher review and a new approved
   baseline policy; it must not silently rejoin the active competition.
4. **Freeze:** at the recorded cutoff invoke `freeze`. Verify the final snapshot
   record count and frozen status. The snapshot is immutable and further saves
   do not alter that result.
5. **Close/export:** invoke `close`, then `export` only from the frozen result.
   Verify the export contains public nicknames and scores only. Retain the
   audit/result record according to the tenant's data-retention policy.

No teacher-facing controls are connected to this scaffold yet. Do not use it for
a live competition until tenant acceptance is complete.

## Tenant deployment and rollback checklist

- [ ] Confirm the SharePoint internal column names and uniqueness strategy for
  the composite baseline identity; retain the single existing progress list.
- [ ] Create one baseline store and one immutable results/archive store (or an
  equivalent transactional store); do not create per-level lists.
- [ ] Deploy and authorize all operations of `GGR_CopyCompetitionSnapshot`;
  verify that baseline capture reads the current canonical save and that freeze
  is immutable and idempotent.
- [ ] Test teacher/class authorization, held rows, generation changes, revision
  conflicts, duplicate requests, timeout/unknown outcomes, and PII-safe exports.
- [ ] Validate the flow contract with tenant test data and record evidence before
  setting either flag. Mocks do not establish tenant deployment.
- [ ] Enable `competitionBaselines` for a controlled teacher pilot. Enable
  `competitionSnapshots` only after capture and freeze pass their acceptance
  tests.
- [ ] Roll back by turning both flags OFF. Existing saves and non-competition
  leaderboard metrics remain untouched; preserve baseline and frozen-result
  records for investigation, and never replay or delete save-protocol queues.

## Limitations and future extension

- All Power Automate endpoints, data stores, teacher UI, auth checks, retention,
  and tenant behavior remain unconfigured/unverified here.
- Baseline scoring measures change from each student's actual starting net
  worth; it does not equalize different starting assets or game conditions.
- Requiring verifiable revision and generation means legacy rows without those
  values are unrankable until a trusted baseline can be established.
- This phase does not create dedicated competition save slots. If isolated,
  equal-start games are later required, design a separate activity/save context
  with explicit ownership, concurrency, restore, reset, and migration contracts.
  Do not append a competition suffix to `ProgressKey` or silently replace the
  main per-level save as part of this phase.
