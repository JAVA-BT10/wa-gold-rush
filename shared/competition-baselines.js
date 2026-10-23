(function initCompetitionBaselines(globalObj) {
    const STATUSES = Object.freeze(['active', 'frozen', 'closed']);
    const HELD_STATUSES = new Set(['held', 'excluded', 'unverified', 'under_review', 'under-review', 'needs_review']);
    const CONFLICT_STATUSES = new Set(['conflict', 'conflicted', 'revision_conflict', 'generation_stale', 'stale_generation', 'unresolved']);

    function unwrap(value) {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            if ('Value' in value) return value.Value;
            if ('value' in value) return value.value;
        }
        return value;
    }

    function text(value) {
        value = unwrap(value);
        return value === null || value === undefined ? '' : String(value).trim();
    }

    function number(value) {
        value = unwrap(value);
        if (!['number', 'string'].includes(typeof value) || text(value) === '') return null;
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }

    function nullableCounter(value) {
        value = unwrap(value);
        if (value === null || value === undefined || value === '') return null;
        const parsed = number(value);
        return Number.isInteger(parsed) && parsed >= 0 ? parsed : NaN;
    }

    function normalizeLevel(value) {
        const parsed = number(value);
        return Number.isInteger(parsed) && parsed >= 2 && parsed <= 5 ? parsed : null;
    }

    function readValue(record, lower, upper) {
        return record?.[lower] ?? record?.[upper];
    }

    function normalizeBaselineRecord(record = {}) {
        const competitionId = text(readValue(record, 'competitionId', 'CompetitionId'));
        const classCode = text(readValue(record, 'classCode', 'ClassCode')).toUpperCase();
        const level = normalizeLevel(readValue(record, 'level', 'Level'));
        const studentCode = text(readValue(record, 'studentCode', 'StudentCode')).toUpperCase();
        const baselineNetWorth = number(readValue(record, 'baselineNetWorth', 'BaselineNetWorth'));
        const baselineRevision = nullableCounter(readValue(record, 'baselineRevision', 'BaselineRevision'));
        const baselineGeneration = nullableCounter(readValue(record, 'baselineGeneration', 'BaselineGeneration'));
        const capturedAt = text(readValue(record, 'baselineCapturedAt', 'BaselineCapturedAt'));
        const status = text(readValue(record, 'status', 'Status')).toLowerCase();

        if (!competitionId || !classCode || level === null || !studentCode) {
            return { ok: false, reason: 'identity_invalid' };
        }
        if (baselineNetWorth === null) return { ok: false, reason: 'baseline_net_worth_invalid' };
        if (Number.isNaN(baselineRevision)) return { ok: false, reason: 'baseline_revision_invalid' };
        if (Number.isNaN(baselineGeneration)) return { ok: false, reason: 'baseline_generation_invalid' };
        if (!capturedAt || !Number.isFinite(Date.parse(capturedAt))) {
            return { ok: false, reason: 'baseline_captured_at_invalid' };
        }
        if (!STATUSES.includes(status)) return { ok: false, reason: 'baseline_status_invalid' };

        return {
            ok: true,
            baseline: Object.freeze({
                competitionId,
                classCode,
                level,
                studentCode,
                baselineNetWorth,
                baselineRevision,
                baselineGeneration,
                baselineCapturedAt: new Date(capturedAt).toISOString(),
                status
            })
        };
    }

    function baselineKey(identity = {}) {
        const competitionId = text(identity.competitionId).toUpperCase();
        const classCode = text(identity.classCode).toUpperCase();
        const level = normalizeLevel(identity.level);
        const studentCode = text(identity.studentCode).toUpperCase();
        if (!competitionId || !classCode || level === null || !studentCode) return '';
        return [
            competitionId,
            classCode,
            level,
            studentCode
        ].join('|');
    }

    function captureCompetitionBaseline({ competitionId, progressRow, baselineCapturedAt } = {}) {
        if (!progressRow || typeof progressRow !== 'object') return { ok: false, reason: 'progress_missing' };
        const statuses = [
            'reviewStatus', 'ReviewStatus', 'leaderboardStatus', 'LeaderboardStatus',
            'saveStatus', 'SaveStatus', 'syncStatus', 'SyncStatus', 'conflictStatus', 'ConflictStatus'
        ].map((key) => text(progressRow[key]).toLowerCase().replace(/[\s-]+/g, '_'));
        if (statuses.some((value) => HELD_STATUSES.has(value))) {
            return { ok: false, reason: 'held_for_review' };
        }
        if (statuses.some((value) => CONFLICT_STATUSES.has(value))
            || progressRow.conflict === true || progressRow.revisionConflict === true || progressRow.generationStale === true) {
            return { ok: false, reason: 'save_conflict' };
        }
        return normalizeBaselineRecord({
            competitionId,
            classCode: readValue(progressRow, 'classCode', 'ClassCode'),
            level: readValue(progressRow, 'level', 'Level'),
            studentCode: readValue(progressRow, 'studentCode', 'StudentCode'),
            baselineNetWorth: readValue(progressRow, 'netWorth', 'NetWorth'),
            baselineRevision: readValue(progressRow, 'revision', 'Revision') ?? readValue(progressRow, 'saveRevision', 'SaveRevision'),
            baselineGeneration: readValue(progressRow, 'runGeneration', 'RunGeneration') ?? readValue(progressRow, 'generation', 'Generation'),
            baselineCapturedAt,
            status: 'active'
        });
    }

    function readCompetitionBaseline(records, identity = {}) {
        const expectedKey = baselineKey(identity);
        if (!expectedKey) return { ok: false, reason: 'identity_invalid' };
        const candidates = (Array.isArray(records) ? records : []).filter((record) =>
            baselineKey({
                competitionId: readValue(record, 'competitionId', 'CompetitionId'),
                classCode: readValue(record, 'classCode', 'ClassCode'),
                level: readValue(record, 'level', 'Level'),
                studentCode: readValue(record, 'studentCode', 'StudentCode')
            }) === expectedKey
        );
        if (!candidates.length) return { ok: true, found: false, baseline: null };
        if (candidates.length > 1) return { ok: false, reason: 'duplicate_baseline' };
        const normalized = normalizeBaselineRecord(candidates[0]);
        if (!normalized.ok) return { ok: false, reason: 'invalid_baseline' };
        return { ok: true, found: true, baseline: normalized.baseline };
    }

    function transitionBaselineStatus(record, nextStatus) {
        const normalized = normalizeBaselineRecord(record);
        if (!normalized.ok) return normalized;
        const next = text(nextStatus).toLowerCase();
        const allowed = normalized.baseline.status === next
            || (normalized.baseline.status === 'active' && ['frozen', 'closed'].includes(next))
            || (normalized.baseline.status === 'frozen' && next === 'closed');
        if (!allowed) return { ok: false, reason: 'invalid_status_transition' };
        return { ok: true, baseline: Object.freeze({ ...normalized.baseline, status: next }) };
    }

    const api = {
        STATUSES,
        baselineKey,
        captureCompetitionBaseline,
        normalizeBaselineRecord,
        readCompetitionBaseline,
        transitionBaselineStatus
    };
    globalObj.WA_GOLD_RUSH_COMPETITION_BASELINES = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
