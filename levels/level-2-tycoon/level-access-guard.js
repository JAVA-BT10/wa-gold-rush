/**
 * Level Access Guard
 * Enforces authorization gates for progression checkpoints.
 */

class LevelAccessGuard {
    constructor(assignedLevel = 2) {
        this.assignedLevel = Number(assignedLevel) || 2;
    }

    getRequiredCheckpointLevel() {
        return this.assignedLevel > 2 ? this.assignedLevel - 1 : null;
    }

    getSavedProgressionState(requiredLevel) {
        try {
            const raw = localStorage.getItem('level2_autosave');
            if (!raw) return null;
            const data = JSON.parse(raw);
            const gs = data?.gameState;
            if (!gs) return null;
            const levelKey = String(requiredLevel);
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
