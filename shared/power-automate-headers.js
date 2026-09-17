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
            ...normalizeExtraHeaders(extraHeaders),
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        };

        if (options.includeApiKey !== false) {
            const apiKey = resolveApiKey(options.apiKey);
            if (apiKey) headers['X-GGR-Key'] = apiKey;
        }

        return headers;
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

    function isPlaceholderEndpoint(url) {
        return /REPLACE-WITH/i.test(String(url || ''));
    }

    function resolveFlowEndpoint(flowName, endpointMap) {
        if (!flowName) return '';
        const flowKey = String(flowName || '').trim();
        if (!flowKey) return '';
        const map = endpointMap || globalObj.WA_GOLD_RUSH_FLOW_ENDPOINTS || globalObj.WA_GOLD_RUSH_DASHBOARD_CONFIG?.flowEndpoints;
        return String(map?.[flowKey] || '').trim();
    }

    async function callFlow(flowOrUrl, payload, options = {}) {
        const isNamedFlow = !/^https?:/i.test(String(flowOrUrl || '').trim());
        const endpoint = isNamedFlow
            ? resolveFlowEndpoint(flowOrUrl, options.endpoints)
            : String(flowOrUrl || '').trim();

        if (!endpoint) {
            return {
                success: false,
                skipped: true,
                flowName: isNamedFlow ? String(flowOrUrl || '').trim() : '',
                error: isNamedFlow
                    ? `Flow endpoint "${String(flowOrUrl || '').trim()}" is not configured.`
                    : 'Flow endpoint URL is missing.'
            };
        }
        if (isPlaceholderEndpoint(endpoint)) {
            return {
                success: false,
                skipped: true,
                flowName: isNamedFlow ? String(flowOrUrl || '').trim() : '',
                error: isNamedFlow
                    ? `Flow endpoint "${String(flowOrUrl || '').trim()}" is still a placeholder.`
                    : 'Flow endpoint URL is still a placeholder.'
            };
        }

        try {
            const response = await postToFlow(endpoint, payload, options);
            let rawBody = '';
            let data = null;
            let isJson = false;
            try {
                rawBody = await response.text();
                if (rawBody) {
                    data = JSON.parse(rawBody);
                    isJson = true;
                }
            } catch (_) {
                isJson = false;
                data = rawBody || null;
            }

            if (!response.ok) {
                const errorText = String(data?.error || data?.message || rawBody || `HTTP ${response.status}`).trim();
                return {
                    success: false,
                    status: response.status,
                    data: isJson ? data : null,
                    rawBody,
                    error: errorText || `HTTP ${response.status}`
                };
            }

            return {
                success: true,
                status: response.status,
                data: isJson ? data : null,
                rawBody
            };
        } catch (error) {
            return {
                success: false,
                error: String(error?.message || error || 'Flow request failed.')
            };
        }
    }

    globalObj.WA_GOLD_RUSH_POWER_AUTOMATE = globalObj.WA_GOLD_RUSH_POWER_AUTOMATE || {};
    globalObj.WA_GOLD_RUSH_POWER_AUTOMATE.buildHeaders = buildPowerAutomateHeaders;
    globalObj.WA_GOLD_RUSH_POWER_AUTOMATE.getApiKey = readConfiguredApiKey;
    globalObj.WA_GOLD_RUSH_POWER_AUTOMATE.resolveFlowEndpoint = resolveFlowEndpoint;
    globalObj.WA_GOLD_RUSH_POWER_AUTOMATE.isPlaceholderEndpoint = isPlaceholderEndpoint;
    globalObj.WA_GOLD_RUSH_POWER_AUTOMATE.postToFlow = postToFlow;
    globalObj.WA_GOLD_RUSH_POWER_AUTOMATE.callFlow = callFlow;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            buildPowerAutomateHeaders,
            readConfiguredApiKey,
            resolveApiKey,
            postToFlow,
            callFlow,
            resolveFlowEndpoint,
            isPlaceholderEndpoint
        };
    }
})(typeof globalThis !== 'undefined' ? globalThis : window);
