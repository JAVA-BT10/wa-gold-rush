/**
 * Full per-level cloud restore adapter (vNext, gated, OFF by default).
 *
 * Prepared for a student-scoped GGR_GetStudentProgress v2 contract that
 * returns the complete saved game for ONE Class|Student|Level slot. It is
 * NOT the teacher dashboard retrieval (GGR_GetDashboardData) and must never
 * be pointed at it.
 *
 * The adapter only runs when BOTH:
 *   - runtime feature flag `fullCloudRestore` is literally true, and
 *   - the getStudentProgress endpoint is configured (not a placeholder).
 * Even then every response is validated. Only an explicit, version-matched
 * `found: false` for the exact requested ProgressKey is treated as
 * "definitively missing". Errors, timeouts, empty bodies, unversioned or
 * checkpoint-only (legacy compatibility) responses are never "missing" and
 * must never cause a fresh/default game to be uploaded over cloud state.
 *
 * Result statuses:
 *   unavailable – feature off / flow not configured / bad request (not called)
 *   failed      – transport/HTTP/ok:false/identity mismatch (unknown state)
 *   incomplete  – response did not meet the v2 contract (unknown state)
 *   missing     – server definitively has no row for this exact slot
 *   found       – validated full save for this exact identity and level
 *
 * The browser identity sent here is NOT authentication. The deployed flow
 * must authorise the caller for the requested class/student server-side (see
 * docs/power-automate/flow-registry-and-contracts.md).
 */
(function initCloudRestore(globalObj) {
    const CONTRACT_VERSION = 'ggr.getStudentProgress.v2';
    const DEFAULT_TIMEOUT_MS = 8000;

    function getStore(root) {
        const store = root?.WA_GOLD_RUSH_LEVEL_SAVE_STORE;
        if (store && typeof store.validateEnvelope === 'function') return store;
        if (typeof require === 'function') {
            try { return require('./level-save-store.js'); } catch (_) { return null; }
        }
        return null;
    }

    function getCapabilities(root) {
        const caps = root?.WA_GOLD_RUSH_LEVEL_CAPABILITIES;
        if (caps && typeof caps.isFlowCallable === 'function') return caps;
        if (typeof require === 'function') {
            try { return require('./level-capabilities.js'); } catch (_) { return null; }
        }
        return null;
    }

    function result(status, reason, extra = {}) {
        return Object.freeze({ status, reason: reason || '', ...extra });
    }

    function isEnabled(root = globalObj) {
        const caps = getCapabilities(root);
        return !!(caps && caps.isFeatureEnabled('fullCloudRestore', root) && caps.isFlowCallable('getStudentProgress', root));
    }

    function withTimeout(promise, timeoutMs) {
        let timer = null;
        const timeout = new Promise((resolve) => {
            timer = setTimeout(() => resolve({ __timeout: true }), timeoutMs);
        });
        return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
    }

    /**
     * Interpret a callFlow-style result ({success,status,data}) for the
     * requested slot. Exposed for tests and server contract vectors.
     */
    function interpretResponse(response, request, root = globalObj) {
        const store = getStore(root);
        if (!store) return result('unavailable', 'save_store_unavailable');
        if (!response || typeof response !== 'object') return result('failed', 'no_response');
        if (response.__timeout) return result('failed', 'timeout');
        if (response.success !== true) {
            return result('failed', response.networkError ? 'network' : `http_${Number(response.status) || 'error'}`);
        }
        const body = response.data;
        if (!body || typeof body !== 'object' || Array.isArray(body)) return result('incomplete', 'empty_or_non_json');
        if (body.contractVersion !== CONTRACT_VERSION) {
            // Legacy checkpoint-only responses stay in compatibility mode
            // (LevelAccessGuard.hydrateRemoteProgression) and are never a
            // definitive answer about the full game.
            return result('incomplete', 'contract_version_mismatch');
        }
        if (body.ok !== true) return result('failed', String(body.code || 'not_ok'));
        if (String(body.progressKey || '') !== request.progressKey) return result('failed', 'progress_key_mismatch');
        if (body.found === false) {
            return result('missing', 'not_found', {
                progressKey: request.progressKey,
                // Highest generation the server has seen for this slot (after
                // an authorised reset the row may be absent but the generation
                // advanced). Null when the server does not report it.
                serverGeneration: Number.isInteger(body.runGeneration) ? body.runGeneration : null
            });
        }
        if (body.found !== true) return result('incomplete', 'found_flag_missing');
        const revision = body.revision;
        if (!Number.isInteger(revision) || revision < 1) return result('incomplete', 'revision_missing');
        const envelope = body.save;
        const validation = store.validateEnvelope(envelope, { identity: request.identity, level: request.level });
        if (!validation.ok) {
            const reason = ['owner_mismatch', 'level_mismatch', 'progress_key_mismatch'].includes(validation.reason)
                ? validation.reason
                : `invalid_save_${validation.reason}`;
            return result(reason.startsWith('invalid_save_') ? 'incomplete' : 'failed', reason);
        }
        if (Number.isInteger(body.runGeneration) && body.runGeneration !== envelope.generation) {
            return result('incomplete', 'generation_mismatch');
        }
        const copy = store.clone(envelope);
        copy.cloud = { status: 'synced', revision };
        return result('found', '', {
            progressKey: request.progressKey,
            revision,
            envelope: store.deepFreeze(copy)
        });
    }

    /**
     * Fetch the full save for the authenticated session and selected level.
     * Never throws; never writes local storage; never uploads anything.
     */
    async function fetchLevelSave(input = {}, root = globalObj) {
        const store = getStore(root);
        const caps = getCapabilities(root);
        if (!store || !caps) return result('unavailable', 'modules_unavailable');
        if (!caps.isFeatureEnabled('fullCloudRestore', root)) return result('unavailable', 'feature_disabled');
        if (!caps.isFlowCallable('getStudentProgress', root)) return result('unavailable', 'flow_unconfigured');
        const identity = store.normalizeIdentity(input.session || input.identity || {});
        const level = store.normalizeSaveLevel(input.level);
        if (!identity || level === null) return result('unavailable', 'invalid_request');
        const api = root?.WA_GOLD_RUSH_POWER_AUTOMATE;
        if (!api || typeof api.callFlow !== 'function') return result('unavailable', 'transport_unavailable');
        const request = { identity, level, progressKey: store.buildProgressKey(identity, level) };
        let response;
        try {
            response = await withTimeout(Promise.resolve(api.callFlow('getStudentProgress', {
                contractVersion: CONTRACT_VERSION,
                mode: 'full_save',
                classCode: identity.classCode,
                studentCode: identity.studentCode,
                level,
                progressKey: request.progressKey
            })), Number(input.timeoutMs) > 0 ? Number(input.timeoutMs) : DEFAULT_TIMEOUT_MS);
        } catch (_) {
            return result('failed', 'exception');
        }
        return interpretResponse(response, request, root);
    }

    /**
     * Decide what to do with a local slot read (store.readLevelSave result)
     * and a cloud fetch result. Conservative: it never discards unsent local
     * changes automatically and never authorises a cloud create/overwrite
     * from an unknown cloud state.
     *
     * Actions:
     *   resume_local          – use local; cloud agrees or local is ahead on same base
     *   resume_local_unsynced – use local; cloud state unknown (offline/failed): show "not synced"
     *   start_local_unsynced  – no local save, cloud unknown: play locally, do NOT create in cloud
     *   start_new             – both definitively empty: first visit (create-only upload allowed)
     *   upload_local_create   – cloud definitively empty, local exists: create-only upload allowed
     *   adopt_cloud           – take the cloud save (local missing or local fully synced & older)
     *   conflict              – both changed / different runs: ask the student/teacher
     */
    function reconcile(local, cloud) {
        const localFound = local?.status === 'found' && local.envelope;
        const cloudStatus = cloud?.status;
        if (cloudStatus === 'found') {
            if (!localFound) return { action: 'adopt_cloud', reason: 'no_local_save' };
            const le = local.envelope;
            const ce = cloud.envelope;
            if (le.generation !== ce.generation || le.runId !== ce.runId) {
                return { action: 'conflict', reason: 'different_run' };
            }
            const localRevision = Number.isInteger(le.cloud?.revision) ? le.cloud.revision : null;
            if (localRevision === cloud.revision) return { action: 'resume_local', reason: 'same_base_revision' };
            if (localRevision !== null && localRevision > cloud.revision) {
                return { action: 'conflict', reason: 'local_ahead_of_server' };
            }
            if (le.cloud?.status === 'synced') return { action: 'adopt_cloud', reason: 'cloud_newer_local_synced' };
            return { action: 'conflict', reason: 'both_changed' };
        }
        if (cloudStatus === 'missing') {
            if (!localFound) return { action: 'start_new', reason: 'definitively_missing' };
            if (Number.isInteger(local.envelope.cloud?.revision)) {
                // The server says no row, yet this device was acknowledged
                // before: an authorised reset or data loss. Never recreate silently.
                return { action: 'conflict', reason: 'server_row_missing_after_ack' };
            }
            return { action: 'upload_local_create', reason: 'definitively_missing' };
        }
        return localFound
            ? { action: 'resume_local_unsynced', reason: cloud?.reason || 'cloud_unknown' }
            : { action: 'start_local_unsynced', reason: cloud?.reason || 'cloud_unknown' };
    }

    /**
     * Apply an adopt_cloud decision: archive the local slot first (fail
     * closed), adopt the cloud run, then write the validated cloud save.
     */
    function adoptCloudSave(storage, cloud, root = globalObj) {
        const store = getStore(root);
        if (!store || cloud?.status !== 'found' || !cloud.envelope) return { ok: false, reason: 'not_found' };
        const envelope = store.clone(cloud.envelope);
        const identity = envelope.owner;
        const archived = store.archiveLevelSave(storage, identity, envelope.level, { reason: 'replaced_by_cloud_restore' });
        if (!archived.ok) return { ok: false, reason: archived.reason };
        if (!store.adoptLevelRun(storage, envelope)) return { ok: false, reason: 'stale_generation' };
        return store.writeLevelSave(storage, envelope, { identity, level: envelope.level });
    }

    const api = {
        CONTRACT_VERSION,
        DEFAULT_TIMEOUT_MS,
        isEnabled,
        interpretResponse,
        fetchLevelSave,
        reconcile,
        adoptCloudSave
    };

    globalObj.WA_GOLD_RUSH_CLOUD_RESTORE = api;
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})(typeof globalThis !== 'undefined' ? globalThis : window);
