# Future-state architecture: one identity, independent per-level games

> **Status: DRAFT design plus a disabled/gated foundation.** This document covers
> both what the repository now implements and what is still planned. Every item
> carries one of the status labels below; read no more into an item than its label says.
>
> | Label | Meaning |
> | --- | --- |
> | **Implemented (repo)** | The code is in this repository and is active in the browser by default. |
> | **Implemented, gated OFF** | The code is present but inactive until a runtime feature flag is set to the literal `true`. All such flags default to OFF. |
> | **Mock-tested** | Covered by `node --test` against in-memory mocks (for example `tests/support/reference-save-server.js`). This is **not** evidence that a tenant flow behaves the same way. |
> | **Tenant-configured** | Someone has configured the Power Automate flow or SharePoint list in the tenant. The repository cannot observe this. |
> | **Live-verified** | The tenant acceptance matrix in [release-and-acceptance](../operations/release-and-acceptance.md) has passed with recorded evidence. **Nothing in this PR is live-verified.** |
>
> Related documents:
> - [Flow registry and contracts](../power-automate/flow-registry-and-contracts.md)
> - [Save protocol v2 (revision / idempotency / generation)](../power-automate/save-protocol-v2.md)
> - [Level 6 Goldfields Mastery blueprint](level-6-goldfields-mastery-blueprint.md)
> - [Manual repair template for mixed-level histories](../operations/manual-repair-mixed-history.md)
> - [Staged release, rollback and tenant acceptance matrix](../operations/release-and-acceptance.md)
> - Existing: [GGR_SaveProgress repair spec](../power-automate/GGR_SaveProgress-repair-spec.md), [student login/progression guide](../power-automate/student-login-progression-repair.md), [checkpoint approval security](../power-automate/checkpoint-approval-security.md)

## 1. Problem being fixed

Before this change, Levels 2–5 shared one browser slot, `level2_autosave`.

- Startup could load a previous economy, *then* set `assignedLevel` from `?level=`, and then sync. A Level 4 visit could therefore relabel a Level 2 economy as Level 4 and upload it to the `…|4` cloud row.
- The cloud contract already derives `UPPER(ClassCode)|UPPER(StudentCode)|Level`, but the browser held only one economy.
- The teacher dashboard ranked each student's *latest* summary on every level tab. It did not filter by level.

Two students have reported mixed-level histories. In one, a lookup showed round 1 / net worth 500 for a Level 4 row, while a mature state was seen later. This is **reported evidence, not a proven root cause.** Those two cases are handled through an authorised, manual, anonymised repair ([template](../operations/manual-repair-mixed-history.md)). No student identity, score or repair detail is hard-coded anywhere in code or docs.

## 2. Decisions adopted (from the product owner)

| Decision | Status |
| --- | --- |
| One student identity in `GGR_Students`. Multiple independent games: one per Class/Student/Level, all in **one** `GGR_StudentProgress` list. No per-level lists and no per-level economy columns. | Design adopted. The client side is Implemented (repo). List changes are tenant work. |
| Canonical `ProgressKey = UPPER(ClassCode)\|UPPER(StudentCode)\|Level`. `ProgressKey` is unique; `StudentCode` is non-unique in the progress list. | Client: Implemented (repo) (`buildProgressKey`). Enforcing uniqueness is tenant work and is not verified. |
| `GGR_Students.Level` (API `assignedLevel`) remains the teacher-assigned starting level. Do **not** rename it or add `AssignedLevel`. `ProgressedLevel` = highest **unlocked** level. `CurrentLevel` = last-selected level preference. | Unchanged in the client (`shared/student-session.js`). |
| The roster holds identity, entitlement and credential metadata. It never holds an economy. | Implemented (repo): saves never write the roster from the browser. |
| Login returns the complete roster identity plus the three level fields. PINs and hashes never appear in browser sessions, docs, logs or public records. | Existing behaviour retained. |
| Students can switch among permitted or unlocked levels and back again. Permission never decreases. No arbitrary higher-level access is granted. | Implemented (repo): the home page and access guard use the roster plus a per-student ledger. |
| Saves are routed by the **level selected for that request**, never by the mutable roster `CurrentLevel` or the assignment. | Implemented (repo): the capture freezes `level`. |
| Each level owns its round, cash, assets, equipment, plans, history, quizzes/achievements, strategy and versioned snapshot. A first visit starts from that level's configured defaults; later visits resume. Nothing transfers between levels. Restarting one level preserves the other levels and earned access. | Implemented (repo) and mock-tested. |
| Passing the existing quiz is sufficient for access. Teacher approval is **not** a mandatory gate. | Unchanged; no policy change. |
| Level 6 "Goldfields Mastery" is planned now. It is not a harder Level 5. It is recognised but unavailable until it is complete and deployed. | Implemented (repo) as recognised-but-disabled. There is no playable Level 6. |

## 3. Level capability registry

`shared/level-capabilities.js` (global `WA_GOLD_RUSH_LEVEL_CAPABILITIES`) is the single source of truth for which levels exist and what each may do.

| Level | Name | Recognised | Playable | Save pipeline (per-level slot + `GGR_SaveProgress`) | Roster-assignable | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Basic Mining | yes | yes | **no** | yes | Auth-only game; see §10 |
| 2 | Goldfields Venture | yes | yes | yes | yes | |
| 3 | WA Goldfields | yes | yes | yes | yes | |
| 4 | Advanced Operations | yes | yes | yes | yes | |
| 5 | Classroom Challenge | yes | yes | yes | yes | |
| 6 | Goldfields Mastery | yes | **no** (`status: 'planned'`) | **no** | **no** | Disabled in the home and teacher UI |

Rules:

- **Recognised does not mean playable.** A recognised but unplayable level:
  - never routes into gameplay;
  - is never offered as an unlock target (`getNextPlayableLevel(5) === null`, which caps the Level 5 → 6 unlock);
  - never invalidates an existing session;
  - never resets entitlement.
- `shared/student-session.js` keeps `ROSTER_LEVELS = 1–5` and `PROGRESS_LEVELS = 2–5`.
  - A roster `Level` of 6 still makes login fail closed. This is existing behaviour, kept until a Level 6 backend exists.
  - A recorded `ProgressedLevel`/`CurrentLevel` of 6 falls back to the assigned level without rejecting the login. A test covers this.
- Feature flags come from `WA_GOLD_RUSH_RUNTIME_CONFIG.featureFlags`. Only the literal `true` enables a flag. All of these default to OFF:
  - `saveProtocolV2`
  - `fullCloudRestore`
  - `serverLeaderboard`
  - `levelResetFlow`
  - `competitionSnapshots`
  - `level6Analytics`
  - `holdUnverifiedNewSlotUploads`
- The `FLOWS` registry marks each flow `existing_endpoint`, `optional_unconfigured` or `planned`.
  - A `planned` flow is never callable unless its flag is on **and** an endpoint is configured (`isFlowCallable`).
  - These labels describe repository configuration only. They are **not** evidence that a flow is operational.

Enabling Level 6 later requires, in order:
1. Gameplay, content and teacher policy are complete.
2. The validators in `GGR_LoginStudent`, `GGR_UpsertStudentProfile` and `GGR_SaveProgress` accept 6.
3. The tenant acceptance matrix passes.
4. Only then is the registry entry flipped.

## 4. Browser storage layout (Implemented (repo), `shared/level-save-store.js`)

| Key | Contents | Notes |
| --- | --- | --- |
| `wa_gr_level_save_v1\|CLASS\|STUDENT\|LEVEL` | One **envelope** per level game: `{kind:'wa_gr_level_save', storageSchemaVersion:1, owner:{classCode,studentCode}, level, progressKey, generation, runId, startingNetWorth, savedAt, cloud:{status,revision}, migratedFrom?, snapshot}` | The snapshot is the full GameState capture. Its `assignedLevel` must equal the envelope level. |
| `wa_gr_progression_v1\|CLASS\|STUDENT` | **Ledger**: per-level checkpoint/quiz evidence, per-level run `{generation, runId}`, legacy-migration marker | Survives an economy reset. Checkpoint evidence only moves forward (`quiz_passed` never drops back to `quiz_available`). Teacher decision fields are preserved and never overwritten by a lower-rank student value. |
| `wa_gr_level_archive_v1\|CLASS\|STUDENT\|LEVEL` | Up to 3 archived envelopes per level | Written **before** a restart or a cloud adopt. |
| `wa_gr_legacy_autosave_backups_v1` | Up to 5 verbatim copies of `level2_autosave` values, keyed by hash | Written before migration. The original key is **not** deleted. |
| `wa_gr_level_save_quarantine_v1` | Malformed or mismatched slot contents | Copied here before a fresh game may replace the slot. Holds the 20 most recent entries; older entries roll off (documented limit). |
| `wa_gr_device_level_board_v1` | Device-only per-level board rows, public fields only | Replaces writes to `wa_gold_rush_class_records`, which is left untouched. |
| `wa_gr_sync_queue`, `wa_gr_sync_quarantine`, `wa_gr_sync_conflicts` | SharePointSync retry queue, quarantine, and v2 conflicts | The first two existed already; the conflict log is new. |

How every read is validated:

- The envelope kind and version are checked.
- The envelope identity must equal the signed-in class and student.
- The envelope level must equal the requested level.
- The snapshot's level and owner must equal the envelope's.

An invalid slot (`status:'invalid'` with a reason) is never loaded. Its raw text is copied to the quarantine key **before** a fresh game may replace it; if that copy fails the level is locked instead. A slot written by an unsupported `storageSchemaVersion` (e.g. a newer build after a rollback) fails closed: the level is locked and the slot is never replaced. On a shared device, another student's slot has a different key and is never touched. Snapshots are deep-copied and frozen at capture (`freezeCopy`), and so are cloud payloads, so later UI or URL changes cannot mutate a queued save.

### Startup sequence (level page, `levels/level-2-tycoon/script.js`)

1. A `GGR_LoginStudent` session is required (unchanged).
2. `?level=` is resolved strictly:
   - missing → 2;
   - anything outside 2–5 is rejected and redirected to `../../index.html?error=level_locked`;
   - there is no coercion to a default level.
3. The access guard runs, reading the roster entitlement plus the per-level ledger evidence. Its policy is unchanged.
4. `loadLevelGameForSession(session, level)` reads **only** the exact slot. The status label (`#levelSaveStatus`) shows one of: starting new / resumed / loading / local-only (unsynced) / conflict / unavailable / error.
5. **No upload at startup.** The old `syncPlayerRecord()` call during init was removed, so a pristine default game can never be uploaded over unknown cloud state. The first real action (round, purchase, quiz) produces the first save.
6. If `fullCloudRestore` is ON and `getStudentProgress` is configured, `maybeRestoreLevelFromCloud` runs (see §6). Otherwise no call is made.

## 5. Legacy local migration (Implemented (repo) + mock-tested)

`migrateLegacyAutosave(storage, identity)` runs on the home page after sign-in. It is idempotent, using a marker keyed by content hash.

| Old slot state | Result |
| --- | --- |
| Missing | `no_legacy` |
| Malformed JSON or not an object | `skipped: malformed`; original kept |
| No owner `studentCode` | `skipped: unowned`; original kept |
| Belongs to another student | `skipped: other_student`; untouched |
| Same student, different class | `needs_review: class_mismatch`; nothing moved (see the class-transfer policy below) |
| Same student, no class recorded | Checkpoint evidence kept; `needs_review: missing_class`; cloud uploads for that level are **held** (`getUploadHold`) |
| Same student, unsupported level | Evidence for supported levels kept; `needs_review: unsupported_level` |
| Same student and class, level L, target slot empty | Migrated **only** into level L, with `cloud.status:'unknown'` and `startingNetWorth:null` (the baseline is unknowable, so profit and ROI are unrankable) |
| Target slot already present | `preserved_existing`; the new slot is never overwritten |

Further guarantees:

- The original is backed up first; if the backup fails, migration stops (`backup_failed`).
- `level2_autosave` itself is never deleted.
- Saves are never fabricated for other levels.
- The two reported mixed-history students need manual review; the code never targets them.

### Class-transfer policy

`ClassCode` is part of the key, so a student who moves class gets a new, empty game for each level. Nothing is moved automatically, whether locally (`class_mismatch` → review) or in the cloud.

Moving saved games is a teacher/admin decision, done as a manual audited copy (a future reset/transfer flow could support this). Earned unlocks are held in the roster (`ProgressedLevel`) and follow the student.

Known pre-existing limitation: `shared/investment-profile.js` is keyed by `studentCode + level`, not class. A class transfer therefore keeps the investment profile, and a level restart clears only that level's profile (`resetLevel`).

## 6. Cloud restore (Implemented, gated OFF; mock-tested)

`shared/cloud-restore.js` (`WA_GOLD_RUSH_CLOUD_RESTORE`) is an adapter for a **student-scoped** `GGR_GetStudentProgress` v2 contract. The teacher-facing `GGR_GetDashboardData` is never used to restore a student's game.

**Request:** `{contractVersion:'ggr.getStudentProgress.v2', mode:'full_save', classCode, studentCode, level, progressKey}`. The flow must authenticate the student server-side; see the [flow contract](../power-automate/flow-registry-and-contracts.md#ggr_getstudentprogress).

**Outcomes:**

| Outcome | When it is returned |
| --- | --- |
| `found` | A validated envelope whose identity, level, key and snapshot all agree |
| `missing` | **Only** an explicit `ok:true, found:false` with a matching `progressKey` and `contractVersion` |
| `unavailable` | The feature is disabled or the endpoint is unconfigured |
| `failed` | Network or HTTP error, or a timeout |
| `incomplete` | A partial or checkpoint-only response, a contract mismatch, or an invalid snapshot |

Errors, timeouts and partial or checkpoint-only responses are **never** treated as `missing`.

**Reconciliation** (`reconcile(local, cloud)`):

| Situation | Action |
| --- | --- |
| Cloud `found` with a newer revision, and no unsynced local changes | `adopt_cloud`; the local copy is archived first |
| Both local and cloud have changed | `conflict`; shown to the student, nothing is overwritten automatically |
| Local save only, cloud definitively missing | `upload_local_create` |
| Cloud state unknown | `resume_local_unsynced` / `start_local_unsynced`, disclosed as unsynced in the UI |

Unknown cloud state never initialises a cloud row:
- with v2 OFF, the slot's uploads are held;
- with v2 ON, CAS (`baseRevision:null` = create-only) protects any existing row.

The request is bounded by an 8 s timeout and never blocks authentication. The existing checkpoint-only `getStudentProgress` access-guard path remains as an explicit **compatibility mode**.

## 7. Save protocol (summary)

The full specification is in [save-protocol-v2](../power-automate/save-protocol-v2.md).

- **Legacy (default, unchanged wire format):**
  - per-level payloads with the canonical `progressKey`;
  - an immutable `saveRequestId` per capture;
  - queue coalescing per `progressKey`.
- **v2 (gated OFF):**
  - a server-authoritative `revision`, written by compare-and-swap on `baseRevision`;
  - `runGeneration`/`runId`, so delayed pre-reset saves cannot land;
  - `contentHash` plus a durable receipt store for idempotency, with dedup checked **before** the stale check;
  - conflicts are held for reconciliation, never retried as an overwrite;
  - a legacy-shaped `200` is classified as **unconfirmed**, never as a v2 save.
- **Rollback:** v2 queue items are held (not replayed) while the flag is OFF; legacy items are held (not upgraded) while it is ON.

## 8. Leaderboards (Implemented (repo) + mock-tested; server leaderboard planned)

`shared/leaderboard.js` ranks from **actual per-level progress rows**, joined to the authorised roster by class + student code. It never uses `assignedLevel`, `currentLevel`, `progressedLevel` or the latest cross-level summary.

- **Scores stay on their own level.** A Level 2 score remains on the Level 2 board while the student plays Level 4 (or, later, Level 6).
- **Exclusions are counted and reported.** A row is excluded when:
  - its class or student is missing;
  - its key doesn't match;
  - the student is not on the authorised roster;
  - it is a duplicate row;
  - `LeaderboardStatus` is held, excluded, unverified, under_review or needs_review;
  - net worth is missing;
  - it has not yet been played (round ≤ 1).
- **No hard-coded student exclusions.** The two reported mixed cases must be excluded by an authorised `LeaderboardStatus` value or through the manual repair.
- **Metrics:**

  | Metric | Formula | Unrankable when |
  | --- | --- | --- |
  | `netWorth` (default) | net worth | — |
  | `profit` | `netWorth − StartingNetWorth` for **this run** | baseline missing (true of migrated legacy saves) |
  | `roi` | `(netWorth − StartingNetWorth) / StartingNetWorth` | baseline missing, or baseline ≤ 0 |

  There is no fallback to `totalProfitLoss` or net worth. Capital injections and debt adjustments do not exist in the current game. If they are added, profit and ROI must subtract injections and the scoring version must change.
- **Current top, not all-time.** The old "All-Time Level Record" label was removed, because the value is the *current* top, not a durable historical best. Durable historical bests are future work (a separate results list or competition snapshots).
- **Public output** is limited to: rank, `LeaderboardName`, class code, level, value, net worth, starting net worth, round, strategy label and last played. `StudentName`, `StudentID`, `StudentCode`, PINs and hashes are never included. A blank `LeaderboardName`, or one equal to `StudentName`, is shown as "Unnamed player".
- **No invented score thresholds.** An unending Level 2 net worth of 50,000 is not, by itself, evidence of corruption.
- **Class filtering in the dashboard is display-only.** Server-side class scope must be enforced in `GGR_GetDashboardData` and in the planned `GGR_GetLeaderboard`.
- **The in-game board is device-only**, labelled "This Device's Leaderboard (this level)". It is not cross-device, because no leaderboard flow exists.

## 9. Competition scope (planned only)

The per-level key keeps Level 2 separate from Level 4. It **cannot** also keep a fresh Level 2 championship run alongside the student's existing Level 2 main game, because one key holds exactly one row.

Lower-level saves are never silently reset to equalise conditions. A future competition extension needs:
- a teacher activity/run identity (e.g. `CompetitionId`);
- an initial baseline;
- scoring rules and a scoring version;
- a round or time cap;
- an approved archive/reset;
- frozen result snapshots.

Two candidate designs exist. Both are documented and gated; neither is deployed.

- **(a) Separate competition results storage.** A `GGR_CompetitionResults` list receives frozen standings via `GGR_CopyCompetitionSnapshot`. This freezes standings but **cannot** create fresh, equal starts.
- **(b) Context-extended key.** `CLASS|STUDENT|LEVEL|CONTEXT`, used only for competition contexts. The main-game key stays the canonical three-part key.

## 10. Level 1 assessment

Level 1 (`levels/level-1-basic/`) requires the same `GGR_LoginStudent` session, but otherwise runs a fixed 10-round game held in page memory. It has no checkpoint quiz, writes no per-level slot, and does not call `GGR_SaveProgress`. It is therefore **not covered** by the save pipeline, and this PR does not claim it is.

Bringing Level 1 into the pipeline would require:
1. Moving Level 1 state into a GameState-compatible snapshot.
2. Enabling `savePipeline` for Level 1 in the registry.
3. Making `PROGRESS_LEVELS` and the flow validators accept 1.
4. Deciding whether Level 1 contributes progression evidence. Today access to Level 2+ follows roster assignment and the quiz checkpoints of Levels 2–4; this is unchanged.

## 11. Level-by-level game guide and infrastructure

Values come from `shared/game-config.json`; goals are the configured `progressionGoal`.

| Level | Player experience | Start cash | Goal | Max active mines | Rounds | Infrastructure |
| --- | --- | --- | --- | --- | --- | --- |
| 1 Basic Mining | Single mine, dice digs, learn safe / medium / deep risk | 100 | — | 1 | 10 fixed | Login only; state held in the page |
| 2 Goldfields Venture | Multiple mines, equipment, unending growth; checkpoint quiz unlocks Level 3 | 250 | 2,500 | 2 | Unending | Per-level slot, ledger, SaveProgress (legacy; v2 gated), dashboard |
| 3 WA Goldfields | Mine upgrades and infrastructure strategy | 300 | 10,000 | 3 | Unending | Same as Level 2 |
| 4 Advanced Operations | Random events, advanced infrastructure | 400 | 50,000 | 4 | Unending | Same as Level 2 |
| 5 Classroom Challenge | Multi-site portfolio, competition focus | 500 | 250,000 | 3 | Unending | Same as Level 2; competition snapshots planned |
| 6 Goldfields Mastery | Historical timeline simulation (planned) | TBD | TBD | TBD | Era-based (TBD) | See the [blueprint](level-6-goldfields-mastery-blueprint.md); `GGR_Level6HistoricalResults` planned |

Mechanics common to Levels 2–5:

- **Each round:** the player sets an investment plan per mine (safe / medium / deep dig) and rolls 2d6. Each dig type has a configured success range. Machinery bonuses, mine upgrades and random events (rolled on a d6) modify the outcome.
- **Progression:** reaching the goal opens the checkpoint quiz. Passing it records `quiz_passed` in the ledger and unlocks the next **playable** level.
- **Restart This Level:** archives the current run and starts a new generation for that level only. Other levels and earned access are preserved.

## 12. Known limitations

- **v2 OFF:** a legacy request already in flight before a restart can still land after it. Restart discards any queued or pending saves for that key, but it cannot recall a request already sent.
- **v2 ON:** a restart started by the client cannot advance the server generation. Until `GGR_ResetLevelProgress` exists, saves from a restarted level fail closed (`precondition_failed` / conflict) rather than overwriting.
- **Device board:** the in-game leaderboard is device-only.
- **Dashboard data:** the teacher dashboard depends on `GGR_GetDashboardData` returning per-level rows with `StartingNetWorth` and generation. Until it does, profit and ROI are unrankable.
- **Checkpoint evidence:** checkpoint evidence stored in the browser is not backend authorisation.
