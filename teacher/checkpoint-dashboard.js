/**
 * Checkpoint Dashboard UI Handler
 * Manages the Progression Checkpoints section in the teacher dashboard.
 *
 * Data comes only from the flow-hydrated TeacherDashboard state
 * (GGR_GetDashboardData → GGR_StudentProgress). Nothing is read from or
 * written to browser storage, so every device shows the same checkpoints.
 *
 * Features:
 * - Tab-based view for each level's checkpoint
 * - Table of students whose checkpoint status is `quiz_passed`
 * - Review button → opens the review modal (CheckpointApproval)
 * - Re-renders automatically each time dashboard hydration completes
 */

const CheckpointDashboard = (() => {
    let dashboardRef = null;
    let getStudentsRef = null;
    let activeLevel = 2;
    let tabsBound = false;

    function normalizeLevel(value, fallback = 2) {
        const numeric = Number(value);
        return Number.isInteger(numeric) && numeric >= 1 && numeric <= 6 ? numeric : fallback;
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function getHydratedStudents() {
        if (typeof getStudentsRef === 'function') return getStudentsRef() || [];
        if (dashboardRef && typeof dashboardRef.getAllStudents === 'function') return dashboardRef.getAllStudents();
        return [];
    }

    /**
     * Read the checkpoint fields for one level from a hydrated student.
     */
    function getCheckpointForLevel(student = {}, level) {
        const levelNum = normalizeLevel(level);
        const fromHydration = student?.checkpointsByLevel?.[levelNum] || student?.checkpointsByLevel?.[String(levelNum)];
        if (fromHydration) return fromHydration;

        const gs = student?.gameState || {};
        const byLevel = gs.progressionStateByLevel?.[String(levelNum)];
        if (byLevel) return byLevel;
        if (Number(gs.assignedLevel || student.level) === levelNum) {
            return {
                checkpointStatus: gs.checkpointStatus,
                quizScore: gs.quizScore,
                quizPassedAt: gs.quizPassedAt,
                quizAttempts: gs.quizAttempts,
                approvalStatus: gs.approvalStatus,
                approverName: gs.approverName,
                approvalTimestamp: gs.approvalTimestamp
            };
        }
        return null;
    }

    /**
     * Students (from hydrated flow data) who passed the checkpoint quiz for a level.
     */
    function getStudentsWithPassedCheckpoint(students, level) {
        const levelNum = normalizeLevel(level);
        return (Array.isArray(students) ? students : [])
            .map(student => ({ student, checkpoint: getCheckpointForLevel(student, levelNum) }))
            .filter(entry => entry.checkpoint?.checkpointStatus === 'quiz_passed');
    }

    function formatQuizScore(checkpoint = {}) {
        const attempts = Array.isArray(checkpoint.quizAttempts) ? checkpoint.quizAttempts : [];
        const value = checkpoint.quizScore ?? attempts[attempts.length - 1]?.score ?? null;
        if (typeof value === 'string' && value.includes('/')) return value;
        const numeric = Number(value);
        return value !== null && value !== '' && Number.isFinite(numeric) ? `${numeric}/5` : '?/5';
    }

    function getApprovalBadgeHTML(status) {
        const badges = {
            'approved': '<span style="background: #4caf50; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold;">✅ Approved</span>',
            'retake_requested': '<span style="background: #ff9800; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold;">🔄 Retake</span>',
            'rejected': '<span style="background: #f44336; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold;">❌ Rejected</span>',
            'pending': '<span style="background: #9e9e9e; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold;">⏳ Pending review</span>'
        };
        return badges[status] || badges.pending;
    }

    function buildCheckpointTableHTML(entries, level) {
        const levelNum = normalizeLevel(level);
        if (!entries.length) {
            return `
                <p style="color: #666; font-size: 14px; text-align: center; padding: 20px;">
                    No students have passed the Level ${levelNum} checkpoint quiz yet.
                </p>
            `;
        }

        const rows = entries.map(({ student, checkpoint }) => {
            const studentCode = String(student.studentCode || student.displayId || '');
            const leaderboardName = student.leaderboardName || student.studentName || student.name || 'Unknown';
            return `
                <tr style="border-bottom: 1px solid #eee;">
                    <td style="padding: 12px;">
                        <strong>${escapeHtml(leaderboardName)}</strong><br>
                        <span style="color: #999; font-size: 12px;">${escapeHtml(studentCode)}</span>
                    </td>
                    <td style="padding: 12px; text-align: center;">
                        <span style="font-size: 18px; font-weight: bold; color: #4caf50;">${escapeHtml(formatQuizScore(checkpoint))}</span>
                    </td>
                    <td style="padding: 12px; text-align: center;">
                        ${getApprovalBadgeHTML(checkpoint.approvalStatus || 'pending')}
                    </td>
                    <td style="padding: 12px; text-align: center;">
                        <button type="button" class="btn-review-checkpoint" data-student="${escapeHtml(studentCode)}" data-level="${levelNum}" aria-label="Review Level ${levelNum} checkpoint for ${escapeHtml(leaderboardName)}" style="width: auto; padding: 6px 12px; background: #1a73e8; color: white; border: none; border-radius: 4px; font-weight: bold; cursor: pointer; font-size: 12px;">
                            🔍 Review
                        </button>
                    </td>
                </tr>
            `;
        }).join('');

        return `
            <table style="width: 100%; border-collapse: collapse;">
                <thead>
                    <tr style="background: #f5f5f5;">
                        <th style="padding: 12px; text-align: left; border-bottom: 2px solid #ddd; font-weight: bold;">Student</th>
                        <th style="padding: 12px; text-align: center; border-bottom: 2px solid #ddd; font-weight: bold;">Quiz Score</th>
                        <th style="padding: 12px; text-align: center; border-bottom: 2px solid #ddd; font-weight: bold;">Approval</th>
                        <th style="padding: 12px; text-align: center; border-bottom: 2px solid #ddd; font-weight: bold;">Actions</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        `;
    }

    /**
     * Render checkpoint table for a level from hydrated flow data.
     */
    function renderCheckpointTable(level) {
        activeLevel = normalizeLevel(level, activeLevel);
        if (typeof document === 'undefined') return;
        const tableContainer = document.getElementById('checkpointTableContainer');
        if (!tableContainer) return;

        document.querySelectorAll('.checkpoint-tab-btn').forEach(btn => {
            const isActive = normalizeLevel(btn.getAttribute('data-level'), -1) === activeLevel;
            btn.classList.toggle('active', isActive);
            btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        });

        const entries = getStudentsWithPassedCheckpoint(getHydratedStudents(), activeLevel);
        tableContainer.innerHTML = buildCheckpointTableHTML(entries, activeLevel);

        tableContainer.querySelectorAll('.btn-review-checkpoint').forEach(btn => {
            btn.addEventListener('click', () => {
                const studentCode = btn.getAttribute('data-student');
                const btnLevel = normalizeLevel(btn.getAttribute('data-level'), activeLevel);
                const entry = entries.find(item => String(item.student.studentCode || item.student.displayId || '') === studentCode);
                if (!entry || typeof CheckpointApproval === 'undefined') return;
                CheckpointApproval.showReviewModal({
                    dashboard: dashboardRef,
                    student: entry.student,
                    level: btnLevel,
                    checkpoint: entry.checkpoint,
                    onSaved: () => renderCheckpointTable(btnLevel)
                });
            });
        });
    }

    /**
     * Initialize the checkpoint dashboard.
     * options: { dashboard: TeacherDashboard, getStudents: () => Student[] }
     */
    function init(options = {}) {
        if (options.dashboard) dashboardRef = options.dashboard;
        if (typeof options.getStudents === 'function') getStudentsRef = options.getStudents;
        if (typeof CheckpointApproval !== 'undefined' && dashboardRef) {
            CheckpointApproval.configure({ dashboard: dashboardRef });
        }
        if (dashboardRef && typeof dashboardRef.onHydrated === 'function') {
            dashboardRef.onHydrated((result) => {
                if (result?.success) renderCheckpointTable(activeLevel);
            });
        }

        if (!tabsBound && typeof document !== 'undefined') {
            tabsBound = true;
            document.querySelectorAll('.checkpoint-tab-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    // data-level is a string; coerce so level + 1 and comparisons work.
                    renderCheckpointTable(normalizeLevel(btn.getAttribute('data-level')));
                });
            });
        }
    }

    return {
        init,
        renderCheckpointTable,
        normalizeLevel,
        getCheckpointForLevel,
        getStudentsWithPassedCheckpoint,
        buildCheckpointTableHTML,
        formatQuizScore,
        getActiveLevel: () => activeLevel
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = CheckpointDashboard;
}
