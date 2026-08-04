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
        // URL for the "upsert student/profile" Power Automate HTTP flow
        profileEndpoint: '',   // e.g. 'https://prod-XX.australiasoutheast.logic.azure.com/...'
        // URL for the "upsert level progress/result" Power Automate HTTP flow
        progressEndpoint: '',  // e.g. 'https://prod-XX.australiasoutheast.logic.azure.com/...'
        // Shared secret sent as X-Game-Key header — set after creating flows
        gameKey: '',
        // Maximum number of queued retries kept in localStorage
        maxQueueSize: 50,
        // Retry interval in milliseconds
        retryIntervalMs: 30000
    };

    const QUEUE_KEY = 'wa_gr_sync_queue';
    let _retryTimer = null;

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------
    function _loadQueue() {
        try {
            const q = JSON.parse(localStorage.getItem(QUEUE_KEY));
            return Array.isArray(q) ? q : [];
        } catch (_) { return []; }
    }

    function _saveQueue(queue) {
        try {
            localStorage.setItem(QUEUE_KEY, JSON.stringify(queue.slice(-CONFIG.maxQueueSize)));
        } catch (_) {}
    }

    function _enqueue(type, payload) {
        const queue = _loadQueue();
        queue.push({ type, payload, queuedAt: new Date().toISOString(), attempts: 0 });
        _saveQueue(queue);
    }

    async function _post(url, payload) {
        const headers = { 'Content-Type': 'application/json' };
        if (CONFIG.gameKey) headers['X-Game-Key'] = CONFIG.gameKey;
        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload)
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response;
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
            StudentCode:     String(opts.studentCode   || '').trim(),
            LeaderboardName: String(opts.leaderboardName || opts.studentCode || '').trim(),
            StudentID:       String(opts.studentId      || '').trim(),
            StudentName:     String(opts.studentName    || '').trim(),
            ClassCode:       String(opts.classCode      || '').trim(),
            LastPlayedUtc:   new Date().toISOString()
        };
    }

    /**
     * Build a level progress/result upsert payload.
     */
    function buildProgressPayload(opts) {
        return {
            StudentCode:    String(opts.studentCode  || '').trim(),
            Level:          Number(opts.level)        || 0,
            Score:          Number(opts.score)        || 0,
            NetWorth:       Number(opts.netWorth)     || 0,
            Round:          Number(opts.round)        || 1,
            MinesOwned:     Number(opts.minesOwned)   || 0,
            StrategyLabel:  String(opts.strategyLabel || '').trim(),
            InvestmentProfile: opts.investmentProfile || null,
            BadgesJson:     opts.badgesJson     ? JSON.stringify(opts.badgesJson)     : '',
            ProgressJson:   opts.progressJson   ? JSON.stringify(opts.progressJson)   : '',
            LastPlayedUtc:  new Date().toISOString()
        };
    }

    // -------------------------------------------------------------------------
    // Public sync functions
    // -------------------------------------------------------------------------

    /**
     * Sync student profile. Non-blocking — failures are queued.
     */
    async function syncProfile(opts) {
        if (!CONFIG.profileEndpoint) return { queued: false, skipped: true };
        const payload = buildProfilePayload(opts);
        if (!payload.StudentCode) return { queued: false, skipped: true };
        try {
            await _post(CONFIG.profileEndpoint, payload);
            return { ok: true };
        } catch (err) {
            console.warn('[SharePointSync] Profile sync failed, queuing:', err.message);
            _enqueue('profile', payload);
            _startRetryLoop();
            return { ok: false, queued: true };
        }
    }

    /**
     * Sync level progress/result. Non-blocking — failures are queued.
     */
    async function syncProgress(opts) {
        if (!CONFIG.progressEndpoint) return { queued: false, skipped: true };
        const payload = buildProgressPayload(opts);
        try {
            await _post(CONFIG.progressEndpoint, payload);
            return { ok: true };
        } catch (err) {
            console.warn('[SharePointSync] Progress sync failed, queuing:', err.message);
            _enqueue('progress', payload);
            _startRetryLoop();
            return { ok: false, queued: true };
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
            const url = item.type === 'profile' ? CONFIG.profileEndpoint : CONFIG.progressEndpoint;
            if (!url) { remaining.push(item); continue; }
            try {
                await _post(url, item.payload);
            } catch (_) {
                item.attempts = (item.attempts || 0) + 1;
                if (item.attempts < 10) remaining.push(item);
            }
        }
        _saveQueue(remaining);
        if (!remaining.length && _retryTimer) {
            clearInterval(_retryTimer);
            _retryTimer = null;
        }
    }

    /** Returns the number of items waiting in the retry queue. */
    function queueLength() {
        return _loadQueue().length;
    }

    /**
     * Update runtime configuration (e.g. from a per-deployment config file).
     * @param {object} cfg — partial CONFIG override
     */
    function configure(cfg) {
        if (cfg && typeof cfg === 'object') {
            Object.assign(CONFIG, cfg);
        }
    }

    // Start retry loop on load if there are already queued items
    if (_loadQueue().length) _startRetryLoop();

    return {
        configure,
        buildProfilePayload,
        buildProgressPayload,
        syncProfile,
        syncProgress,
        retryQueue,
        queueLength
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = SharePointSync;
}
