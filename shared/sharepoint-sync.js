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
        loadProgressEndpointKey: 'getStudentProgress',
        // Shared secret sent as X-GGR-Key header — set after creating flows
        apiKey: '',
        // Maximum number of queued retries kept in localStorage
        maxQueueSize: 50,
        // Retry interval in milliseconds
        retryIntervalMs: 30000
    };

    const QUEUE_KEY = 'wa_gr_sync_queue';
    const QUEUE_SCHEMA_VERSION = 2;
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
                supportReason: String(payload.supportReason || '')
            };
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

    function _loadQueue() {
        try {
            const q = JSON.parse(localStorage.getItem(QUEUE_KEY));
            if (!Array.isArray(q)) return [];
            const normalized = q
                .map(_normalizeQueueItem)
                .filter(Boolean);
            if (normalized.length !== q.length || q.some(item => item?.payloadSchemaVersion !== QUEUE_SCHEMA_VERSION)) {
                _saveQueue(normalized);
            }
            return normalized;
        } catch (_) { return []; }
    }

    function _saveQueue(queue) {
        try {
            localStorage.setItem(QUEUE_KEY, JSON.stringify(queue.slice(-CONFIG.maxQueueSize)));
        } catch (_) {}
    }

    function _enqueue(type, payload) {
        const queue = _loadQueue();
        queue.push({
            type,
            payload,
            queuedAt: new Date().toISOString(),
            attempts: 0,
            payloadSchemaVersion: QUEUE_SCHEMA_VERSION
        });
        _saveQueue(queue);
    }

    function _resolveEndpoint(endpointKey) {
        const resolveFlowEndpoint = globalThis.WA_GOLD_RUSH_POWER_AUTOMATE?.resolveFlowEndpoint;
        if (typeof resolveFlowEndpoint === 'function') {
            return resolveFlowEndpoint(endpointKey);
        }
        return String(globalThis.WA_GOLD_RUSH_FLOW_ENDPOINTS?.[endpointKey] || '').trim();
    }

    async function _post(endpointKey, payload) {
        const callFlow = globalThis.WA_GOLD_RUSH_POWER_AUTOMATE?.callFlow;
        if (typeof callFlow !== 'function') {
            throw new Error('Power Automate flow helper is unavailable.');
        }
        const result = await callFlow(endpointKey, payload, {
            apiKey: CONFIG.apiKey,
            requireApiKey: true,
            cache: 'no-store'
        });
        if (!result.success) throw new Error(result.error || `HTTP ${result.status || 0}`);
        return result;
    }

    function _startRetryLoop() {
        if (_retryTimer) return;
        _retryTimer = setInterval(retryQueue, CONFIG.retryIntervalMs);
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
     */
    function buildProgressPayload(opts) {
        return {
            studentCode: String(opts.studentCode || '').trim(),
            classCode: String(opts.classCode || '').trim().toUpperCase(),
            level: Number(opts.level) || 0,
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
            supportReason: String(opts.supportReason || '').trim()
        };
    }

    function extractProgressRecord(responseData, criteria = {}) {
        const isObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
        const unwrap = (value) => {
            if (!isObject(value)) return value;
            if (Array.isArray(value.records)) return value.records;
            if (Array.isArray(value.items)) return value.items;
            if (Array.isArray(value.value)) return value.value;
            if (Array.isArray(value.progress)) return value.progress;
            if (Array.isArray(value.Progress)) return value.Progress;
            if (Array.isArray(value.data)) return value.data;
            if (isObject(value.body)) return unwrap(value.body);
            if (isObject(value.data)) return unwrap(value.data);
            return value;
        };
        const parsedCriteria = {
            studentCode: String(criteria.studentCode || '').trim().toLowerCase(),
            studentId: String(criteria.studentId || '').trim().toLowerCase(),
            classCode: String(criteria.classCode || '').trim().toUpperCase(),
            level: Number(criteria.level) || 0
        };
        const unwrapped = unwrap(responseData);
        const records = Array.isArray(unwrapped) ? unwrapped : [unwrapped].filter(isObject);
        if (!records.length) return null;

        const scoreRecord = (record) => {
            let score = 0;
            const recordStudentCode = String(record?.studentCode || record?.StudentCode || '').trim().toLowerCase();
            const recordStudentId = String(record?.studentId || record?.StudentID || '').trim().toLowerCase();
            const recordClassCode = String(record?.classCode || record?.ClassCode || '').trim().toUpperCase();
            const recordLevel = Number(record?.level || record?.Level || record?.assignedLevel || 0) || 0;
            if (parsedCriteria.studentCode && recordStudentCode === parsedCriteria.studentCode) score += 4;
            if (parsedCriteria.studentId && recordStudentId === parsedCriteria.studentId) score += 3;
            if (parsedCriteria.classCode && recordClassCode === parsedCriteria.classCode) score += 2;
            if (parsedCriteria.level && recordLevel === parsedCriteria.level) score += 1;
            return score;
        };

        return [...records]
            .map((record, index) => ({ record, index, score: scoreRecord(record) }))
            .sort((a, b) => {
                if (b.score !== a.score) return b.score - a.score;
                return a.index - b.index;
            })[0]?.record || null;
    }

    function extractProgressSnapshot(record = {}) {
        const rawSnapshot = record?.progressionMarkersJson
            || record?.ProgressionMarkersJson
            || record?.ProgressJson
            || record?.progressJson
            || '';
        if (rawSnapshot && typeof rawSnapshot === 'object') {
            return rawSnapshot;
        }
        if (!rawSnapshot || typeof rawSnapshot !== 'string') {
            return null;
        }
        try {
            const parsed = JSON.parse(rawSnapshot);
            return parsed && typeof parsed === 'object' ? parsed : null;
        } catch (_) {
            return null;
        }
    }

    function deriveProgressTimestamp(record = {}, snapshot = null) {
        const candidates = [
            snapshot?.savedAt,
            snapshot?.quizPassedAt,
            record?.updatedAt,
            record?.UpdatedAt,
            record?.lastPlayedUtc,
            record?.LastPlayedUtc,
            record?.lastPlayed,
            record?.LastPlayed
        ];
        for (const candidate of candidates) {
            const value = String(candidate || '').trim();
            if (value) return value;
        }
        return '';
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
        try {
            await _post(CONFIG.progressEndpointKey, payload);
            _dispatchCloudSaveStatus('saved to cloud');
            return { ok: true };
        } catch (err) {
            console.warn('[SharePointSync] Progress sync failed, queuing:', err.message);
            _enqueue('progress', payload);
            _startRetryLoop();
            _dispatchCloudSaveStatus('locally saved with retry pending');
            return { ok: false, queued: true };
        }
    }

    async function loadProgress(opts = {}) {
        if (!_resolveEndpoint(CONFIG.loadProgressEndpointKey)) {
            return { ok: false, skipped: true, error: 'Student progress endpoint is not configured.' };
        }
        const payload = {
            studentCode: String(opts.studentCode || '').trim(),
            studentId: String(opts.studentId || '').trim(),
            classCode: String(opts.classCode || '').trim().toUpperCase(),
            level: Number(opts.level) || 0,
            requestedLevel: Number(opts.level) || 0
        };
        if (!payload.studentCode && !payload.studentId) {
            return { ok: false, skipped: true, error: 'Student code or student ID is required.' };
        }

        const result = await _post(CONFIG.loadProgressEndpointKey, payload).then(
            (response) => ({ success: true, response }),
            (error) => ({ success: false, error })
        );
        if (!result.success) {
            return { ok: false, error: result.error?.message || String(result.error || 'Unable to load student progress.') };
        }

        const rawData = result.response?.data || null;
        const record = extractProgressRecord(rawData, payload);
        const snapshot = extractProgressSnapshot(record);
        const updatedAt = deriveProgressTimestamp(record, snapshot);
        return {
            ok: !!snapshot,
            skipped: !snapshot,
            record,
            snapshot,
            updatedAt,
            error: snapshot ? '' : 'Student progress response did not include a restorable progression snapshot.'
        };
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
                await _post(endpointKey, item.payload);
            } catch (_) {
                item.attempts = (item.attempts || 0) + 1;
                if (item.attempts < 10) remaining.push(item);
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
        buildProgressPayload,
        extractProgressRecord,
        extractProgressSnapshot,
        syncProfile,
        syncProgress,
        loadProgress,
        retryQueue,
        queueLength,
        getCloudSaveStatus
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = SharePointSync;
}
