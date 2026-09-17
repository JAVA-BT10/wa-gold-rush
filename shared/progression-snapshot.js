(function initProgressionSnapshot(globalObj) {
    function buildProgressionSnapshot(input = {}) {
        return {
            schemaVersion: Number(input.schemaVersion) || 1,
            savedAt: String(input.savedAt || new Date().toISOString()),
            assignedLevel: Number(input.assignedLevel) || 0,
            round: Number(input.round) || 1,
            cash: Number(input.cash) || 0,
            netWorth: Number(input.netWorth) || 0,
            player: input.player || {},
            companyName: String(input.companyName || ''),
            ownedMines: input.ownedMines || {},
            machinery: Array.isArray(input.machinery) ? input.machinery : [],
            roundHistory: Array.isArray(input.roundHistory) ? input.roundHistory : [],
            totalProfitLoss: Number(input.totalProfitLoss) || 0,
            investmentPlans: input.investmentPlans || {},
            investmentProfile: input.investmentProfile || null,
            strategyLabel: String(input.strategyLabel || ''),
            checkpointStatus: input.checkpointStatus || null,
            quizScore: input.quizScore ?? null,
            quizPassedAt: input.quizPassedAt || null,
            quizAttempts: Array.isArray(input.quizAttempts) ? input.quizAttempts : [],
            approvalStatus: input.approvalStatus || null,
            approverName: input.approverName || null,
            approvalTimestamp: input.approvalTimestamp || null,
            progressionStateByLevel: input.progressionStateByLevel || {}
        };
    }

    globalObj.WA_GOLD_RUSH_PROGRESS_SNAPSHOT = globalObj.WA_GOLD_RUSH_PROGRESS_SNAPSHOT || {};
    globalObj.WA_GOLD_RUSH_PROGRESS_SNAPSHOT.build = buildProgressionSnapshot;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { buildProgressionSnapshot };
    }
})(typeof globalThis !== 'undefined' ? globalThis : window);
