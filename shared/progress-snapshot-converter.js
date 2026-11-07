/**
 * Explicit, pure conversion of raw progression snapshot schema 2 to an envelope.
 *
 * convertLegacySnapshot(rawJson, {identity,level}) -> {ok,envelope,rawBackup,losses,
 * requiresOperatorConfigCheck:true}
 * or {ok:false,reason,rawBackup}. The caller MUST archive rawBackup externally
 * before adopting/replacing anything. This module never writes storage.
 * Unknown shapes/fields and contradictory identity, level or checkpoint evidence
 * fail closed. Existing run identity is required; baseline stays unknown (null)
 * when absent and cloud revision is unknown, never inferred from economy/time.
 * Known roster PII and teacher names are omitted explicitly in losses and remain
 * in rawBackup. Approval state/timestamps are retained; names are not authority.
 * This is an operator preflight, NOT automatic migration/deployment approval:
 * mine/machinery/config values and reported net worth still require an external
 * consistency check against the correct historical level configuration.
 * createdAt is omitted because savedAt cannot establish a run creation time.
 */
(function initProgressSnapshotConverter(globalObj) {
    const FIELDS = new Set([
        'schemaVersion', 'savedAt', 'assignedLevel', 'currentLevel', 'rosterAssignedLevel',
        'round', 'cash', 'netWorth', 'player', 'companyName', 'ownedMines', 'machinery',
        'roundHistory', 'totalProfitLoss', 'investmentPlans', 'investmentProfile',
        'strategyLabel', 'checkpointStatus', 'quizScore', 'quizPassedAt', 'quizAttempts',
        'approvalStatus', 'approverName', 'approvalTimestamp', 'progressionStateByLevel', 'run'
    ]);
    const CHECKPOINTS = [
        'checkpointStatus', 'quizScore', 'quizPassedAt', 'quizAttempts',
        'approvalStatus', 'approverName', 'approvalTimestamp'
    ];
    const BUCKETS = ['highRisk', 'lowRisk', 'profitChasing', 'assetBuilding', 'futureProofing'];
    const object = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
    const unknownKeys = (value, allowed) => Object.keys(value).some((key) => !allowed.has(key));
    const finiteJson = (value) => typeof value === 'number' ? Number.isFinite(value)
        : !value || typeof value !== 'object' || Object.values(value).every(finiteJson);

    function hasDuplicateKeys(rawJson) {
        // JSON.parse has already validated syntax; scan keys before accepting its
        // last-key-wins result, including escaped aliases and nested asset data.
        const tokens = rawJson.match(/"(?:\\.|[^"\\])*"|[{}\[\]:,]/g) || [];
        const stack = [];
        for (let index = 0; index < tokens.length; index += 1) {
            const token = tokens[index];
            if (token === '{') stack.push(new Set());
            else if (token === '[') stack.push(null);
            else if (token === '}' || token === ']') stack.pop();
            else if (token[0] === '"' && tokens[index + 1] === ':') {
                const keys = stack[stack.length - 1];
                const key = JSON.parse(token);
                if (keys.has(key)) return true;
                keys.add(key);
            }
        }
        return false;
    }

    function convertLegacySnapshot(rawJson, expected = {}) {
        const fail = (reason) => ({ ok: false, reason, rawBackup: rawJson });
        let store = globalObj.WA_GOLD_RUSH_LEVEL_SAVE_STORE;
        if (!store && typeof require === 'function') store = require('./level-save-store.js');
        if (!store) return fail('save_store_unavailable');
        if (typeof rawJson !== 'string') return fail('raw_json_required');
        let source;
        try { source = JSON.parse(rawJson); } catch (_) { return fail('malformed_json'); }
        if (!object(source) || source.schemaVersion !== 2) return fail('unsupported_snapshot');
        try {
            if (!finiteJson(source)) return fail('non_finite_json');
            if (hasDuplicateKeys(rawJson)) return fail('duplicate_json_keys');
        } catch (_) {
            return fail('unrepresentable_json');
        }
        if (unknownKeys(source, FIELDS)) return fail('unknown_snapshot_fields');
        const identity = store.normalizeIdentity(expected.identity);
        const level = store.normalizeSaveLevel(expected.level);
        if (!identity || level === null) return fail('expected_slot_required');
        const owner = store.normalizeIdentity(source.player);
        if (!owner || owner.classCode !== identity.classCode || owner.studentCode !== identity.studentCode) {
            return fail('owner_mismatch');
        }
        if (unknownKeys(source.player, new Set(['classCode', 'studentCode', 'leaderboardName', 'studentId', 'studentName']))) {
            return fail('unknown_player_fields');
        }
        if (['leaderboardName', 'studentId', 'studentName'].some((key) => key in source.player && typeof source.player[key] !== 'string')) {
            return fail('player_fields_invalid');
        }
        if (source.assignedLevel !== level || source.currentLevel !== level) return fail('level_mismatch');
        if (typeof source.savedAt !== 'string' || !Number.isFinite(Date.parse(source.savedAt))) return fail('saved_at_invalid');
        if (typeof source.companyName !== 'string' || typeof source.strategyLabel !== 'string'
            || typeof source.netWorth !== 'number' || !Number.isFinite(source.netWorth)) return fail('metadata_invalid');
        if (source.rosterAssignedLevel !== null
            && (!Number.isInteger(source.rosterAssignedLevel) || source.rosterAssignedLevel < 1 || source.rosterAssignedLevel > 5)) {
            return fail('roster_level_invalid');
        }
        const run = source.run;
        if (!object(run) || unknownKeys(run, new Set(['generation', 'runId', 'startingNetWorth', 'storageSchemaVersion']))
            || !Number.isInteger(run.generation) || run.generation < 1
            || typeof run.runId !== 'string' || !run.runId.trim()
            || run.storageSchemaVersion !== store.STORAGE_SCHEMA_VERSION) return fail('run_metadata_required');
        if (run.startingNetWorth !== undefined && run.startingNetWorth !== null
            && (typeof run.startingNetWorth !== 'number' || !Number.isFinite(run.startingNetWorth))) {
            return fail('baseline_invalid');
        }
        const profile = source.investmentProfile;
        if (profile !== null && (!object(profile) || unknownKeys(profile, new Set(BUCKETS))
            || BUCKETS.some((key) => typeof profile[key] !== 'number' || !Number.isFinite(profile[key]) || profile[key] < 0))) {
            return fail('investment_profile_invalid');
        }
        if (!object(source.progressionStateByLevel)
            || Object.entries(source.progressionStateByLevel).some(([key, value]) => !/^[1-5]$/.test(key) || !object(value))) {
            return fail('progression_invalid');
        }
        const progression = store.clone(source.progressionStateByLevel[String(level)] || {});
        for (const key of CHECKPOINTS) {
            if (!(key in source)) return fail('checkpoint_fields_missing');
            if (key in progression && store.canonicalJson(progression[key]) !== store.canonicalJson(source[key])) {
                return fail('checkpoint_ambiguous');
            }
            progression[key] = store.clone(source[key]);
        }
        if (!Array.isArray(source.quizAttempts)) return fail('quiz_attempts_invalid');
        const snapshot = store.clone(source);
        const losses = [];
        for (const key of ['studentId', 'studentName']) {
            if (key in snapshot.player) losses.push(`player.${key}`);
            delete snapshot.player[key];
        }
        snapshot.level = level;
        snapshot.player.companyName = source.companyName;
        snapshot.progression = progression;
        const omitTeacherName = (record, path) => {
            if ('approverName' in record) {
                losses.push(`${path}approverName`);
                delete record.approverName;
            }
        };
        omitTeacherName(snapshot, '');
        Object.entries(snapshot.progressionStateByLevel).forEach(([key, evidence]) => {
            omitTeacherName(evidence, `progressionStateByLevel.${key}.`);
        });
        omitTeacherName(snapshot.progression, 'progression.');
        const envelope = {
            kind: store.ENVELOPE_KIND,
            storageSchemaVersion: store.STORAGE_SCHEMA_VERSION,
            owner: identity,
            level,
            progressKey: store.buildProgressKey(identity, level),
            generation: run.generation,
            runId: run.runId,
            startingNetWorth: run.startingNetWorth ?? null,
            savedAt: source.savedAt,
            cloud: { status: 'unknown', revision: null },
            snapshot
        };
        const validation = store.validateEnvelope(envelope, { identity, level });
        if (!validation.ok) return fail(validation.reason);
        return {
            ok: true, envelope: store.deepFreeze(envelope), rawBackup: rawJson, losses,
            requiresOperatorConfigCheck: true
        };
    }

    const api = { convertLegacySnapshot };
    globalObj.WA_GOLD_RUSH_PROGRESS_SNAPSHOT_CONVERTER = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
