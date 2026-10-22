# Manual repair template: mixed-level history (anonymised)

> **Scope:** Two students have reported mixed-level histories. This is an **authorised, manual, per-student** procedure. It is not a bulk cleanup tool.
>
> - No student identity, score or tenant detail belongs in this repository.
> - Fill in a private copy of the report template below, held in the school's approved records location, and refer to students only by a case ID (e.g. `CASE-A`, `CASE-B`).
> - The repository code does **not** repair tenant rows or delete device data.
>
> Example of the kind of evidence reported (anonymised): a lookup of `CLASS|STUDENT|4` showed round 1 / net worth 500, while a more mature Level 4 state was shown later. Treat this as **reported evidence, not a proven root cause.**

## Preconditions

- [ ] Authorisation recorded: who approved the repair, their role and the date.
- [ ] **Backups taken before any change:**
  - [ ] Export of the affected `GGR_StudentProgress` rows, *all levels for the student*, including version history if it is available.
  - [ ] Export of the student's `GGR_Students` row, **excluding** PIN/hash columns from any copy that leaves the tenant.
  - [ ] Device evidence (optional, with consent): a copy of `level2_autosave`, `wa_gr_legacy_autosave_backups_v1` and `wa_gr_level_save_v1|…` keys from the student's device. Device data is **never** deleted.
- [ ] The per-level client build (this PR, or later) is deployed, so the old shared-slot writer cannot recreate the problem.
- [ ] The student is asked not to play the affected levels during the repair window.

## Procedure

1. **Inventory the rows.** List every progress row for the student. For each one, record:
   - ProgressKey;
   - Level;
   - Round, NetWorth;
   - `Modified` / version timestamps;
   - checkpoint status;
   - the `assignedLevel` stored inside the snapshot JSON.
2. **Identify the authoritative state per level** using evidence, not net worth alone.
   - Use:
     - the snapshot's own `assignedLevel`;
     - round/history continuity;
     - list version history;
     - device backups;
     - teacher observation.
   - A high net worth is **not** evidence of contamination.
   - A snapshot whose recorded level differs from the row's `Level` is a strong signal.
3. **Decide per level.** Choose one of:
   - **keep** the current row;
   - **restore** from a version or backup;
   - **move**: a snapshot belonging to level L found on row M is copied to row L **only if** row L is empty or older, and with teacher approval;
   - **mark for review**: set `LeaderboardStatus = needs_review`.
4. **Preserve earned access.**
   - Do not lower `ProgressedLevel`.
   - Do not remove `quiz_passed` / approval evidence.
   - Do not change the PIN.
5. **Apply the changes manually**, one row at a time, and record each before/after value in the private report.
6. **Leaderboards:** exclude repaired rows from competitive standings with `LeaderboardStatus` until a teacher confirms them.
7. **Verify:**
   - the student signs in;
   - each level resumes the expected state;
   - no level shows another level's economy;
   - the dashboard shows each level's row on that level's board only.
8. **Close the case:** keep the backups for the agreed retention period; the original exports are never overwritten.

## Private report template (do not commit filled copies)

```text
Case ID:                CASE-__
Authorised by / role:   ______________________   Date: __________
Backups (locations):    progress rows: ________  roster row: ________  device: ________
Rows before:
  Level | Round | NetWorth | Snapshot level | Modified | Checkpoint | Notes
  ----- | ----- | -------- | -------------- | -------- | ---------- | -----
Evidence used per level: ______________________________________________
Decision per level (keep / restore / move / review): ___________________
Rows after:
  Level | Round | NetWorth | Snapshot level | LeaderboardStatus
Access preserved (ProgressedLevel before/after): ____ / ____
Verification (student sign-in per level, dashboard per level): ☐ ☐
Open issues / follow-up: _______________________________________________
```
