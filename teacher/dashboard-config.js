window.WA_GOLD_RUSH_DASHBOARD_CONFIG = window.WA_GOLD_RUSH_DASHBOARD_CONFIG || {};

const existingFlowEndpoints = window.WA_GOLD_RUSH_DASHBOARD_CONFIG.flowEndpoints || {};

window.WA_GOLD_RUSH_DASHBOARD_CONFIG.flowEndpoints = {
    ...existingFlowEndpoints,
    loginTeacher: existingFlowEndpoints.loginTeacher
        || 'https://224cde437d52e44da36161836e53cf.cc.environment.api.powerplatform.com:443/powerautomate/automations/direct/cu/10/workflows/63479c7d2c794888b481e3d477f60136/triggers/manual/paths/invoke',
    loginStudent: existingFlowEndpoints.loginStudent
        || 'https://REPLACE-WITH-GGR_LoginStudent-URL',
    upsertStudentProfile: existingFlowEndpoints.upsertStudentProfile
        || 'https://REPLACE-WITH-GGR_UpsertStudentProfile-URL',
    changeStudentPin: existingFlowEndpoints.changeStudentPin
        || 'https://REPLACE-WITH-GGR_ChangeStudentPin-URL',
    saveProgress: existingFlowEndpoints.saveProgress
        || 'https://REPLACE-WITH-GGR_SaveProgress-URL',
    teacherUnlockStudent: existingFlowEndpoints.teacherUnlockStudent
        || 'https://REPLACE-WITH-GGR_TeacherUnlockStudent-URL',
    teacherResetStudentPin: existingFlowEndpoints.teacherResetStudentPin
        || 'https://REPLACE-WITH-GGR_TeacherResetStudentPin-URL',
    rebuildLeaderboardOnProgressChange: existingFlowEndpoints.rebuildLeaderboardOnProgressChange
        || 'https://REPLACE-WITH-GGR_RebuildLevelLeaderboard_OnProgressChange-URL',
    upsertInvestmentProfileOnProgressChange: existingFlowEndpoints.upsertInvestmentProfileOnProgressChange
        || 'https://REPLACE-WITH-GGR_UpsertInvestmentProfile_OnProgressChange-URL'
};
