window.WA_GOLD_RUSH_DASHBOARD_CONFIG = window.WA_GOLD_RUSH_DASHBOARD_CONFIG || {};

const existingFlowEndpoints = window.WA_GOLD_RUSH_DASHBOARD_CONFIG.flowEndpoints || {};

window.WA_GOLD_RUSH_DASHBOARD_CONFIG.flowEndpoints = {
    ...existingFlowEndpoints,
    loginTeacher: existingFlowEndpoints.loginTeacher
        || 'https://224cde437d52e44da36161836e53cf.cc.environment.api.powerplatform.com:443/powerautomate/automations/direct/cu/10/workflows/63479c7d2c794888b481e3d477f60136/triggers/manual/paths/invoke?api-version=1'
};
