'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { read, createSessionStorage, buildStudentGameHarness } = require('./support/harness.js');
const { ReferenceSaveServer } = require('./support/reference-save-server.js');
const converter = require('../shared/progress-snapshot-converter.js');

// Pre-Option C label: a full replay of round history. The cumulative
// strategy totals must reproduce it exactly without the history.
function replayStrategyLabel(history) {
    const totals = { safe: 0, medium: 0, deep: 0 };
    history.forEach((round) => (round.results || []).forEach((result) => {
        if (result.digKey in totals) totals[result.digKey] += result.amount || 0;
    }));
    const max = Math.max(totals.safe, totals.medium, totals.deep);
    if (max === 0) return 'No strategy yet';
    if (max === totals.safe) return 'Safe-focused';
    if (max === totals.medium) return 'Balanced-medium';
    return 'High-risk deep';
}

function syntheticRound(round) {
    const digKey = ['safe', 'safe', 'medium', 'deep'][round % 4];
    return {
        round, event: null, totalProfit: (round % 5) - 2, cashAfter: 1000 + round, netWorth: 2000 + round,
        results: [{ mineName: 'Southern Cross', digKey, amount: 10 + (round % 7), profit: (round % 5) - 2,
            success: round % 3 !== 0, details: 'gold'.repeat(100) }]
    };
}

test('Option C: compact cloud resume save restores across devices while local history stays complete', async () => {
    const server = new ReferenceSaveServer();
    const documents = new Map();
    const requests = [];
    async function transport(name, payload, options) {
        requests.push({ name, options });
        assert.equal(options.requireApiKey, true);
        if (name === 'getStudentProgress') {
            const row = server.rows.get(payload.progressKey);
            if (!row) return { success: true, status: 200, data: {
                ok: true, contractVersion: 'ggr.getStudentProgress.v2',
                progressKey: payload.progressKey, found: false
            } };
            // List-backed flow: returns the stored ProgressionMarkersJson text.
            return { success: true, status: 200, data: {
                ok: true, contractVersion: 'ggr.getStudentProgress.v2',
                progressKey: payload.progressKey, found: true, revision: row.revision,
                runGeneration: row.runGeneration, progressionMarkersJson: documents.get(row.lastSaveRequestId)
            } };
        }
        assert.equal(name, 'saveProgress');
        const ack = server.handle(payload);
        if (ack.ok) documents.set(payload.saveRequestId, payload.progressionMarkersJson);
        return { success: true, status: 200, data: ack };
    }

    function device(storage = createSessionStorage()) {
        const h = buildStudentGameHarness({
            storage, stubSync: false,
            extraGlobals: {
                setInterval() { return { unref() {} }; },
                clearInterval() {},
                WA_GOLD_RUSH_RUNTIME_CONFIG: { featureFlags: {
                    saveProtocolV2: true, fullCloudRestore: true, pilotSharedKeyProgress: true
                } },
                WA_GOLD_RUSH_FLOW_ENDPOINTS: {
                    getStudentProgress: 'https://example.invalid/read',
                    saveProgress: 'https://example.invalid/write'
                },
                WA_GOLD_RUSH_POWER_AUTOMATE: { getApiKey: () => 'test-key', callFlow: transport }
            }
        });
        vm.runInContext(read('shared/progress-snapshot-converter.js') + '\n'
            + read('shared/student-progress-auth.js') + '\n'
            + read('shared/sharepoint-sync.js') + '\nthis.sync = SharePointSync;', h.context);
        return h;
    }
    const identity = { classCode: '6B', studentCode: 'SC-1' };
    const plain = (value) => JSON.parse(JSON.stringify(value));

    const first = device();
    await first.context.maybeRestoreLevelFromCloud(first.context.getAuthenticatedStudentSession(), 2);
    const fullHistory = Array.from({ length: 2500 }, (_, i) => syntheticRound(i + 1));
    first.gameState.round = 2501;
    first.gameState.cash = 1234.567;
    first.gameState.roundHistory = plain(fullHistory);
    assert.equal(first.gameState.saveToLocalStorage(), true);
    const expectedLabel = replayStrategyLabel(fullHistory);
    assert.equal(first.context.calculateStrategyLabel(), expectedLabel);
    first.context.realSyncPlayerRecord();
    await first.context.getProgressSaveScheduler().whenIdle();
    const store = first.context.WA_GOLD_RUSH_LEVEL_SAVE_STORE;
    const saved = store.readLevelSave(first.storage, identity, 2);
    assert.equal(saved.envelope.cloud.status, 'synced');
    assert.equal(saved.envelope.snapshot.roundHistory.length, 2500, 'local save keeps the complete history');
    assert.equal(documents.size, 1);
    const uploaded = JSON.parse([...documents.values()][0]);
    assert.ok([...documents.values()][0].length < store.CLOUD_SAVE_MAX_CHARS);
    assert.equal(uploaded.roundHistory.length, 20);
    assert.deepEqual(uploaded.roundHistory.map((r) => r.round), fullHistory.slice(-20).map((r) => r.round));
    assert.deepEqual(plain(uploaded.historyRetention), { mode: 'recent', limit: 20, recordedRounds: 2500, retainedRounds: 20 });
    const expectedMetrics = plain(store.computeMetricsFromHistory(fullHistory));
    assert.deepEqual(plain(uploaded.strategyMetrics), expectedMetrics.strategyMetrics);
    assert.deepEqual(plain(uploaded.roundMetrics), expectedMetrics.roundMetrics);
    assert.equal(uploaded.roundMetrics.roundsRecorded, 2500);

    const second = device();
    const decision = await second.context.maybeRestoreLevelFromCloud(second.context.getAuthenticatedStudentSession(), 2);
    assert.equal(decision.action, 'adopt_cloud');
    assert.equal(second.gameState.round, 2501);
    assert.equal(second.gameState.cash, 1234.567);
    assert.equal(second.gameState.roundHistory.length, 20);
    assert.deepEqual(plain(second.gameState.getSaveMetrics()), expectedMetrics);
    assert.equal(second.context.calculateStrategyLabel(), expectedLabel, 'label identical without full history');

    first.gameState.round = 2502;
    first.gameState.cash = 2345;
    assert.equal(first.gameState.saveToLocalStorage(), true);
    first.context.realSyncPlayerRecord();
    await first.context.getProgressSaveScheduler().whenIdle();
    assert.equal(server.rows.get('6B|SC-1|2').revision, 2);
    assert.equal(store.readLevelSave(first.storage, identity, 2).envelope.cloud.status, 'synced');

    second.gameState.round = 2503;
    second.gameState.cash = 3456;
    assert.equal(second.gameState.saveToLocalStorage(), true);
    second.context.realSyncPlayerRecord();
    await second.context.getProgressSaveScheduler().whenIdle();
    assert.equal(server.rows.get('6B|SC-1|2').revision, 2, 'stale device cannot overwrite the accepted save');
    assert.equal(second.gameState.cash, 3456, 'unacknowledged local progress is preserved');
    assert.equal(second.context.sync.getCloudSaveStatus(), 'cloud save conflict: reload to review');

    // A third device continues from revision 2 and plays one more round.
    const third = device();
    assert.equal((await third.context.maybeRestoreLevelFromCloud(third.context.getAuthenticatedStudentSession(), 2)).action, 'adopt_cloud');
    const nextRound = syntheticRound(2501);
    third.gameState.roundHistory.push(nextRound);
    third.gameState.recordRoundMetrics(nextRound);
    third.gameState.round = 2502;
    third.gameState.cash = 4567;
    assert.equal(third.gameState.saveToLocalStorage(), true);
    third.context.realSyncPlayerRecord();
    await third.context.getProgressSaveScheduler().whenIdle();
    assert.equal(server.rows.get('6B|SC-1|2').revision, 3);

    // The original device reopens: it adopts the newer cloud save but keeps
    // every older round it already held for this run.
    const reopened = device(first.storage);
    assert.equal((await reopened.context.maybeRestoreLevelFromCloud(reopened.context.getAuthenticatedStudentSession(), 2)).action, 'adopt_cloud');
    assert.equal(reopened.gameState.cash, 4567);
    assert.equal(reopened.gameState.roundHistory.length, 2501);
    assert.deepEqual(plain(reopened.gameState.roundHistory), plain([...fullHistory, nextRound]));
    const fullMetrics = plain(store.computeMetricsFromHistory([...fullHistory, nextRound]));
    assert.deepEqual(plain(reopened.gameState.getSaveMetrics()), fullMetrics);
    const local = store.readLevelSave(first.storage, identity, 2).envelope.snapshot;
    assert.equal(local.roundHistory.length, 2501);
    assert.equal(local.historyRetention.mode, 'full');
    assert.equal(requests.filter((request) => request.name === 'saveProgress').length, 4);
});

test('compact cloud saves fail validation when trimmed history lacks cumulative totals', () => {
    const store = require('../shared/level-save-store.js');
    const history = Array.from({ length: 30 }, (_, i) => syntheticRound(i + 1));
    const metrics = store.computeMetricsFromHistory(history);
    const cloud = store.buildCloudHistory(history, metrics);
    assert.equal(cloud.roundHistory.length, 20);
    assert.equal(history.length, 30, 'source history is never shortened');
    const snapshot = {
        level: 2, round: 31, cash: 10, player: { classCode: '6B', studentCode: 'SC-1', companyName: '' },
        progression: {}, ownedMines: {}, machinery: [], investmentPlans: {}, totalProfitLoss: 0,
        roundHistory: cloud.roundHistory, historyRetention: cloud.historyRetention
    };
    assert.equal(store.validateSnapshot(snapshot), 'snapshot_history_metrics_missing');
    assert.equal(store.validateSnapshot({ ...snapshot, ...metrics }), '');
    assert.equal(store.validateSnapshot({ ...snapshot, ...metrics, eventJournal: Array.from({ length: 201 }, () => ({ eventType: 'major_decision' })) }),
        'snapshot_event_journal_invalid');
    assert.equal(store.validateSnapshot({ ...snapshot, ...metrics, eventJournal: [{ eventType: 'major_decision', year: '1893' }],
        timelinePosition: { year: 1893 }, assessmentEvidence: {} }), '');
    assert.equal(store.strategyLabelFromMetrics(metrics.strategyMetrics), replayStrategyLabel(history));
    const roundMetrics = metrics.roundMetrics;
    assert.equal(roundMetrics.profitableRounds + roundMetrics.lossRounds + roundMetrics.breakEvenRounds, 30);
    assert.equal(roundMetrics.largestProfit, 2);
    assert.equal(roundMetrics.largestLoss, 2);
});
