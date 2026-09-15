window.WA_GOLD_RUSH_DASHBOARD_CONFIG = window.WA_GOLD_RUSH_DASHBOARD_CONFIG || {};

const existingFlowEndpoints = window.WA_GOLD_RUSH_DASHBOARD_CONFIG.flowEndpoints || {};
const existingApiKey = String(window.WA_GOLD_RUSH_DASHBOARD_CONFIG.apiKey || '').trim();
const runtimeConfiguredApiKey = String(window.WA_GOLD_RUSH_POWER_AUTOMATE_CONFIG?.apiKey || '').trim();

/**
 * Dashboard API Key Configuration
 *
 * The apiKey is used to build the X-GGR-Key header for all Power Automate flow requests.
 * Priority (in order):
 * 1. Pre-existing window.WA_GOLD_RUSH_DASHBOARD_CONFIG.apiKey (set before this script loads)
 * 2. window.WA_GOLD_RUSH_POWER_AUTOMATE_CONFIG?.apiKey (set at runtime)
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
 * If no apiKey is configured, Power Automate flows will NOT include the X-GGR-Key
 * header, causing authentication failures. Set one of the above before dashboard loads.
 */
window.WA_GOLD_RUSH_DASHBOARD_CONFIG.apiKey = existingApiKey || runtimeConfiguredApiKey;

// Diagnostic logging (remove in production if sensitive)
if (!window.WA_GOLD_RUSH_DASHBOARD_CONFIG.apiKey) {
    console.warn(
        '[Dashboard] ⚠️  No apiKey configured. Power Automate flows will not include X-GGR-Key header. ' +
        'Set window.WA_GOLD_RUSH_DASHBOARD_CONFIG.apiKey or window.WA_GOLD_RUSH_POWER_AUTOMATE_CONFIG.apiKey ' +
        'before loading the dashboard.'
    );
}

window.WA_GOLD_RUSH_DASHBOARD_CONFIG.flowEndpoints = {
    ...existingFlowEndpoints,
    loginTeacher: existingFlowEndpoints.loginTeacher
        || 'https://224cde437d52e44da36161836e53cf.cc.environment.api.powerplatform.com:443/powerautomate/automations/direct/cu/10/workflows/63479c7d2c794888b481e3d477f60136/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=eg2dklPqD9lEhEmrhI5d6UCRC-0o4Sef-P54qF4wK0M',
    loginStudent: existingFlowEndpoints.loginStudent
        || 'https://224cde437d52e44da36161836e53cf.cc.environment.api.powerplatform.com:443/powerautomate/automations/direct/cu/08/workflows/d9e728c9ccdf41ef8bd6b0e2e43a6c30/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=MXdl5PkkbZctyqlB4SCCgPNSutquUXN_MjIQmFzS9cc',
    upsertStudentProfile: existingFlowEndpoints.upsertStudentProfile
        || 'https://224cde437d52e44da36161836e53cf.cc.environment.api.powerplatform.com:443/powerautomate/automations/direct/cu/06/workflows/441ec597942642278c09e29b5c7195cf/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=3VrGGK2ZaELVnG_rtkpS8RT7TGttvKNeb1YeuocZxjI',
    upsertTeacher: existingFlowEndpoints.upsertTeacher
        || 'https://REPLACE-WITH-GGR_UpsertTeacher-URL',
    bulkImportStudents: existingFlowEndpoints.bulkImportStudents
        || 'https://REPLACE-WITH-GGR_BulkImportStudents-URL',
    bulkImportTeachers: existingFlowEndpoints.bulkImportTeachers
        || 'https://REPLACE-WITH-GGR_BulkImportTeachers-URL',
    changeStudentPin: existingFlowEndpoints.changeStudentPin
        || 'https://224cde437d52e44da36161836e53cf.cc.environment.api.powerplatform.com:443/powerautomate/automations/direct/cu/02/workflows/00d7ad1f20974b5d8a0337e9ea4e9958/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=8qlDFE4s62DsmT3P_cWF0uM7PQg6PL7k8-p4I5cZhAE',
    saveProgress: existingFlowEndpoints.saveProgress
        || 'https://224cde437d52e44da36161836e53cf.cc.environment.api.powerplatform.com:443/powerautomate/automations/direct/cu/11/workflows/de843a7b9cd74079ae14dc3b96e2128a/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=LhB5RSfjk_WXMB0IuYs1E8KPxLHUz1SYqWw7Y3qsJaw',
    teacherUnlockStudent: existingFlowEndpoints.teacherUnlockStudent
        || 'https://REPLACE-WITH-GGR_TeacherUnlockStudent-URL',
    teacherResetStudentPin: existingFlowEndpoints.teacherResetStudentPin
        || 'https://REPLACE-WITH-GGR_TeacherResetStudentPin-URL',
    rebuildLeaderboardOnProgressChange: existingFlowEndpoints.rebuildLeaderboardOnProgressChange
        || 'https://REPLACE-WITH-GGR_RebuildLevelLeaderboard_OnProgressChange-URL',
    upsertInvestmentProfileOnProgressChange: existingFlowEndpoints.upsertInvestmentProfileOnProgressChange
        || 'https://REPLACE-WITH-GGR_UpsertInvestmentProfile_OnProgressChange-URL'
};
