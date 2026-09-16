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
window.WA_GOLD_RUSH_DASHBOARD_CONFIG.flowEndpoints = {
    ...existingFlowEndpoints,
    // TIER 1 - Core Foundation ✅
    loginTeacher: existingFlowEndpoints.loginTeacher
        || 'https://224cde437d52e44da36161836e53cf.cc.environment.api.powerplatform.com:443/powerautomate/automations/direct/cu/10/workflows/63479c7d2c794888b481e3d477f60136/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=eg2dklPqD9lEhEmrhI5d6UCRC-0o4Sef-P54qF4wK0M',
    loginStudent: existingFlowEndpoints.loginStudent
        || 'https://224cde437d52e44da36161836e53cf.cc.environment.api.powerplatform.com:443/powerautomate/automations/direct/cu/08/workflows/d9e728c9ccdf41ef8bd6b0e2e43a6c30/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=MXdl5PkkbZctyqlB4SCCgPNSutquUXN_MjIQmFzS9cc',
    upsertStudentProfile: existingFlowEndpoints.upsertStudentProfile
        || 'https://224cde437d52e44da36161836e53cf.cc.environment.api.powerplatform.com:443/powerautomate/automations/direct/cu/06/workflows/441ec597942642278c09e29b5c7195cf/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=3VrGGK2ZaELVnG_rtkpS8RT7TGttvKNeb1YeuocZxjI',
    changeStudentPin: existingFlowEndpoints.changeStudentPin
        || 'https://224cde437d52e44da36161836e53cf.cc.environment.api.powerplatform.com:443/powerautomate/automations/direct/cu/02/workflows/00d7ad1f20974b5d8a0337e9ea4e9958/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=8qlDFE4s62DsmT3P_cWF0uM7PQg6PL7k8-p4I5cZhAE',
    saveProgress: existingFlowEndpoints.saveProgress
        || 'https://224cde437d52e44da36161836e53cf.cc.environment.api.powerplatform.com:443/powerautomate/automations/direct/cu/11/workflows/de843a7b9cd74079ae14dc3b96e2128a/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=LhB5RSfjk_WXMB0IuYs1E8KPxLHUz1SYqWw7Y3qsJaw',
    
    // TIER 2 - Teacher Administration ✅
    upsertTeacher: existingFlowEndpoints.upsertTeacher
        || 'https://224cde437d52e44da36161836e53cf.cc.environment.api.powerplatform.com:443/powerautomate/automations/direct/cu/11/workflows/51990841b4b34fb28030e2d5c7da22c0/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=8B3B4_eD2_bz33l21IzumYDEvvenaY_7zw5s2IpUlYM',
    teacherUnlockStudent: existingFlowEndpoints.teacherUnlockStudent
        || 'https://REPLACE-WITH-GGR_TeacherUnlockStudent-URL',
    teacherResetStudentPin: existingFlowEndpoints.teacherResetStudentPin
        || 'https://REPLACE-WITH-GGR_TeacherResetStudentPin-URL',
    
    // TIER 3 - Data Loading / Dashboard Services
    getDashboardData: existingFlowEndpoints.getDashboardData
        || 'https://REPLACE-WITH-GGR_GetDashboardData-URL',
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
