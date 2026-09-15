/**
 * Shared Power Automate request header helper.
 */
(function initPowerAutomateHeaders(globalObj) {
    function normalizeApiKey(value) {
        return String(value || '').trim();
    }

    function readConfiguredApiKey() {
        const configuredKey = globalObj.WA_GOLD_RUSH_DASHBOARD_CONFIG?.apiKey
            || globalObj.WA_GOLD_RUSH_POWER_AUTOMATE_CONFIG?.apiKey
            || '';
        return normalizeApiKey(configuredKey);
    }

    function resolveApiKey(apiKeyOverride) {
        return normalizeApiKey(apiKeyOverride) || readConfiguredApiKey();
    }

    function buildPowerAutomateHeaders(extraHeaders = {}, options = {}) {
        const headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        };

        if (options.includeApiKey !== false) {
            const apiKey = resolveApiKey(options.apiKey);
            if (apiKey) headers['X-GGR-Key'] = apiKey;
        }

        return { ...headers, ...extraHeaders };
    }

    async function postToFlow(url, payload, options = {}) {
        const endpoint = String(url || '').trim();
        if (!endpoint) {
            throw new Error('Power Automate flow URL is required.');
        }
        if (typeof payload === 'undefined') {
            throw new Error('Power Automate flow payload is required.');
        }

        const fetchImpl = typeof options.fetch === 'function'
            ? options.fetch
            : (typeof globalObj.fetch === 'function' ? globalObj.fetch.bind(globalObj) : null);
        if (!fetchImpl) {
            throw new Error('Fetch is unavailable.');
        }

        const shouldIncludeApiKey = options.includeApiKey !== false;
        const apiKey = shouldIncludeApiKey ? resolveApiKey(options.apiKey) : '';
        if (options.requireApiKey === true && !apiKey) {
            throw new Error('Power Automate API key is required.');
        }

        return fetchImpl(endpoint, {
            method: 'POST',
            headers: buildPowerAutomateHeaders(
                options.extraHeaders,
                shouldIncludeApiKey ? { ...options, apiKey } : { ...options, includeApiKey: false }
            ),
            cache: typeof options.cache === 'undefined' ? 'no-store' : options.cache,
            body: JSON.stringify(payload)
        });
    }

    globalObj.WA_GOLD_RUSH_POWER_AUTOMATE = globalObj.WA_GOLD_RUSH_POWER_AUTOMATE || {};
    globalObj.WA_GOLD_RUSH_POWER_AUTOMATE.buildHeaders = buildPowerAutomateHeaders;
    globalObj.WA_GOLD_RUSH_POWER_AUTOMATE.getApiKey = readConfiguredApiKey;
    globalObj.WA_GOLD_RUSH_POWER_AUTOMATE.postToFlow = postToFlow;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            buildPowerAutomateHeaders,
            readConfiguredApiKey,
            resolveApiKey,
            postToFlow
        };
    }
})(typeof globalThis !== 'undefined' ? globalThis : window);
