/**
 * Executable client contract vectors, not evidence of deployed flow behaviour.
 * Proof stubs are generated per process, never embedded credentials.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const store = require('../shared/level-save-store.js');
const snapshotApi = require('../shared/progression-snapshot.js');
const converter = require('../shared/progress-snapshot-converter.js');
const auth = require('../shared/student-progress-auth.js');
const restore = require('../shared/cloud-restore.js');
const protocol = require('../shared/save-protocol.js');
const { createSessionStorage, setSession, buildStudentGameHarness } = require('./support/harness.js');
const { ReferenceSaveServer } = require('./support/reference-save-server.js');

const ID = Object.freeze({ classCode: '6B', studentCode: 'SC-1' });
const SLOT = Object.freeze({ identity: ID, level: 2, progressKey: '6B|SC-1|2' });
const ephemeralProof = crypto.randomBytes(24).toString('base64url');
const testAuthorization = () => ['Bearer', ephemeralProof].join(' ');

function modelRequest(overrides = {}) {
    return {
        protocolVersion: 2, saveRequestId: 'model-a', progressKey: SLOT.progressKey,
        runGeneration: 1, runId: 'model-run', baseRevision: null,
        contentHash: 'advisory-test-fingerprint', currentCash: 20,
        gameState: { round: 94, cash: 20, machinery: [{ id: 'cradle', purchasePrice: 250 }] },
        ...overrides
    };
}

test('reference model binds exact canonical immutable content/base/run, not advisory hash or length', () => {
    const server = new ReferenceSaveServer();
    const original = modelRequest();
    assert.equal(server.handle(original).revision, 1);
    for (const alteration of [
        { currentCash: 21 },
        { gameState: { ...original.gameState, cash: 21 } },
        { baseRevision: 1 },
        { runId: 'other-run' },
        { runGeneration: 2 },
        { progressKey: '6C|SC-1|2' }
    ]) {
        const request = { ...original, ...alteration };
        assert.equal(request.contentHash, original.contentHash);
        assert.equal(server.handle(request).code, 'request_id_reused');
    }
    const equivalent = {
        ...original, contentHash: 'different-advisory-fingerprint',
        clientVersion: 'new-client', clientTimestampUtc: '2026-03-04T05:06:07.000Z',
        gameState: { machinery: original.gameState.machinery, cash: 20, round: 94 }
    };
    const retry = server.handle(equivalent);
    assert.equal(retry.deduplicated, true);
    assert.equal(retry.revision, 1);
    assert.equal(server.rows.get(SLOT.progressKey).revision, 1);
    assert.equal(server.rows.has('6C|SC-1|2'), false);
});

test('reference model row-atomic recent requests recover lost A response original revision after B commits', async () => {
    const server = new ReferenceSaveServer();
    const a = modelRequest();
    let dropA = true;
    const transport = server.transport({
        dropResponse: (request) => {
            if (request.saveRequestId !== a.saveRequestId || !dropA) return false;
            dropA = false;
            return true;
        }
    });
    server.failNextReceiptWrite = true;
    assert.equal((await transport('saveProgress', a)).networkError, true);
    assert.equal(server.receipts.has(a.saveRequestId), false);
    assert.equal(server.rows.get(SLOT.progressKey).recentRequests[0].response.revision, 1);
    assert.equal(server.handle({ ...a, progressKey: '6C|SC-1|2' }).code, 'request_id_reused');
    assert.equal(server.handle({ ...a, baseRevision: 1 }).code, 'request_id_reused');
    assert.equal(server.handle({ ...a, currentCash: 21 }).code, 'request_id_reused');
    const b = modelRequest({ saveRequestId: 'model-b', baseRevision: 1, currentCash: 30 });
    assert.equal((await transport('saveProgress', b)).data.revision, 2);
    const retry = (await transport('saveProgress', a)).data;
    assert.equal(retry.ok, true);
    assert.equal(retry.deduplicated, true);
    assert.equal(retry.revision, 1);
    assert.equal(server.receipts.get(a.saveRequestId).response.revision, 1);
    assert.equal(server.rows.get(SLOT.progressKey).revision, 2);
    assert.equal(server.rows.get(SLOT.progressKey).payload.currentCash, 30);
});

test('reference model bounded ring blocks eviction/reset of an unreceipted original until repaired', () => {
    const server = new ReferenceSaveServer({ recentRequestLimit: 2 });
    const a = modelRequest();
    server.failNextReceiptWrite = true;
    assert.throws(() => server.handle(a), /simulated crash/);
    assert.equal(server.handle(modelRequest({ saveRequestId: 'model-b', baseRevision: 1 })).revision, 2);
    const before = store.canonicalJson(server.rows.get(SLOT.progressKey));
    const c = modelRequest({ saveRequestId: 'model-c', baseRevision: 2, currentCash: 40 });
    assert.equal(server.handle(c).code, 'receipt_repair_required');
    assert.equal(store.canonicalJson(server.rows.get(SLOT.progressKey)), before);
    assert.throws(() => server.reset(SLOT.progressKey), { code: 'receipt_repair_required' });
    assert.equal(server.currentGeneration(SLOT.progressKey), 1);
    assert.equal(server.handle(a).revision, 1, 'retry repairs the durable original receipt');
    assert.equal(server.handle(c).revision, 3);
    assert.deepEqual(server.rows.get(SLOT.progressKey).recentRequests.map((entry) => entry.saveRequestId), ['model-b', 'model-c']);
    assert.equal(server.handle(a).revision, 1, 'evicted row entry remains available in the durable store');
    assert.equal(server.rows.get(SLOT.progressKey).revision, 3);
});

test('reference model receipt capacity never silently prunes a durable original', () => {
    const server = new ReferenceSaveServer({ receiptRetentionLimit: 1, recentRequestLimit: 1 });
    const a = modelRequest();
    assert.equal(server.handle(a).revision, 1);
    const b = modelRequest({ saveRequestId: 'model-b', baseRevision: 1, currentCash: 30 });
    assert.throws(() => server.handle(b), { code: 'receipt_capacity' });
    assert.equal(server.receipts.has(a.saveRequestId), true);
    assert.equal(server.receipts.has(b.saveRequestId), false);
    assert.equal(server.rows.get(SLOT.progressKey).revision, 2);
    assert.equal(server.handle(modelRequest({ saveRequestId: 'model-c', baseRevision: 2 })).code, 'receipt_repair_required');
    assert.equal(server.handle(a).revision, 1);
    server.receiptRetentionLimit = 2;
    assert.equal(server.handle(b).revision, 2);
    assert.equal(server.receipts.has(b.saveRequestId), true);
    assert.equal(server.rows.get(SLOT.progressKey).revision, 2);
});

function rawSnapshot(overrides = {}) {
    return snapshotApi.buildProgressionSnapshot({
        schemaVersion: 2, savedAt: '2026-01-02T03:04:05.000Z',
        assignedLevel: 2, currentLevel: 2, rosterAssignedLevel: 4,
        round: 94, cash: 109.11399999999995, netWorth: 396.1139999999999,
        player: { ...ID, leaderboardName: 'Miner', studentId: 'roster-example', studentName: 'Example Student' },
        companyName: 'Example Mining',
        ownedMines: { southern_cross: { id: 'southern_cross', owned: true, purchasePrice: 0, upgrades: [] } },
        machinery: [{ id: 'cradle', purchasePrice: 250, purchaseRound: 6 }],
        roundHistory: [{ round: 93, totalProfit: -10, revenue: 20 }],
        totalProfitLoss: 75, investmentPlans: { '94': { mine: 'southern_cross', amount: 25 } },
        investmentProfile: { highRisk: 2, lowRisk: 3, profitChasing: 0, assetBuilding: 7, futureProofing: 1 },
        strategyLabel: 'Asset Building',
        run: { generation: 3, runId: 'existing-run', startingNetWorth: null, storageSchemaVersion: 1 },
        ...overrides
    });
}

function convertedEnvelope() {
    const converted = converter.convertLegacySnapshot(JSON.stringify(rawSnapshot()), SLOT);
    assert.equal(converted.ok, true, converted.reason);
    return converted.envelope;
}

test('explicit conversion preserves economy, profile, history and existing run with exact external backup', () => {
    const raw = ` ${JSON.stringify(rawSnapshot(), null, 2)}\n`;
    const converted = converter.convertLegacySnapshot(raw, SLOT);
    assert.equal(converted.ok, true, converted.reason);
    assert.equal(converted.rawBackup, raw);
    const envelope = converted.envelope;
    const source = JSON.parse(raw);
    assert.equal(store.validateEnvelope(envelope, SLOT).ok, true);
    for (const key of ['ownedMines', 'machinery', 'roundHistory', 'investmentPlans', 'investmentProfile']) {
        assert.deepEqual(envelope.snapshot[key], source[key]);
    }
    assert.equal(envelope.runId, source.run.runId);
    assert.equal(envelope.generation, source.run.generation);
    assert.equal(envelope.startingNetWorth, null);
    assert.equal(envelope.cloud.revision, null);
    assert.equal(envelope.cloud.status, 'unknown');
    assert.equal(envelope.savedAt, source.savedAt);
    assert.equal(envelope.snapshot.round, 94);
    assert.equal(envelope.snapshot.cash, 109.11399999999995);
    // Historical reported value is preserved, not certified against today's config.
    assert.equal(envelope.snapshot.netWorth, 396.1139999999999);
    assert.deepEqual(envelope.snapshot.machinery, [{ id: 'cradle', purchasePrice: 250, purchaseRound: 6 }]);
    assert.equal('createdAt' in envelope, false, 'a save timestamp does not prove a run creation timestamp');
    assert.equal(envelope.snapshot.player.companyName, source.companyName);
    assert.deepEqual(converted.losses, ['player.studentId', 'player.studentName', 'approverName', 'progression.approverName']);
    assert.equal(converted.requiresOperatorConfigCheck, true);
    assert.equal('studentId' in envelope.snapshot.player, false);
    assert.equal('studentName' in envelope.snapshot.player, false);
    assert.equal(Object.isFrozen(envelope.snapshot.investmentProfile), true);
});

test('conversion explicitly removes private teacher names while retaining approval evidence', () => {
    const approval = {
        checkpointStatus: 'quiz_passed', quizScore: 90, quizPassedAt: '2026-01-01T10:00:00.000Z',
        quizAttempts: [{ score: 90 }], approvalStatus: 'approved',
        approverName: 'Private Teacher', approvalTimestamp: '2026-01-01T11:00:00.000Z'
    };
    const otherApproval = { ...approval, approverName: 'Other Private Teacher' };
    const source = rawSnapshot({ ...approval, progressionStateByLevel: { '2': approval, '3': otherApproval } });
    const raw = JSON.stringify(source);
    const result = converter.convertLegacySnapshot(raw, SLOT);
    assert.equal(result.ok, true, result.reason);
    assert.equal(result.rawBackup, raw);
    const snapshot = result.envelope.snapshot;
    for (const evidence of [snapshot, snapshot.progression, ...Object.values(snapshot.progressionStateByLevel)]) {
        assert.equal('approverName' in evidence, false);
        assert.equal(evidence.approvalStatus, 'approved');
        assert.equal(evidence.approvalTimestamp, approval.approvalTimestamp);
        assert.equal(evidence.checkpointStatus, 'quiz_passed');
        assert.equal(evidence.quizScore, 90);
    }
    assert.equal(JSON.stringify(result.envelope).includes('Private Teacher'), false);
    for (const path of ['approverName', 'progression.approverName', 'progressionStateByLevel.2.approverName', 'progressionStateByLevel.3.approverName']) {
        assert.equal(result.losses.includes(path), true, path);
    }
});

test('conversion never creates run identity or baseline from current net worth', () => {
    const missingRun = rawSnapshot();
    delete missingRun.run;
    assert.equal(converter.convertLegacySnapshot(JSON.stringify(missingRun), SLOT).reason, 'run_metadata_required');
    const missingBaseline = rawSnapshot();
    delete missingBaseline.run.startingNetWorth;
    const converted = converter.convertLegacySnapshot(JSON.stringify(missingBaseline), SLOT);
    assert.equal(converted.ok, true);
    assert.equal(converted.envelope.startingNetWorth, null);
    const knownBaseline = rawSnapshot();
    knownBaseline.run.startingNetWorth = 300;
    assert.equal(converter.convertLegacySnapshot(JSON.stringify(knownBaseline), SLOT).envelope.startingNetWorth, 300);
});

test('converted profile survives real game load, new actions, save and a second device', () => {
    const raw = JSON.stringify(rawSnapshot());
    const source = JSON.parse(raw);
    const assertGameEconomy = (state) => {
        const snapshot = store.clone(state.captureLevelSnapshot());
        assert.equal(snapshot.round, source.round);
        assert.equal(snapshot.cash, source.cash);
        assert.equal(snapshot.player.companyName, source.companyName);
        for (const key of ['ownedMines', 'machinery', 'roundHistory', 'investmentPlans', 'totalProfitLoss']) {
            assert.deepEqual(snapshot[key], source[key], key);
        }
        assert.equal(state.activeRun.runId, source.run.runId);
        assert.equal(state.activeRun.generation, source.run.generation);
    };
    const converted = converter.convertLegacySnapshot(raw, SLOT);
    const cloud = restore.interpretResponse({
        success: true, status: 200,
        data: {
            contractVersion: restore.CONTRACT_VERSION, ok: true, found: true,
            progressKey: SLOT.progressKey, revision: 4, runGeneration: 3, save: converted.envelope
        }
    }, SLOT);
    assert.equal(cloud.status, 'found');
    assert.equal(cloud.envelope.snapshot.netWorth, source.netWorth);
    const device = createSessionStorage();
    device.setItem('explicit-conversion-backup', converted.rawBackup);
    assert.equal(restore.adoptCloudSave(device, cloud).ok, true);
    const adoptedRun = JSON.parse(device.getItem(store.buildLedgerKey(ID))).levelRuns['2'];
    assert.equal('startedAt' in adoptedRun, false, 'journal adoption preserves unknown creation time as absent');
    assert.equal(device.getItem(`${store.buildSaveKey(ID, 2)}|adoption`), null);
    const game = buildStudentGameHarness({ level: 2, storage: device });
    assert.equal(game.loadResult.status, 'resumed');
    assertGameEconomy(game.gameState);
    assert.deepEqual(store.clone(game.gameState.captureLevelSnapshot().investmentProfile), rawSnapshot().investmentProfile);
    assert.equal(game.gameState.activeRun.runId, 'existing-run');
    game.gameState.recordInvestmentAction('assetBuilding', 4);
    assert.equal(game.gameState.saveToLocalStorage(), true);
    const saved = store.readLevelSave(device, ID, 2).envelope;
    assert.equal(saved.snapshot.cash, source.cash);
    assert.equal(saved.snapshot.player.companyName, source.companyName);
    assert.equal(saved.snapshot.investmentProfile.assetBuilding, 11);
    assert.equal(saved.snapshot.investmentProfile.highRisk, 2);
    assert.equal(saved.snapshot.roundHistory.length, 1);
    assert.equal(saved.runId, 'existing-run');
    const nextDevice = createSessionStorage();
    assert.equal(store.adoptLevelRun(nextDevice, saved), true);
    assert.equal(store.writeLevelSave(nextDevice, saved, SLOT).ok, true);
    const next = buildStudentGameHarness({ level: 2, storage: nextDevice });
    assert.equal(next.loadResult.status, 'resumed');
    assertGameEconomy(next.gameState);
    assert.deepEqual(store.clone(next.gameState.captureLevelSnapshot().investmentProfile), saved.snapshot.investmentProfile);
    assert.equal(next.gameState.saveToLocalStorage(), true);
    assert.deepEqual(store.readLevelSave(nextDevice, ID, 2).envelope.snapshot.investmentProfile, saved.snapshot.investmentProfile);
    assert.equal(device.getItem('explicit-conversion-backup'), raw);
    assert.equal(JSON.parse(device.getItem('explicit-conversion-backup')).netWorth, source.netWorth);
    assert.equal(converted.requiresOperatorConfigCheck, true);
});

test('release-blocker evidence: existing scoped profile can override exact cloud profile when its economy slot is missing', () => {
    // Diagnostic reproduction, not acceptance approval. The operations runbook
    // blocks the pilot until retained profile history has run-aware reconciliation.
    const incoming = convertedEnvelope();
    const priorHistory = { ...incoming.snapshot.investmentProfile, assetBuilding: 99 };
    const storage = createSessionStorage({
        wa_gr_investment_profile: JSON.stringify({ '6B|SC-1__L2': priorHistory })
    });
    assert.equal(store.readLevelSave(storage, ID, 2).status, 'missing');
    const cloud = restore.interpretResponse({
        success: true, status: 200,
        data: {
            contractVersion: restore.CONTRACT_VERSION, ok: true, found: true,
            progressKey: SLOT.progressKey, revision: 4, runGeneration: 3, save: incoming
        }
    }, SLOT);
    assert.equal(restore.adoptCloudSave(storage, cloud).ok, true);
    const game = buildStudentGameHarness({ level: 2, storage });
    assert.equal(game.loadResult.status, 'resumed');
    const loadedProfile = store.clone(game.gameState.captureLevelSnapshot().investmentProfile);
    assert.equal(incoming.snapshot.investmentProfile.assetBuilding, 7);
    assert.equal(loadedProfile.assetBuilding, 99);
    assert.notDeepEqual(loadedProfile, incoming.snapshot.investmentProfile);
    assert.equal(game.gameState.activeRun.runId, incoming.runId);
    assert.equal(game.gameState.cash, incoming.snapshot.cash);
    assert.equal(JSON.parse(storage.getItem('wa_gr_investment_profile'))['6B|SC-1__L2'].assetBuilding, 99);
});

test('real gameplay profiles are isolated by class, student and level; ambiguous legacy totals stay unclaimed', () => {
    const legacy = { 'SC-1__L2': { highRisk: 999, lowRisk: 0, profitChasing: 0, assetBuilding: 0, futureProofing: 0 } };
    const storage = createSessionStorage({ wa_gr_investment_profile: JSON.stringify(legacy) });
    const a = buildStudentGameHarness({ level: 2, storage });
    assert.equal(a.gameState.captureLevelSnapshot().investmentProfile.highRisk, 0);
    a.gameState.recordInvestmentAction('highRisk', 2);
    assert.equal(a.gameState.saveToLocalStorage(), true);
    setSession(storage, { classCode: '6C' });
    const otherClass = buildStudentGameHarness({ level: 2, storage });
    assert.equal(otherClass.gameState.captureLevelSnapshot().investmentProfile.highRisk, 0);
    otherClass.gameState.recordInvestmentAction('lowRisk', 3);
    assert.equal(otherClass.gameState.saveToLocalStorage(), true);
    setSession(storage, { studentCode: 'SC-2' });
    const otherStudent = buildStudentGameHarness({ level: 2, storage });
    assert.equal(otherStudent.gameState.captureLevelSnapshot().investmentProfile.highRisk, 0);
    setSession(storage);
    const otherLevel = buildStudentGameHarness({ level: 4, storage });
    assert.equal(otherLevel.gameState.captureLevelSnapshot().investmentProfile.highRisk, 0);
    const resumed = buildStudentGameHarness({ level: 2, storage });
    assert.equal(resumed.gameState.captureLevelSnapshot().investmentProfile.highRisk, 2);
    assert.equal(resumed.gameState.captureLevelSnapshot().investmentProfile.lowRisk, 0);
    const entries = JSON.parse(storage.getItem('wa_gr_investment_profile'));
    assert.deepEqual(entries['SC-1__L2'], legacy['SC-1__L2']);
    assert.equal(entries['6B|SC-1__L2'].highRisk, 2);
    assert.equal(entries['6C|SC-1__L2'].lowRisk, 3);
});

test('conversion rejects unknown, ambiguous and malformed data without discarding the original', () => {
    const vectors = [
        ['unknown_snapshot_fields', { ...rawSnapshot(), futureAssets: { gold: 4 } }],
        ['unsupported_snapshot', { ...rawSnapshot(), schemaVersion: 99 }],
        ['owner_mismatch', { ...rawSnapshot(), player: { ...ID, studentCode: 'SC-2' } }],
        ['level_mismatch', { ...rawSnapshot(), currentLevel: 3 }],
        ['unknown_player_fields', { ...rawSnapshot(), player: { ...ID, companyName: 'ambiguous' } }],
        ['snapshot_cash_invalid', { ...rawSnapshot(), cash: '430' }],
        ['snapshot_history_invalid', { ...rawSnapshot(), roundHistory: {} }],
        ['investment_profile_invalid', { ...rawSnapshot(), investmentProfile: { highRisk: 1 } }],
        ['investment_profile_invalid', { ...rawSnapshot(), investmentProfile: { ...rawSnapshot().investmentProfile, unknownBucket: 1 } }],
        ['checkpoint_ambiguous', { ...rawSnapshot(), progressionStateByLevel: { '2': { quizScore: 90 } } }],
        ['run_metadata_required', { ...rawSnapshot(), run: { ...rawSnapshot().run, revision: 1 } }]
    ];
    for (const [reason, value] of vectors) {
        const raw = JSON.stringify(value);
        const result = converter.convertLegacySnapshot(raw, SLOT);
        assert.equal(result.ok, false, reason);
        assert.equal(result.reason, reason);
        assert.equal(result.rawBackup, raw);
        assert.equal('envelope' in result, false);
    }
    const infiniteAsset = JSON.stringify(rawSnapshot()).replace('"purchasePrice":250', '"purchasePrice":1e999');
    assert.equal(converter.convertLegacySnapshot(infiniteAsset, SLOT).reason, 'non_finite_json');
    const duplicateAsset = JSON.stringify(rawSnapshot()).replace('"purchasePrice":250', '"purchasePrice":250,"purchase\\u0050rice":300');
    assert.equal(converter.convertLegacySnapshot(duplicateAsset, SLOT).reason, 'duplicate_json_keys');
    assert.equal(converter.convertLegacySnapshot('{broken', SLOT).reason, 'malformed_json');
    assert.equal(converter.convertLegacySnapshot(rawSnapshot(), SLOT).reason, 'raw_json_required');
});

/** @typedef {{name:string, body:Object, status:string}} RestoreVector */
test('typed restore vectors exercise the actual response interpreter with converted full saves', () => {
    const body = {
        contractVersion: restore.CONTRACT_VERSION, ok: true, found: true,
        progressKey: SLOT.progressKey, revision: 4, runGeneration: 3, save: convertedEnvelope()
    };
    /** @type {RestoreVector[]} */
    const vectors = [
        { name: 'full', body, status: 'found' },
        { name: 'missing', body: { ...body, found: false, save: undefined }, status: 'missing' },
        { name: 'checkpoint-only', body: { ok: true, checkpointStatus: 'quiz_passed' }, status: 'incomplete' },
        { name: 'wrong-slot', body: { ...body, progressKey: '6B|SC-2|2' }, status: 'failed' },
        { name: 'no-revision', body: { ...body, revision: undefined }, status: 'incomplete' },
        { name: 'wrong-generation', body: { ...body, runGeneration: 4 }, status: 'incomplete' },
        { name: 'partial-economy', body: { ...body, save: { ...body.save, snapshot: { level: 2 } } }, status: 'incomplete' }
    ];
    for (const vector of vectors) {
        const result = restore.interpretResponse({ success: true, status: 200, data: vector.body }, SLOT);
        assert.equal(result.status, vector.status, vector.name);
        if (result.status === 'found') {
            assert.deepEqual(result.envelope.snapshot.investmentProfile, body.save.snapshot.investmentProfile);
            assert.equal(result.envelope.runId, body.save.runId);
            assert.equal(result.envelope.cloud.revision, 4);
        }
    }
});

/** @typedef {{name:string, response:Object, outcome:string}} SaveVector */
test('typed save acknowledgement vectors exercise the actual v2 response classifier', () => {
    const payload = {
        protocolVersion: 2, saveRequestId: 'request-example', progressKey: SLOT.progressKey,
        runGeneration: 3, runId: convertedEnvelope().runId
    };
    const ack = { ok: true, protocolVersion: 2, saveRequestId: payload.saveRequestId, progressKey: payload.progressKey, runGeneration: 3, revision: 4 };
    /** @type {SaveVector[]} */
    const vectors = [
        { name: 'ack', response: { success: true, status: 200, data: ack }, outcome: 'confirmed' },
        { name: 'dedup', response: { success: true, status: 200, data: { ...ack, deduplicated: true } }, outcome: 'confirmed' },
        { name: 'legacy', response: { success: true, status: 200, data: { ok: true } }, outcome: 'unconfirmed' },
        { name: 'wrong-request', response: { success: true, data: { ...ack, saveRequestId: 'other' } }, outcome: 'unconfirmed' },
        { name: 'revision-conflict', response: { success: false, status: 409, data: { code: 'revision_conflict', currentRevision: 5 } }, outcome: 'conflict' },
        { name: 'stale-run', response: { success: false, status: 409, data: { code: 'generation_stale' } }, outcome: 'stale_generation' },
        { name: 'unknown-transport', response: { success: false, status: 0 }, outcome: 'defer' }
    ];
    for (const vector of vectors) {
        assert.equal(protocol.classifyResponse(payload, vector.response).outcome, vector.outcome, vector.name);
    }
});

test('get/save/reset all fail closed without an external provider and request fresh ephemeral proof', async () => {
    const requests = [];
    const root = {
        WA_GOLD_RUSH_STUDENT_PROGRESS_PROOF_PROVIDER: {
            getProof: async (request) => {
                assert.equal(Object.isFrozen(request), true);
                assert.equal(Object.isFrozen(request.identity), true);
                requests.push(request);
                return { authorization: testAuthorization() };
            }
        }
    };
    for (const operation of ['get', 'save', 'reset']) {
        const request = { ...SLOT, operation };
        assert.equal((await auth.authorize(request, {})).reason, 'auth_provider_unavailable');
        const result = await auth.authorize(request, root);
        assert.equal(result.ok, true);
        assert.equal(result.options.headers.Authorization, testAuthorization());
        assert.equal(result.options.cache, 'no-store');
        assert.deepEqual(Object.keys(request).sort(), ['identity', 'level', 'operation', 'progressKey']);
    }
    assert.deepEqual(requests.map((request) => request.operation), ['get', 'save', 'reset']);
    assert.equal((await auth.authorize({ ...SLOT, operation: 'get', progressKey: '6B|SC-2|2' }, root)).reason, 'auth_request_invalid');
    assert.equal(requests.length, 3);
});

test('invalid provider proofs and exceptions do not leak credentials or fall back to identity/API key', async () => {
    const request = { ...SLOT, operation: 'get' };
    for (const proof of [null, {}, { authorization: '' }, { authorization: 'identity-only' }, { authorization: testAuthorization() + '\r\nbad' }]) {
        const root = { WA_GOLD_RUSH_STUDENT_PROGRESS_PROOF_PROVIDER: { getProof: async () => proof } };
        assert.deepEqual(await auth.authorize(request, root), { ok: false, reason: 'auth_proof_unavailable' });
    }
    const root = { WA_GOLD_RUSH_STUDENT_PROGRESS_PROOF_PROVIDER: { getProof: async () => { throw new Error(testAuthorization()); } } };
    assert.deepEqual(await auth.authorize(request, root), { ok: false, reason: 'auth_provider_failed' });
});

test('full restore transports proof only in headers and never calls the flow without it', async () => {
    let calls = 0;
    const root = {
        WA_GOLD_RUSH_LEVEL_CAPABILITIES: { isFeatureEnabled: () => true, isFlowCallable: () => true },
        WA_GOLD_RUSH_POWER_AUTOMATE: {
            callFlow: async (name, payload, options) => {
                calls += 1;
                assert.equal(name, 'getStudentProgress');
                assert.equal(options.headers.Authorization, testAuthorization());
                assert.equal(options.cache, 'no-store');
                assert.equal(JSON.stringify(payload).includes(ephemeralProof), false);
                return { success: true, status: 200, data: { contractVersion: restore.CONTRACT_VERSION, ok: true, found: false, progressKey: payload.progressKey } };
            }
        }
    };
    const denied = await restore.fetchLevelSave(SLOT, root);
    assert.equal(denied.status, 'unavailable');
    assert.equal(denied.reason, 'auth_provider_unavailable');
    assert.equal(calls, 0);
    root.WA_GOLD_RUSH_STUDENT_PROGRESS_PROOF_PROVIDER = { getProof: async () => ({ authorization: testAuthorization() }) };
    const result = await restore.fetchLevelSave(SLOT, root);
    assert.equal(result.status, 'missing');
    assert.equal(calls, 1);
    root.WA_GOLD_RUSH_STUDENT_PROGRESS_PROOF_PROVIDER.getProof = () => new Promise(() => {});
    assert.equal((await restore.fetchLevelSave({ ...SLOT, timeoutMs: 1 }, root)).status, 'unavailable');
    assert.equal(calls, 1);
});
