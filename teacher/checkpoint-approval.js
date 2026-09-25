/**
 * Teacher Checkpoint Approval Module
 * Provides UI and state management for checkpoint quiz review & approval
 * 
 * Integrates with TeacherDashboard to:
 * - Display student quiz attempts and scores
 * - Show question-by-question review with explanations
 * - Allow approval, rejection, or retake requests
 * - Update student approval status in localStorage
 */

const CheckpointApproval = (() => {
    const APPROVAL_STORAGE_KEY = 'wa_gr_checkpoint_approvals';

    /**
     * Load all approvals for a level
     */
    function loadApprovalsForLevel(level) {
        try {
            const raw = localStorage.getItem(APPROVAL_STORAGE_KEY);
            const all = raw ? JSON.parse(raw) : {};
            return all[`level_${level}`] || {};
        } catch (_) {
            return {};
        }
    }

    /**
     * Save approval for student + level
     */
    function saveApproval(studentCode, level, status, approverName = 'Teacher') {
        try {
            const raw = localStorage.getItem(APPROVAL_STORAGE_KEY);
            const all = raw ? JSON.parse(raw) : {};
            const key = `level_${level}`;
            if (!all[key]) all[key] = {};
            all[key][studentCode] = {
                status,           // 'approved' | 'rejected' | 'retake_requested'
                approverName,
                timestamp: new Date().toISOString(),
                approvedAt: new Date().toISOString()
            };
            localStorage.setItem(APPROVAL_STORAGE_KEY, JSON.stringify(all));
            return true;
        } catch (_) {
            return false;
        }
    }

    /**
     * Get approval status for student + level
     */
    function getApprovalStatus(studentCode, level) {
        const approvals = loadApprovalsForLevel(level);
        return approvals[studentCode] || null;
    }

    /**
     * Sync approval to student's game state (localStorage)
     * This updates the matching classroom/player records with approval info.
     */
    function syncApprovalToGameState(studentCode, level, approvalRecord) {
        const levelKey = String(level);

        function applyApprovalToGameStateContainer(gameState) {
            if (!gameState || typeof gameState !== 'object') return false;

            const progressionStateByLevel = (gameState.progressionStateByLevel && typeof gameState.progressionStateByLevel === 'object')
                ? gameState.progressionStateByLevel
                : {};
            const levelState = {
                checkpointStatus: null,
                quizAttempts: [],
                approvalStatus: null,
                approverName: null,
                approvalTimestamp: null,
                quizScore: null,
                quizPassedAt: null,
                ...(progressionStateByLevel[levelKey] || {})
            };

            if (approvalRecord.status === 'approved') {
                levelState.checkpointStatus = levelState.checkpointStatus || 'quiz_passed';
                levelState.approvalStatus = 'approved';
                levelState.approverName = approvalRecord.approverName;
                levelState.approvalTimestamp = approvalRecord.timestamp;
            } else if (approvalRecord.status === 'rejected') {
                levelState.approvalStatus = 'rejected';
                levelState.approverName = approvalRecord.approverName;
                levelState.approvalTimestamp = approvalRecord.timestamp;
            } else if (approvalRecord.status === 'retake_requested') {
                levelState.approvalStatus = null;
                levelState.approverName = approvalRecord.approverName;
                levelState.approvalTimestamp = approvalRecord.timestamp;
                levelState.checkpointStatus = 'quiz_available';
            }

            progressionStateByLevel[levelKey] = levelState;
            gameState.progressionStateByLevel = progressionStateByLevel;
            gameState.checkpointStatus = levelState.checkpointStatus;
            gameState.quizAttempts = levelState.quizAttempts;
            gameState.approvalStatus = levelState.approvalStatus;
            gameState.approverName = levelState.approverName;
            gameState.approvalTimestamp = levelState.approvalTimestamp;
            gameState.quizScore = levelState.quizScore;
            return true;
        }

        function matchesStudent(candidate) {
            return String(candidate || '').trim().toLowerCase() === String(studentCode || '').trim().toLowerCase();
        }

        try {
            let updated = false;

            const recordsRaw = localStorage.getItem('wa_gold_rush_class_records');
            if (recordsRaw) {
                const records = JSON.parse(recordsRaw);
                if (Array.isArray(records)) {
                    records.forEach(record => {
                        if (matchesStudent(record.studentCode) || matchesStudent(record.studentId)) {
                            updated = applyApprovalToGameStateContainer(record.gameState || (record.gameState = {})) || updated;
                        }
                    });
                    localStorage.setItem('wa_gold_rush_class_records', JSON.stringify(records));
                }
            }

            const dashboardRaw = localStorage.getItem('teacher_dashboard');
            if (dashboardRaw) {
                const dashboard = JSON.parse(dashboardRaw);
                if (Array.isArray(dashboard?.students)) {
                    dashboard.students.forEach(student => {
                        if (matchesStudent(student.studentCode) || matchesStudent(student.displayId) || matchesStudent(student.id)) {
                            updated = applyApprovalToGameStateContainer(student.gameState || (student.gameState = {})) || updated;
                        }
                    });
                    localStorage.setItem('teacher_dashboard', JSON.stringify(dashboard));
                }
            }

            const autosaveKeys = Array.from(new Set([`level${level}_autosave`, 'level2_autosave']));
            autosaveKeys.forEach(key => {
                const autosaveRaw = localStorage.getItem(key);
                if (!autosaveRaw) return;
                const autosave = JSON.parse(autosaveRaw);
                const autosaveCode = autosave?.gameState?.player?.studentCode || autosave?.gameState?.player?.studentId || '';
                if (matchesStudent(autosaveCode) && applyApprovalToGameStateContainer(autosave.gameState)) {
                    localStorage.setItem(key, JSON.stringify(autosave));
                    updated = true;
                }
            });

            return updated;
        } catch (_) {
            return false;
        }
    }

    /**
     * Get student's quiz attempt for a level
     */
    function getStudentQuizAttempt(studentCode, level) {
        try {
            const storageKey = `wa_gr_progression_quiz_${studentCode}_level_${level}`;
            const raw = localStorage.getItem(storageKey);
            if (!raw) return null;
            const data = JSON.parse(raw);
            if (!data.attempts || !data.attempts.length) return null;
            return data.attempts[data.attempts.length - 1]; // Last attempt
        } catch (_) {
            return null;
        }
    }

    function getStudentProgressRecord(studentCode, level) {
        try {
            const raw = localStorage.getItem('wa_gold_rush_class_records');
            const records = raw ? JSON.parse(raw) : [];
            if (!Array.isArray(records)) return null;
            const normalizedTarget = String(studentCode || '').trim().toLowerCase();
            return records.find((record) => {
                const identity = typeof dashboard !== 'undefined' && typeof dashboard.normalizeDashboardStudentIdentity === 'function'
                    ? dashboard.normalizeDashboardStudentIdentity(record)
                    : {
                        studentCode: String(record?.studentCode || record?.StudentCode || record?.displayId || '').trim(),
                        studentId: String(record?.studentId || record?.StudentID || record?.email || '').trim()
                    };
                const recordStudentCode = String(identity?.studentCode || '').trim().toLowerCase();
                const recordStudentId = String(identity?.studentId || '').trim().toLowerCase();
                const matchesStudent = recordStudentCode === normalizedTarget || recordStudentId === normalizedTarget;
                const recordLevel = Number(record?.level || record?.gameState?.assignedLevel || 0) || 0;
                return matchesStudent && (!level || recordLevel === Number(level));
            }) || null;
        } catch (_) {
            return null;
        }
    }

    async function syncApprovalRecordToBackend(studentCode, level) {
        if (typeof dashboard === 'undefined' || typeof dashboard.syncProgressRecordToBackend !== 'function') {
            return { success: false, skipped: true, error: 'Dashboard progress sync helper is unavailable.' };
        }
        const record = getStudentProgressRecord(studentCode, level);
        if (!record) {
            return { success: false, skipped: true, error: 'Student progress record was not found for backend sync.' };
        }
        return dashboard.syncProgressRecordToBackend(record);
    }

    /**
     * Generate HTML for quiz review modal
     */
    function generateQuizReviewHTML(attempt) {
        if (!attempt) {
            return '<p style="color: #666;">No quiz attempt found.</p>';
        }

        const scoreColor = attempt.score >= 4 ? '#4caf50' : '#f44336';
        const scoreText = attempt.score >= 4 ? 'PASSED ✅' : 'FAILED ❌';

        let html = `
            <div style="margin-bottom: 20px;">
                <h4 style="margin: 0 0 10px 0; color: #1a1a1a;">Quiz Performance</h4>
                <div style="display: flex; gap: 20px; flex-wrap: wrap;">
                    <div>
                        <div style="font-size: 32px; font-weight: bold; color: ${scoreColor};">${attempt.score}/5</div>
                        <div style="font-size: 12px; color: #666; margin-top: 4px;">Score</div>
                    </div>
                    <div>
                        <div style="font-size: 32px; font-weight: bold; color: ${scoreColor};">${scoreText}</div>
                        <div style="font-size: 12px; color: #666; margin-top: 4px;">Status</div>
                    </div>
                    <div>
                        <div style="font-size: 12px; color: #999;">${new Date(attempt.timestamp).toLocaleString()}</div>
                        <div style="font-size: 12px; color: #666; margin-top: 4px;">Attempt Time</div>
                    </div>
                </div>
            </div>

            <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">

            <h4 style="margin: 20px 0 10px 0; color: #1a1a1a;">Question Review</h4>
        `;

        if (attempt.results && Array.isArray(attempt.results)) {
            attempt.results.forEach((result, idx) => {
                const icon = result.correct ? '✅' : '❌';
                const bgColor = result.correct ? '#e8f5e9' : '#ffebee';
                html += `
                    <div style="background: ${bgColor}; padding: 12px; border-radius: 6px; margin-bottom: 12px;">
                        <p style="margin: 0 0 8px 0; font-weight: bold; color: #1a1a1a;">${icon} Q${idx + 1}: ${result.question}</p>
                        <div style="margin: 8px 0; padding: 8px; background: #fff; border-radius: 4px; font-size: 13px;">
                            <strong>Student Answer:</strong> ${result.studentAnswer || '(Not answered)'}
                        </div>
                        <div style="margin: 8px 0; padding: 8px; background: #fff; border-radius: 4px; font-size: 13px; color: #2e7d32;">
                            <strong>Correct Answer:</strong> ${result.correctAnswer}
                        </div>
                        <div style="margin: 8px 0; padding: 8px; background: #fff; border-radius: 4px; font-size: 13px; color: #555; line-height: 1.5;">
                            <strong>Explanation:</strong> ${result.explanation}
                        </div>
                        <div style="margin: 8px 0; padding: 8px; background: #fff; border-radius: 4px; font-size: 12px; color: #777; line-height: 1.5; font-style: italic;">
                            <strong>Work-Through:</strong> ${result.workThroughExample}
                        </div>
                    </div>
                `;
            });
        }

        return html;
    }

    /**
     * Show checkpoint review modal (for teachers)
     */
    function showReviewModal(studentCode, level, studentName = '') {
        const attempt = getStudentQuizAttempt(studentCode, level);
        const currentApproval = getApprovalStatus(studentCode, level);

        const modal = document.createElement('div');
        modal.className = 'checkpoint-review-modal';
        modal.id = 'checkpointReviewModal';
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

        const statusBadge = currentApproval ? `<span style="display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; background: ${currentApproval.status === 'approved' ? '#4caf50' : '#ff9800'}; color: white;">${currentApproval.status.toUpperCase()}</span>` : '';

        content.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                <div>
                    <h2 style="margin: 0 0 4px 0; color: #1a1a1a;">Level ${level} Checkpoint Review</h2>
                    <p style="margin: 0; color: #666; font-size: 14px;">Student: ${studentName}</p>
                </div>
                <button style="background: none; border: none; font-size: 24px; cursor: pointer; color: #999;" onclick="document.getElementById('checkpointReviewModal').remove();">×</button>
            </div>

            <div style="margin-bottom: 16px;">
                ${statusBadge}
            </div>

            ${generateQuizReviewHTML(attempt)}

            <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">

            <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                <button class="btn-approve-checkpoint" style="flex: 1; min-width: 120px; padding: 12px; background: #4caf50; color: white; border: none; border-radius: 6px; font-weight: bold; cursor: pointer; font-size: 14px;">
                    ✅ Approve for Next Level
                </button>
                <button class="btn-reject-checkpoint" style="flex: 1; min-width: 120px; padding: 12px; background: #f44336; color: white; border: none; border-radius: 6px; font-weight: bold; cursor: pointer; font-size: 14px;">
                    ⛔ Reject
                </button>
                <button class="btn-retake-checkpoint" style="flex: 1; min-width: 120px; padding: 12px; background: #ff9800; color: white; border: none; border-radius: 6px; font-weight: bold; cursor: pointer; font-size: 14px;">
                    🔄 Request Retake
                </button>
            </div>
        `;

        modal.appendChild(content);
        document.body.appendChild(modal);

        // Attach event handlers
        const approveBtn = content.querySelector('.btn-approve-checkpoint');
        const rejectBtn = content.querySelector('.btn-reject-checkpoint');
        const retakeBtn = content.querySelector('.btn-retake-checkpoint');

        approveBtn.onclick = async () => {
            const teacherName = prompt('Your name (for record):') || 'Teacher';
            saveApproval(studentCode, level, 'approved', teacherName);
            syncApprovalToGameState(studentCode, level, { status: 'approved', approverName: teacherName });
            const backendResult = await syncApprovalRecordToBackend(studentCode, level);
            alert(
                backendResult?.success
                    ? `✅ Approved ${studentName} for Level ${level + 1} after backend confirmation.`
                    : `✅ Approved ${studentName} locally, but backend sync is still pending or failed.`
            );
            modal.remove();
            if (window.refreshCheckpointTable) window.refreshCheckpointTable();
        };

        rejectBtn.onclick = async () => {
            const teacherName = prompt('Optional rejection note (for record):', 'Teacher review rejected') || 'Teacher';
            saveApproval(studentCode, level, 'rejected', teacherName);
            syncApprovalToGameState(studentCode, level, { status: 'rejected', approverName: teacherName });
            const backendResult = await syncApprovalRecordToBackend(studentCode, level);
            alert(
                backendResult?.success
                    ? `⛔ Rejected ${studentName} after backend confirmation.`
                    : `⛔ Rejected ${studentName} locally, but backend sync is still pending or failed.`
            );
            modal.remove();
            if (window.refreshCheckpointTable) window.refreshCheckpointTable();
        };

        retakeBtn.onclick = async () => {
            saveApproval(studentCode, level, 'retake_requested', 'Teacher');
            syncApprovalToGameState(studentCode, level, { status: 'retake_requested', approverName: 'Teacher' });
            const backendResult = await syncApprovalRecordToBackend(studentCode, level);
            alert(
                backendResult?.success
                    ? `🔄 Requested retake for ${studentName} after backend confirmation.`
                    : `🔄 Requested retake for ${studentName} locally, but backend sync is still pending or failed.`
            );
            modal.remove();
            if (window.refreshCheckpointTable) window.refreshCheckpointTable();
        };
    }

    return {
        loadApprovalsForLevel,
        saveApproval,
        getApprovalStatus,
        getStudentQuizAttempt,
        generateQuizReviewHTML,
        showReviewModal
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = CheckpointApproval;
}
