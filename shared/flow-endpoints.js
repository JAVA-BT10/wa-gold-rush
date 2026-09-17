(function initFlowEndpoints(globalObj) {
    const existingEndpoints = globalObj.WA_GOLD_RUSH_FLOW_ENDPOINTS || {};
    const dashboardEndpoints = globalObj.WA_GOLD_RUSH_DASHBOARD_CONFIG?.flowEndpoints || {};

    const defaults = {
        loginTeacher: 'https://224cde437d52e44da36161836e53cf.cc.environment.api.powerplatform.com:443/powerautomate/automations/direct/cu/10/workflows/63479c7d2c794888b481e3d477f60136/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=eg2dklPqD9lEhEmrhI5d6UCRC-0o4Sef-P54qF4wK0M',
        loginStudent: 'https://224cde437d52e44da36161836e53cf.cc.environment.api.powerplatform.com:443/powerautomate/automations/direct/cu/08/workflows/d9e728c9ccdf41ef8bd6b0e2e43a6c30/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=MXdl5PkkbZctyqlB4SCCgPNSutquUXN_MjIQmFzS9cc',
        upsertStudentProfile: 'https://224cde437d52e44da36161836e53cf.cc.environment.api.powerplatform.com:443/powerautomate/automations/direct/cu/06/workflows/441ec597942642278c09e29b5c7195cf/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=3VrGGK2ZaELVnG_rtkpS8RT7TGttvKNeb1YeuocZxjI',
        upsertTeacher: 'https://224cde437d52e44da36161836e53cf.cc.environment.api.powerplatform.com:443/powerautomate/automations/direct/cu/11/workflows/51990841b4b34fb28030e2d5c7da22c0/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=8B3B4_eD2_bz33l21IzumYDEvvenaY_7zw5s2IpUlYM',
        changeStudentPin: 'https://224cde437d52e44da36161836e53cf.cc.environment.api.powerplatform.com:443/powerautomate/automations/direct/cu/02/workflows/00d7ad1f20974b5d8a0337e9ea4e9958/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=RpwToQQqWyJTJzTkGxQ3pGwD6r8C3kL_wWNJwChHx20',
        saveProgress: 'https://224cde437d52e44da36161836e53cf.cc.environment.api.powerplatform.com:443/powerautomate/automations/direct/cu/11/workflows/de843a7b9cd74079ae14dc3b96e2128a/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=UrSe8pJ17rOw8j3vf-TfOQMVowucgt1-FIdZzUa2vCA',
        teacherUnlockStudent: 'https://224cde437d52e44da36161836e53cf.cc.environment.api.powerplatform.com:443/powerautomate/automations/direct/cu/11/workflows/a7d0d76c24304f6bbfae4cb50df223f8/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=3gHMEDXh4lqrOLpCj9SnuEfSsVhqjrHVQ3ilp8IspWc'
    };

    function applyOverrides(target, source) {
        Object.entries(source || {}).forEach(([key, value]) => {
            const endpoint = String(value || '').trim();
            if (!endpoint || /REPLACE-WITH/i.test(endpoint)) return;
            target[key] = endpoint;
        });
    }

    const merged = { ...defaults };
    applyOverrides(merged, existingEndpoints);
    applyOverrides(merged, dashboardEndpoints);
    globalObj.WA_GOLD_RUSH_FLOW_ENDPOINTS = merged;
})(typeof globalThis !== 'undefined' ? globalThis : window);
