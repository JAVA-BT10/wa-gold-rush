window.WA_GOLD_RUSH_DASHBOARD_CONFIG = window.WA_GOLD_RUSH_DASHBOARD_CONFIG || {};

const existingFlowEndpoints = window.WA_GOLD_RUSH_DASHBOARD_CONFIG.flowEndpoints || {};
const existingApiKey = String(window.WA_GOLD_RUSH_DASHBOARD_CONFIG.apiKey || '').trim();
const runtimeConfiguredApiKey = String(window.WA_GOLD_RUSH_POWER_AUTOMATE_CONFIG?.apiKey || '').trim();

window.WA_GOLD_RUSH_DASHBOARD_CONFIG.apiKey = existingApiKey || runtimeConfiguredApiKey || 'MySuperSecretKey2026';

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
        || 'https://224cde437d52e44da36161836e53cf.cc.environment.api.powerplatform.com:443/powerautomate/automations/direct/cu/02/workflows/00d7ad1f20974b5d8a0337e9ea4e9958/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=RpwToQQqWyJTJzTkGxQ3pGwD6r8C3kL_wWNJwChHx20',
    saveProgress: existingFlowEndpoints.saveProgress
        || 'https://224cde437d52e44da36161836e53cf.cc.environment.api.powerplatform.com:443/powerautomate/automations/direct/cu/11/workflows/de843a7b9cd74079ae14dc3b96e2128a/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=UrSe8pJ17rOw8j3vf-TfOQMVowucgt1-FIdZzUa2vCA',
    teacherUnlockStudent: existingFlowEndpoints.teacherUnlockStudent
        || 'https://REPLACE-WITH-GGR_TeacherUnlockStudent-URL',
    teacherResetStudentPin: existingFlowEndpoints.teacherResetStudentPin
        || 'https://REPLACE-WITH-GGR_TeacherResetStudentPin-URL',
    rebuildLeaderboardOnProgressChange: existingFlowEndpoints.rebuildLeaderboardOnProgressChange
        || 'https://REPLACE-WITH-GGR_RebuildLevelLeaderboard_OnProgressChange-URL',
    upsertInvestmentProfileOnProgressChange: existingFlowEndpoints.upsertInvestmentProfileOnProgressChange
        || 'https://REPLACE-WITH-GGR_UpsertInvestmentProfile_OnProgressChange-URL'
};
