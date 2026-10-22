/**
 * Centralized level + backend capability registry.
 *
 * "Recognized" levels (1–6) can be named and shown in the UI. Only "playable"
 * levels can be started, and only "savePipeline" levels write per-level saves
 * through GGR_SaveProgress. Level 6 (Goldfields Mastery) is recognized but
 * NOT playable: it is planned work (see docs/architecture/
 * level-6-goldfields-mastery-blueprint.md) and nothing here can enable it.
 *
 * Feature flags for tenant-dependent vNext behaviour default to OFF. A flag is
 * only honoured when it is literally `true` in the runtime configuration AND
 * the flow it depends on has a configured, non-placeholder endpoint. Turning a
 * flag on does not prove that the deployed flow implements the contract; each
 * response is still validated (see shared/save-protocol.js and
 * shared/cloud-restore.js). Runtime/Pages configuration is browser-visible
 * and is not an authentication mechanism.
 */
(function initLevelCapabilities(globalObj) {
    const LEVELS = Object.freeze({
        1: Object.freeze({
            level: 1,
            title: 'Basic Mining',
            engine: 'level-1-basic',
            recognized: true,
            playable: true,
            savePipeline: false,
            rosterAssignable: true,
            requiredCheckpointLevel: null,
            status: 'available',
            note: 'Auth-only practice game; no per-level save or cloud progress pipeline yet.'
        }),
        2: Object.freeze({
            level: 2,
            title: 'Goldfields Venture',
            engine: 'goldfields-venture',
            recognized: true,
            playable: true,
            savePipeline: true,
            rosterAssignable: true,
            requiredCheckpointLevel: null,
            status: 'available'
        }),
        3: Object.freeze({
            level: 3,
            title: 'WA Goldfields',
            engine: 'goldfields-venture',
            recognized: true,
            playable: true,
            savePipeline: true,
            rosterAssignable: true,
            requiredCheckpointLevel: 2,
            status: 'available'
        }),
        4: Object.freeze({
            level: 4,
            title: 'Advanced Operations',
            engine: 'goldfields-venture',
            recognized: true,
            playable: true,
            savePipeline: true,
            rosterAssignable: true,
            requiredCheckpointLevel: 3,
            status: 'available'
        }),
        5: Object.freeze({
            level: 5,
            title: 'Classroom Challenge',
            engine: 'goldfields-venture',
            recognized: true,
            playable: true,
            savePipeline: true,
            rosterAssignable: true,
            requiredCheckpointLevel: 4,
            status: 'available'
        }),
        6: Object.freeze({
            level: 6,
            title: 'Goldfields Mastery',
            engine: 'goldfields-mastery (planned)',
            recognized: true,
            playable: false,
            savePipeline: false,
            rosterAssignable: false,
            requiredCheckpointLevel: 5,
            status: 'planned',
            note: 'Planned historical timeline simulation. Not implemented, not deployed, cannot be assigned or started.'
        })
    });

    /**
     * Flow registry. `status` describes what this repository can honestly say:
     *  - existing_endpoint: a trigger URL is wired in shared/flow-endpoints.js;
     *    that is NOT evidence that the deployed flow meets the documented contract.
     *  - optional_unconfigured: referenced by client code but no endpoint is wired.
     *  - planned: a proposed flow name. Not deployed. Client code must not call it
     *    unless its feature flag is on AND an endpoint is configured.
     */
    const FLOWS = Object.freeze({
        loginStudent: Object.freeze({ name: 'GGR_LoginStudent', status: 'existing_endpoint', flag: null }),
        loginTeacher: Object.freeze({ name: 'GGR_LoginTeacher', status: 'existing_endpoint', flag: null }),
        changeStudentPin: Object.freeze({ name: 'GGR_ChangeStudentPin', status: 'existing_endpoint', flag: null }),
        upsertStudentProfile: Object.freeze({ name: 'GGR_UpsertStudentProfile', status: 'existing_endpoint', flag: null }),
        upsertTeacher: Object.freeze({ name: 'GGR_UpsertTeacher', status: 'existing_endpoint', flag: null }),
        saveProgress: Object.freeze({ name: 'GGR_SaveProgress', status: 'existing_endpoint', flag: null }),
        getDashboardData: Object.freeze({ name: 'GGR_GetDashboardData', status: 'existing_endpoint', flag: null }),
        teacherUnlockStudent: Object.freeze({ name: 'GGR_TeacherUnlockStudent', status: 'existing_endpoint', flag: null }),
        saveCheckpointApproval: Object.freeze({ name: 'GGR_SaveCheckpointApproval', status: 'optional_unconfigured', flag: null }),
        getStudentProgress: Object.freeze({ name: 'GGR_GetStudentProgress', status: 'optional_unconfigured', flag: null }),
        teacherResetStudentPin: Object.freeze({ name: 'GGR_TeacherResetStudentPin', status: 'optional_unconfigured', flag: null }),
        rebuildLeaderboardOnProgressChange: Object.freeze({ name: 'GGR_RebuildLevelLeaderboard_OnProgressChange', status: 'optional_unconfigured', flag: null }),
        upsertInvestmentProfileOnProgressChange: Object.freeze({ name: 'GGR_UpsertInvestmentProfile_OnProgressChange', status: 'optional_unconfigured', flag: null }),
        importAuditLogger: Object.freeze({ name: 'GGR_ImportAuditLogger', status: 'optional_unconfigured', flag: null }),
        resetLevelProgress: Object.freeze({ name: 'GGR_ResetLevelProgress', status: 'planned', flag: 'levelResetFlow' }),
        getLeaderboard: Object.freeze({ name: 'GGR_GetLeaderboard', status: 'planned', flag: 'serverLeaderboard' }),
        copyCompetitionSnapshot: Object.freeze({ name: 'GGR_CopyCompetitionSnapshot', status: 'planned', flag: 'competitionBaselines' }),
        level6HistoricalResults: Object.freeze({ name: 'GGR_Level6HistoricalResults', status: 'planned', flag: 'level6Analytics' })
    });

    /** Every tenant-dependent vNext behaviour, all OFF by default. */
    const DEFAULT_FLAGS = Object.freeze({
        // Send revision/idempotency/generation fields to GGR_SaveProgress and
        // require the v2 acknowledgement. Requires the server protocol in
        // docs/power-automate/save-protocol-v2.md.
        saveProtocolV2: false,
        // Ask GGR_GetStudentProgress for a full exact-slot snapshot at startup.
        fullCloudRestore: false,
        serverLeaderboard: false,
        levelResetFlow: false,
        competitionBaselines: false,
        competitionLeaderboardMetric: false,
        competitionSnapshots: false,
        level6Analytics: false,
        // Policy: when cloud state for a brand-new local level slot cannot be
        // verified, hold all cloud uploads for that slot (fail closed) instead
        // of uploading after the student's first real action.
        holdUnverifiedNewSlotUploads: false
    });

    function readRuntimeFlags(root) {
        const source = root?.WA_GOLD_RUSH_RUNTIME_CONFIG?.featureFlags;
        return source && typeof source === 'object' ? source : {};
    }

    function getFeatureFlags(root = globalObj) {
        const runtime = readRuntimeFlags(root);
        const flags = {};
        Object.keys(DEFAULT_FLAGS).forEach((name) => {
            flags[name] = runtime[name] === true;
        });
        return flags;
    }

    function isFeatureEnabled(name, root = globalObj) {
        if (!Object.prototype.hasOwnProperty.call(DEFAULT_FLAGS, name)) return false;
        return getFeatureFlags(root)[name] === true;
    }

    function normalizeLevelNumber(value) {
        if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
        const text = String(value).trim();
        if (!/^\d+$/.test(text)) return null;
        const level = Number(text);
        return Object.prototype.hasOwnProperty.call(LEVELS, level) ? level : null;
    }

    function getLevel(value) {
        const level = normalizeLevelNumber(value);
        return level === null ? null : LEVELS[level];
    }

    function isRecognizedLevel(value) {
        return !!getLevel(value)?.recognized;
    }

    function isPlayableLevel(value) {
        return !!getLevel(value)?.playable;
    }

    function isSavePipelineLevel(value) {
        const entry = getLevel(value);
        return !!(entry && entry.playable && entry.savePipeline);
    }

    function isRosterAssignableLevel(value) {
        return !!getLevel(value)?.rosterAssignable;
    }

    function listLevels() {
        return Object.keys(LEVELS).map(Number).sort((a, b) => a - b).map((level) => LEVELS[level]);
    }

    function getPlayableLevels() {
        return listLevels().filter((entry) => entry.playable).map((entry) => entry.level);
    }

    function getSavePipelineLevels() {
        return listLevels().filter((entry) => entry.playable && entry.savePipeline).map((entry) => entry.level);
    }

    /**
     * Next level a passed checkpoint may lead to. Capped to playable levels:
     * Level 5 → 6 returns null until Level 6 is implemented and deployed.
     */
    function getNextPlayableLevel(value) {
        const level = normalizeLevelNumber(value);
        if (level === null) return null;
        const next = LEVELS[level + 1];
        return next && next.playable ? next.level : null;
    }

    function resolveEndpoint(flowKey, root) {
        const api = root?.WA_GOLD_RUSH_POWER_AUTOMATE;
        let endpoint = '';
        if (api && typeof api.resolveFlowEndpoint === 'function') {
            endpoint = String(api.resolveFlowEndpoint(flowKey) || '').trim();
        } else {
            endpoint = String(root?.WA_GOLD_RUSH_FLOW_ENDPOINTS?.[flowKey] || '').trim();
        }
        if (!endpoint || /REPLACE-WITH/i.test(endpoint)) return '';
        return endpoint;
    }

    /**
     * A flow may only be called when it has a configured, non-placeholder
     * endpoint and, for planned flows, its feature flag is explicitly on.
     */
    function isFlowCallable(flowKey, root = globalObj) {
        const flow = FLOWS[flowKey];
        if (!flow) return false;
        if (flow.status === 'planned' && !(flow.flag && isFeatureEnabled(flow.flag, root))) return false;
        return !!resolveEndpoint(flowKey, root);
    }

    const api = {
        LEVELS,
        FLOWS,
        DEFAULT_FLAGS,
        getFeatureFlags,
        isFeatureEnabled,
        normalizeLevelNumber,
        getLevel,
        isRecognizedLevel,
        isPlayableLevel,
        isSavePipelineLevel,
        isRosterAssignableLevel,
        listLevels,
        getPlayableLevels,
        getSavePipelineLevels,
        getNextPlayableLevel,
        isFlowCallable
    };

    globalObj.WA_GOLD_RUSH_LEVEL_CAPABILITIES = api;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})(typeof globalThis !== 'undefined' ? globalThis : window);
