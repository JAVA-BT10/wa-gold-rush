/**
 * Shared Power Automate request header helper.
 */
(function initPowerAutomateHeaders(globalObj) {
    function readConfiguredApiKey() {
        const configuredKey = globalObj.WA_GOLD_RUSH_DASHBOARD_CONFIG?.apiKey
            || globalObj.WA_GOLD_RUSH_POWER_AUTOMATE_CONFIG?.apiKey
            || '';
        const normalizedKey = String(configuredKey || '').trim();
        return normalizedKey;
    }

    function buildPowerAutomateHeaders(extraHeaders = {}, options = {}) {
        const headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        };

        if (options.includeApiKey !== false) {
            const apiKey = readConfiguredApiKey();
            if (apiKey) headers['X-GGR-Key'] = apiKey;
        }

        return { ...headers, ...extraHeaders };
    }

    globalObj.WA_GOLD_RUSH_POWER_AUTOMATE = globalObj.WA_GOLD_RUSH_POWER_AUTOMATE || {};
    globalObj.WA_GOLD_RUSH_POWER_AUTOMATE.buildHeaders = buildPowerAutomateHeaders;
    globalObj.WA_GOLD_RUSH_POWER_AUTOMATE.getApiKey = readConfiguredApiKey;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { buildPowerAutomateHeaders, readConfiguredApiKey };
    }
})(typeof globalThis !== 'undefined' ? globalThis : window);
