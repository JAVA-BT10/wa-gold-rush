/**
 * Level Access Guard
 * Enforces authorization gates for progression checkpoints
 * Level 2: Always accessible
 * Levels 3+: Require teacher approval of checkpoint quiz
 */

class LevelAccessGuard {
    constructor(assignedLevel = 2) {
        this.assignedLevel = assignedLevel;
    }

    /**
     * Check if level is accessible
     * Level 2 is always open
     * Levels 3+ require checkpoint approval
     */
    isLevelAccessible() {
        if (this.assignedLevel <= 2) {
            return true; // Level 2 and below are always open
        }
        return this.hasCheckpointApproval();
    }

    /**
     * Load saved game state to check approval status
     */
    hasCheckpointApproval() {
        try {
            const raw = localStorage.getItem('level2_autosave');
            if (!raw) return false;
            const data = JSON.parse(raw);
            const gs = data.gameState;
            if (!gs) return false;
            // Must have: quiz passed + teacher approved
            return gs.checkpointStatus === 'quiz_passed' && gs.approvalStatus === 'approved';
        } catch (_) {
            return false;
        }
    }

    /**
     * Get access denial message
     */
    getAccessDenialReason() {
        if (this.assignedLevel <= 2) {
            return null; // No denial
        }

        const raw = localStorage.getItem('level2_autosave');
        let checkpointStatus = null;
        let approvalStatus = null;

        try {
            if (raw) {
                const data = JSON.parse(raw);
                const gs = data.gameState;
                checkpointStatus = gs?.checkpointStatus;
                approvalStatus = gs?.approvalStatus;
            }
        } catch (_) {}

        if (!checkpointStatus) {
            return 'You must complete the progression checkpoint quiz to unlock this level. Go to Level 2 and reach the goal to take the quiz.';
        }
        if (checkpointStatus !== 'quiz_passed') {
            return `Quiz status: ${checkpointStatus}. Please contact your teacher.`;
        }
        if (approvalStatus !== 'approved') {
            return `Awaiting teacher approval. Your quiz was passed, but your teacher hasn't approved progression yet. Check the teacher dashboard.`;
        }

        return null; // Should not reach here
    }

    /**
     * Enforce access: redirect if not allowed
     */
    enforceAccess() {
        if (!this.isLevelAccessible()) {
            const reason = this.getAccessDenialReason();
            const message = `Access Denied: ${reason}`;
            // Show modal or alert
            showAccessDeniedModal(message);
            // Redirect to home after 3 seconds
            setTimeout(() => {
                window.location.href = '../../index.html?error=level_locked';
            }, 3000);
        }
    }
}

/**
 * Display access denied modal
 */
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
    
    content.innerHTML = `
        <h2 style="color: #c62828; margin-top: 0;">🔒 Level Locked</h2>
        <p style="color: #333; font-size: 16px; line-height: 1.6;">${message}</p>
        <p style="color: #666; font-size: 13px;">Redirecting to home page...</p>
    `;
    
    modal.appendChild(content);
    document.body.appendChild(modal);
}

// Auto-enforce on page load if in a level
if (typeof window !== 'undefined') {
    window.addEventListener('DOMContentLoaded', () => {
        // Only enforce if this is a level page (not home or dashboard)
        const url = window.location.pathname;
        const levelMatch = url.match(/level-(\d+)/);
        if (levelMatch) {
            const level = parseInt(levelMatch[1], 10);
            const guard = new LevelAccessGuard(level);
            guard.enforceAccess();
        }
    });
}
