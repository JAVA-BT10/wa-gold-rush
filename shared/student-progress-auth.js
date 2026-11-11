/**
 * Ephemeral student progress proof transport; not an authentication issuer.
 *
 * authorize({operation: 'get'|'save'|'reset', identity, level, progressKey}, root)
 * returns {ok, options:{headers:{Authorization}, cache:'no-store'}} or {ok:false,reason}.
 * The host must install WA_GOLD_RUSH_STUDENT_PROGRESS_PROOF_PROVIDER.getProof(request),
 * returning {authorization: <server-verifiable bearer authorization header>} on EACH
 * dispatch. The provider owns login, expiry/refresh and logout; the server must
 * verify the proof and authorise its subject for the requested slot/operation.
 * Class/student codes, an API key, and browser session data are not proof.
 * The explicitly enabled shared-key pilot permits get/save without proof;
 * it is not student authentication and never applies to reset.
 * Never persist, queue, fingerprint or log the returned transport options.
 */
(function initStudentProgressAuth(globalObj) {
    async function authorize(input = {}, root = globalObj) {
        if (!input || typeof input !== 'object') return { ok: false, reason: 'auth_request_invalid' };
        let store = root?.WA_GOLD_RUSH_LEVEL_SAVE_STORE;
        if (!store && typeof require === 'function') store = require('./level-save-store.js');
        if (!store) return { ok: false, reason: 'auth_store_unavailable' };
        const identity = store.normalizeIdentity(input.identity);
        const level = store.normalizeSaveLevel(input.level);
        if (!['get', 'save', 'reset'].includes(input.operation) || !identity || level === null
            || input.progressKey !== store.buildProgressKey(identity, level)) {
            return { ok: false, reason: 'auth_request_invalid' };
        }
        const provider = root?.WA_GOLD_RUSH_STUDENT_PROGRESS_PROOF_PROVIDER;
        if (!provider || typeof provider.getProof !== 'function') {
            const caps = root?.WA_GOLD_RUSH_LEVEL_CAPABILITIES;
            const api = root?.WA_GOLD_RUSH_POWER_AUTOMATE;
            if (['get', 'save'].includes(input.operation)
                && caps?.isFeatureEnabled?.('pilotSharedKeyProgress', root)
                && typeof api?.getApiKey === 'function'
                && api.getApiKey()) {
                return { ok: true, options: { requireApiKey: true, cache: 'no-store' } };
            }
            return { ok: false, reason: 'auth_provider_unavailable' };
        }
        const request = Object.freeze({
            operation: input.operation,
            identity: Object.freeze(identity),
            level,
            progressKey: input.progressKey
        });
        try {
            const proof = await provider.getProof(request);
            // Header syntax only. Authenticity/expiry are exclusively server checks.
            const parts = typeof proof?.authorization === 'string' ? proof.authorization.split(' ') : [];
            if (parts.length !== 2 || parts[0] !== 'Bearer' || !/^[A-Za-z0-9._~+/-]+=*$/.test(parts[1])) {
                return { ok: false, reason: 'auth_proof_unavailable' };
            }
            return {
                ok: true,
                options: { headers: { Authorization: proof.authorization }, cache: 'no-store' }
            };
        } catch (_) {
            // Provider failures can contain credentials. Do not expose their text.
            return { ok: false, reason: 'auth_provider_failed' };
        }
    }

    const api = { authorize };
    globalObj.WA_GOLD_RUSH_STUDENT_PROGRESS_AUTH = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
