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

    function normalizeExtraHeaders(headers) {
        if (!headers) return {};
        if (typeof headers.entries === 'function') {
            return Object.fromEntries(headers.entries());
        }
        if (Array.isArray(headers)) {
            return Object.fromEntries(headers);
        }
        return { ...headers };
    }

    function isNonJsonPayload(payload) {
        if (typeof globalObj.FormData !== 'undefined' && payload instanceof globalObj.FormData) return true;
        if (typeof globalObj.Blob !== 'undefined' && payload instanceof globalObj.Blob) return true;
        if (typeof globalObj.ArrayBuffer !== 'undefined' && payload instanceof globalObj.ArrayBuffer) return true;
        if (typeof globalObj.URLSearchParams !== 'undefined' && payload instanceof globalObj.URLSearchParams) return true;
        return false;
    }

    /**
     * Send a JSON payload to a Power Automate HTTP trigger.
     * This helper is intentionally for JSON request bodies only.
     */
    async function postToFlow(url, payload, options = {}) {
        const endpoint = String(url || '').trim();
        if (!endpoint) {
            throw new Error('Power Automate flow URL is required.');
        }
        if (typeof payload === 'undefined') {
            throw new Error('Power Automate flow payload is required.');
        }
        if (isNonJsonPayload(payload)) {
            throw new Error('Power Automate flow payload must be JSON data.');
        }

        const {
            fetch: customFetch,
            extraHeaders,
            headers,
            apiKey: apiKeyOverride,
            includeApiKey,
            requireApiKey,
            ...requestInit
        } = options;

        const fetchImpl = typeof customFetch === 'function'
            ? customFetch
            : (typeof globalObj.fetch === 'function' ? globalObj.fetch.bind(globalObj) : null);
        if (!fetchImpl) {
            throw new Error('Fetch is unavailable.');
        }

        const shouldIncludeApiKey = includeApiKey !== false;
        const apiKey = shouldIncludeApiKey ? resolveApiKey(apiKeyOverride) : '';
        if (requireApiKey === true && !apiKey) {
            throw new Error('Power Automate API key is required.');
        }

        return fetchImpl(endpoint, {
            ...requestInit,
            method: 'POST',
            headers: buildPowerAutomateHeaders(
                {
                    ...normalizeExtraHeaders(headers),
                    ...normalizeExtraHeaders(extraHeaders)
                },
                shouldIncludeApiKey ? { includeApiKey: true, apiKey } : { includeApiKey: false }
            ),
            cache: typeof requestInit.cache === 'undefined' ? 'no-store' : requestInit.cache,
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
