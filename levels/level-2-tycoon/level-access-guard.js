/**
 * Level Access Guard
 * Enforces authorization gates for progression checkpoints.
 */

class LevelAccessGuard {
    static AUTOSAVE_KEY = 'level2_autosave';
    static STUDENT_SESSION_KEY = 'wa_gold_rush_student_session';

    constructor(assignedLevel = 2) {
        this.assignedLevel = Number(assignedLevel) || 2;
    }

    getRequiredCheckpointLevel() {
        return this.assignedLevel > 2 ? this.assignedLevel - 1 : null;
    }

    /**
     * Reads the per-level checkpoint state from the shared Level 2–5 autosave
     * slot. The game (script.js → GameState.saveToLocalStorage) and the home
     * page level cards read/write this exact shape, so all three agree.
     */
    static readSavedProgressionState(requiredLevel, storage) {
        try {
            const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
            const raw = store?.getItem(LevelAccessGuard.AUTOSAVE_KEY);
            if (!raw) return null;
            const data = JSON.parse(raw);
            const gs = data?.gameState;
            if (!gs) return null;
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

    static readStudentSession(storage) {
        try {
            const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
            const session = JSON.parse(store?.getItem(LevelAccessGuard.STUDENT_SESSION_KEY) || 'null');
            const studentCode = String(session?.studentCode || '').trim();
            if (!studentCode) return null;
            return {
                studentCode,
                classCode: String(session.classCode || '').trim().toUpperCase()
            };
        } catch (_) {
            return null;
        }
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
     * Fetches the student's saved progress from Microsoft Lists (via the
     * getStudentProgress flow) and, if the required level's checkpoint quiz is
     * recorded as passed there, mirrors that state into the local autosave slot
     * so the game, home page, and this guard all read the same saved state.
     */
    static async hydrateRemoteProgression(requiredLevel, options = {}) {
        const root = options.globalObj || (typeof window !== 'undefined' ? window : globalThis);
        const storage = options.storage || root?.localStorage;
        const level = Number(requiredLevel);
        if (!Number.isFinite(level)) return { unlocked: false, reason: 'invalid_level' };
        if (!LevelAccessGuard.isRemoteProgressConfigured(root)) {
            return { unlocked: false, reason: 'flow_unavailable' };
        }
        const session = LevelAccessGuard.readStudentSession(storage);
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
            const recordCode = String(record.studentCode || record.StudentCode || '').trim().toUpperCase();
            return !recordCode || recordCode === codeKey;
        });
        const passed = records
            .map((record) => extract(record, level))
            .find((fields) => fields?.checkpointStatus === 'quiz_passed');
        if (!passed) return { unlocked: false, reason: 'not_passed' };

        try {
            const raw = storage?.getItem(LevelAccessGuard.AUTOSAVE_KEY);
            const data = raw ? JSON.parse(raw) : {};
            const gameState = data?.gameState && typeof data.gameState === 'object' ? data.gameState : {};
            const byLevel = gameState.progressionStateByLevel && typeof gameState.progressionStateByLevel === 'object'
                ? gameState.progressionStateByLevel
                : {};
            const levelKey = String(level);
            byLevel[levelKey] = {
                ...(byLevel[levelKey] || {}),
                checkpointStatus: 'quiz_passed',
                quizScore: passed.quizScore ?? byLevel[levelKey]?.quizScore ?? null,
                quizPassedAt: passed.quizPassedAt || byLevel[levelKey]?.quizPassedAt || null,
                quizAttempts: Array.isArray(byLevel[levelKey]?.quizAttempts) && byLevel[levelKey].quizAttempts.length
                    ? byLevel[levelKey].quizAttempts
                    : (Array.isArray(passed.quizAttempts) ? passed.quizAttempts : []),
                approvalStatus: passed.approvalStatus || byLevel[levelKey]?.approvalStatus || null,
                approverName: passed.approverName || byLevel[levelKey]?.approverName || null,
                approvalTimestamp: passed.approvalTimestamp || byLevel[levelKey]?.approvalTimestamp || null
            };
            gameState.progressionStateByLevel = byLevel;
            storage.setItem(LevelAccessGuard.AUTOSAVE_KEY, JSON.stringify({
                ...data,
                timestamp: data?.timestamp || new Date().toISOString(),
                gameState
            }));
        } catch (error) {
            return { unlocked: false, reason: 'storage_failed', error: error?.message || String(error) };
        }
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
        if (this.isLevelAccessible()) return true;
        const requiredLevel = this.getRequiredCheckpointLevel();
        const remote = await LevelAccessGuard.hydrateRemoteProgression(requiredLevel, options);
        return remote.unlocked ? this.isLevelAccessible() : false;
    }

    isLevelAccessible() {
        if (this.assignedLevel <= 2) {
            return true;
        }
        const state = this.getSavedProgressionState(this.getRequiredCheckpointLevel());
        return state?.checkpointStatus === 'quiz_passed';
    }

    getAccessDenialReason() {
        if (this.assignedLevel <= 2) {
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

function getAssignedLevelFromPageUrl() {
    try {
        const params = new URLSearchParams(window.location.search);
        const level = Number(params.get('level'));
        if ([2, 3, 4, 5].includes(level)) {
            return level;
        }
        const pathMatch = String(window.location.pathname || '').match(/level-(\d+)/);
        const pathLevel = Number(pathMatch?.[1]);
        return [2, 3, 4, 5].includes(pathLevel) ? pathLevel : 2;
    } catch (_) {
        return 2;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { LevelAccessGuard, getAssignedLevelFromPageUrl };
}
