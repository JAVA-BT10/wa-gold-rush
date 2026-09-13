/**
 * Shared Power Automate request header helper.
 */
(function initPowerAutomateHeaders(globalObj) {
    const DEFAULT_API_KEY = 'MySuperSecretKey2026';

    function readConfiguredApiKey() {
        const configuredKey = globalObj.WA_GOLD_RUSH_DASHBOARD_CONFIG?.apiKey
            || globalObj.WA_GOLD_RUSH_POWER_AUTOMATE_CONFIG?.apiKey
            || '';
        const normalizedKey = String(configuredKey || '').trim();
        return normalizedKey || DEFAULT_API_KEY;
    }

    function buildPowerAutomateHeaders(extraHeaders = {}) {
        return {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-GGR-Key': readConfiguredApiKey(),
            ...extraHeaders
        };
    }

    globalObj.WA_GOLD_RUSH_POWER_AUTOMATE = globalObj.WA_GOLD_RUSH_POWER_AUTOMATE || {};
    globalObj.WA_GOLD_RUSH_POWER_AUTOMATE.buildHeaders = buildPowerAutomateHeaders;
    globalObj.WA_GOLD_RUSH_POWER_AUTOMATE.getApiKey = readConfiguredApiKey;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { buildPowerAutomateHeaders, readConfiguredApiKey };
    }
})(typeof globalThis !== 'undefined' ? globalThis : window);
