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
        // Retry interval in milliseconds
        retryIntervalMs: 30000,
        // Bound gameplay-triggered cloud saves so they resolve to success or retry quickly
        progressRequestTimeoutMs: 30000
    };

    const QUEUE_KEY = 'wa_gr_sync_queue';
    const QUEUE_SCHEMA_VERSION = 3;
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

    function _generateRequestId() {
        if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function') {
            return globalThis.crypto.randomUUID();
        }
        return `save_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
    }

    function _normalizeUpper(value) {
        return String(value || '').trim().toUpperCase();
    }

    function _normalizeLevel(value) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) return 0;
        return Math.max(0, Math.trunc(numeric));
    }

    function buildCanonicalProgressKey(opts) {
        return [
            _normalizeUpper(opts?.classCode),
            _normalizeUpper(opts?.studentCode),
            _normalizeLevel(opts?.level)
        ].join('|');
    }

    function _resolveClientVersion() {
        const runtimeConfig = globalThis.WA_GOLD_RUSH_RUNTIME_CONFIG || {};
        const runtimeVersion = String(runtimeConfig.version || '').trim();
        const runtimeTarget = String(runtimeConfig.buildTarget || '').trim();
        const packageVersion = typeof process !== 'undefined'
            ? String(process.env?.npm_package_version || '').trim()
            : '';
        if (packageVersion) return packageVersion;
        if (runtimeVersion && runtimeTarget) return `${runtimeTarget}:${runtimeVersion}`;
        if (runtimeVersion) return runtimeVersion;
        if (runtimeTarget) return runtimeTarget;
        return 'local-dev';
    }

    function _createProgressTelemetry(opts) {
        return {
            saveRequestId: String(opts?.saveRequestId || '').trim() || _generateRequestId(),
            clientTimestampUtc: String(opts?.clientTimestampUtc || '').trim() || new Date().toISOString(),
            clientVersion: String(opts?.clientVersion || '').trim() || _resolveClientVersion()
        };
    }

    function _getProgressTelemetry(payload) {
        return {
            saveRequestId: String(payload?.saveRequestId || '').trim(),
            progressKey: String(payload?.progressKey || '').trim(),
            clientTimestampUtc: String(payload?.clientTimestampUtc || '').trim(),
            clientVersion: String(payload?.clientVersion || '').trim()
        };
    }

    function _logProgress(event, payload, extra = {}) {
        console.info(`[SharePointSync] Progress ${event}`, {
            telemetry: _getProgressTelemetry(payload),
            studentCode: String(payload?.studentCode || '').trim(),
            classCode: String(payload?.classCode || '').trim().toUpperCase(),
            level: _normalizeLevel(payload?.level),
            ...extra
        });
    }

    function _createPostError(message, outcome = 'failure', result = null) {
        const error = new Error(String(message || 'Flow request failed.'));
        error.syncOutcome = outcome;
        error.result = result;
        return error;
    }

    function _normalizeQueueItem(item) {
        if (!item || typeof item !== 'object') return null;
        const type = item.type === 'profile' ? 'profile' : (item.type === 'progress' ? 'progress' : '');
        if (!type) return null;

        let payload = item.payload && typeof item.payload === 'object' ? { ...item.payload } : null;
        if (!payload) return null;

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
                level: Number(payload.Level || payload.level) || 0,
                currentRound: Number(payload.Round || payload.currentRound) || 1,
                currentCash: Number(payload.currentCash ?? payload.Cash ?? 0),
                currentAssets: Number(payload.currentAssets ?? payload.Assets ?? 0),
                netWorth: Number(payload.NetWorth ?? payload.netWorth ?? 0),
                score: Number(payload.Score ?? payload.score ?? 0),
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
        }

        if (type === 'progress' && !payload.studentCode) return null;
        if (type === 'profile' && !payload.studentCode) return null;
        return {
            type,
            payload,
            queuedAt: String(item.queuedAt || new Date().toISOString()),
            attempts: Number(item.attempts) || 0,
            payloadSchemaVersion: QUEUE_SCHEMA_VERSION
        };
    }

    function _coalesceQueue(queue) {
        const normalized = [];
        const progressIndexes = new Map();
        for (const rawItem of Array.isArray(queue) ? queue : []) {
            const item = _normalizeQueueItem(rawItem);
            if (!item) continue;
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
        return normalized;
    }

    function _loadQueue() {
        try {
            const q = JSON.parse(localStorage.getItem(QUEUE_KEY));
            if (!Array.isArray(q)) return [];
            const normalized = _coalesceQueue(q);
            if (normalized.length !== q.length || q.some(item => item?.payloadSchemaVersion !== QUEUE_SCHEMA_VERSION)) {
                _saveQueue(normalized);
            }
            return normalized;
        } catch (_) { return []; }
    }

    function _saveQueue(queue) {
        try {
            const normalized = _coalesceQueue(queue).slice(-CONFIG.maxQueueSize);
            localStorage.setItem(QUEUE_KEY, JSON.stringify(normalized));
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
                throw _createPostError(errorMessage, unknownOutcome ? 'unknown' : 'failure', result);
            }
            return result;
        } catch (error) {
            if (timedOut && error?.syncOutcome !== 'unknown') {
                throw _createPostError(`Timed out after ${timeoutMs}ms`, 'unknown');
            }
            if (error?.syncOutcome) {
                throw error;
            }
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
     * Build a level progress/result upsert payload.
     * progressKey is diagnostic-only — the Power Automate flow must recompute
     * the canonical key server-side and must not trust the client value.
     */
    function buildProgressPayload(opts) {
        const telemetry = _createProgressTelemetry(opts);
        const classCode = String(opts.classCode || '').trim().toUpperCase();
        const studentCode = String(opts.studentCode || '').trim();
        const level = _normalizeLevel(opts.level);
        return {
            studentCode,
            classCode,
            level,
            currentRound: Number(opts.currentRound) || 1,
            currentCash: Number(opts.currentCash ?? 0),
            currentAssets: Number(opts.currentAssets ?? 0),
            netWorth: Number(opts.netWorth ?? 0),
            score: Number(opts.score ?? 0),
            progressionMarkersJson: opts.progressionMarkersJson
                ? (typeof opts.progressionMarkersJson === 'string' ? opts.progressionMarkersJson : JSON.stringify(opts.progressionMarkersJson))
                : '',
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
     * Sync level progress/result. Non-blocking — failures are queued.
     */
    async function syncProgress(opts) {
        if (!_resolveEndpoint(CONFIG.progressEndpointKey)) return { queued: false, skipped: true };
        const payload = buildProgressPayload(opts);
        if (!payload.studentCode) {
            _dispatchCloudSaveStatus('idle');
            return { queued: false, skipped: true };
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
     */
    async function retryQueue() {
        const queue = _loadQueue();
        if (!queue.length) return;

        const remaining = [];
        for (const item of queue) {
            const endpointKey = item.type === 'profile' ? CONFIG.profileEndpointKey : CONFIG.progressEndpointKey;
            const url = _resolveEndpoint(endpointKey);
            if (!url) { remaining.push(item); continue; }
            try {
                if (item.type === 'progress') {
                    _logProgress('retry', item.payload, {
                        attempts: Number(item.attempts || 0) + 1
                    });
                }
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
                if (item.attempts < 10) {
                    remaining.push(item);
                }
                if (item.type === 'progress') {
                    _logProgress(item.attempts >= 10 ? 'final failure' : 'retry queueing', item.payload, {
                        attempts: item.attempts,
                        error: error?.message || 'Retry failed.',
                        verificationPending: error?.syncOutcome === 'unknown'
                    });
                }
                if (item.attempts >= 10) {
                    _dispatchCloudSaveStatus('cloud save failed');
                }
            }
        }
        _saveQueue(remaining);
        if (!remaining.length && _retryTimer) {
            clearInterval(_retryTimer);
            _retryTimer = null;
            _dispatchCloudSaveStatus('saved to cloud');
        } else if (remaining.length) {
            _dispatchCloudSaveStatus('locally saved with retry pending');
        }
    }

    /** Returns the number of items waiting in the retry queue. */
    function queueLength() {
        return _loadQueue().length;
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
        syncProfile,
        syncProgress,
        retryQueue,
        queueLength,
        getCloudSaveStatus
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = SharePointSync;
}
