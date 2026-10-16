# Goldfields Goldrush W.A. - Educational Mathematics Game

A progressive financial mathematics simulation game for students, themed around Western Australian gold mining.

## Game Structure

### 📂 Directory Organization

```
wa-gold-rush/
├── levels/
│   ├── level-1-basic/           # ARCHIVED: Original 10-round game
│   │   ├── index.html
│   │   ├── script.js
│   │   └── style.css
│   └── level-2-tycoon/          # Active Goldfields Venture mode (bundles Levels 2-5 progression)
│
├── shared/                       # Shared utilities across levels
│   ├── game-config.json         # Game configuration & assets
│   ├── storage.js               # OneDrive & localStorage
│   └── shared-styles.css        # Common styling
│
├── teacher/                      # Teacher dashboard
│   ├── dashboard.html
│   └── dashboard-state.js
│
├── index.html                    # Level selector (home page)
└── README.md
```

## Levels Overview

| Level | Name | Description | Duration | Features |
|-------|------|-------------|----------|----------|
| 1 | Basic Mining | Original game - single mine, 10 rounds fixed | 10 min | Dice rolls, 3 dig types |
| 2 | Goldfields Venture | Multiple mines, upgrades, machinery, resale | Unending | Net worth + event system |
| 3 | WA Goldfields | Southern Cross, Coolgardie, Kalgoorlie progression | Unending | Regional strategy |
| 4 | Advanced | Company mode, random events, advanced risk | Unending | Strategic planning |
| 5 | Classroom Challenge | Shared local leaderboard + teacher stats/pause | Ongoing | Classroom competition |

## Level 1: Basic Mining (Archived)

**Access:** `/levels/level-1-basic/index.html`

The original working game - preserved as-is for reference and student access.

- **Duration:** 10 rounds maximum
- **Starting Cash:** $100
- **Dig Types:** Safe (10%), Medium (50%), Deep Vein (300%)
- **Mechanics:** Dice rolls determine dig success

## Data Privacy

✅ **No identifying data stored offsite**
- All game data stored locally on student devices
- Teacher can export progress to OneDrive (encrypted, education tenant)
- Compliant with education department data policies

## Progression Note

Detailed progression steps are condensed into the current Level 2 Goldfields Venture implementation and reflected on the home page cards for Levels 2–5.

## Teacher Dashboard

Access: `/teacher/dashboard.html`

- Import student lists (bulk or individual)
- Assign students to levels
- Monitor local shared progress and leaderboard statistics
- Pause game for lessons
- Toggle **Strict Classroom Mode (Competition Lock)** to require student login for leaderboard/rankings/shared records while still allowing free-play and saves
- Track wealthiest player, most mines owned, most profitable strategy, and average class wealth

---

## Teacher Dashboard data flow (Microsoft Lists → Power Automate)

**Microsoft Lists → Power Automate → Teacher Dashboard → Student Games**

- **Sign-in:** every teacher, including admins, signs in via the `loginTeacher` flow (`GGR_LoginTeacher`) against the `GGR_Teachers` list. Admin access comes from a `GGR_Teachers` row with `Role=admin`; there is no code-level allowlist or admin bypass. Only the signed-in session is kept in `sessionStorage`.
- **Dashboard data:** `GGR_GetDashboardData` is the only source for the dashboard. It returns `Teachers`, `Students` and `Progress` from the Lists. If one array is missing, the dashboard still loads the others and shows which array was missing. If the flow fails, the tables are cleared and a **Retry** button appears. Cached browser data is never shown in their place.
- **Writes:** `GGR_UpsertTeacher` and `GGR_UpsertStudentProfile` only write. They do not supply dashboard data. The dashboard reports success only after the flow confirms the write, then reloads from `GGR_GetDashboardData`. To remove a teacher, deactivate their row in `GGR_Teachers`.
- **Checkpoints:** the checkpoint tabs show `quiz_passed` students from the `Progress` rows (`CheckpointStatus`, `QuizScore`, …). Approvals are saved through `GGR_SaveCheckpointApproval`. While that flow is not configured, the approval buttons are disabled.

### PIN setup and teacher approval release notes

- **PIN creation:** the home page now gives accessible, example-only guidance with empty PIN fields. No new PIN length/digit rule is assumed. Successful setup requires an explicit `ok: true` response; students then sign in with their new PIN. Nested flow errors are shown as readable text, with a fallback for unreadable responses.
- **Approval wiring — direct browser integration, not confidential:** set the repository Actions secret `WA_GGR_SAVE_CHECKPOINT_APPROVAL_URL` to the saved flow's HTTP trigger URL, then deploy Pages. Do not add credentials to `teacher/runtime-config.js`, `shared/flow-endpoints.js`, or other tracked source, or log them. The workflow publishes the URL as `WA_GOLD_RUSH_RUNTIME_CONFIG.flowEndpoints.saveCheckpointApproval` and the shared `WA_GGR_API_KEY` value in browser-served `teacher/runtime-config.js`. Both are observable in source/devtools and network requests. Actions secret storage protects build inputs, **not runtime confidentiality**; no Actions environment variable exists in the browser, only the generated JS values. A blank or placeholder override does not mask a configured endpoint; without a configured URL, approvals remain unavailable. Rotate any previously disclosed trigger signature. Keep existing injection until an authenticated replacement is deployed; rotation alone cannot hide values republished to Pages. See the [approval audit and backend migration contract](docs/power-automate/checkpoint-approval-security.md).
- **Teacher display:** dashboard hydration now reads `ClassCodes` (text or arrays, including Choice values) and checks each class when filtering the teacher roster. It still loads from `GGR_GetDashboardData`, not browser caches. Browser filtering is presentation/defense-in-depth only: `GGR_GetDashboardData` must authorize the signed-in teacher server-side and must not return rows outside their authorized classes (except for a verified admin). The List schema is unchanged: `Title`, `TeacherEmail`, `TeacherName`, `Role`, `Active`, `AllowedDashboardAccess`, `ClassCodes`, `DomainValidated`, `LastUpdatedUtc`. The creator's authenticated `Role=admin` remains admin and sees all returned teachers; non-admin teachers remain class-scoped. No identity-based admin bypass is added.

**Still requires live-flow verification:**

1. Inspect the failed `GGR_ChangeStudentPin` run to resolve the underlying 502. First-time requests still send `classCode`, `studentId`, `newPinHash` (SHA-256), and `firstTimeSetup: true`, without `oldPinHash`; normal changes still send both hashes. The backend must authorize initial setup/reset and return `ok: true` only after persisting the credential. The UI change does not repair the deployed flow or permit overwriting an existing PIN.
2. Confirm `GGR_SaveCheckpointApproval` accepts the existing payload: `studentCode`, `classCode`, `level`, `progressKey`, `approvalStatus`, `approverName`, `approverEmail`, `approvalTimestamp`. There is no verified trigger schema requiring `teacherEmail`, so the payload has not been renamed. Verify reviewer authorization server-side, save one decision, and refresh to confirm read-back from `GGR_GetDashboardData`.
3. Confirm `GGR_LoginTeacher` returns `Role=admin` for the creator's authorized List profile (sign out/in after backend role changes), and `GGR_GetDashboardData` returns the expected teacher rows. Client filtering cannot recover rows omitted by the flow. No List columns, including the intentional legacy internal column `LaastPlayedUtc`, are renamed.
- **Still in browser storage:** class controls (pause and Strict Classroom Mode), student autosave, and the cloud-save retry queue. These are not roster data.

Backend prerequisites and the SaveProgress upsert contract are documented in `docs/power-automate/GGR_SaveProgress-repair-spec.md`.
The student login/import/progression audit and tenant deployment checklist are in [`docs/power-automate/student-login-progression-repair.md`](docs/power-automate/student-login-progression-repair.md). `GGR_Students.Level` remains the teacher-assigned level; `GGR_StudentProgress.Level` remains the per-game-level progress key dimension.

---

## Getting Started

1. **For Students:** Sign in on the home page (`index.html`) with Class Code, Student ID, and PIN, then choose a level.
2. **For Teachers:** Navigate to `/teacher/dashboard.html`
3. **For Developers:** See DEVELOPMENT.md

## Technology

- **Frontend:** HTML5 + CSS3 + Vanilla JavaScript
- **Storage:** LocalStorage + OneDrive API (optional)
- **Compatibility:** iPad-optimized, works offline
- **Hosting:** the current frontend is fully client-side; confidential approval credentials require a separately hosted authenticated backend (not GitHub Pages).

---

**Status:** Level 1 ✅ Complete | Levels 2-5 ✅ Bundled in Goldfields Venture mode

---

## 🆕 SharePoint / Power Automate Login & Data Flow (Stage 1)

### New Login Flow

Student identity comes **only** from the class roster (`GGR_Students`) through the `GGR_LoginStudent` flow:

1. From the Home page, students enter **Class Code**, **Student ID**, and **PIN**. Nothing else.
2. `shared/student-auth-client.js` sends the class code, student ID, and a SHA-256 PIN hash to `GGR_LoginStudent`. The login succeeds only if the flow returns `ok:true` with a complete roster identity (`studentCode`, `studentId`, `studentName`, `leaderboardName`, `classCode`, `assignedLevel`).
3. `shared/student-session.js` stores that roster identity in `localStorage` (`wa_gold_rush_student_session`, `source: "GGR_LoginStudent"`, `schemaVersion: 2`). PINs and PIN hashes are never stored. Legacy or self-created sessions are cleared, and the student must sign in again.
4. Identity is shown read-only after login. In-game, only the company name can be edited.
5. Every level page, quiz action, save, and level unlock requires this session. Direct navigation to a level without it redirects to the Home login with `returnTo`.
6. Students can log out from the Home page or in-game at any time.

### Creating a student PIN

On `index.html`, open **Set or Change Student PIN** and select **First-time PIN setup / I do not have an old PIN yet**. Enter Class Code and Student ID, choose a private PIN, and re-enter it exactly. Select **Set PIN**, wait for backend-confirmed success, then log in above with the new PIN. First-time requests omit `oldPinHash`; ordinary changes still require the old PIN.

The form allows up to **12 characters** per PIN field. The numeric keyboard is a hint, not digits-only validation; **482619 is an example only**, not a prefilled/default PIN or a mandatory six-digit format. The frontend requires nonempty trimmed entries, matching new/confirmation values, and a new PIN different from the old one for ordinary changes. It trims surrounding whitespace and SHA-256 hashes the PIN without converting it to a number (leading zeroes are preserved). PINs and hashes are not persisted in browser storage. No mandatory four/six-digit minimum or digits-only backend policy has been verified.

**Deployment verification still required:** the deployed `GGR_ChangeStudentPin` definition is not available here. Verify its PIN policy, authorised first-time/reset eligibility, credential update in `GGR_Students`, and subsequent `GGR_LoginStudent` sign-in live. The frontend example does not repair the flow or prove a PIN was saved. The reported screenshot (first-time mode selected, masked matching fields, `[object Object]` response) is a reference for helper placement, not evidence of the backend failure's cause; error formatting is unchanged in this PR.

Removing Class Code for Student ID + PIN-only login is separate coordinated frontend/backend contract work. No List names or internal mappings change here; `GGR_StudentProgress` display column `LastPlayedUtc` intentionally retains internal name `LaastPlayedUtc`.

### Data Fields & Privacy Model

| Field | Stored Where | Visible To |
|---|---|---|
| `StudentCode` | localStorage + SharePoint | Teacher & student |
| `LeaderboardName` | localStorage + SharePoint | Public (leaderboard only) |
| `StudentID` | localStorage + SharePoint | Teacher only |
| `StudentName` | localStorage + SharePoint | Teacher only |
| `ClassCode` | localStorage + SharePoint | Teacher |
| Progress/Score | localStorage + SharePoint | Teacher + student |

Leaderboard displays **only** `LeaderboardName` — never `StudentName` or `StudentID`.

### Configuring Power Automate Endpoints

Flow endpoints are now centralized in `shared/flow-endpoints.js` and consumed by:
- Home page (`index.html`)
- Teacher dashboard (`teacher/dashboard.html`)
- Levels 2–5 gameplay (`levels/level-2-tycoon/index.html`)
- Shared sync helper (`shared/sharepoint-sync.js`)

Runtime API key bootstrap is loaded from `teacher/runtime-config.js` (generated by GitHub Actions) before flow helpers.

GitHub Pages must be configured with **Settings → Pages → Source = GitHub Actions**. The checked-in `teacher/runtime-config.js` remains a development-safe stub; the Pages workflow generates the deployed `teacher/runtime-config.js`, injects the runtime API key from `WA_GGR_API_KEY`, rewrites cache-busted runtime-config URLs in the built HTML, and fails the build if the packaged Pages artifact cannot be shown to contain that generated file.

This build injection **publishes** the API key and configured approval URL in the Pages artifact. The empty tracked stub only demonstrates source hygiene. A shared browser-visible `X-GGR-Key` is not per-user authentication, and CORS is not authentication. The current teacher `sessionStorage` fields (including email, role and classes) are not identity proof a backend can trust. Protecting credentials requires browser → authenticated API → flow; the [migration contract](docs/power-automate/checkpoint-approval-security.md) specifies the required authorization, hosting, rotation and acceptance tests. This follow-up does not implement that backend or change live flows.

Frontend flow calls use `WA_GOLD_RUSH_POWER_AUTOMATE.callFlow(...)`, which handles endpoint resolution, placeholder detection, `X-GGR-Key`, JSON parsing, and a consistent `{ success, status, data, error }` result.

### Progress saves

`shared/sharepoint-sync.js` only sends a save when `studentCode`, `classCode`, and the current gameplay `level` (2–5) are valid and match the signed-in session. The canonical `ProgressKey` is `UPPER(ClassCode)|UPPER(StudentCode)|Level`. Invalid or rejected saves (HTTP 400/410/422 or `ok:false`) go to `wa_gr_sync_quarantine` and are not retried. Network errors and timeouts are retried with the same `saveRequestId`. See `docs/power-automate/GGR_SaveProgress-repair-spec.md` for the flow-side checklist.

#### Power Automate: student/profile upsert flow
Trigger: **When an HTTP request is received**  
Expected JSON body:
```json
{
  "studentCode": "SC-Y6-1042",
  "studentId": "123456",
  "studentName": "Alex Smith",
  "leaderboardName": "Golddigger",
  "classCode": "6B",
  "Level": 2,
  "active": true,
  "teacherEmailPrimary": "teacher@example.edu.au",
  "timestampUtc": "2025-01-01T00:00:00.000Z"
}
```
Action: upsert SharePoint List row by `StudentCode`.

#### Power Automate: level progress/result upsert flow
Expected JSON body:
```json
{
  "studentCode": "SC-Y6-1042",
  "classCode": "6B",
  "level": 2,
  "currentRound": 7,
  "currentCash": 1234.56,
  "currentAssets": 890.12,
  "netWorth": 2124.68,
  "score": 2124.68,
  "progressionMarkersJson": "{...full versioned restoration snapshot...}",
  "badgesJson": "[]",
  "achievementsCount": 3,
  "sessionStatus": "authenticated",
  "needsSupport": false,
  "supportReason": ""
}
```

### CSV Import Formats

#### Students / Class Teachers (`teacher/dashboard.html` → Bulk Import)
```csv
StudentCode,LeaderboardName,StudentID,StudentName,ClassCode,Level
SC-Y6-001,Golddigger,123456,Alex Smith,6B,2
SC-Y6-002,TinPan,654321,Jordan Lee,6B,3
```
Legacy format (`name,email,level`) is also accepted.

The same bulk import workflow can also include non-admin teacher rows in the same payload when teacher-specific fields are present:

```csv
StudentCode,LeaderboardName,StudentID,StudentName,ClassCode,Level,TeacherEmail,TeacherName,Role
SC-Y6-001,Golddigger,123456,Alex Smith,6B,2,,,
,,,,6B,,teacher@education.wa.edu.au,Ms Smith,teacher
```

For teacher-only rows in that mixed CSV, leave the student columns blank and put the teacher's class in the shared `ClassCode` column.

#### Teachers (`teacher/dashboard.html` → Teacher Import)
```csv
TeacherEmail,TeacherName,ClassCode,Role
teacher@education.wa.edu.au,Ms Smith,6B,teacher
admin@education.wa.edu.au,Mr Jones,,admin
```

Validation rules:
- `TeacherEmail` must be present and a valid email address
- `TeacherName` is required
- `Role` must be `teacher` or `admin`
- `ClassCode` is required for `teacher` rows and may be blank for `admin`

### Level-Specific Leaderboards

Each level (1–6) has its own leaderboard in the Teacher Dashboard:
- **Top 20** — sorted by net worth
- **All-Time Level Record** — highest net worth ever for that level

The in-game classroom leaderboard (Level 2–5 Goldfields Venture) shows public `LeaderboardName`.

### Investment Profile

Per student, per level:

| Bucket | Triggered By |
|---|---|
| High Risk | Deep Vein Dig investments |
| Profit Chasing | Medium dig investments |
| Low Risk | Safe dig investments |
| Asset Building | Mine & machinery purchases |
| Future Proofing | Mine upgrades |

A donut chart and rating label appear on:
- The Home page login panel (after sign-in)
- The Level 2–5 game panel (Company & Identity section)

### Known Temporary Constraints

- SharePoint sync is disabled until Power Automate endpoints are configured in `shared/sharepoint-sync.js`.
- Teacher dashboard access is open (no passcode) by default. Set `TEACHER_PASSCODE_MODE = true` and `TEACHER_PASSCODE_STATIC = 'yourpasscode'` in `teacher/dashboard-state.js` to require a passcode.
- Level 6 is a placeholder card — gameplay not yet implemented.
