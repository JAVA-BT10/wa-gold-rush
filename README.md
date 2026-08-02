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
