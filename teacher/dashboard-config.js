window.WA_GOLD_RUSH_DASHBOARD_CONFIG = window.WA_GOLD_RUSH_DASHBOARD_CONFIG || {};

const existingFlowEndpoints = window.WA_GOLD_RUSH_DASHBOARD_CONFIG.flowEndpoints || {};

function normalizeApiKey(value) {
    return String(value || '').trim();
}

const hasOwnDashboardApiKey = Object.prototype.hasOwnProperty.call(window.WA_GOLD_RUSH_DASHBOARD_CONFIG, 'apiKey');
let configuredDashboardApiKey = hasOwnDashboardApiKey
    ? normalizeApiKey(window.WA_GOLD_RUSH_DASHBOARD_CONFIG.apiKey)
    : '';

function readRuntimeConfiguredApiKey() {
    return normalizeApiKey(window.WA_GOLD_RUSH_POWER_AUTOMATE_CONFIG?.apiKey);
}

/**
 * Dashboard API Key Configuration
 *
 * The apiKey is used to build the X-GGR-Key header for all Power Automate flow requests.
 * Priority (in order):
 * 1. Pre-existing window.WA_GOLD_RUSH_DASHBOARD_CONFIG.apiKey (set before this script loads)
 * 2. window.WA_GOLD_RUSH_POWER_AUTOMATE_CONFIG?.apiKey (resolved at runtime)
 *
 * Configuration Methods:
 *
 * Option A: HTML-inline (before dashboard script loads)
 *   <script>
 *     window.WA_GOLD_RUSH_DASHBOARD_CONFIG = { apiKey: 'your-secret-key' };
 *   </script>
 *   <script src="teacher/dashboard-config.js"></script>
 *
 * Option B: Runtime injection (before any flow requests)
 *   window.WA_GOLD_RUSH_POWER_AUTOMATE_CONFIG = { apiKey: 'your-secret-key' };
 *
 * Option C: Environment variable at build time
 *   Set WA_GGR_API_KEY during build, then inject into this config.
 *
 * If no apiKey is configured, Power Automate flow POSTs are blocked before sending
 * because the required X-GGR-Key header cannot be attached. Set one of the above
 * before dashboard loads.
 */
if (!hasOwnDashboardApiKey) {
    Object.defineProperty(window.WA_GOLD_RUSH_DASHBOARD_CONFIG, 'apiKey', {
        configurable: true,
        enumerable: true,
        get() {
            return configuredDashboardApiKey || readRuntimeConfiguredApiKey();
        },
        set(value) {
            configuredDashboardApiKey = normalizeApiKey(value);
        }
    });
}

// Diagnostic logging (remove in production if sensitive)
setTimeout(() => {
    const apiKey = String(
        window.WA_GOLD_RUSH_DASHBOARD_CONFIG?.apiKey
        || window.WA_GOLD_RUSH_POWER_AUTOMATE_CONFIG?.apiKey
        || ''
    ).trim();
    if (!apiKey) {
        console.warn(
            '[Dashboard] ⚠️  No apiKey configured. Power Automate flow POSTs are blocked because X-GGR-Key is required. ' +
            'Set window.WA_GOLD_RUSH_DASHBOARD_CONFIG.apiKey or window.WA_GOLD_RUSH_POWER_AUTOMATE_CONFIG.apiKey ' +
            'before sending authenticated dashboard flow requests.'
        );
    }
}, 0);

/**
 * Power Automate Flow Endpoints
 *
 * TIER 1 - Core Foundation (Critical Path - Must work first)
 * Flow 1: GGR_LoginTeacher          - Teacher authentication & dashboard access ✅
 * Flow 2: GGR_UpsertStudentProfile  - Create/update student profiles → GGR_Students ✅
 * Flow 3: GGR_LoginStudent          - Student authentication ✅
 * Flow 4: GGR_ChangeStudentPin      - Student PIN management ✅
 * Flow 5: GGR_SaveProgress          - Save gameplay → GGR_StudentProgress ✅
 *
 * TIER 2 - Teacher Administration (Build after Tier 1 proven)
 * Flow 6: GGR_UpsertTeacher         - Create/update teacher records → GGR_Teachers ✅
 * Flow 7: GGR_TeacherUnlockStudent  - Unlock accounts, reset login attempts
 * Flow 8: GGR_TeacherResetStudentPin - Force PIN reset by teacher
 *
 * TIER 3 - Data Loading / Dashboard Services (Fully dynamic dashboard)
 * Flow 9: GGR_GetDashboardData      - Load students, teachers, classes, stats
 * Flow 10: GGR_GetStudentProgress   - Load saved game for cross-device play
 *
 * TIER 4 - Analytics (Automatic/background)
 * Flow 11: GGR_RebuildLevelLeaderboard_OnProgressChange - Auto-update leaderboards
 * Flow 12: GGR_UpsertInvestmentProfile_OnProgressChange - Auto-update investment profiles
 *
 * TIER 5 - Auditing
 * Flow 13: GGR_ImportAuditLogger    - Track imports, dashboard actions, teacher activity
 */
const sharedFlowEndpoints = window.WA_GOLD_RUSH_FLOW_ENDPOINTS || {};
const configuredUnlockEndpoint = String(existingFlowEndpoints.teacherUnlockStudent || '').trim();
const configuredGetDashboardDataEndpoint = String(existingFlowEndpoints.getDashboardData || '').trim();

window.WA_GOLD_RUSH_DASHBOARD_CONFIG.flowEndpoints = {
    ...sharedFlowEndpoints,
    ...existingFlowEndpoints,
    teacherUnlockStudent: configuredUnlockEndpoint && !/REPLACE-WITH/i.test(configuredUnlockEndpoint)
        ? configuredUnlockEndpoint
        : (sharedFlowEndpoints.teacherUnlockStudent
            || 'https://REPLACE-WITH-GGR_TeacherUnlockStudent-URL'),
    teacherResetStudentPin: existingFlowEndpoints.teacherResetStudentPin
        || 'https://REPLACE-WITH-GGR_TeacherResetStudentPin-URL',
    
    // TIER 3 - Data Loading / Dashboard Services
    getDashboardData: configuredGetDashboardDataEndpoint && !/REPLACE-WITH/i.test(configuredGetDashboardDataEndpoint)
        ? configuredGetDashboardDataEndpoint
        : (sharedFlowEndpoints.getDashboardData
            || 'https://REPLACE-WITH-GGR_GetDashboardData-URL'),
    getStudentProgress: existingFlowEndpoints.getStudentProgress
        || 'https://REPLACE-WITH-GGR_GetStudentProgress-URL',
    
    // TIER 4 - Analytics
    rebuildLeaderboardOnProgressChange: existingFlowEndpoints.rebuildLeaderboardOnProgressChange
        || 'https://REPLACE-WITH-GGR_RebuildLevelLeaderboard_OnProgressChange-URL',
    upsertInvestmentProfileOnProgressChange: existingFlowEndpoints.upsertInvestmentProfileOnProgressChange
        || 'https://REPLACE-WITH-GGR_UpsertInvestmentProfile_OnProgressChange-URL',
    
    // TIER 5 - Auditing
    importAuditLogger: existingFlowEndpoints.importAuditLogger
        || 'https://REPLACE-WITH-GGR_ImportAuditLogger-URL'
};
