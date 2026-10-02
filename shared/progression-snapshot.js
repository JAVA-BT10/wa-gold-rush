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

    const CHECKPOINT_FIELD_NAMES = [
        'checkpointStatus',
        'quizScore',
        'quizPassedAt',
        'quizAttempts',
        'approvalStatus',
        'approverName',
        'approvalTimestamp'
    ];

    function parseJsonValue(value) {
        if (value && typeof value === 'object') return value;
        if (typeof value !== 'string' || !value.trim()) return null;
        try {
            const parsed = JSON.parse(value);
            return parsed && typeof parsed === 'object' ? parsed : null;
        } catch (_) {
            return null;
        }
    }

    function unwrapListValue(value) {
        // SharePoint Choice/Lookup columns arrive as { Value: '...' } through Power Automate.
        if (value && typeof value === 'object' && !Array.isArray(value) && 'Value' in value) {
            return value.Value;
        }
        return value;
    }

    function readRecordField(record, name) {
        if (!record || typeof record !== 'object') return undefined;
        const pascal = name.charAt(0).toUpperCase() + name.slice(1);
        const value = typeof record[name] !== 'undefined' ? record[name] : record[pascal];
        return unwrapListValue(value);
    }

    function hasValue(value) {
        return value !== undefined && value !== null && value !== '';
    }

    function normalizeQuizAttempts(value) {
        if (Array.isArray(value)) return value;
        const parsed = parseJsonValue(value);
        return Array.isArray(parsed) ? parsed : [];
    }

    function normalizeQuizScore(value) {
        if (!hasValue(value)) return null;
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : null;
    }

    /**
     * Read per-level checkpoint fields from any progress record shape:
     * game payloads (camelCase), SharePoint/flow rows (PascalCase columns),
     * or the ProgressionMarkersJson snapshot string saved by GGR_SaveProgress.
     */
    function extractCheckpointFields(record = {}, level) {
        const source = record && typeof record === 'object' ? record : {};
        const markers = parseJsonValue(readRecordField(source, 'progressionMarkersJson'))
            || parseJsonValue(source.gameState)
            || {};
        const byLevel = parseJsonValue(readRecordField(source, 'progressionStateByLevel'))
            || parseJsonValue(readRecordField(source, 'progressionStateJson'))
            || parseJsonValue(markers.progressionStateByLevel)
            || {};

        const recordLevel = Number(readRecordField(source, 'level') ?? readRecordField(source, 'assignedLevel') ?? markers.assignedLevel);
        const requestedLevel = Number(level);
        const targetLevel = Number.isFinite(requestedLevel) && requestedLevel > 0 ? requestedLevel : recordLevel;
        const levelKey = Number.isFinite(targetLevel) && targetLevel > 0 ? String(targetLevel) : '';
        const levelState = (levelKey && byLevel[levelKey] && typeof byLevel[levelKey] === 'object') ? byLevel[levelKey] : {};
        const recordMatchesLevel = !levelKey || !Number.isFinite(recordLevel) || String(recordLevel) === levelKey;
        const markersMatchLevel = !levelKey || String(Number(markers.assignedLevel) || '') === levelKey;

        const fields = {};
        CHECKPOINT_FIELD_NAMES.forEach(name => {
            const candidates = [];
            if (recordMatchesLevel) candidates.push(readRecordField(source, name));
            candidates.push(levelState[name]);
            if (markersMatchLevel) candidates.push(markers[name]);
            if (name === 'quizAttempts') {
                const attempts = candidates.map(normalizeQuizAttempts).find(list => list.length > 0);
                fields.quizAttempts = attempts || [];
                return;
            }
            const value = candidates.find(hasValue);
            fields[name] = hasValue(value) ? value : null;
        });
        fields.quizScore = normalizeQuizScore(fields.quizScore);
        fields.checkpointStatus = fields.checkpointStatus ? String(fields.checkpointStatus) : null;
        fields.progressionStateByLevel = byLevel;
        return fields;
    }

    /**
     * Flattened checkpoint fields for GGR_SaveProgress so the Teacher Dashboard can
     * read checkpoint state from GGR_StudentProgress on any device.
     */
    function buildCheckpointPayloadFields(record = {}, level) {
        const fields = extractCheckpointFields(record, level);
        return {
            checkpointStatus: fields.checkpointStatus || '',
            quizScore: fields.quizScore,
            quizPassedAt: fields.quizPassedAt || '',
            quizAttempts: fields.quizAttempts,
            quizAttemptsJson: JSON.stringify(fields.quizAttempts),
            approvalStatus: fields.approvalStatus || '',
            approverName: fields.approverName || '',
            approvalTimestamp: fields.approvalTimestamp || '',
            progressionStateByLevel: fields.progressionStateByLevel,
            progressionStateJson: JSON.stringify(fields.progressionStateByLevel)
        };
    }

    globalObj.WA_GOLD_RUSH_PROGRESS_SNAPSHOT = globalObj.WA_GOLD_RUSH_PROGRESS_SNAPSHOT || {};
    globalObj.WA_GOLD_RUSH_PROGRESS_SNAPSHOT.build = buildProgressionSnapshot;
    globalObj.WA_GOLD_RUSH_PROGRESS_SNAPSHOT.extractCheckpointFields = extractCheckpointFields;
    globalObj.WA_GOLD_RUSH_PROGRESS_SNAPSHOT.buildCheckpointPayloadFields = buildCheckpointPayloadFields;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { buildProgressionSnapshot, extractCheckpointFields, buildCheckpointPayloadFields };
    }
})(typeof globalThis !== 'undefined' ? globalThis : window);
