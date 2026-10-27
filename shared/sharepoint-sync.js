/**
 * SharePoint / Power Automate sync hooks
 *
 * Configure your Power Automate HTTP-trigger endpoints in the constants below.
 * No secrets are stored here — the shared key header value should be injected
 * at deployment time or kept in a separate config file outside the repository.
 *
 * Gameplay and local saving never wait for cloud dispatch. Unconditional
 * legacy progress writes stay local-only. Conditional writes require an
 * authenticated proof and a verified exact-slot lookup in this startup;
 * failed conditional requests retain their immutable retry payload.
 */

const SharePointSync = (() => {
    // -------------------------------------------------------------------------
    // Configuration — update these URLs after creating your Power Automate flows
    // -------------------------------------------------------------------------
    const CONFIG = {
        profileEndpointKey: 'upsertStudentProfile',
        progressEndpointKey: 'saveProgress',
        // Shared secret sent as X-GGR-Key header — set after creating flows
        apiKey: '',
        // Maximum number of queued retries kept in localStorage
        maxQueueSize: 50,
        // Maximum number of quarantined (permanently rejected) items kept for inspection
        maxQuarantineSize: 50,
        // Retry interval in milliseconds
        retryIntervalMs: 30000,
        // Bound gameplay-triggered cloud saves so they resolve to success or retry quickly
        progressRequestTimeoutMs: 30000
    };

    const QUEUE_KEY = 'wa_gr_sync_queue';
    const QUARANTINE_KEY = 'wa_gr_sync_quarantine';
    const QUEUE_SCHEMA_VERSION = 4;
    const MAX_RETRY_ATTEMPTS = 10;
    // HTTP statuses that mean the request itself is wrong; retrying cannot help.
    const PERMANENT_HTTP_STATUSES = [400, 410, 422];
    let _retryTimer = null;
    let _cloudSaveStatus = 'idle';
    let _retryPromise = null;
    const _activeProgressKeys = new Set();
    const _discardVersions = new Map();
    const _unconfirmedKeys = new Set();
    // Deliberately memory-only: an old acknowledgement is not a startup lookup.
    const _verifiedSlots = new Map();
    const _lookupVersions = new Map();
    let _sessionEpoch = 0;

    function _sessionStamp(session) {
        let rawSession = null;
        try {
            rawSession = localStorage.getItem(_resolveSessionApi()?.STORAGE_KEY || 'wa_gold_rush_student_session');
        } catch (_) {}
        return JSON.stringify([_sessionEpoch, rawSession, session || null]);
    }

    function clearStartupVerification() {
        _sessionEpoch += 1;
        _verifiedSlots.clear();
        _lookupVersions.forEach((version, key) => _lookupVersions.set(key, version + 1));
    }

    async function checkLevelSave(session, level) {
        const sessionStamp = _sessionStamp(session);
        const key = _resolveStore()?.buildProgressKey(session, level);
        const version = (_lookupVersions.get(key) || 0) + 1;
        _lookupVersions.set(key, version);
        if (key) _verifiedSlots.delete(key);
        const restore = globalThis.WA_GOLD_RUSH_CLOUD_RESTORE;
        if (!restore?.isEnabled()) return { status: 'unavailable', reason: 'restore_unconfigured' };
        const cloud = await restore.fetchLevelSave({ session, level });
        const auth = _checkAuthenticatedIdentity({ ...session, level });
        if (!auth.ok || _sessionStamp(auth.session) !== sessionStamp
            || _lookupVersions.get(key) !== version) {
            return { status: 'failed', reason: 'session_changed' };
        }
        if (key && cloud.progressKey === key && ['found', 'missing'].includes(cloud.status)) {
            _verifiedSlots.set(key, { cloud, session: sessionStamp });
        }
        return cloud;
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------
    function _dispatchCloudSaveStatus(status) {
        if (status === 'saved to cloud' && _unconfirmedKeys.size) status = 'cloud save not verified';
        _cloudSaveStatus = status;
        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof window.CustomEvent === 'function') {
            window.dispatchEvent(new CustomEvent('wa-gr-cloud-save-status', {
                detail: { status }
            }));
        }
    }

    function _toRoundedInteger(value) {
        const num = Number(value ?? 0);
        return Number.isFinite(num) ? Math.round(num) : 0;
    }

    function _resolveSessionApi() {
        const globalApi = (typeof globalThis !== 'undefined' ? globalThis : window).WA_GOLD_RUSH_STUDENT_SESSION;
        if (globalApi && typeof globalApi.readSession === 'function') return globalApi;
        if (typeof require === 'function') {
            try { return require('./student-session.js'); } catch (_) { return null; }
        }
        return null;
    }

    /**
     * Supported integer gameplay level for GGR_SaveProgress, or null.
     * A missing/blank/fractional level is rejected — never defaulted to Level 1.
     */
    function _normalizeLevel(value) {
        const sessionApi = _resolveSessionApi();
        return sessionApi ? sessionApi.normalizeProgressLevel(value) : null;
    }

    function _normalizeRosterLevel(value) {
        const sessionApi = _resolveSessionApi();
        return sessionApi ? sessionApi.normalizeLevel(value) : null;
    }

    function _createProgressTelemetry(payload = {}) {
        const version = String(
            payload.clientVersion
            || globalThis.WA_GOLD_RUSH_RUNTIME_CONFIG?.version
            || 'dev'
        ).trim() || 'dev';
        return {
            saveRequestId: String(payload.saveRequestId || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`).trim(),
            clientTimestampUtc: String(payload.clientTimestampUtc || new Date().toISOString()).trim(),
            clientVersion: version
        };
    }

    /**
     * syncOutcome:
     *  - 'failure'  retryable (network / server error)
     *  - 'unknown'  timed out; the write may have happened — retry with the same saveRequestId
     *  - 'rejected' permanent (bad identity / app-level ok:false) — quarantine, never retry
     */
    function _createPostError(message, syncOutcome = 'failure', result) {
        const error = new Error(String(message || 'Progress sync failed.'));
        error.syncOutcome = ['unknown', 'rejected', 'conflict', 'stale_generation', 'unconfirmed', 'held'].includes(syncOutcome)
            ? syncOutcome
            : 'failure';
        if (result !== undefined) {
            error.result = result;
        }
        return error;
    }

    function _resolveSaveProtocol() {
        const globalApi = (typeof globalThis !== 'undefined' ? globalThis : window).WA_GOLD_RUSH_SAVE_PROTOCOL;
        if (globalApi && typeof globalApi.classifyResponse === 'function') return globalApi;
        if (typeof require === 'function') {
            try { return require('./save-protocol.js'); } catch (_) { return null; }
        }
        return null;
    }

    function _resolveStore() {
        const globalApi = (typeof globalThis !== 'undefined' ? globalThis : window).WA_GOLD_RUSH_LEVEL_SAVE_STORE;
        if (globalApi && typeof globalApi.updateCloudState === 'function') return globalApi;
        if (typeof require === 'function') {
            try { return require('./level-save-store.js'); } catch (_) { return null; }
        }
        return null;
    }

    function _isV2(payload) {
        return payload?.protocolVersion === 2;
    }

    /** Queue coalescing key: ProgressKey (legacy) or ProgressKey + run generation (v2). */
    function _queueKey(payload) {
        const protocol = _resolveSaveProtocol();
        if (_isV2(payload) && protocol) return protocol.coalesceKey(payload);
        return String(payload?.progressKey || '').trim();
    }

    /**
     * v2 requests are either sealed (baseRevision assigned, sent at least
     * once, immutable) or pending (latest local capture, not yet sent). One of
     * each may be queued per key; a pending capture never replaces a sealed
     * request whose outcome is still unknown.
     */
    function _queueSlotKey(item) {
        const key = _queueKey(item?.payload);
        if (!key) return '';
        if (!_isV2(item?.payload)) return key;
        return `${key}#${item.payload.baseRevision === undefined ? 'pending' : `sealed:${item.payload.saveRequestId}`}`;
    }

    function _logProgress(event, payload, details = {}) {
        const safeDetails = {};
        for (const key of ['httpStatus', 'attempts', 'queueLength']) {
            if (Number.isFinite(details[key])) safeDetails[key] = details[key];
        }
        for (const key of ['coalesced', 'verificationPending', 'deduplicated']) {
            if (typeof details[key] === 'boolean') safeDetails[key] = details[key];
        }
        console.info(`[SharePointSync] Progress ${event}`, {
            level: _normalizeLevel(payload?.level),
            ...safeDetails
        });
    }

    /**
     * Returns { item } for a valid queue entry or { invalid: { item, reason } }.
     * Legacy entries are mapped field-for-field but never "repaired": a blank
     * ClassCode, blank/unsupported Level, or malformed StudentCode is not
     * filled in — the entry is quarantined instead.
     */
    function _normalizeQueueItem(item) {
        if (!item || typeof item !== 'object') return { invalid: { item, reason: 'malformed_queue_item' } };
        const type = item.type === 'profile' ? 'profile' : (item.type === 'progress' ? 'progress' : '');
        if (!type) return { invalid: { item, reason: 'unknown_queue_item_type' } };

        let payload = item.payload && typeof item.payload === 'object' ? { ...item.payload } : null;
        if (!payload) return { invalid: { item, reason: 'missing_payload' } };

        if (type === 'profile' && !payload.studentCode && payload.StudentCode) {
            payload = {
                studentCode: String(payload.StudentCode || '').trim(),
                studentId: String(payload.StudentID || '').trim(),
                studentName: String(payload.StudentName || '').trim(),
                leaderboardName: String(payload.LeaderboardName || '').trim(),
                classCode: String(payload.ClassCode || '').trim(),
                Level: Number(payload.Level || payload.level) || 1,
                active: payload.active !== false,
                teacherEmailPrimary: String(payload.teacherEmailPrimary || '').trim().toLowerCase(),
                timestampUtc: String(payload.timestampUtc || payload.LastPlayedUtc || new Date().toISOString())
            };
        }

        if (type === 'progress' && !payload.studentCode && payload.StudentCode) {
            payload = {
                studentCode: String(payload.StudentCode || '').trim(),
                classCode: String(payload.classCode || payload.ClassCode || '').trim().toUpperCase(),
                level: payload.level ?? payload.Level,
                currentRound: Number(payload.Round || payload.currentRound) || 1,
                currentCash: _toRoundedInteger(payload.currentCash ?? payload.Cash ?? 0),
                currentAssets: _toRoundedInteger(payload.currentAssets ?? payload.Assets ?? 0),
                netWorth: _toRoundedInteger(payload.NetWorth ?? payload.netWorth ?? 0),
                score: _toRoundedInteger(payload.Score ?? payload.score ?? 0),
                progressionMarkersJson: String(payload.ProgressJson || payload.progressionMarkersJson || ''),
                badgesJson: String(payload.BadgesJson || payload.badgesJson || ''),
                achievementsCount: Number(payload.achievementsCount || 0),
                sessionStatus: String(payload.sessionStatus || 'active'),
                needsSupport: payload.needsSupport === true,
                supportReason: String(payload.supportReason || ''),
                progressKey: String(payload.progressKey || '').trim(),
                saveRequestId: String(payload.saveRequestId || '').trim(),
                clientTimestampUtc: String(payload.clientTimestampUtc || payload.timestampUtc || item.queuedAt || new Date().toISOString()),
                clientVersion: String(payload.clientVersion || '').trim()
            };
        }

        if (type === 'progress') {
            payload = buildProgressPayload(payload);
            const validation = validateProgressPayload(payload);
            if (!validation.ok) {
                return { invalid: { item: { ...item, payload }, reason: `invalid_identity:${validation.errors.join(',')}` } };
            }
            if (_isV2(payload)) {
                const protocol = _resolveSaveProtocol();
                const v2 = protocol ? protocol.validateV2Fields(payload) : { ok: false, errors: ['protocol_unavailable'] };
                if (!v2.ok) {
                    return { invalid: { item: { ...item, payload }, reason: `invalid_v2:${v2.errors.join(',')}` } };
                }
            }
        }

        if (type === 'profile' && !payload.studentCode) return { invalid: { item, reason: 'invalid_identity:studentCode' } };
        return {
            item: {
                type,
                payload,
                queuedAt: String(item.queuedAt || new Date().toISOString()),
                attempts: Number(item.attempts) || 0,
                payloadSchemaVersion: QUEUE_SCHEMA_VERSION
            }
        };
    }

    function _coalesceQueue(queue) {
        const normalized = [];
        const invalid = [];
        const progressIndexes = new Map();
        for (const rawItem of Array.isArray(queue) ? queue : []) {
            const result = _normalizeQueueItem(rawItem);
            if (result.invalid) {
                invalid.push(result.invalid);
                continue;
            }
            const item = result.item;
            const slotKey = item.type === 'progress' ? _queueSlotKey(item) : '';
            if (slotKey) {
                const existingIndex = progressIndexes.get(slotKey);
                if (typeof existingIndex === 'number') {
                    normalized[existingIndex] = item;
                    continue;
                }
                progressIndexes.set(slotKey, normalized.length);
            }
            normalized.push(item);
        }
        return { items: normalized, invalid };
    }

    function _loadQuarantine() {
        try {
            const q = JSON.parse(localStorage.getItem(QUARANTINE_KEY));
            return Array.isArray(q) ? q : [];
        } catch (_) { return []; }
    }

    /**
     * Permanently rejected items are kept (not silently repaired, not
     * silently dropped) so a teacher/admin can inspect them.
     */
    function _quarantine(entries) {
        const list = (Array.isArray(entries) ? entries : [entries]).filter(Boolean);
        if (!list.length) return;
        try {
            const quarantine = _loadQuarantine();
            list.forEach(({ item, reason }) => {
                quarantine.push({
                    type: item?.type || '',
                    payload: item?.payload ?? null,
                    reason: String(reason || 'rejected'),
                    queuedAt: item?.queuedAt || null,
                    attempts: Number(item?.attempts) || 0,
                    quarantinedAt: new Date().toISOString()
                });
                if (item?.type === 'progress') {
                    _logProgress('quarantined', item.payload, { reason: String(reason || 'rejected') });
                }
            });
            localStorage.setItem(QUARANTINE_KEY, JSON.stringify(quarantine.slice(-CONFIG.maxQuarantineSize)));
        } catch (_) {}
    }

    function _loadQueue() {
        try {
            const q = JSON.parse(localStorage.getItem(QUEUE_KEY));
            if (!Array.isArray(q)) return [];
            const { items, invalid } = _coalesceQueue(q);
            if (invalid.length) _quarantine(invalid);
            if (items.length !== q.length || q.some(item => item?.payloadSchemaVersion !== QUEUE_SCHEMA_VERSION)) {
                _saveQueue(items);
            }
            return items;
        } catch (_) { return []; }
    }

    function _saveQueue(queue) {
        try {
            const { items, invalid } = _coalesceQueue(queue);
            if (invalid.length) _quarantine(invalid);
            if (!items.some((item) => _isV2(item.payload))) {
                localStorage.setItem(QUEUE_KEY, JSON.stringify(items.slice(-CONFIG.maxQueueSize)));
                return true;
            }
            while (items.length > CONFIG.maxQueueSize) {
                const index = items.findIndex((item) => !_isV2(item.payload) || item.payload.baseRevision === undefined);
                if (index < 0) break; // Unacknowledged sealed requests must never be silently evicted.
                const [item] = items.splice(index, 1);
                _quarantine({ item, reason: 'queue_capacity' });
            }
            localStorage.setItem(QUEUE_KEY, JSON.stringify(items));
            return true;
        } catch (_) { return false; }
    }

    function _enqueue(type, payload) {
        const queue = _loadQueue();
        const queueItem = {
            type,
            payload,
            queuedAt: new Date().toISOString(),
            attempts: 0,
            payloadSchemaVersion: QUEUE_SCHEMA_VERSION
        };
        let coalesced = false;
        const slotKey = type === 'progress' ? _queueSlotKey(queueItem) : '';
        if (slotKey) {
            const existingIndex = queue.findIndex(item => item.type === 'progress' && _queueSlotKey(item) === slotKey);
            if (existingIndex >= 0) {
                queue[existingIndex] = queueItem;
                coalesced = true;
            } else {
                queue.push(queueItem);
            }
        } else {
            queue.push(queueItem);
        }
        const persisted = _saveQueue(queue);
        return {
            queuedItem: queueItem,
            coalesced,
            persisted,
            accepted: persisted && _loadQueue().some((item) => _sameQueueItem(item, queueItem)),
            queueLength: _loadQueue().length
        };
    }

    function _resolveEndpoint(endpointKey) {
        const resolveFlowEndpoint = globalThis.WA_GOLD_RUSH_POWER_AUTOMATE?.resolveFlowEndpoint;
        if (typeof resolveFlowEndpoint === 'function') {
            return resolveFlowEndpoint(endpointKey);
        }
        return String(globalThis.WA_GOLD_RUSH_FLOW_ENDPOINTS?.[endpointKey] || '').trim();
    }

    function _sameQueueItem(a, b) {
        return a.type === b.type && (a.type === 'progress'
            ? a.payload.saveRequestId === b.payload.saveRequestId
            : a.queuedAt === b.queuedAt && JSON.stringify(a.payload) === JSON.stringify(b.payload));
    }

    // Captures and resets may change the live queue during a network await.
    function _replaceQueuedItem(item, replacement) {
        const queue = _loadQueue();
        const index = queue.findIndex((entry) => _sameQueueItem(entry, item));
        if (index < 0) return false;
        if (replacement) queue[index] = replacement;
        else queue.splice(index, 1);
        return _saveQueue(queue);
    }

    function _uploadHold(payload) {
        const protocol = _resolveSaveProtocol();
        const store = _resolveStore();
        const hold = store?.getUploadHold(localStorage, payload, payload.level)
            || store?.getLevelWriteProtection(localStorage, payload, payload.level);
        if (hold) return hold;
        if (protocol?.hasConflict(localStorage, _queueKey(payload))) return 'revision_conflict';
        if (!_isV2(payload) || !protocol?.isEnabled()) return 'local_only_legacy_writes_disabled';
        if (!globalThis.WA_GOLD_RUSH_CLOUD_RESTORE?.isEnabled()) return 'restore_unconfigured';
        const auth = _checkAuthenticatedIdentity(payload);
        if (!auth.ok) return auth.reason;
        const verified = _verifiedSlots.get(payload.progressKey);
        if (!verified || verified.session !== _sessionStamp(auth.session)) return 'startup_lookup_required';
        const local = store?.readLevelSave(localStorage, payload, payload.level);
        const decision = globalThis.WA_GOLD_RUSH_CLOUD_RESTORE.reconcile(local, verified.cloud);
        if (local?.envelope && (local.envelope.runId !== payload.runId
            || local.envelope.generation !== payload.runGeneration)) return 'run_changed';
        // An immutable, previously dispatched request can safely ask the CAS
        // backend for its receipt, even when its lost acknowledgement means
        // reconciliation cannot yet decide whether this local base is current.
        const receiptRetry = payload.baseRevision !== undefined
            && verified.cloud.status === 'found'
            && verified.cloud.envelope.runId === payload.runId
            && verified.cloud.envelope.generation === payload.runGeneration
            && _loadQueue().some(item => item.type === 'progress'
                && item.payload.saveRequestId === payload.saveRequestId
                && item.payload.contentHash === payload.contentHash
                && item.payload.baseRevision === payload.baseRevision);
        if (!receiptRetry && !['resume_local', 'start_new', 'upload_local_create'].includes(decision.action)) return 'cloud_reconciliation_required';
        return !_resolveEndpoint(CONFIG.progressEndpointKey) ? 'save_unconfigured' : '';
    }

    function _refreshVerifiedRevision(payload) {
        const verified = _verifiedSlots.get(payload.progressKey);
        const local = _resolveStore()?.readLevelSave(localStorage, payload, payload.level);
        if (verified && local?.status === 'found' && Number.isInteger(local.envelope.cloud?.revision)
            && (!Number.isInteger(verified.cloud.revision) || local.envelope.cloud.revision >= verified.cloud.revision)) {
            verified.cloud = { status: 'found', progressKey: payload.progressKey,
                revision: local.envelope.cloud.revision, envelope: local.envelope };
        }
    }

    async function _post(endpointKey, payload, options = {}) {
        const callFlow = globalThis.WA_GOLD_RUSH_POWER_AUTOMATE?.callFlow;
        if (typeof callFlow !== 'function') {
            throw new Error('Power Automate flow helper is unavailable.');
        }
        const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 0;
        const canAbort = timeoutMs > 0 && typeof AbortController !== 'undefined';
        const abortController = canAbort ? new AbortController() : null;
        let timeoutId = null;
        let timedOut = false;
        try {
            let authOptions = {};
            if (endpointKey === CONFIG.progressEndpointKey) {
                const hold = _uploadHold(payload);
                if (hold) throw _createPostError(hold, 'held');
                const sessionBefore = _sessionStamp(_checkAuthenticatedIdentity(payload).session);
                let auth = globalThis.WA_GOLD_RUSH_STUDENT_PROGRESS_AUTH;
                if (!auth && typeof require === 'function') auth = require('./student-progress-auth.js');
                if (!auth?.authorize) throw _createPostError('auth_module_unavailable', 'held');
                let authTimer;
                const authorization = await Promise.race([
                    auth.authorize({ operation: 'save', identity: payload, level: payload.level, progressKey: payload.progressKey }),
                    new Promise(resolve => {
                        authTimer = setTimeout(() => resolve({ ok: false, reason: 'auth_timeout' }),
                            timeoutMs || CONFIG.progressRequestTimeoutMs);
                    })
                ]).finally(() => clearTimeout(authTimer));
                const current = _checkAuthenticatedIdentity(payload);
                if (!current.ok || _sessionStamp(current.session) !== sessionBefore) throw _createPostError('session_changed', 'held');
                if (!authorization?.ok) throw _createPostError(authorization?.reason || 'auth_proof_unavailable', 'held');
                const latestHold = _uploadHold(payload);
                if (latestHold) throw _createPostError(latestHold, 'held');
                authOptions = authorization.options;
            }
            const requestPromise = callFlow(endpointKey, payload, {
                apiKey: CONFIG.apiKey,
                requireApiKey: endpointKey !== CONFIG.progressEndpointKey,
                cache: 'no-store',
                ...authOptions,
                ...(abortController ? { signal: abortController.signal } : {})
            });
            const result = timeoutMs > 0 && !abortController
                ? await Promise.race([
                    requestPromise,
                    new Promise((_, reject) => {
                        timeoutId = setTimeout(() => {
                            timedOut = true;
                            reject(_createPostError(`Timed out after ${timeoutMs}ms`, 'unknown'));
                        }, timeoutMs);
                    })
                ])
                : await (() => {
                    if (abortController) {
                        timeoutId = setTimeout(() => {
                            timedOut = true;
                            abortController.abort();
                        }, timeoutMs);
                    }
                    return requestPromise;
                })();
            if (timedOut) {
                throw _createPostError(`Timed out after ${timeoutMs}ms`, 'unknown', result);
            }
            if (options.protocolV2) {
                const protocol = _resolveSaveProtocol();
                const v2 = protocol
                    ? protocol.classifyResponse(payload, result)
                    : { outcome: 'unconfirmed', code: 'protocol_unavailable' };
                if (v2.outcome === 'confirmed') return { ...result, v2 };
                if (v2.outcome !== 'defer') {
                    const outcome = v2.outcome === 'unconfirmed' ? 'unconfirmed' : v2.outcome;
                    const error = _createPostError(`v2 ${v2.outcome}${v2.code ? `: ${v2.code}` : ''}`, outcome, result);
                    error.v2 = v2;
                    throw error;
                }
            }
            if (!result.success) {
                const errorMessage = result.error || `HTTP ${result.status || 0}`;
                const unknownOutcome = result.status === 504
                    || result?.data?.ok === true
                    || /timed?\s*out|timeout|abort/i.test(String(errorMessage));
                const permanent = !unknownOutcome && PERMANENT_HTTP_STATUSES.includes(Number(result.status));
                throw _createPostError(errorMessage, unknownOutcome ? 'unknown' : (permanent ? 'rejected' : 'failure'), result);
            }
            // HTTP 200 with an application-level ok:false is a failed save.
            const responseBody = options.protocolV2 && result.data?.body && typeof result.data.body === 'object'
                ? result.data.body : result.data;
            if (responseBody && typeof responseBody === 'object' && responseBody.ok === false) {
                const errorMessage = String(responseBody.message || responseBody.error || 'Flow returned ok:false.').trim();
                throw _createPostError(errorMessage, responseBody.retryable === true ? 'failure' : 'rejected', result);
            }
            return result;
        } catch (error) {
            if (timedOut && error?.syncOutcome !== 'unknown') {
                throw _createPostError(`Timed out after ${timeoutMs}ms`, 'unknown');
            }
            if (error?.syncOutcome) {
                throw error;
            }
            // e.g. "Power Automate API key is required." — configuration, retryable.
            throw _createPostError(error?.message || error, /timed?\s*out|timeout|abort/i.test(String(error?.message || error)) ? 'unknown' : 'failure');
        } finally {
            if (timeoutId) clearTimeout(timeoutId);
        }
    }

    function _startRetryLoop() {
        if (_retryTimer) return;
        _retryTimer = setInterval(retryQueue, CONFIG.retryIntervalMs);
        if (typeof _retryTimer?.unref === 'function') {
            _retryTimer.unref();
        }
    }

    // -------------------------------------------------------------------------
    // Payload builders
    // -------------------------------------------------------------------------

    /**
     * Build a student/profile upsert payload.
     * StudentName and StudentID are included for teacher-facing use only;
     * they are never shown on the public leaderboard.
     */
    function buildProfilePayload(opts) {
        return {
            studentCode: String(opts.studentCode || '').trim(),
            studentId: String(opts.studentId || '').trim(),
            studentName: String(opts.studentName || '').trim(),
            leaderboardName: String(opts.leaderboardName || opts.studentCode || '').trim(),
            classCode: String(opts.classCode || '').trim().toUpperCase(),
            Level: Number(opts.level) || 1,
            active: opts.active !== false,
            teacherEmailPrimary: String(opts.teacherEmailPrimary || '').trim().toLowerCase(),
            timestampUtc: new Date().toISOString()
        };
    }

    /**
     * Canonical ProgressKey: UPPER(ClassCode)|UPPER(StudentCode)|Level.
     * Returns '' when any part is blank, malformed, or unsupported — a key
     * like "|SC-1|2" or "6B|SC-1|1" (defaulted level) is never produced.
     */
    function buildCanonicalProgressKey({ classCode, studentCode, level } = {}) {
        const sessionApi = _resolveSessionApi();
        if (!sessionApi) return '';
        const normalizedClass = sessionApi.normalizeClassCode(classCode);
        const normalizedCode = sessionApi.normalizeStudentCode(studentCode).toUpperCase();
        const normalizedLevel = _normalizeLevel(level);
        if (!normalizedClass || !normalizedCode || !normalizedLevel) return '';
        return [normalizedClass, normalizedCode, normalizedLevel].join('|');
    }

    /**
     * Validate a progress payload before it is posted or queued.
     */
    function validateProgressPayload(payload) {
        const errors = [];
        const sessionApi = _resolveSessionApi();
        if (!sessionApi) return { ok: false, errors: ['session_contract_unavailable'] };
        if (!payload || typeof payload !== 'object') return { ok: false, errors: ['payload'] };
        const studentCode = String(payload.studentCode || '').trim();
        if (!studentCode || sessionApi.normalizeStudentCode(studentCode) !== studentCode) errors.push('studentCode');
        const classCode = String(payload.classCode || '').trim();
        if (!classCode || sessionApi.normalizeClassCode(classCode) !== classCode) errors.push('classCode');
        if (!Number.isInteger(payload.level) || _normalizeLevel(payload.level) !== payload.level) errors.push('level');
        if (!errors.length) {
            const expectedKey = buildCanonicalProgressKey(payload);
            if (!expectedKey || payload.progressKey !== expectedKey) errors.push('progressKey');
        }
        return { ok: errors.length === 0, errors };
    }

    /**
     * The payload identity must be the signed-in roster student's identity.
     */
    function _checkAuthenticatedIdentity(payload) {
        const sessionApi = _resolveSessionApi();
        if (!sessionApi) return { ok: false, reason: 'session_contract_unavailable' };
        let session = null;
        try {
            session = sessionApi.readSession(typeof localStorage !== 'undefined' ? localStorage : null);
        } catch (_) {
            session = null;
        }
        if (!session) return { ok: false, reason: 'not_authenticated' };
        if (!sessionApi.sessionMatches(session, payload)) return { ok: false, reason: 'identity_mismatch' };
        return { ok: true, session };
    }

    /**
     * Build a level progress/result upsert payload.
     * progressKey is diagnostic-only — the Power Automate flow must recompute
     * the canonical key server-side and must not trust the client value.
     */
    function _resolveSnapshotApi() {
        const globalApi = (typeof globalThis !== 'undefined' ? globalThis : window).WA_GOLD_RUSH_PROGRESS_SNAPSHOT;
        if (globalApi && typeof globalApi.buildCheckpointPayloadFields === 'function') return globalApi;
        if (typeof require === 'function') {
            try { return require('./progression-snapshot.js'); } catch (_) { return null; }
        }
        return null;
    }

    function _buildCheckpointFields(opts, level) {
        const snapshotApi = _resolveSnapshotApi();
        if (!snapshotApi) return {};
        return snapshotApi.buildCheckpointPayloadFields({ ...opts, level }, level);
    }

    function buildProgressPayload(opts) {
        const telemetry = _createProgressTelemetry(opts);
        const classCode = String(opts.classCode || '').trim().toUpperCase();
        const studentCode = String(opts.studentCode || '').trim();
        // Current gameplay level (null if missing/unsupported — never defaulted).
        const level = _normalizeLevel(opts.level);
        // GGR_Students assigned level, kept separate from the level being played.
        const rosterAssignedLevel = _normalizeRosterLevel(opts.rosterAssignedLevel);
        const progressionMarkersJson = opts.progressionMarkersJson
            ? (typeof opts.progressionMarkersJson === 'string' ? opts.progressionMarkersJson : JSON.stringify(opts.progressionMarkersJson))
            : '';
        const payload = {
            studentCode,
            classCode,
            level,
            currentLevel: level,
            rosterAssignedLevel,
            currentRound: Number(opts.currentRound) || 1,
            currentCash: _toRoundedInteger(opts.currentCash ?? 0),
            currentAssets: _toRoundedInteger(opts.currentAssets ?? 0),
            netWorth: _toRoundedInteger(opts.netWorth ?? 0),
            score: _toRoundedInteger(opts.score ?? 0),
            progressionMarkersJson,
            ..._buildCheckpointFields({ ...opts, progressionMarkersJson }, level),
            badgesJson: opts.badgesJson
                ? (typeof opts.badgesJson === 'string' ? opts.badgesJson : JSON.stringify(opts.badgesJson))
                : '',
            achievementsCount: Number(opts.achievementsCount || 0),
            sessionStatus: String(opts.sessionStatus || 'active'),
            needsSupport: opts.needsSupport === true,
            supportReason: String(opts.supportReason || '').trim(),
            progressKey: buildCanonicalProgressKey({
                classCode,
                studentCode,
                level
            }),
            saveRequestId: telemetry.saveRequestId,
            clientTimestampUtc: telemetry.clientTimestampUtc,
            clientVersion: telemetry.clientVersion
        };
        // Protocol v2 fields are only present when the caller explicitly built
        // a v2 capture (feature flag on). Legacy payloads are unchanged and
        // legacy queued items are never upgraded.
        if (opts.protocolVersion !== 2) return payload;
        const protocol = _resolveSaveProtocol();
        if (!protocol) return { ...payload, protocolVersion: 2 };
        Object.assign(payload, protocol.buildV2Fields(opts));
        if (Object.prototype.hasOwnProperty.call(opts, 'baseRevision')) {
            payload.baseRevision = Number.isInteger(opts.baseRevision) ? opts.baseRevision : (opts.baseRevision === null ? null : NaN);
        }
        payload.contentHash = protocol.computeContentHash(payload);
        return payload;
    }

    function _findQueuedForKey(queue, key) {
        return queue.filter((item) => item.type === 'progress' && _queueKey(item.payload) === key);
    }

    /**
     * Handle a non-legacy v2 outcome. Returns a result object, or null when
     * the caller should continue with the retry/queue path.
     */
    function _handleV2Outcome(error, payload) {
        const protocol = _resolveSaveProtocol();
        const outcome = error?.syncOutcome;
        if (outcome === 'conflict') {
            protocol?.recordConflict(localStorage, payload, error.v2 || {});
            _logProgress('revision conflict (held for reconciliation)', payload, { code: error.v2?.code || '' });
            _dispatchCloudSaveStatus('cloud save conflict: reload to review');
            return { ok: false, queued: false, conflict: true, reason: 'revision_conflict', progressKey: payload.progressKey, saveRequestId: payload.saveRequestId };
        }
        if (outcome === 'stale_generation' || outcome === 'unconfirmed') {
            const reason = outcome === 'stale_generation' ? 'generation_stale' : `protocol_unconfirmed:${error.v2?.code || ''}`;
            _quarantine({ item: { type: 'progress', payload, queuedAt: new Date().toISOString(), attempts: 1 }, reason });
            if (outcome === 'unconfirmed') {
                _unconfirmedKeys.add(payload.progressKey);
                protocol?.recordUnconfirmed(localStorage, payload);
            }
            _dispatchCloudSaveStatus(outcome === 'stale_generation' ? 'cloud save superseded by reset' : 'cloud save not verified');
            return { ok: false, queued: false, rejected: true, quarantined: true, reason, progressKey: payload.progressKey, saveRequestId: payload.saveRequestId };
        }
        return null;
    }

    /**
     * Remove every queued progress item for a ProgressKey (e.g. after the
     * student restarts that level). Items are moved to quarantine, never
     * silently dropped, and can never be replayed over the new run.
     */
    function discardQueuedForProgressKey(progressKey, reason = 'superseded_by_reset') {
        const key = String(progressKey || '').trim();
        if (!key) return 0;
        _verifiedSlots.delete(key);
        _lookupVersions.set(key, (_lookupVersions.get(key) || 0) + 1);
        _discardVersions.set(key, (_discardVersions.get(key) || 0) + 1);
        const queue = _loadQueue();
        const keep = [];
        const removed = [];
        queue.forEach((item) => {
            if (item.type === 'progress' && item.payload?.progressKey === key) removed.push({ item, reason });
            else keep.push(item);
        });
        if (!removed.length) return 0;
        _quarantine(removed);
        _saveQueue(keep);
        return removed.length;
    }

    // -------------------------------------------------------------------------
    // Public sync functions
    // -------------------------------------------------------------------------

    /**
     * Sync student profile. Non-blocking — failures are queued.
     */
    async function syncProfile(opts) {
        if (!_resolveEndpoint(CONFIG.profileEndpointKey)) return { queued: false, skipped: true };
        const payload = buildProfilePayload(opts);
        if (!payload.studentCode) {
            _dispatchCloudSaveStatus('idle');
            return { queued: false, skipped: true };
        }
        _dispatchCloudSaveStatus('saving');
        try {
            await _post(CONFIG.profileEndpointKey, payload);
            _dispatchCloudSaveStatus('saved to cloud');
            return { ok: true };
        } catch (err) {
            console.warn('[SharePointSync] Profile sync failed; queued for retry.');
            _enqueue('profile', payload);
            _startRetryLoop();
            _dispatchCloudSaveStatus('locally saved with retry pending');
            return { ok: false, queued: true };
        }
    }

    /**
     * Sync level progress/result. Non-blocking — retryable failures are queued,
     * permanent rejections are quarantined, invalid identity is never sent.
     */
    async function syncProgress(opts) {
        const payload = buildProgressPayload(opts || {});
        const validation = validateProgressPayload(payload);
        if (!validation.ok) {
            _logProgress('blocked (invalid identity/level)', payload, { errors: validation.errors });
            _dispatchCloudSaveStatus('cloud save blocked: sign in again');
            return { ok: false, queued: false, rejected: true, reason: 'invalid_payload', errors: validation.errors };
        }
        const auth = _checkAuthenticatedIdentity(payload);
        if (!auth.ok) {
            _logProgress('blocked (not authenticated)', payload, { reason: auth.reason });
            _dispatchCloudSaveStatus('cloud save blocked: sign in again');
            return { ok: false, queued: false, rejected: true, reason: auth.reason };
        }
        let sendPayload = payload;
        const isV2 = _isV2(payload);
        const progressKey = payload.progressKey;
        const discardVersion = _discardVersions.get(progressKey) || 0;
        const discarded = () => (_discardVersions.get(progressKey) || 0) !== discardVersion;
        let queuedItem = null;
        const hold = _uploadHold(payload);
        if (hold) {
            _dispatchCloudSaveStatus('local-only: cloud saving paused');
            return { ok: false, queued: false, held: true, reason: hold, progressKey };
        }
        if (isV2) {
            const protocol = _resolveSaveProtocol();
            const v2Validation = protocol ? protocol.validateV2Fields(payload) : { ok: false, errors: ['protocol_unavailable'] };
            if (!v2Validation.ok || !protocol.isEnabled()) {
                _logProgress('blocked (v2 unavailable)', payload, { errors: v2Validation.errors || [] });
                return { ok: false, queued: false, held: true, reason: 'protocol_v2_unavailable' };
            }
            const key = _queueKey(payload);
            if (protocol.hasConflict(localStorage, key)) {
                _dispatchCloudSaveStatus('cloud save conflict: reload to review');
                return { ok: false, queued: false, held: true, reason: 'revision_conflict', progressKey: payload.progressKey };
            }
            if (_activeProgressKeys.has(progressKey) || _findQueuedForKey(_loadQueue(), key).length) {
                // Never race an unresolved request for the same game: wait.
                const queued = _enqueue('progress', payload);
                if (!queued.accepted) return {
                    ok: false, queued: false, rejected: true, quarantined: queued.persisted,
                    reason: queued.persisted ? 'queue_capacity' : 'queue_write_failed', progressKey
                };
                _startRetryLoop();
                _dispatchCloudSaveStatus('locally saved with retry pending');
                return { ok: false, queued: true, waitingForPrevious: true, queueLength: queued.queueLength, progressKey: payload.progressKey };
            }
            const sealed = protocol.seal(payload, localStorage);
            if (!sealed.ok) {
                _quarantine({ item: { type: 'progress', payload, queuedAt: new Date().toISOString(), attempts: 0 }, reason: `unsealable:${sealed.reason}` });
                return { ok: false, queued: false, rejected: true, reason: sealed.reason };
            }
            sendPayload = sealed.payload;
            const queued = _enqueue('progress', sendPayload);
            if (!queued.accepted) return { ok: false, queued: false, held: true, reason: 'queue_write_failed', progressKey };
            queuedItem = queued.queuedItem;
            _activeProgressKeys.add(progressKey);
        }
        _dispatchCloudSaveStatus('saving');
        _logProgress('save attempt', sendPayload);
        try {
            const result = await _post(CONFIG.progressEndpointKey, sendPayload, {
                timeoutMs: CONFIG.progressRequestTimeoutMs,
                protocolV2: isV2
            });
            if (!_checkAuthenticatedIdentity(sendPayload).ok
                || _verifiedSlots.get(progressKey)?.session !== _sessionStamp(_checkAuthenticatedIdentity(sendPayload).session)) {
                return { ok: false, held: true, reason: 'session_changed' };
            }
            if (discarded()) return { ok: false, queued: false, rejected: true, reason: 'superseded_by_reset' };
            if (queuedItem) _replaceQueuedItem(queuedItem, null);
            if (isV2) _resolveSaveProtocol()?.recordAcknowledgement(localStorage, sendPayload, result.v2);
            if (isV2) _refreshVerifiedRevision(sendPayload);
            if (isV2) _unconfirmedKeys.delete(progressKey);
            _logProgress('save success', sendPayload, {
                httpStatus: result.status,
                ...(isV2 ? { revision: result.v2?.revision, deduplicated: !!result.v2?.deduplicated } : {})
            });
            _dispatchCloudSaveStatus(_loadQueue().length ? 'locally saved with retry pending' : 'saved to cloud');
            return {
                ok: true,
                progressKey: sendPayload.progressKey,
                saveRequestId: sendPayload.saveRequestId,
                ...(isV2 ? { revision: result.v2?.revision } : {})
            };
        } catch (err) {
            if (discarded()) return { ok: false, queued: false, rejected: true, reason: 'superseded_by_reset' };
            const currentAuth = _checkAuthenticatedIdentity(sendPayload);
            if (!currentAuth.ok || _verifiedSlots.get(progressKey)?.session !== _sessionStamp(currentAuth.session)) {
                return { ok: false, held: true, reason: 'session_changed' };
            }
            if (err?.syncOutcome === 'held') return { ok: false, held: true, queued: !!queuedItem, reason: err.message };
            if (isV2) {
                const handled = _handleV2Outcome(err, sendPayload);
                if (handled) {
                    _replaceQueuedItem(queuedItem, null);
                    return handled;
                }
            }
            if (err?.syncOutcome === 'rejected') {
                if (queuedItem) _replaceQueuedItem(queuedItem, null);
                _quarantine({
                    item: { type: 'progress', payload: sendPayload, queuedAt: new Date().toISOString(), attempts: 1 },
                    reason: `rejected:${err?.message || 'Flow rejected the save.'}`
                });
                _dispatchCloudSaveStatus('cloud save rejected');
                return {
                    ok: false,
                    queued: false,
                    rejected: true,
                    quarantined: true,
                    reason: 'flow_rejected',
                    error: err?.message || 'Flow rejected the save.',
                    progressKey: sendPayload.progressKey,
                    saveRequestId: sendPayload.saveRequestId
                };
            }
            const unknownOutcome = err?.syncOutcome === 'unknown';
            _logProgress(unknownOutcome ? 'timeout/unknown outcome' : 'save failure', sendPayload, {
                error: err?.message || 'Progress sync failed.'
            });
            const queued = queuedItem
                ? { coalesced: false, queueLength: _loadQueue().length }
                : _enqueue('progress', sendPayload);
            _logProgress('queueing', sendPayload, {
                coalesced: queued.coalesced,
                queueLength: queued.queueLength,
                verificationPending: unknownOutcome
            });
            _startRetryLoop();
            _dispatchCloudSaveStatus(unknownOutcome ? 'verification pending' : 'locally saved with retry pending');
            return {
                ok: false,
                queued: true,
                unknownOutcome,
                progressKey: sendPayload.progressKey,
                saveRequestId: sendPayload.saveRequestId
            };
        } finally {
            if (isV2) _activeProgressKeys.delete(progressKey);
        }
    }

    /**
     * Flush the retry queue. Called automatically by the retry loop.
     * Progress items are only dispatched for the signed-in student they belong
     * to; items for another (or no) signed-in student are held, not sent.
     */
    function retryQueue() {
        if (_retryPromise) return _retryPromise;
        _retryPromise = _drainQueue().finally(() => { _retryPromise = null; });
        return _retryPromise;
    }

    async function _drainQueue() {
        const queue = _loadQueue();
        if (!queue.length) return;

        const remaining = [];
        const rejected = [];
        const blockedV2Keys = new Set();
        const protocol = _resolveSaveProtocol();
        let finalFailure = false;
        let conflicted = false;
        let held = false;
        for (const item of queue) {
            if (!_loadQueue().some((entry) => _sameQueueItem(entry, item))) continue;
            const discardVersion = _discardVersions.get(item.payload?.progressKey) || 0;
            const discarded = () => (_discardVersions.get(item.payload?.progressKey) || 0) !== discardVersion;
            const endpointKey = item.type === 'profile' ? CONFIG.profileEndpointKey : CONFIG.progressEndpointKey;
            const url = _resolveEndpoint(endpointKey);
            if (!url) { remaining.push(item); continue; }
            const isV2 = item.type === 'progress' && _isV2(item.payload);
            const v2Enabled = !!protocol && protocol.isEnabled();
            if (item.type === 'progress') {
                const validation = validateProgressPayload(item.payload);
                if (!validation.ok) {
                    rejected.push({ item, reason: `invalid_identity:${validation.errors.join(',')}` });
                    continue;
                }
                if (_uploadHold(item.payload)) {
                    held = true;
                    remaining.push(item);
                    continue;
                }
                const auth = _checkAuthenticatedIdentity(item.payload);
                if (!auth.ok) {
                    _logProgress('retry held', item.payload, { reason: auth.reason });
                    remaining.push(item);
                    continue;
                }
                if (isV2 && !v2Enabled) {
                    // AC9: Log rollback hold for visibility
                    _logProgress('retry held (rollback)', item.payload, { reason: 'v2_disabled_rollback' });
                    // Rollback safety: never replay a v2 request through a
                    // legacy (non-conditional) save path. Held, not deleted.
                    remaining.push(item);
                    continue;
                }
                if (!isV2 && v2Enabled) {
                    // Never blindly upgrade or replay a legacy capture once v2
                    // conditional writes are active.
                    rejected.push({ item, reason: 'legacy_item_held_v2_active' });
                    continue;
                }
                if (isV2) {
                    const key = _queueKey(item.payload);
                    if (blockedV2Keys.has(key) || _activeProgressKeys.has(item.payload.progressKey)) {
                        remaining.push(item);
                        continue;
                    }
                    const sealed = protocol.seal(item.payload, localStorage);
                    if (!sealed.ok) {
                        if (sealed.reason === 'generation_mismatch') {
                            rejected.push({ item, reason: 'superseded_by_reset' });
                        } else {
                            remaining.push(item);
                            blockedV2Keys.add(key);
                        }
                        continue;
                    }
                    const replacement = { ...item, payload: sealed.payload };
                    if (!_replaceQueuedItem(item, replacement)) continue;
                    item.payload = sealed.payload;
                }
            }
            const activeKey = isV2 ? item.payload.progressKey : '';
            if (activeKey) _activeProgressKeys.add(activeKey);
            try {
                if (item.type === 'progress') {
                    _logProgress('retry', item.payload, {
                        attempts: Number(item.attempts || 0) + 1
                    });
                }
                // The queued payload (including its saveRequestId) is re-sent
                // unchanged so the flow can de-duplicate unknown-outcome retries.
                const result = await _post(endpointKey, item.payload, item.type === 'progress'
                    ? { timeoutMs: CONFIG.progressRequestTimeoutMs, protocolV2: isV2 }
                    : {});
                if (item.type === 'progress' && (!_checkAuthenticatedIdentity(item.payload).ok
                    || _verifiedSlots.get(item.payload.progressKey)?.session !== _sessionStamp(_checkAuthenticatedIdentity(item.payload).session))) continue;
                if (discarded()) continue;
                _replaceQueuedItem(item, null);
                if (isV2) protocol.recordAcknowledgement(localStorage, item.payload, result.v2);
                if (isV2) _refreshVerifiedRevision(item.payload);
                if (isV2) _unconfirmedKeys.delete(item.payload.progressKey);
                if (item.type === 'progress') {
                    _logProgress('retry success', item.payload, {
                        attempts: Number(item.attempts || 0) + 1
                    });
                }
            } catch (error) {
                if (discarded()) continue;
                if (item.type === 'progress') {
                    const auth = _checkAuthenticatedIdentity(item.payload);
                    if (!auth.ok || _verifiedSlots.get(item.payload.progressKey)?.session !== _sessionStamp(auth.session)) {
                        remaining.push(item);
                        continue;
                    }
                }
                if (error?.syncOutcome === 'held') { remaining.push(item); continue; }
                item.attempts = (item.attempts || 0) + 1;
                if (isV2) {
                    const handled = _handleV2Outcome(error, item.payload);
                    if (handled) {
                        _replaceQueuedItem(item, null);
                        if (handled.conflict) {
                            conflicted = true;
                        }
                        blockedV2Keys.add(_queueKey(item.payload));
                        continue;
                    }
                    blockedV2Keys.add(_queueKey(item.payload));
                }
                if (error?.syncOutcome === 'rejected') {
                    _replaceQueuedItem(item, null);
                    rejected.push({ item, reason: `rejected:${error?.message || 'Flow rejected the save.'}` });
                    continue;
                }
                if (item.attempts < MAX_RETRY_ATTEMPTS) {
                    _replaceQueuedItem(item, item);
                    remaining.push(item);
                } else {
                    _replaceQueuedItem(item, null);
                    finalFailure = true;
                    rejected.push({ item, reason: `max_attempts:${error?.message || 'Retry failed.'}` });
                }
                if (item.type === 'progress') {
                    _logProgress(item.attempts >= MAX_RETRY_ATTEMPTS ? 'final failure' : 'retry queueing', item.payload, {
                        attempts: item.attempts,
                        error: error?.message || 'Retry failed.',
                        verificationPending: error?.syncOutcome === 'unknown'
                    });
                }
            } finally {
                if (activeKey) _activeProgressKeys.delete(activeKey);
            }
        }
        rejected.forEach(({ item }) => _replaceQueuedItem(item, null));
        _quarantine(rejected);
        const liveQueue = _loadQueue();
        if (!liveQueue.length && _retryTimer) {
            clearInterval(_retryTimer);
            _retryTimer = null;
        }
        if (conflicted) {
            _dispatchCloudSaveStatus('cloud save conflict: reload to review');
        } else if (finalFailure) {
            _dispatchCloudSaveStatus('cloud save failed');
        } else if (rejected.length) {
            _dispatchCloudSaveStatus('cloud save rejected');
        } else if (_unconfirmedKeys.size) {
            _dispatchCloudSaveStatus('cloud save not verified');
        } else if (held) {
            _dispatchCloudSaveStatus('local-only: cloud saving paused');
        } else if (liveQueue.length) {
            _dispatchCloudSaveStatus('locally saved with retry pending');
        } else {
            _dispatchCloudSaveStatus('saved to cloud');
        }
    }

    /** Returns the number of items waiting in the retry queue. */
    function queueLength() {
        return _loadQueue().length;
    }

    /** Items permanently rejected (invalid identity, ok:false, or retries exhausted). */
    function getQuarantine() {
        return _loadQuarantine();
    }

    function quarantineLength() {
        return _loadQuarantine().length;
    }

    function getCloudSaveStatus() {
        return _cloudSaveStatus;
    }

    function getDiagnostics(input = {}) {
        const protocol = _resolveSaveProtocol();
        const store = _resolveStore();
        const session = _resolveSessionApi()?.readSession(typeof localStorage !== 'undefined' ? localStorage : null);
        const level = store?.normalizeSaveLevel(input.level);
        const key = session && level !== null ? store?.buildProgressKey(session, level) : '';
        const evidence = key ? _verifiedSlots.get(key) : null;
        const local = key ? store.readLevelSave(localStorage, session, level) : null;
        return Object.freeze({
            protocolVersion: protocol?.PROTOCOL_VERSION === 2 ? 2 : null,
            storageSchemaVersion: store?.STORAGE_SCHEMA_VERSION === 1 ? 1 : null,
            conditionalSavesEnabled: !!protocol?.isEnabled(),
            restoreConfigured: !!globalThis.WA_GOLD_RUSH_CLOUD_RESTORE?.isEnabled(),
            saveConfigured: !!_resolveEndpoint(CONFIG.progressEndpointKey),
            proofProviderConfigured: typeof globalThis.WA_GOLD_RUSH_STUDENT_PROGRESS_PROOF_PROVIDER?.getProof === 'function',
            authenticatedSessionPresent: !!session,
            startupSlotVerified: !!evidence && evidence.session === _sessionStamp(session),
            localSaveStatus: ['found', 'missing', 'invalid', 'unavailable'].includes(local?.status) ? local.status : 'unavailable',
            status: _cloudSaveStatus
        });
    }

    /**
     * Update runtime configuration (e.g. from a per-deployment config file).
     * @param {object} cfg — partial CONFIG override
     */
    function configure(cfg) {
        if (cfg && typeof cfg === 'object') {
            const normalizedCfg = { ...cfg };
            if (!normalizedCfg.apiKey && normalizedCfg.gameKey) {
                normalizedCfg.apiKey = normalizedCfg.gameKey;
            }
            if (typeof normalizedCfg.profileEndpoint === 'string' && normalizedCfg.profileEndpoint.trim()) {
                globalThis.WA_GOLD_RUSH_FLOW_ENDPOINTS = globalThis.WA_GOLD_RUSH_FLOW_ENDPOINTS || {};
                globalThis.WA_GOLD_RUSH_FLOW_ENDPOINTS.upsertStudentProfile = normalizedCfg.profileEndpoint.trim();
            }
            if (typeof normalizedCfg.progressEndpoint === 'string' && normalizedCfg.progressEndpoint.trim()) {
                globalThis.WA_GOLD_RUSH_FLOW_ENDPOINTS = globalThis.WA_GOLD_RUSH_FLOW_ENDPOINTS || {};
                globalThis.WA_GOLD_RUSH_FLOW_ENDPOINTS.saveProgress = normalizedCfg.progressEndpoint.trim();
            }
            Object.assign(CONFIG, normalizedCfg);
        }
    }

    // Start retry loop on load if there are already queued items
    if (_loadQueue().length) _startRetryLoop();
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        window.addEventListener('storage', event => {
            if (event.key === null || event.key === (_resolveSessionApi()?.STORAGE_KEY || 'wa_gold_rush_student_session')) {
                clearStartupVerification();
            }
        });
    }

    return {
        configure,
        buildProfilePayload,
        buildCanonicalProgressKey,
        buildProgressPayload,
        validateProgressPayload,
        syncProfile,
        syncProgress,
        checkLevelSave,
        clearStartupVerification,
        retryQueue,
        discardQueuedForProgressKey,
        queueLength,
        getQuarantine,
        quarantineLength,
        getCloudSaveStatus,
        getDiagnostics,
        getRuntimeDiagnostics: getDiagnostics
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = SharePointSync;
}
