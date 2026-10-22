/**
 * GGR_SaveProgress protocol v2 — client side (capability-gated, default OFF).
 *
 * Fixes the weakness of "client increments saveRevision and the server
 * rejects incoming <= stored": that cannot protect concurrent requests or
 * multiple devices. v2 is SERVER-authoritative:
 *
 *  - Every request carries an immutable saveRequestId, the run identity
 *    (runGeneration + runId), a content fingerprint, and baseRevision: the
 *    last revision this device saw acknowledged for this run (null = create
 *    only; the row must not already exist).
 *  - The server de-duplicates by saveRequestId BEFORE any stale/conflict
 *    check (same ID + same content → original success; same ID + different
 *    content → request_id_reused), then performs a conditional write
 *    (compare-and-swap on Revision / ETag) and returns the revision it
 *    assigned. Two devices submitting the same baseRevision → one wins, the
 *    other gets revision_conflict (never silent last-writer-wins).
 *  - A server reset advances RunGeneration; requests from an older
 *    generation are rejected (generation_stale).
 *
 * The full contract, receipt store and tenant verification steps are in
 * docs/power-automate/save-protocol-v2.md. Nothing in this file proves the
 * deployed flow implements it: a response is only "confirmed" when it echoes
 * the v2 acknowledgement fields. A legacy 200 is "unconfirmed", never saved.
 *
 * Snapshot schema version (storageSchemaVersion / progression snapshot
 * schemaVersion) is deliberately separate from the concurrency revision.
 */
(function initSaveProtocol(globalObj) {
    const PROTOCOL_VERSION = 2;
    const CONFLICTS_KEY = 'wa_gr_sync_conflicts';
    const MAX_CONFLICTS = 50;
    // Fields that are not part of the content fingerprint: request identity,
    // client telemetry, and the concurrency base (compared separately).
    const NON_CONTENT_FIELDS = new Set([
        'saveRequestId', 'clientTimestampUtc', 'clientVersion', 'contentHash', 'baseRevision'
    ]);
    const CONFLICT_CODES = new Set(['revision_conflict', 'row_exists', 'precondition_failed']);

    function getCapabilities(root) {
        const api = (root || globalObj).WA_GOLD_RUSH_LEVEL_CAPABILITIES;
        if (api && typeof api.isFeatureEnabled === 'function') return api;
        if (typeof require === 'function') {
            try { return require('./level-capabilities.js'); } catch (_) { return null; }
        }
        return null;
    }

    function getStore(root) {
        const api = (root || globalObj).WA_GOLD_RUSH_LEVEL_SAVE_STORE;
        if (api && typeof api.readLevelSave === 'function') return api;
        if (typeof require === 'function') {
            try { return require('./level-save-store.js'); } catch (_) { return null; }
        }
        return null;
    }

    function resolveStorage(storage) {
        return storage || (typeof globalObj.localStorage !== 'undefined' ? globalObj.localStorage : null);
    }

    /** True only when the runtime flag is explicitly on. */
    function isEnabled(root) {
        const caps = getCapabilities(root);
        return !!caps && caps.isFeatureEnabled('saveProtocolV2', root || globalObj);
    }

    function isV2Payload(payload) {
        return !!payload && typeof payload === 'object' && payload.protocolVersion === PROTOCOL_VERSION;
    }

    function computeContentHash(payload) {
        const store = getStore();
        const content = {};
        Object.keys(payload || {}).forEach((key) => {
            if (!NON_CONTENT_FIELDS.has(key)) content[key] = payload[key];
        });
        return store ? store.hashValue(content) : '';
    }

    /** v2 request fields for a capture (does not include baseRevision). */
    function buildV2Fields(input = {}) {
        const generation = Number(input.runGeneration);
        const startingNetWorth = Number(input.startingNetWorth);
        return {
            protocolVersion: PROTOCOL_VERSION,
            runGeneration: Number.isInteger(generation) && generation >= 1 ? generation : null,
            runId: typeof input.runId === 'string' ? input.runId : '',
            startingNetWorth: input.startingNetWorth !== null && input.startingNetWorth !== undefined
                && Number.isFinite(startingNetWorth) ? startingNetWorth : null,
            storageSchemaVersion: Number.isInteger(input.storageSchemaVersion) ? input.storageSchemaVersion : null
        };
    }

    function validateV2Fields(payload) {
        const errors = [];
        if (!isV2Payload(payload)) return { ok: false, errors: ['protocolVersion'] };
        if (!Number.isInteger(payload.runGeneration) || payload.runGeneration < 1) errors.push('runGeneration');
        if (typeof payload.runId !== 'string' || !payload.runId) errors.push('runId');
        if (payload.baseRevision !== undefined && payload.baseRevision !== null
            && !(Number.isInteger(payload.baseRevision) && payload.baseRevision >= 1)) errors.push('baseRevision');
        if (typeof payload.contentHash !== 'string' || !payload.contentHash) errors.push('contentHash');
        return { ok: errors.length === 0, errors };
    }

    /** Queue coalescing key: canonical ProgressKey + run generation. */
    function coalesceKey(payload) {
        const progressKey = String(payload?.progressKey || '').trim();
        if (!progressKey) return '';
        return isV2Payload(payload) ? `${progressKey}#g${payload.runGeneration}` : progressKey;
    }

    function identityFromPayload(payload) {
        return {
            identity: { classCode: payload?.classCode, studentCode: payload?.studentCode },
            level: payload?.level
        };
    }

    /**
     * Assign baseRevision once, at first dispatch ("seal"). After sealing the
     * request is immutable and every retry re-sends it byte-for-byte.
     * Returns { ok, payload } or { ok:false, reason }.
     */
    function seal(payload, storageInput) {
        if (!isV2Payload(payload)) return { ok: false, reason: 'not_v2' };
        if (payload.baseRevision !== undefined) return { ok: true, payload };
        const store = getStore();
        const storage = resolveStorage(storageInput);
        if (!store || !storage) return { ok: false, reason: 'store_unavailable' };
        const { identity, level } = identityFromPayload(payload);
        const current = store.readLevelSave(storage, identity, level);
        if (current.status !== 'found') return { ok: false, reason: `local_save_${current.status}` };
        const envelope = current.envelope;
        if (envelope.generation !== payload.runGeneration || envelope.runId !== payload.runId) {
            return { ok: false, reason: 'generation_mismatch' };
        }
        const revision = envelope.cloud?.revision;
        return {
            ok: true,
            payload: Object.freeze({ ...payload, baseRevision: Number.isInteger(revision) && revision >= 1 ? revision : null })
        };
    }

    function readBody(result) {
        const data = result?.data;
        if (data && typeof data === 'object' && !Array.isArray(data)) {
            return data.body && typeof data.body === 'object' && !Array.isArray(data.body) ? data.body : data;
        }
        return null;
    }

    /**
     * Classify a v2 response. Outcomes:
     *  confirmed        — server acknowledged THIS request with its assigned revision
     *  unconfirmed      — HTTP success without a v2 acknowledgement (e.g. a legacy
     *                     flow): the write may have happened but is NOT treated as
     *                     a confirmed v2 save
     *  conflict         — revision/precondition conflict: no automatic overwrite
     *  stale_generation — the level was reset on the server; request is obsolete
     *  rejected         — request ID reused with different content, or invalid
     *  defer            — transport failure, timeout or an application ok:false
     *                     without a v2 code: the caller keeps its existing
     *                     failure / unknown-outcome / rejection handling
     */
    function classifyResponse(payload, result) {
        const body = readBody(result);
        const code = String(body?.code || body?.errorCode || '').trim();
        const status = Number(result?.status) || 0;
        if (code === 'generation_stale') return { outcome: 'stale_generation', code };
        if (code === 'request_id_reused') return { outcome: 'rejected', code };
        if (CONFLICT_CODES.has(code) || status === 409 || status === 412) {
            const currentRevision = Number(body?.currentRevision);
            return {
                outcome: 'conflict',
                code: code || (status === 412 ? 'precondition_failed' : 'revision_conflict'),
                currentRevision: Number.isInteger(currentRevision) ? currentRevision : null,
                currentGeneration: Number.isInteger(Number(body?.currentGeneration)) ? Number(body.currentGeneration) : null
            };
        }
        if (!result?.success) return { outcome: 'defer', code };
        if (body && body.ok === false) return { outcome: 'defer', code };
        if (!body || body.ok !== true) return { outcome: 'unconfirmed', code: code || 'missing_ack' };
        const revision = Number(body.revision);
        if (body.protocolVersion !== PROTOCOL_VERSION
            || !Number.isInteger(revision) || revision < 1
            || String(body.saveRequestId || '') !== String(payload?.saveRequestId || '')
            || (body.progressKey !== undefined && String(body.progressKey) !== String(payload?.progressKey || ''))
            || (body.runGeneration !== undefined && Number(body.runGeneration) !== payload?.runGeneration)) {
            return { outcome: 'unconfirmed', code: 'ack_mismatch' };
        }
        return { outcome: 'confirmed', revision, deduplicated: body.deduplicated === true };
    }

    /** Record an acknowledged revision on the local envelope (monotonic, same run only). */
    function recordAcknowledgement(storageInput, payload, ack) {
        const store = getStore();
        const storage = resolveStorage(storageInput);
        if (!store || !storage || !isV2Payload(payload) || !Number.isInteger(ack?.revision)) return false;
        const { identity, level } = identityFromPayload(payload);
        const current = store.readLevelSave(storage, identity, level);
        if (current.status !== 'found') return false;
        const known = current.envelope.cloud?.revision;
        if (Number.isInteger(known) && known >= ack.revision) return true;
        return store.updateCloudState(storage, identity, level, {
            generation: payload.runGeneration,
            runId: payload.runId,
            cloud: {
                status: 'synced',
                revision: ack.revision,
                lastAcknowledgedSaveRequestId: payload.saveRequestId
            }
        }).ok;
    }

    function readConflicts(storage) {
        try {
            const value = JSON.parse(storage.getItem(CONFLICTS_KEY));
            return Array.isArray(value) ? value : [];
        } catch (_) {
            return [];
        }
    }

    /** Keep the conflicting request for teacher/student reconciliation. */
    function recordConflict(storageInput, payload, info = {}) {
        const storage = resolveStorage(storageInput);
        if (!storage) return false;
        try {
            const conflicts = readConflicts(storage);
            conflicts.push({
                key: coalesceKey(payload),
                progressKey: payload?.progressKey || '',
                saveRequestId: payload?.saveRequestId || '',
                baseRevision: payload?.baseRevision ?? null,
                code: info.code || 'revision_conflict',
                currentRevision: info.currentRevision ?? null,
                recordedAt: new Date().toISOString(),
                payload
            });
            storage.setItem(CONFLICTS_KEY, JSON.stringify(conflicts.slice(-MAX_CONFLICTS)));
        } catch (_) {
            return false;
        }
        const store = getStore();
        if (store && isV2Payload(payload)) {
            const { identity, level } = identityFromPayload(payload);
            store.updateCloudState(storage, identity, level, {
                generation: payload.runGeneration,
                runId: payload.runId,
                cloud: { status: 'conflict' }
            });
        }
        return true;
    }

    function hasConflict(storageInput, key) {
        const storage = resolveStorage(storageInput);
        if (!storage || !key) return false;
        return readConflicts(storage).some((entry) => entry?.key === key);
    }

    function getConflicts(storageInput) {
        const storage = resolveStorage(storageInput);
        return storage ? readConflicts(storage) : [];
    }

    const api = {
        PROTOCOL_VERSION,
        CONFLICTS_KEY,
        isEnabled,
        isV2Payload,
        computeContentHash,
        buildV2Fields,
        validateV2Fields,
        coalesceKey,
        seal,
        classifyResponse,
        recordAcknowledgement,
        recordConflict,
        hasConflict,
        getConflicts
    };

    globalObj.WA_GOLD_RUSH_SAVE_PROTOCOL = api;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})(typeof globalThis !== 'undefined' ? globalThis : window);
