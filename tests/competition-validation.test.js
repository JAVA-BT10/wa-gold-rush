const test = require('node:test');
const assert = require('node:assert/strict');
const baselines = require('../shared/competition-baselines.js');
const snapshot = require('../shared/competition-snapshot.js');
const caps = require('../shared/level-capabilities.js');
const leaderboard = require('../shared/leaderboard.js');

const progressRow = { classCode: '6B', studentCode: 'SC-1', level: 2, netWorth: 300 };
function capture(overrides = {}) {
    return baselines.captureCompetitionBaseline({
        competitionId: 'term-1',
        progressRow: { ...progressRow, ...overrides },
        baselineCapturedAt: '2026-10-22T12:00:00.000Z'
    });
}

test('baseline capture unwraps SharePoint choices and blocks every supported review/sync/conflict marker', () => {
    for (const field of ['reviewStatus', 'ReviewStatus', 'leaderboardStatus', 'LeaderboardStatus',
        'saveStatus', 'SaveStatus', 'syncStatus', 'SyncStatus', 'conflictStatus', 'ConflictStatus']) {
        for (const wrapper of [(value) => value, (Value) => ({ Value }), (value) => ({ value })]) {
            for (const held of ['held', 'excluded', 'unverified', 'Under Review', 'needs-review']) {
                assert.equal(capture({ [field]: wrapper(held) }).reason, 'held_for_review', `${field}: ${held}`);
            }
            for (const conflict of ['conflict', 'conflicted', 'revision_conflict', 'generation_stale',
                'stale_generation', 'unresolved']) {
                assert.equal(capture({ [field]: wrapper(conflict) }).reason, 'save_conflict', `${field}: ${conflict}`);
            }
        }
    }
    for (const field of ['conflict', 'revisionConflict', 'generationStale']) {
        assert.equal(capture({ [field]: true }).reason, 'save_conflict', field);
    }
    assert.equal(capture({ reviewStatus: 'active', ReviewStatus: { Value: 'held' } }).ok, false);
    const wrapped = capture({
        classCode: { Value: '6B' }, studentCode: { value: 'SC-1' },
        level: { Value: 2 }, netWorth: { value: 300 }
    });
    assert.equal(wrapped.ok, true);
    assert.equal(wrapped.baseline.baselineNetWorth, 300);
});

async function snapshotResponse(counts) {
    const root = {
        WA_GOLD_RUSH_LEVEL_CAPABILITIES: caps,
        WA_GOLD_RUSH_RUNTIME_CONFIG: { featureFlags: { competitionBaselines: true } },
        WA_GOLD_RUSH_FLOW_ENDPOINTS: { copyCompetitionSnapshot: 'https://example.test/competition' }
    };
    return snapshot.requestCompetitionSnapshot('capture_baseline', {
        competitionId: 'term-1', classCodes: ['6B'], level: 2
    }, {
        root,
        callFlow: async () => ({
            success: true,
            data: {
                ok: true, contractVersion: snapshot.CONTRACT_VERSION,
                operation: 'capture_baseline', status: 'active',
                competitionId: 'term-1', level: 2, ...counts
            }
        })
    });
}

test('snapshot validates the raw selected count and never masks malformed primary counts', async () => {
    for (const invalid of ['', ' ', false, true, [], null, undefined, {}, -1, 0.5]) {
        assert.equal((await snapshotResponse({ recordCount: invalid, recordsCaptured: 5 })).reason,
            'invalid_response', `primary: ${String(invalid)}`);
        assert.equal((await snapshotResponse({ recordsCaptured: invalid })).reason,
            'invalid_response', `fallback: ${String(invalid)}`);
    }
    for (const counts of [{ recordCount: 0 }, { recordsCaptured: 0 }, { recordCount: '0' }]) {
        const result = await snapshotResponse(counts);
        assert.equal(result.ok, true);
        assert.equal(result.recordCount, 0);
    }
});

test('competition ranking excludes the sync stale-generation marker as well as baseline capture', () => {
    const previous = global.WA_GOLD_RUSH_RUNTIME_CONFIG;
    global.WA_GOLD_RUSH_RUNTIME_CONFIG = {
        featureFlags: { competitionBaselines: true, competitionLeaderboardMetric: true }
    };
    try {
        const baseline = {
            ...capture().baseline, baselineRevision: 1, baselineGeneration: 1
        };
        for (const marker of ['generation_stale', 'stale_generation']) {
            const result = leaderboard.buildLevelLeaderboard({
                students: [{ ...progressRow, leaderboardName: 'Gold Miner', active: true }],
                progress: [{
                    ...progressRow, round: 2, revision: 1, runGeneration: 1,
                    SyncStatus: { Value: marker }
                }],
                level: 2, metric: 'competitionProfit', competitionId: 'term-1',
                competitionBaselines: [baseline]
            });
            assert.equal(result.entries.length, 0, marker);
            assert.equal(result.unrankable.save_conflict, 1, marker);
        }
    } finally {
        if (previous === undefined) delete global.WA_GOLD_RUSH_RUNTIME_CONFIG;
        else global.WA_GOLD_RUSH_RUNTIME_CONFIG = previous;
    }
});
