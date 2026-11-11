'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { read, createSessionStorage, buildStudentGameHarness } = require('./support/harness.js');
const { ReferenceSaveServer } = require('./support/reference-save-server.js');
const converter = require('../shared/progress-snapshot-converter.js');

test('shared-key conditional save and restore round-trips a large game between isolated devices', async () => {
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
            const raw = documents.get(row.lastSaveRequestId);
            const converted = converter.convertLegacySnapshot(raw, {
                identity: { classCode: payload.classCode, studentCode: payload.studentCode }, level: payload.level
            });
            assert.equal(converted.ok, true, converted.reason);
            return { success: true, status: 200, data: {
                ok: true, contractVersion: 'ggr.getStudentProgress.v2',
                progressKey: payload.progressKey, found: true, revision: row.revision,
                runGeneration: row.runGeneration, save: converted.envelope
            } };
        }
        assert.equal(name, 'saveProgress');
        const ack = server.handle(payload);
        if (ack.ok) documents.set(payload.saveRequestId, payload.progressionMarkersJson);
        return { success: true, status: 200, data: ack };
    }

    function device() {
        const h = buildStudentGameHarness({
            storage: createSessionStorage(), stubSync: false,
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
        vm.runInContext(read('shared/student-progress-auth.js') + '\n'
            + read('shared/sharepoint-sync.js') + '\nthis.sync = SharePointSync;', h.context);
        return h;
    }

    const first = device();
    await first.context.maybeRestoreLevelFromCloud(first.context.getAuthenticatedStudentSession(), 2);
    first.gameState.round = 2501;
    first.gameState.cash = 1234.567;
    first.gameState.roundHistory = Array.from({ length: 2500 }, (_, i) => ({
        round: i + 1, totalProfit: i % 2, results: [{ mineName: 'Southern Cross', details: 'gold'.repeat(100) }]
    }));
    assert.equal(first.gameState.saveToLocalStorage(), true);
    first.context.realSyncPlayerRecord();
    await first.context.getProgressSaveScheduler().whenIdle();
    const saved = first.context.WA_GOLD_RUSH_LEVEL_SAVE_STORE.readLevelSave(
        first.storage, { classCode: '6B', studentCode: 'SC-1' }, 2
    );
    assert.equal(saved.envelope.cloud.status, 'synced');
    assert.equal(documents.size, 1);
    assert.ok([...documents.values()][0].length > 1000000);

    const second = device();
    const decision = await second.context.maybeRestoreLevelFromCloud(second.context.getAuthenticatedStudentSession(), 2);
    assert.equal(decision.action, 'adopt_cloud');
    assert.equal(second.gameState.round, 2501);
    assert.equal(second.gameState.cash, 1234.567);
    assert.equal(second.gameState.roundHistory.length, 2500);
    assert.deepEqual(JSON.parse(JSON.stringify(second.gameState.roundHistory)), JSON.parse(JSON.stringify(first.gameState.roundHistory)));
    assert.equal(requests.filter(request => request.name === 'saveProgress').length, 1);

    first.gameState.round = 2502;
    first.gameState.cash = 2345;
    assert.equal(first.gameState.saveToLocalStorage(), true);
    first.context.realSyncPlayerRecord();
    await first.context.getProgressSaveScheduler().whenIdle();
    assert.equal(server.rows.get('6B|SC-1|2').revision, 2);

    second.gameState.round = 2503;
    second.gameState.cash = 3456;
    assert.equal(second.gameState.saveToLocalStorage(), true);
    second.context.realSyncPlayerRecord();
    await second.context.getProgressSaveScheduler().whenIdle();
    assert.equal(server.rows.get('6B|SC-1|2').revision, 2, 'stale device cannot overwrite the accepted save');
    assert.equal(second.gameState.cash, 3456, 'unacknowledged local progress is preserved');
    assert.equal(second.context.sync.getCloudSaveStatus(), 'cloud save conflict: reload to review');
});
