/**
 * Level Access Guard
 * Enforces authorization gates for progression checkpoints.
 */

class LevelAccessGuard {
    // Legacy shared slot: read-only fallback for checkpoint evidence. New
    // evidence lives in the per-student progression ledger (level-save-store).
    static AUTOSAVE_KEY = 'level2_autosave';
    static STUDENT_SESSION_KEY = 'wa_gold_rush_student_session';

    constructor(assignedLevel = 2) {
        // The requested level is never coerced: an invalid or unavailable
        // level (e.g. planned Level 6) is simply not accessible.
        const level = Number(assignedLevel);
        this.assignedLevel = Number.isInteger(level) ? level : null;
    }

    getRequiredCheckpointLevel() {
        return this.assignedLevel > 2 ? this.assignedLevel - 1 : null;
    }

    static getSessionApi(globalObj) {
        const root = globalObj || (typeof window !== 'undefined' ? window : globalThis);
        const api = root?.WA_GOLD_RUSH_STUDENT_SESSION;
        if (api && typeof api.readSession === 'function') return api;
        if (typeof require === 'function') {
            try { return require('../../shared/student-session.js'); } catch (_) { return null; }
        }
        return null;
    }

    static getStoreApi(globalObj) {
        const root = globalObj || (typeof window !== 'undefined' ? window : globalThis);
        const api = root?.WA_GOLD_RUSH_LEVEL_SAVE_STORE;
        if (api && typeof api.readProgressionEvidence === 'function') return api;
        if (typeof require === 'function') {
            try { return require('../../shared/level-save-store.js'); } catch (_) { return null; }
        }
        return null;
    }

    static getCapabilitiesApi(globalObj) {
        const root = globalObj || (typeof window !== 'undefined' ? window : globalThis);
        const api = root?.WA_GOLD_RUSH_LEVEL_CAPABILITIES;
        if (api && typeof api.isPlayableLevel === 'function') return api;
        if (typeof require === 'function') {
            try { return require('../../shared/level-capabilities.js'); } catch (_) { return null; }
        }
        return null;
    }

    /** Recognized AND playable (implemented + deployed) levels only. */
    static isPlayableLevel(level) {
        const caps = LevelAccessGuard.getCapabilitiesApi();
        if (caps) return caps.isPlayableLevel(level);
        return [1, 2, 3, 4, 5].includes(Number(level));
    }

    /**
     * Highest level the roster already entitles this student to: the
     * teacher-assigned starting level (GGR_Students.Level) or the recorded
     * highest unlocked level (ProgressedLevel), whichever is higher.
     */
    static getRosterEntitledLevel(session) {
        const assigned = Number(session?.assignedLevel) || 0;
        const progressed = Number(session?.progressedLevel) || 0;
        return Math.max(assigned, progressed);
    }

    static resolveStorage(storage) {
        return storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    }

    /**
     * The roster-verified (GGR_LoginStudent) session, or null. Legacy,
     * self-created, or incomplete sessions are rejected.
     */
    static readStudentSession(storage, globalObj) {
        const api = LevelAccessGuard.getSessionApi(globalObj);
        if (!api) return null;
        return api.readSession(LevelAccessGuard.resolveStorage(storage));
    }

    /**
     * The shared autosave slot is per device, not per student. It only counts
     * for the signed-in student when its saved player.studentCode matches.
     */
    static isAutosaveOwnedBy(gameState, session) {
        if (!session || !gameState || typeof gameState !== 'object') return false;
        const ownerCode = String(gameState.player?.studentCode || '').trim().toUpperCase();
        return !!ownerCode && ownerCode === String(session.studentCode || '').trim().toUpperCase();
    }

    /**
     * Reads one level's checkpoint evidence for the signed-in student from the
     * per-student progression ledger written by the game
     * (GameState.saveToLocalStorage). The game, the home page level cards and
     * this guard all use this reader, so they agree. Falls back (read-only) to
     * the legacy shared autosave slot when the ledger has no pass recorded.
     */
    static readSavedProgressionState(requiredLevel, storage) {
        try {
            const store = LevelAccessGuard.resolveStorage(storage);
            const session = LevelAccessGuard.readStudentSession(store);
            if (!session) return null;
            const saveStore = LevelAccessGuard.getStoreApi();
            const ledgerState = saveStore
                ? saveStore.readProgressionEvidence(store, session, requiredLevel)
                : null;
            if (ledgerState?.checkpointStatus === 'quiz_passed') return ledgerState;
            const legacyState = LevelAccessGuard.readLegacyProgressionState(requiredLevel, store, session);
            if (legacyState?.checkpointStatus === 'quiz_passed') return legacyState;
            return ledgerState || legacyState;
        } catch (_) {
            return null;
        }
    }

    static readLegacyProgressionState(requiredLevel, store, session) {
        try {
            const raw = store?.getItem(LevelAccessGuard.AUTOSAVE_KEY);
            if (!raw) return null;
            const data = JSON.parse(raw);
            const gs = data?.gameState;
            if (!gs) return null;
            if (!LevelAccessGuard.isAutosaveOwnedBy(gs, session)) return null;
            const levelKey = String(Number(requiredLevel));
            return gs.progressionStateByLevel?.[levelKey]
                || (String(gs.assignedLevel || '') === levelKey
                    ? {
                        checkpointStatus: gs.checkpointStatus,
                        approvalStatus: gs.approvalStatus
                    }
                    : null);
        } catch (_) {
            return null;
        }
    }

    static isCheckpointPassed(requiredLevel, storage) {
        return LevelAccessGuard.readSavedProgressionState(requiredLevel, storage)?.checkpointStatus === 'quiz_passed';
    }

    /**
     * Cross-device unlock is only possible when a GGR_GetStudentProgress flow
     * endpoint ("getStudentProgress") is configured for the student pages.
     * Without it, unlocks stay same-device (the saved autosave slot).
     */
    static isRemoteProgressConfigured(globalObj) {
        const root = globalObj || (typeof window !== 'undefined' ? window : globalThis);
        const api = root?.WA_GOLD_RUSH_POWER_AUTOMATE;
        if (!api || typeof api.callFlow !== 'function' || typeof api.resolveFlowEndpoint !== 'function') {
            return false;
        }
        const endpoint = api.resolveFlowEndpoint('getStudentProgress');
        return !!endpoint && !(typeof api.isPlaceholderEndpoint === 'function' && api.isPlaceholderEndpoint(endpoint));
    }

    static extractProgressRecords(data) {
        const body = data && typeof data === 'object' && !Array.isArray(data) && data.body && typeof data.body === 'object'
            ? data.body
            : data;
        if (Array.isArray(body)) return body;
        if (!body || typeof body !== 'object') return [];
        for (const key of ['progress', 'Progress', 'records', 'items', 'value']) {
            if (Array.isArray(body[key])) return body[key];
        }
        return [body];
    }

    /**
     * Checkpoint-only compatibility mode of GGR_GetStudentProgress: fetches the
     * student's saved progress and, if the required level's checkpoint quiz is
     * recorded as passed there, merges that evidence (monotonically) into the
     * student's progression ledger so the game, home page and this guard all
     * read the same state. It never restores or overwrites any level economy;
     * full-snapshot restore is a separate, capability-gated path
     * (shared/cloud-restore.js).
     */
    static async hydrateRemoteProgression(requiredLevel, options = {}) {
        const root = options.globalObj || (typeof window !== 'undefined' ? window : globalThis);
        const storage = options.storage || root?.localStorage;
        const level = Number(requiredLevel);
        if (!Number.isFinite(level)) return { unlocked: false, reason: 'invalid_level' };
        if (!LevelAccessGuard.isRemoteProgressConfigured(root)) {
            return { unlocked: false, reason: 'flow_unavailable' };
        }
        const session = LevelAccessGuard.readStudentSession(storage, root);
        if (!session) return { unlocked: false, reason: 'missing_student_session' };
        const extract = root?.WA_GOLD_RUSH_PROGRESS_SNAPSHOT?.extractCheckpointFields;
        if (typeof extract !== 'function') return { unlocked: false, reason: 'snapshot_unavailable' };

        const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 8000;
        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
        let result;
        try {
            result = await root.WA_GOLD_RUSH_POWER_AUTOMATE.callFlow('getStudentProgress', {
                studentCode: session.studentCode,
                classCode: session.classCode,
                level
            }, {
                requireApiKey: true,
                ...(controller ? { signal: controller.signal } : {})
            });
        } catch (error) {
            return { unlocked: false, reason: 'flow_failed', error: error?.message || String(error) };
        } finally {
            if (timer) clearTimeout(timer);
        }
        if (!result?.success || result?.data?.ok === false) {
            return { unlocked: false, reason: 'flow_failed', error: result?.error || 'Progress lookup failed.' };
        }

        const codeKey = session.studentCode.toUpperCase();
        const records = LevelAccessGuard.extractProgressRecords(result.data).filter((record) => {
            if (!record || typeof record !== 'object') return false;
            // Only records explicitly belonging to the signed-in student (and
            // their class, when the record carries one) may unlock a level.
            const recordCode = String(record.studentCode || record.StudentCode || '').trim().toUpperCase();
            const recordClass = String(record.classCode || record.ClassCode || '').trim().toUpperCase();
            return recordCode === codeKey && (!recordClass || recordClass === session.classCode);
        });
        const passed = records
            .map((record) => extract(record, level))
            .find((fields) => fields?.checkpointStatus === 'quiz_passed');
        if (!passed) return { unlocked: false, reason: 'not_passed' };

        const saveStore = LevelAccessGuard.getStoreApi(root);
        if (!saveStore) return { unlocked: false, reason: 'storage_failed', error: 'Save store unavailable.' };
        const recorded = saveStore.recordProgressionEvidence(storage, session, level, {
            checkpointStatus: 'quiz_passed',
            quizScore: passed.quizScore ?? null,
            quizPassedAt: passed.quizPassedAt || null,
            quizAttempts: Array.isArray(passed.quizAttempts) ? passed.quizAttempts : [],
            approvalStatus: passed.approvalStatus || null,
            approverName: passed.approverName || null,
            approvalTimestamp: passed.approvalTimestamp || null
        });
        if (!recorded) return { unlocked: false, reason: 'storage_failed', error: 'Could not record progression evidence.' };
        return { unlocked: true, reason: 'flow' };
    }

    getSavedProgressionState(requiredLevel) {
        return LevelAccessGuard.readSavedProgressionState(requiredLevel);
    }

    /**
     * Same-device check first; if locked, try the cross-device progress flow
     * (only when configured) before denying access.
     */
    async resolveAccess(options = {}) {
        if (!LevelAccessGuard.readStudentSession(options.storage, options.globalObj)) return false;
        if (this.isLevelAccessible()) return true;
        const requiredLevel = this.getRequiredCheckpointLevel();
        const remote = await LevelAccessGuard.hydrateRemoteProgression(requiredLevel, options);
        return remote.unlocked ? this.isLevelAccessible() : false;
    }

    isLevelAccessible() {
        const session = LevelAccessGuard.readStudentSession();
        if (!session) {
            return false;
        }
        if (!LevelAccessGuard.isPlayableLevel(this.assignedLevel)) {
            return false;
        }
        if (this.assignedLevel <= LevelAccessGuard.getRosterEntitledLevel(session) || this.assignedLevel <= 2) {
            return true;
        }
        const state = this.getSavedProgressionState(this.getRequiredCheckpointLevel());
        return state?.checkpointStatus === 'quiz_passed';
    }

    getAccessDenialReason() {
        const session = LevelAccessGuard.readStudentSession();
        if (!session) {
            return 'You must sign in with your Class Code, Student ID and PIN before playing.';
        }
        if (!LevelAccessGuard.isPlayableLevel(this.assignedLevel)) {
            return this.assignedLevel === null
                ? 'That level link is not valid.'
                : `Level ${this.assignedLevel} is not available yet.`;
        }
        if (this.assignedLevel <= LevelAccessGuard.getRosterEntitledLevel(session) || this.assignedLevel <= 2) {
            return null;
        }

        const requiredLevel = this.getRequiredCheckpointLevel();
        const state = this.getSavedProgressionState(requiredLevel);
        const checkpointStatus = state?.checkpointStatus || null;
        const approvalStatus = state?.approvalStatus || null;

        if (!checkpointStatus) {
            return `You must complete the Level ${requiredLevel} progression checkpoint quiz to unlock this level.`;
        }
        if (checkpointStatus !== 'quiz_passed') {
            return `Level ${requiredLevel} quiz status: ${checkpointStatus}.`;
        }
        if (approvalStatus && approvalStatus !== 'approved') {
            return `Level ${requiredLevel} quiz passed. Last review status: ${approvalStatus}.`;
        }

        return null;
    }

    enforceAccess() {
        if (!LevelAccessGuard.readStudentSession()) {
            LevelAccessGuard.getSessionApi()?.requireSessionOrRedirect({ loginPath: '../../index.html' });
            return;
        }
        if (!this.isLevelAccessible()) {
            const reason = this.getAccessDenialReason();
            showAccessDeniedModal(`Access Denied: ${reason}`);
            setTimeout(() => {
                window.location.href = '../../index.html?error=level_locked';
            }, 3000);
        }
    }
}

function showAccessDeniedModal(message) {
    const modal = document.createElement('div');
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.7);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 9999;
    `;

    const content = document.createElement('div');
    content.style.cssText = `
        background: white;
        padding: 30px;
        border-radius: 10px;
        max-width: 500px;
        text-align: center;
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
    `;

    const heading = document.createElement('h2');
    heading.style.cssText = 'color: #c62828; margin-top: 0;';
    heading.textContent = '🔒 Level Locked';

    const body = document.createElement('p');
    body.style.cssText = 'color: #333; font-size: 16px; line-height: 1.6;';
    body.textContent = message;

    const redirectNotice = document.createElement('p');
    redirectNotice.style.cssText = 'color: #666; font-size: 13px;';
    redirectNotice.textContent = 'Redirecting to home page...';

    content.appendChild(heading);
    content.appendChild(body);
    content.appendChild(redirectNotice);

    modal.appendChild(content);
    document.body.appendChild(modal);
}

/**
 * Level requested by the Level 2–5 page URL. A missing ?level= means the
 * default Level 2 entry point; a present but invalid/unsupported value
 * returns null (never coerced to another level's save).
 */
function getAssignedLevelFromPageUrl() {
    try {
        const params = new URLSearchParams(window.location.search);
        const raw = params.get('level');
        if (raw === null) return 2;
        const text = String(raw).trim();
        if (!/^\d+$/.test(text)) return null;
        const level = Number(text);
        return [2, 3, 4, 5].includes(level) ? level : null;
    } catch (_) {
        return null;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { LevelAccessGuard, getAssignedLevelFromPageUrl };
}
