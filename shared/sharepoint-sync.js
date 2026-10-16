/**
 * SharePoint / Power Automate sync hooks
 *
 * Configure your Power Automate HTTP-trigger endpoints in the constants below.
 * No secrets are stored here — the shared key header value should be injected
 * at deployment time or kept in a separate config file outside the repository.
 *
 * All sync calls are fire-and-forget: gameplay is never blocked on sync.
 * Failed requests are queued in localStorage and retried automatically.
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

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------
    function _dispatchCloudSaveStatus(status) {
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
        error.syncOutcome = ['unknown', 'rejected'].includes(syncOutcome) ? syncOutcome : 'failure';
        if (result !== undefined) {
            error.result = result;
        }
        return error;
    }

    function _logProgress(event, payload, details = {}) {
        console.info(`[SharePointSync] Progress ${event}`, {
            progressKey: String(payload?.progressKey || '').trim(),
            saveRequestId: String(payload?.saveRequestId || '').trim(),
            ...details
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
            if (item.type === 'progress' && item.payload?.progressKey) {
                const existingIndex = progressIndexes.get(item.payload.progressKey);
                if (typeof existingIndex === 'number') {
                    normalized[existingIndex] = item;
                    continue;
                }
                progressIndexes.set(item.payload.progressKey, normalized.length);
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
            localStorage.setItem(QUEUE_KEY, JSON.stringify(items.slice(-CONFIG.maxQueueSize)));
        } catch (_) {}
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
        if (type === 'progress' && payload?.progressKey) {
            const existingIndex = queue.findIndex(item => item.type === 'progress' && item.payload?.progressKey === payload.progressKey);
            if (existingIndex >= 0) {
                queue[existingIndex] = queueItem;
                coalesced = true;
            } else {
                queue.push(queueItem);
            }
        } else {
            queue.push(queueItem);
        }
        _saveQueue(queue);
        return {
            queuedItem: queueItem,
            coalesced,
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
            const requestPromise = callFlow(endpointKey, payload, {
                apiKey: CONFIG.apiKey,
                requireApiKey: true,
                cache: 'no-store',
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
            if (!result.success) {
                const errorMessage = result.error || `HTTP ${result.status || 0}`;
                const unknownOutcome = result.status === 504
                    || result?.data?.ok === true
                    || /timed?\s*out|timeout|abort/i.test(String(errorMessage));
                const permanent = !unknownOutcome && PERMANENT_HTTP_STATUSES.includes(Number(result.status));
                throw _createPostError(errorMessage, unknownOutcome ? 'unknown' : (permanent ? 'rejected' : 'failure'), result);
            }
            // HTTP 200 with an application-level ok:false is a failed save.
            if (result.data && typeof result.data === 'object' && result.data.ok === false) {
                const errorMessage = String(result.data.message || result.data.error || 'Flow returned ok:false.').trim();
                throw _createPostError(errorMessage, result.data.retryable === true ? 'failure' : 'rejected', result);
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
        return {
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
            console.warn('[SharePointSync] Profile sync failed, queuing:', err.message);
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
        if (!_resolveEndpoint(CONFIG.progressEndpointKey)) return { queued: false, skipped: true };
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
        _dispatchCloudSaveStatus('saving');
        _logProgress('save attempt', payload);
        try {
            const result = await _post(CONFIG.progressEndpointKey, payload, {
                timeoutMs: CONFIG.progressRequestTimeoutMs
            });
            _logProgress('save success', payload, {
                httpStatus: result.status
            });
            _dispatchCloudSaveStatus('saved to cloud');
            return {
                ok: true,
                progressKey: payload.progressKey,
                saveRequestId: payload.saveRequestId
            };
        } catch (err) {
            if (err?.syncOutcome === 'rejected') {
                _quarantine({
                    item: { type: 'progress', payload, queuedAt: new Date().toISOString(), attempts: 1 },
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
                    progressKey: payload.progressKey,
                    saveRequestId: payload.saveRequestId
                };
            }
            const unknownOutcome = err?.syncOutcome === 'unknown';
            _logProgress(unknownOutcome ? 'timeout/unknown outcome' : 'save failure', payload, {
                error: err?.message || 'Progress sync failed.'
            });
            const queued = _enqueue('progress', payload);
            _logProgress('queueing', payload, {
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
                progressKey: payload.progressKey,
                saveRequestId: payload.saveRequestId
            };
        }
    }

    /**
     * Flush the retry queue. Called automatically by the retry loop.
     * Progress items are only dispatched for the signed-in student they belong
     * to; items for another (or no) signed-in student are held, not sent.
     */
    async function retryQueue() {
        const queue = _loadQueue();
        if (!queue.length) return;

        const remaining = [];
        const rejected = [];
        let finalFailure = false;
        for (const item of queue) {
            const endpointKey = item.type === 'profile' ? CONFIG.profileEndpointKey : CONFIG.progressEndpointKey;
            const url = _resolveEndpoint(endpointKey);
            if (!url) { remaining.push(item); continue; }
            if (item.type === 'progress') {
                const validation = validateProgressPayload(item.payload);
                if (!validation.ok) {
                    rejected.push({ item, reason: `invalid_identity:${validation.errors.join(',')}` });
                    continue;
                }
                const auth = _checkAuthenticatedIdentity(item.payload);
                if (!auth.ok) {
                    _logProgress('retry held', item.payload, { reason: auth.reason });
                    remaining.push(item);
                    continue;
                }
            }
            try {
                if (item.type === 'progress') {
                    _logProgress('retry', item.payload, {
                        attempts: Number(item.attempts || 0) + 1
                    });
                }
                // The queued payload (including its saveRequestId) is re-sent
                // unchanged so the flow can de-duplicate unknown-outcome retries.
                await _post(endpointKey, item.payload, item.type === 'progress'
                    ? { timeoutMs: CONFIG.progressRequestTimeoutMs }
                    : {});
                if (item.type === 'progress') {
                    _logProgress('retry success', item.payload, {
                        attempts: Number(item.attempts || 0) + 1
                    });
                }
            } catch (error) {
                item.attempts = (item.attempts || 0) + 1;
                if (error?.syncOutcome === 'rejected') {
                    rejected.push({ item, reason: `rejected:${error?.message || 'Flow rejected the save.'}` });
                    continue;
                }
                if (item.attempts < MAX_RETRY_ATTEMPTS) {
                    remaining.push(item);
                } else {
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
            }
        }
        _quarantine(rejected);
        _saveQueue(remaining);
        if (!remaining.length && _retryTimer) {
            clearInterval(_retryTimer);
            _retryTimer = null;
        }
        if (finalFailure) {
            _dispatchCloudSaveStatus('cloud save failed');
        } else if (rejected.length) {
            _dispatchCloudSaveStatus('cloud save rejected');
        } else if (remaining.length) {
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

    return {
        configure,
        buildProfilePayload,
        buildCanonicalProgressKey,
        buildProgressPayload,
        validateProgressPayload,
        syncProfile,
        syncProgress,
        retryQueue,
        queueLength,
        getQuarantine,
        quarantineLength,
        getCloudSaveStatus
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = SharePointSync;
}
