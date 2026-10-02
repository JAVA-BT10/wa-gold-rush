/**
 * Teacher Checkpoint Approval Module
 * Provides the review modal and approval actions for checkpoint quizzes.
 *
 * Source of truth:
 * - Quiz attempts, scores and approval state come from the flow-hydrated
 *   dashboard data (GGR_GetDashboardData → GGR_StudentProgress).
 * - Approvals and retake requests are written only through the
 *   GGR_SaveCheckpointApproval flow (`saveCheckpointApproval` endpoint).
 *   If that flow is not configured, the actions are disabled and an
 *   "unavailable" message is shown. Nothing is written to browser storage.
 * - Reviewer identity comes from the signed-in teacher session.
 */

const CheckpointApproval = (() => {
    const APPROVAL_FLOW_NAME = 'saveCheckpointApproval';
    const UNAVAILABLE_MESSAGE = 'Checkpoint approvals are unavailable: the GGR_SaveCheckpointApproval flow is not configured. Approval decisions cannot be saved yet.';
    const NO_DETAIL_MESSAGE = 'Detailed per-question answers are not stored in Microsoft Lists for this attempt. Only the score and status are available.';
    let dashboardRef = null;

    function configure(options = {}) {
        if (options.dashboard) dashboardRef = options.dashboard;
    }

    function resolveDashboard(dashboard) {
        return dashboard || dashboardRef || null;
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function isApprovalFlowConfigured(dashboard) {
        const target = resolveDashboard(dashboard);
        return !!(target && typeof target.hasConfiguredFlowEndpoint === 'function'
            && target.hasConfiguredFlowEndpoint(APPROVAL_FLOW_NAME));
    }

    function getReviewerIdentity(dashboard) {
        const target = resolveDashboard(dashboard);
        const session = target && typeof target.getTeacherSession === 'function'
            ? target.getTeacherSession()
            : null;
        if (!session?.teacherEmail) return null;
        return {
            reviewerEmail: session.teacherEmail,
            reviewerName: session.teacherName || session.teacherEmail,
            reviewerRole: session.role || 'teacher'
        };
    }

    function getLatestAttempt(checkpoint = {}) {
        const attempts = Array.isArray(checkpoint?.quizAttempts) ? checkpoint.quizAttempts : [];
        return attempts.length ? attempts[attempts.length - 1] : null;
    }

    function buildApprovalPayload({ student = {}, level, status, reviewer }) {
        const classCode = String(student.classCode || '').trim().toUpperCase();
        const studentCode = String(student.studentCode || student.displayId || '').trim();
        const numericLevel = Number(level) || 0;
        return {
            studentCode,
            classCode,
            level: numericLevel,
            progressKey: [classCode, studentCode.toUpperCase(), numericLevel].join('|'),
            approvalStatus: status,
            approverName: reviewer?.reviewerName || '',
            approverEmail: reviewer?.reviewerEmail || '',
            approvalTimestamp: new Date().toISOString()
        };
    }

    /**
     * Persist an approval/retake decision through GGR_SaveCheckpointApproval.
     * Success is only reported after the flow confirms the write; the dashboard
     * then re-hydrates so every device sees the same state.
     */
    async function saveApproval({ dashboard, student, level, status } = {}) {
        const target = resolveDashboard(dashboard);
        if (!target) {
            return { success: false, error: 'Teacher dashboard is not ready.' };
        }
        if (!isApprovalFlowConfigured(target)) {
            return { success: false, unavailable: true, error: UNAVAILABLE_MESSAGE };
        }
        const reviewer = getReviewerIdentity(target);
        if (!reviewer) {
            return { success: false, error: 'Sign in to the Teacher Dashboard before reviewing checkpoints.' };
        }
        if (!student || !(student.studentCode || student.displayId)) {
            return { success: false, error: 'Student not found.' };
        }
        if (typeof target.canTeacherAccessClass === 'function' && !target.canTeacherAccessClass(student.classCode)) {
            return { success: false, error: 'You are not authorized to review students in that class.' };
        }
        if (!['approved', 'retake_requested', 'rejected'].includes(status)) {
            return { success: false, error: 'Unknown approval decision.' };
        }

        const payload = buildApprovalPayload({ student, level, status, reviewer });
        const result = await target.postFlowPayload(APPROVAL_FLOW_NAME, payload);
        if (!result?.success) {
            return {
                success: false,
                error: String(result?.error || 'GGR_SaveCheckpointApproval did not confirm the decision.')
            };
        }

        const hydration = typeof target.rehydrateAfterWrite === 'function'
            ? await target.rehydrateAfterWrite()
            : null;
        return { success: true, payload, hydration };
    }

    /**
     * Generate HTML for the quiz review section.
     */
    function generateQuizReviewHTML(attempt, checkpoint = {}) {
        const scoreValue = attempt?.score ?? checkpoint?.quizScore;
        const numericScore = Number(scoreValue);
        const hasScore = scoreValue !== null && scoreValue !== undefined && scoreValue !== '' && Number.isFinite(numericScore);
        const passed = checkpoint?.checkpointStatus === 'quiz_passed' || (hasScore && numericScore >= 4);
        const scoreColor = passed ? '#4caf50' : '#f44336';
        const timestamp = attempt?.timestamp || checkpoint?.quizPassedAt;

        let html = `
            <div style="margin-bottom: 20px;">
                <h4 style="margin: 0 0 10px 0; color: #1a1a1a;">Quiz Performance</h4>
                <div style="display: flex; gap: 20px; flex-wrap: wrap;">
                    <div>
                        <div style="font-size: 32px; font-weight: bold; color: ${scoreColor};">${hasScore ? `${escapeHtml(numericScore)}/5` : '?/5'}</div>
                        <div style="font-size: 12px; color: #666; margin-top: 4px;">Score</div>
                    </div>
                    <div>
                        <div style="font-size: 32px; font-weight: bold; color: ${scoreColor};">${passed ? 'PASSED ✅' : 'NOT PASSED ❌'}</div>
                        <div style="font-size: 12px; color: #666; margin-top: 4px;">Status</div>
                    </div>
                    <div>
                        <div style="font-size: 12px; color: #999;">${timestamp ? escapeHtml(new Date(timestamp).toLocaleString()) : 'Unknown'}</div>
                        <div style="font-size: 12px; color: #666; margin-top: 4px;">Attempt Time</div>
                    </div>
                </div>
            </div>

            <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">

            <h4 style="margin: 20px 0 10px 0; color: #1a1a1a;">Question Review</h4>
        `;

        if (!attempt || !Array.isArray(attempt.results) || !attempt.results.length) {
            html += `<p class="checkpoint-no-detail" style="color: #666;">${escapeHtml(NO_DETAIL_MESSAGE)}</p>`;
            return html;
        }

        attempt.results.forEach((result, idx) => {
            const icon = result.correct ? '✅' : '❌';
            const bgColor = result.correct ? '#e8f5e9' : '#ffebee';
            html += `
                <div style="background: ${bgColor}; padding: 12px; border-radius: 6px; margin-bottom: 12px;">
                    <p style="margin: 0 0 8px 0; font-weight: bold; color: #1a1a1a;">${icon} Q${idx + 1}: ${escapeHtml(result.question)}</p>
                    <div style="margin: 8px 0; padding: 8px; background: #fff; border-radius: 4px; font-size: 13px;">
                        <strong>Student Answer:</strong> ${escapeHtml(result.studentAnswer || '(Not answered)')}
                    </div>
                    <div style="margin: 8px 0; padding: 8px; background: #fff; border-radius: 4px; font-size: 13px; color: #2e7d32;">
                        <strong>Correct Answer:</strong> ${escapeHtml(result.correctAnswer)}
                    </div>
                    <div style="margin: 8px 0; padding: 8px; background: #fff; border-radius: 4px; font-size: 13px; color: #555; line-height: 1.5;">
                        <strong>Explanation:</strong> ${escapeHtml(result.explanation)}
                    </div>
                    <div style="margin: 8px 0; padding: 8px; background: #fff; border-radius: 4px; font-size: 12px; color: #777; line-height: 1.5; font-style: italic;">
                        <strong>Work-Through:</strong> ${escapeHtml(result.workThroughExample)}
                    </div>
                </div>
            `;
        });

        return html;
    }

    /**
     * Show checkpoint review modal (for teachers).
     * options: { dashboard, student, level, checkpoint, onSaved }
     */
    function showReviewModal(options = {}) {
        const dashboard = resolveDashboard(options.dashboard);
        const student = options.student || {};
        const level = Number(options.level) || 0;
        const checkpoint = options.checkpoint || student.checkpointsByLevel?.[level] || {};
        const studentName = student.leaderboardName || student.studentName || student.studentCode || 'Student';
        const attempt = getLatestAttempt(checkpoint);
        const approvalStatus = checkpoint.approvalStatus || '';
        const flowConfigured = isApprovalFlowConfigured(dashboard);
        const reviewer = getReviewerIdentity(dashboard);
        const actionsEnabled = flowConfigured && !!reviewer;

        document.getElementById('checkpointReviewModal')?.remove();

        const modal = document.createElement('div');
        modal.className = 'checkpoint-review-modal';
        modal.id = 'checkpointReviewModal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'checkpointReviewTitle');
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 9999;
            overflow-y: auto;
        `;

        const content = document.createElement('div');
        content.style.cssText = `
            background: white;
            border-radius: 10px;
            max-width: 700px;
            width: 90%;
            margin: 20px auto;
            padding: 24px;
            box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
        `;

        const statusBadge = approvalStatus
            ? `<span style="display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; background: ${approvalStatus === 'approved' ? '#4caf50' : '#ff9800'}; color: white;">${escapeHtml(String(approvalStatus).toUpperCase())}</span>`
            : '';
        const approverLine = checkpoint.approverName
            ? `<p style="margin: 6px 0 0; color: #666; font-size: 13px;">Reviewed by ${escapeHtml(checkpoint.approverName)}${checkpoint.approvalTimestamp ? ` on ${escapeHtml(new Date(checkpoint.approvalTimestamp).toLocaleString())}` : ''}</p>`
            : '';
        const unavailableNotice = !flowConfigured
            ? UNAVAILABLE_MESSAGE
            : (!reviewer ? 'Sign in to the Teacher Dashboard before reviewing checkpoints.' : '');
        const disabledAttr = actionsEnabled ? '' : 'disabled aria-disabled="true"';
        const disabledStyle = actionsEnabled ? 'cursor: pointer;' : 'cursor: not-allowed; opacity: 0.55;';

        content.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                <div>
                    <h2 id="checkpointReviewTitle" style="margin: 0 0 4px 0; color: #1a1a1a;">Level ${escapeHtml(level)} Checkpoint Review</h2>
                    <p style="margin: 0; color: #666; font-size: 14px;">Student: ${escapeHtml(studentName)}</p>
                </div>
                <button type="button" class="btn-close-checkpoint" aria-label="Close checkpoint review" style="width: auto; background: none; border: none; font-size: 24px; cursor: pointer; color: #999;">×</button>
            </div>

            <div style="margin-bottom: 16px;">
                ${statusBadge}
                ${approverLine}
            </div>

            ${generateQuizReviewHTML(attempt, checkpoint)}

            <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">

            <p class="checkpoint-approval-unavailable" role="status" aria-live="polite" style="color: #b45309; font-size: 13px; margin: 0 0 12px; ${unavailableNotice ? '' : 'display: none;'}">${escapeHtml(unavailableNotice)}</p>
            <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                <button type="button" class="btn-approve-checkpoint" ${disabledAttr} style="flex: 1; min-width: 120px; padding: 12px; background: #4caf50; color: white; border: none; border-radius: 6px; font-weight: bold; font-size: 14px; ${disabledStyle}">
                    ✅ Approve for Next Level
                </button>
                <button type="button" class="btn-retake-checkpoint" ${disabledAttr} style="flex: 1; min-width: 120px; padding: 12px; background: #ff9800; color: white; border: none; border-radius: 6px; font-weight: bold; font-size: 14px; ${disabledStyle}">
                    🔄 Request Retake
                </button>
            </div>
            <p class="checkpoint-approval-result" role="status" aria-live="polite" style="font-size: 13px; margin: 12px 0 0;"></p>
        `;

        modal.appendChild(content);
        document.body.appendChild(modal);

        const resultEl = content.querySelector('.checkpoint-approval-result');
        const approveBtn = content.querySelector('.btn-approve-checkpoint');
        const retakeBtn = content.querySelector('.btn-retake-checkpoint');
        content.querySelector('.btn-close-checkpoint').addEventListener('click', () => modal.remove());

        const submitDecision = async (status, successMessage) => {
            if (!actionsEnabled) return;
            approveBtn.disabled = true;
            retakeBtn.disabled = true;
            resultEl.style.color = '#1d4ed8';
            resultEl.textContent = 'Saving decision to Microsoft Lists…';
            const result = await saveApproval({ dashboard, student, level, status });
            if (!result.success) {
                approveBtn.disabled = false;
                retakeBtn.disabled = false;
                resultEl.style.color = '#b91c1c';
                resultEl.setAttribute('role', 'alert');
                resultEl.textContent = `Decision was not saved. ${result.error}`;
                return;
            }
            modal.remove();
            if (typeof options.onSaved === 'function') options.onSaved(result, successMessage);
        };

        approveBtn.addEventListener('click', () => submitDecision('approved', `Approved ${studentName} for Level ${level + 1}.`));
        retakeBtn.addEventListener('click', () => submitDecision('retake_requested', `Requested a retake for ${studentName}.`));
    }

    return {
        APPROVAL_FLOW_NAME,
        UNAVAILABLE_MESSAGE,
        NO_DETAIL_MESSAGE,
        configure,
        isApprovalFlowConfigured,
        getReviewerIdentity,
        getLatestAttempt,
        buildApprovalPayload,
        saveApproval,
        generateQuizReviewHTML,
        showReviewModal
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = CheckpointApproval;
}
