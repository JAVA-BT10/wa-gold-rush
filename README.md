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

## ⚠️ Temporary Teacher Allowlist Mode (LOW SECURITY)

> **This mode is a temporary workaround only.** Use it while Microsoft Entra app registration is unavailable. Disable it once M365 sign-in is working.

### What it does

When `TEMP_TEACHER_ALLOWLIST_MODE = true` (in `teacher/dashboard-state.js`), teachers can access the dashboard by entering their email address at a prompt. Access is granted if the email is in the allowlist; otherwise access is denied.

Normal M365 teacher sessions still work transparently when this mode is on.

### How to add or remove teacher emails

**Option 1 — Edit the static list (code change required)**

Open `teacher/dashboard-state.js` and add/remove entries in `TEMP_TEACHER_ALLOWLIST_STATIC`:

```js
const TEMP_TEACHER_ALLOWLIST_STATIC = [
    'teacher@education.wa.edu.au',
    'anotherteacher@school.edu',
];
```

**Option 2 — Use localStorage (no code change, takes effect immediately)**

In browser DevTools (F12 → Application → Local Storage for your site):

- Key: `wa_gold_rush_teacher_allowlist`
- Value: comma- or newline-separated emails, e.g. `alice@school.edu,bob@school.edu`

Entries from localStorage are merged with the static list.

### How to disable temporary mode (switch back to M365-only auth)

Once your Entra app registration is set up:

1. Open `teacher/dashboard-state.js`.
2. Change `const TEMP_TEACHER_ALLOWLIST_MODE = true;` → `false`.
3. Deploy the change.
4. Teachers will use Microsoft 365 sign-in on the home page as normal.

Do **not** delete the allowlist or the M365 code — just setting the flag to `false` restores normal production behaviour.

### Security warning

⚠️ In temporary allowlist mode, dashboard access is gated only by email-string matching in browser-side storage. This is **not secure** for production use — it can be bypassed by anyone with access to browser DevTools. Use it only for short-term classroom continuity while awaiting IT/Entra setup.

---

## Getting Started

1. **For Students:** Click level in home page (`index.html`). Optional competition login on home enables leaderboard/class competition participation.
2. **For Teachers:** Navigate to `/teacher/dashboard.html`
3. **For Developers:** See DEVELOPMENT.md

## Technology

- **Frontend:** HTML5 + CSS3 + Vanilla JavaScript
- **Storage:** LocalStorage + OneDrive API (optional)
- **Compatibility:** iPad-optimized, works offline
- **No Backend Required:** Fully client-side

---

**Status:** Level 1 ✅ Complete | Levels 2-5 ✅ Bundled in Goldfields Venture mode

---

## 🆕 SharePoint / Power Automate Login & Data Flow (Stage 1)

### New Login Flow

Microsoft 365 / MSAL sign-in has been replaced by a lightweight **StudentCode** login:

1. From the Home page, students enter:
   - **Student Code** *(required)* — their unique login key, e.g. `SC-Y6-1042`
   - **Leaderboard Name** *(required)* — pseudonym shown publicly on leaderboards
   - **Student ID** *(optional)* — school ID, teacher-facing only
   - **Class Code** *(optional)* — e.g. `6B`
2. Session is saved to `localStorage` so gameplay continues across page loads.
3. Students can log out from the Home page at any time.

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

Edit `shared/sharepoint-sync.js` and set the `CONFIG` object at the top of the file:

```js
const CONFIG = {
    profileEndpoint:  'https://prod-XX.australiasoutheast.logic.azure.com/...',  // student upsert flow
    progressEndpoint: 'https://prod-XX.australiasoutheast.logic.azure.com/...',  // level result flow
    gameKey: 'your-shared-secret',  // sent as X-Game-Key header
};
```

If both endpoints are left blank, the game runs fully offline with no sync (all progress in localStorage).

#### Power Automate: student/profile upsert flow
Trigger: **When an HTTP request is received**  
Expected JSON body:
```json
{
  "StudentCode": "SC-Y6-1042",
  "LeaderboardName": "Golddigger",
  "StudentID": "123456",
  "StudentName": "Alex Smith",
  "ClassCode": "6B",
  "LastPlayedUtc": "2025-01-01T00:00:00.000Z"
}
```
Action: upsert SharePoint List row by `StudentCode`.

#### Power Automate: level progress/result upsert flow
Expected JSON body:
```json
{
  "StudentCode": "SC-Y6-1042",
  "Level": 2,
  "Score": 1234.56,
  "NetWorth": 1234.56,
  "Round": 7,
  "MinesOwned": 3,
  "StrategyLabel": "Asset Building",
  "InvestmentProfile": { "highRisk": 2, "lowRisk": 5, "profitChasing": 1, "assetBuilding": 4, "futureProofing": 2 },
  "LastPlayedUtc": "2025-01-01T00:00:00.000Z"
}
```

### CSV Import Formats

#### Students (`teacher/dashboard.html` → Bulk Import)
```csv
StudentCode,LeaderboardName,StudentID,StudentName,ClassCode,Level
SC-Y6-001,Golddigger,123456,Alex Smith,6B,2
SC-Y6-002,TinPan,654321,Jordan Lee,6B,3
```
Legacy format (`name,email,level`) is also accepted.

#### Teachers (`teacher/dashboard.html` → Teacher Import)
```csv
TeacherEmail,TeacherName,ClassCode,Role
teacher@education.wa.edu.au,Ms Smith,6B,teacher
admin@education.wa.edu.au,Mr Jones,,admin
```

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
