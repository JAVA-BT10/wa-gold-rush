/**
 * Checkpoint Dashboard UI Handler
 * Manages the Progression Checkpoints section in teacher dashboard
 * 
 * Features:
 * - Tab-based view for each level's checkpoints
 * - Table showing students who have passed quiz
 * - Review button → opens full Q&A modal
 * - Approve/Retake decision buttons
 * - Real-time status updates
 */

const CheckpointDashboard = (() => {
    const APPROVAL_KEY = 'wa_gr_checkpoint_approvals';

    /**
     * Initialize checkpoint dashboard
     */
    function init() {
        // Add event listeners to tab buttons
        const tabBtns = document.querySelectorAll('.checkpoint-tab-btn');
        tabBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const level = e.target.getAttribute('data-level');
                renderCheckpointTable(level);
            });
        });
        
        // Load default tab (Level 2→3)
        renderCheckpointTable(2);
    }

    /**
     * Get all students who passed checkpoint for a level
     */
    function getStudentsWithPassedCheckpoint(level) {
        const CLASS_RECORDS_KEY = 'wa_gold_rush_class_records';
        try {
            const raw = localStorage.getItem(CLASS_RECORDS_KEY);
            if (!raw) return [];
            const records = JSON.parse(raw);
            if (!Array.isArray(records)) return [];

            return records.filter(r => {
                const gs = r.gameState || {};
                const progressionState = gs.progressionStateByLevel?.[String(level)]
                    || (Number(gs.assignedLevel || r.level) === Number(level)
                        ? {
                            checkpointStatus: gs.checkpointStatus,
                            approvalStatus: gs.approvalStatus,
                            quizScore: gs.quizScore
                        }
                        : null);
                return progressionState?.checkpointStatus === 'quiz_passed';
            });
        } catch (_) {
            return [];
        }
    }

    function getLatestQuizAttempt(studentCode, level) {
        try {
            const raw = localStorage.getItem(`wa_gr_progression_quiz_${studentCode}_level_${level}`);
            if (!raw) return null;
            const data = JSON.parse(raw);
            return Array.isArray(data?.attempts) && data.attempts.length
                ? data.attempts[data.attempts.length - 1]
                : null;
        } catch (_) {
            return null;
        }
    }

    /**
     * Get approval status for a student
     */
    function getApprovalStatus(studentCode, level) {
        try {
            const raw = localStorage.getItem(APPROVAL_KEY);
            if (!raw) return null;
            const all = JSON.parse(raw);
            return all[`level_${level}`]?.[studentCode] || null;
        } catch (_) {
            return null;
        }
    }

    /**
     * Render checkpoint table for a level
     */
    function renderCheckpointTable(level) {
        const tableContainer = document.getElementById('checkpointTableContainer');
        if (!tableContainer) return;

        const students = getStudentsWithPassedCheckpoint(level);
        const nextLevel = level + 1;

        // Update active tab
        document.querySelectorAll('.checkpoint-tab-btn').forEach(btn => {
            btn.classList.toggle('active', Number(btn.getAttribute('data-level')) === level);
        });

        if (!students.length) {
            tableContainer.innerHTML = `
                <p style="color: #666; font-size: 14px; text-align: center; padding: 20px;">
                    No students have passed the Level ${level} checkpoint quiz yet.
                </p>
            `;
            return;
        }

        let html = `
            <table style="width: 100%; border-collapse: collapse;">
                <thead>
                    <tr style="background: #f5f5f5;">
                        <th style="padding: 12px; text-align: left; border-bottom: 2px solid #ddd; font-weight: bold;">Student</th>
                        <th style="padding: 12px; text-align: center; border-bottom: 2px solid #ddd; font-weight: bold;">Quiz Score</th>
                        <th style="padding: 12px; text-align: center; border-bottom: 2px solid #ddd; font-weight: bold;">Status</th>
                        <th style="padding: 12px; text-align: center; border-bottom: 2px solid #ddd; font-weight: bold;">Actions</th>
                    </tr>
                </thead>
                <tbody>
        `;

        students.forEach(student => {
            const studentCode = student.studentCode || student.id;
            const leaderboardName = student.leaderboardName || student.name || 'Unknown';
            const gs = student.gameState || {};
            const progressionState = gs.progressionStateByLevel?.[String(level)]
                || (Number(gs.assignedLevel || student.level) === Number(level)
                    ? gs
                    : {});
            const quizAttempt = getLatestQuizAttempt(studentCode, level);
            const quizScoreValue = progressionState?.quizScore ?? quizAttempt?.score ?? '?';
            const quizScore = (typeof quizScoreValue === 'string' && quizScoreValue.includes('/'))
                ? quizScoreValue
                : `${quizScoreValue}/5`;
            const approval = getApprovalStatus(studentCode, level);
            const approvalStatus = approval?.status || 'pending';
            const approvalBadge = getApprovalBadgeHTML(approvalStatus);

            html += `
                <tr style="border-bottom: 1px solid #eee;">
                    <td style="padding: 12px;">
                        <strong>${leaderboardName}</strong><br>
                        <span style="color: #999; font-size: 12px;">${studentCode}</span>
                    </td>
                    <td style="padding: 12px; text-align: center;">
                        <span style="font-size: 18px; font-weight: bold; color: #4caf50;">${quizScore}</span>
                    </td>
                    <td style="padding: 12px; text-align: center;">
                        ${approvalBadge}
                    </td>
                    <td style="padding: 12px; text-align: center;">
                        <button class="btn-review-checkpoint" data-student="${studentCode}" data-level="${level}" data-name="${leaderboardName}" style="width: auto; padding: 6px 12px; background: #1a73e8; color: white; border: none; border-radius: 4px; font-weight: bold; cursor: pointer; font-size: 12px;">
                            🔍 Review
                        </button>
                    </td>
                </tr>
            `;
        });

        html += `
                </tbody>
            </table>
        `;

        tableContainer.innerHTML = html;

        // Attach review button handlers
        tableContainer.querySelectorAll('.btn-review-checkpoint').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const studentCode = e.target.getAttribute('data-student');
                const level = Number(e.target.getAttribute('data-level'));
                const studentName = e.target.getAttribute('data-name');
                if (typeof CheckpointApproval !== 'undefined') {
                    CheckpointApproval.showReviewModal(studentCode, level, studentName);
                    // Set callback to refresh table when approved/retake
                    window.refreshCheckpointTable = () => renderCheckpointTable(level);
                }
            });
        });
    }

    /**
     * Get approval badge HTML
     */
    function getApprovalBadgeHTML(status) {
        const badges = {
            'approved': '<span style="background: #4caf50; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold;">✅ Approved</span>',
            'retake_requested': '<span style="background: #ff9800; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold;">🔄 Retake</span>',
            'rejected': '<span style="background: #f44336; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold;">❌ Rejected</span>',
            'pending': '<span style="background: #9e9e9e; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold;">⏳ Pending</span>'
        };
        return badges[status] || badges['pending'];
    }

    return {
        init,
        renderCheckpointTable
    };
})();

// Auto-initialize on DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => CheckpointDashboard.init());
} else {
    CheckpointDashboard.init();
}
