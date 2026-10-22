(function initCompetitionSnapshot(globalObj) {
    const CONTRACT_VERSION = 'ggr.competitionSnapshot.v1';
    const OPERATIONS = Object.freeze(['capture_baseline', 'freeze', 'close', 'export']);
    const LEVELS = new Set([2, 3, 4, 5]);
    const RESULT_STATUS = Object.freeze({
        capture_baseline: 'active',
        freeze: 'frozen',
        close: 'closed',
        export: 'exported'
    });

    function unavailable(reason) {
        return { ok: false, status: 'unavailable', reason };
    }

    function text(value) {
        return value === null || value === undefined ? '' : String(value).trim();
    }

    function validRequest(operation, payload) {
        const level = Number(payload.level);
        return OPERATIONS.includes(operation)
            && !!text(payload.competitionId)
            && LEVELS.has(level)
            && Array.isArray(payload.classCodes)
            && payload.classCodes.length > 0
            && payload.classCodes.every((code) => !!text(code));
    }

    async function requestCompetitionSnapshot(operation, payload = {}, options = {}) {
        const root = options.root || globalObj;
        const caps = root.WA_GOLD_RUSH_LEVEL_CAPABILITIES;
        if (!validRequest(operation, payload)) return unavailable('invalid_request');
        if (!caps || typeof caps.isFeatureEnabled !== 'function') return unavailable('capabilities_unavailable');
        if (!caps.isFeatureEnabled('competitionBaselines', root)) return unavailable('feature_disabled');
        if (['freeze', 'close', 'export'].includes(operation)
            && !caps.isFeatureEnabled('competitionSnapshots', root)) {
            return unavailable('feature_disabled');
        }
        if (!caps.isFlowCallable('copyCompetitionSnapshot', root)) {
            return unavailable('endpoint_unconfigured');
        }

        const powerAutomate = root.WA_GOLD_RUSH_POWER_AUTOMATE;
        const callFlow = options.callFlow || powerAutomate?.callFlow;
        if (typeof callFlow !== 'function') return unavailable('flow_client_unavailable');

        let timer;
        const AbortControllerImpl = root.AbortController || globalObj.AbortController;
        const controller = typeof AbortControllerImpl === 'function' ? new AbortControllerImpl() : null;
        const timeoutMs = Number.isInteger(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : 8000;
        const setTimer = root.setTimeout || globalObj.setTimeout;
        const clearTimer = root.clearTimeout || globalObj.clearTimeout;
        const flowOptions = { ...(options.flowOptions || {}) };
        if (!flowOptions.signal && controller) flowOptions.signal = controller.signal;
        let result;
        try {
            const flowRequest = callFlow.call(powerAutomate, 'copyCompetitionSnapshot', {
                contractVersion: CONTRACT_VERSION,
                operation,
                competitionId: text(payload.competitionId),
                classCodes: payload.classCodes.map((code) => text(code).toUpperCase()),
                level: Number(payload.level),
                metric: text(payload.metric) || 'competitionProfit',
                scoringVersion: text(payload.scoringVersion) || 'competition-profit-v1',
                cutoffUtc: text(payload.cutoffUtc),
                rules: payload.rules && typeof payload.rules === 'object' ? payload.rules : {}
            }, flowOptions);
            const timeout = new Promise((_, reject) => {
                timer = setTimer(() => {
                    controller?.abort();
                    const error = new Error('Competition flow timed out.');
                    error.code = 'flow_timeout';
                    reject(error);
                }, timeoutMs);
            });
            result = await Promise.race([flowRequest, timeout]);
        } catch (error) {
            return unavailable(error?.code === 'flow_timeout' ? 'flow_timeout' : 'flow_failed');
        } finally {
            if (timer !== undefined) clearTimer(timer);
        }

        const data = result?.data;
        if (!result?.success) {
            return unavailable(result?.skipped ? 'endpoint_unconfigured' : 'flow_failed');
        }
        if (!data || data.ok !== true || data.contractVersion !== CONTRACT_VERSION
            || data.operation !== operation || data.status !== RESULT_STATUS[operation]
            || data.competitionId !== text(payload.competitionId)
            || Number(data.level) !== Number(payload.level)) {
            return unavailable('invalid_response');
        }
        const recordCount = Number(data.recordCount ?? data.recordsCaptured);
        if (!Number.isInteger(recordCount) || recordCount < 0) return unavailable('invalid_response');

        const response = {
            ok: true,
            status: RESULT_STATUS[operation],
            operation,
            competitionId: text(payload.competitionId),
            level: Number(payload.level),
            recordCount
        };
        return response;
    }

    const api = { CONTRACT_VERSION, OPERATIONS, RESULT_STATUS, requestCompetitionSnapshot };
    globalObj.WA_GOLD_RUSH_COMPETITION_SNAPSHOT = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
