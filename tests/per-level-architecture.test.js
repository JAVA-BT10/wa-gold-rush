/**
 * Per-level save architecture tests (mock / vm harness).
 *
 * These are unit and integration tests against local mocks and the
 * reference server model in tests/support/reference-save-server.js. They are
 * NOT evidence that any SharePoint list or Power Automate flow has been
 * deployed or verified — see docs/operations/release-and-acceptance.md for
 * the tenant acceptance matrix.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const {
    read,
    createStorage,
    createSessionStorage,
    setSession,
    buildRosterSession,
    buildStudentGameHarness
} = require('./support/harness.js');
const { ReferenceSaveServer } = require('./support/reference-save-server.js');

const store = require('../shared/level-save-store.js');
const caps = require('../shared/level-capabilities.js');
const competitionBaselines = require('../shared/competition-baselines.js');
const leaderboard = require('../shared/leaderboard.js');
const cloudRestore = require('../shared/cloud-restore.js');
const competitionSnapshot = require('../shared/competition-snapshot.js');

const ID = Object.freeze({ classCode: '6B', studentCode: 'SC-1' });

function playSomeRounds(gameState, { round, cash }) {
    gameState.round = round;
    gameState.cash = cash;
    gameState.roundHistory = [{ round: round - 1, totalProfit: 10 }];
    gameState.totalProfitLoss = 10;
    assert.equal(gameState.saveToLocalStorage(), true);
}

function resetGlobals() {
    delete global.WA_GOLD_RUSH_RUNTIME_CONFIG;
    delete global.WA_GOLD_RUSH_POWER_AUTOMATE;
    delete global.WA_GOLD_RUSH_FLOW_ENDPOINTS;
}

test.afterEach(() => resetGlobals());

// ---------------------------------------------------------------------------
// Independent per-level games
// ---------------------------------------------------------------------------

test('lower and higher level games round-trip independently; first visit starts, later visits resume', () => {
    const storage = createSessionStorage({}, { assignedLevel: 4 });

    const l2 = buildStudentGameHarness({ level: 2, storage });
    assert.equal(l2.loadResult.status, 'started');
    playSomeRounds(l2.gameState, { round: 7, cash: 4321 });

    const l4 = buildStudentGameHarness({ level: 4, storage });
    assert.equal(l4.loadResult.status, 'started', 'Level 4 first visit starts fresh, not from Level 2');
    assert.equal(l4.gameState.round, 1);
    assert.equal(l4.gameState.cash, l4.gameState.getPlayableStartingCash());
    assert.notEqual(l4.gameState.cash, 4321);
    assert.equal(l4.gameState.assignedLevel, 4);
    playSomeRounds(l4.gameState, { round: 3, cash: 99999 });

    const l2Again = buildStudentGameHarness({ level: 2, storage });
    assert.equal(l2Again.loadResult.status, 'resumed');
    assert.equal(l2Again.gameState.round, 7);
    assert.equal(l2Again.gameState.cash, 4321);
    assert.equal(l2Again.gameState.assignedLevel, 2);

    const l4Again = buildStudentGameHarness({ level: 4, storage });
    assert.equal(l4Again.loadResult.status, 'resumed');
    assert.equal(l4Again.gameState.round, 3);
    assert.equal(l4Again.gameState.cash, 99999);

    assert.equal(store.readLevelSave(storage, ID, 2).envelope.snapshot.level, 2);
    assert.equal(store.readLevelSave(storage, ID, 4).envelope.snapshot.level, 4);
    assert.equal(storage.getItem('level2_autosave'), null);
});

test('first visit records the run baseline (StartingNetWorth) once and never rewrites it', () => {
    const storage = createSessionStorage();
    const h = buildStudentGameHarness({ level: 2, storage });
    const baseline = h.gameState.startingNetWorth;
    assert.equal(typeof baseline, 'number');
    playSomeRounds(h.gameState, { round: 5, cash: 5000 });
    const saved = store.readLevelSave(storage, ID, 2).envelope;
    assert.equal(saved.startingNetWorth, baseline);
    const again = buildStudentGameHarness({ level: 2, storage });
    assert.equal(again.gameState.startingNetWorth, baseline);
});

test('shared device: two students keep separate games and never load each other\'s save', () => {
    const storage = createSessionStorage();
    const a = buildStudentGameHarness({ level: 2, storage });
    playSomeRounds(a.gameState, { round: 6, cash: 777 });

    setSession(storage, { studentCode: 'SC-2', studentId: '654321', studentName: 'Sam Lee', leaderboardName: 'Nugget' });
    const b = buildStudentGameHarness({ level: 2, storage });
    assert.equal(b.loadResult.status, 'started');
    assert.equal(b.gameState.round, 1);
    playSomeRounds(b.gameState, { round: 2, cash: 111 });

    assert.equal(store.readLevelSave(storage, ID, 2).envelope.snapshot.cash, 777);
    assert.equal(store.readLevelSave(storage, { classCode: '6B', studentCode: 'SC-2' }, 2).envelope.snapshot.cash, 111);
});

test('same student code in another class is a different game (class is part of the key)', () => {
    const storage = createSessionStorage();
    const a = buildStudentGameHarness({ level: 2, storage });
    playSomeRounds(a.gameState, { round: 6, cash: 777 });
    setSession(storage, { classCode: '7C' });
    const b = buildStudentGameHarness({ level: 2, storage });
    assert.equal(b.loadResult.status, 'started');
    assert.equal(store.buildProgressKey({ classCode: '7c', studentCode: 'sc-1' }, 2), '7C|SC-1|2');
});

test('local saves contain no StudentName, StudentID, PIN or hash', () => {
    const storage = createSessionStorage();
    const h = buildStudentGameHarness({ level: 3, storage: setSession(storage, { assignedLevel: 3 }), stubSync: false });
    h.gameState.player.companyName = 'Co';
    playSomeRounds(h.gameState, { round: 4, cash: 3000 });
    // Real syncPlayerRecord writes the device-only board (SharePointSync absent).
    vm.runInContext('syncPlayerRecord()', h.context);
    const keys = storage.__keys().filter((key) => key.startsWith('wa_gr_'));
    assert.ok(keys.some((key) => key.startsWith('wa_gr_device_level_board_v1')));
    for (const key of keys) {
        const value = storage.getItem(key);
        assert.doesNotMatch(value, /Alex Smith|123456|pinHash|"pin"/i, `${key} must not hold private fields`);
    }
});

// ---------------------------------------------------------------------------
// Validation: identity / class / level mismatch, no coercion
// ---------------------------------------------------------------------------

test('envelope validation rejects identity, class and level mismatches before any write', () => {
    const run = { generation: 1, runId: 'run_x' };
    const snapshot = {
        level: 2, round: 2, cash: 10, player: { classCode: '6B', studentCode: 'SC-1' },
        ownedMines: {}, machinery: [], roundHistory: [], investmentPlans: {}, totalProfitLoss: 0
    };
    const envelope = store.createEnvelope({ identity: ID, level: 2, ...run, snapshot });
    assert.equal(store.validateEnvelope(envelope, { identity: ID, level: 2 }).ok, true);
    assert.equal(store.validateEnvelope(envelope, { identity: ID, level: 3 }).reason, 'level_mismatch');
    assert.equal(store.validateEnvelope(envelope, { identity: { classCode: '6B', studentCode: 'SC-2' }, level: 2 }).reason, 'owner_mismatch');
    assert.equal(store.validateEnvelope(envelope, { identity: { classCode: '7C', studentCode: 'SC-1' }, level: 2 }).reason, 'owner_mismatch');
    const relabelled = { ...store.clone(envelope), level: 3, progressKey: '6B|SC-1|3' };
    assert.equal(store.validateEnvelope(relabelled).reason, 'snapshot_level_mismatch');
    const storage = createStorage();
    assert.equal(store.writeLevelSave(storage, envelope, { identity: ID, level: 4 }).ok, false);
    assert.equal(storage.getItem(store.buildSaveKey(ID, 4)), null);
});

test('malformed or mismatched slot content is protected and never replaced silently', () => {
    const storage = createSessionStorage();
    const key = store.buildSaveKey(ID, 2);
    storage.setItem(key, '{not json');
    const h = buildStudentGameHarness({ level: 2, storage });
    assert.equal(h.loadResult.status, 'error');
    assert.equal(storage.getItem(key), '{not json');
    assert.equal(h.gameState.saveToLocalStorage(), false);
    assert.equal(storage.getItem(key), '{not json');
});

test('a slot written by an unsupported (e.g. newer) storage schema fails closed and is never replaced', () => {
    const storage = createSessionStorage();
    const key = store.buildSaveKey(ID, 2);
    const future = JSON.stringify({ kind: 'wa_gr_level_save', storageSchemaVersion: 99, owner: ID, level: 2, snapshot: {} });
    storage.setItem(key, future);
    const h = buildStudentGameHarness({ level: 2, storage });
    assert.equal(h.loadResult.status, 'error');
    assert.equal(h.gameState.saveLocked, true);
    h.gameState.saveToLocalStorage();
    assert.equal(storage.getItem(key), future);
});

test('no default-level coercion: invalid or planned ?level= never maps to another level', () => {
    const storage = createSessionStorage();
    for (const search of ['?level=6', '?level=abc', '?level=2.5', '?level=0', '?level=1']) {
        const h = buildStudentGameHarness({ search, storage });
        assert.equal(h.requestedLevel, null, `${search} must be rejected`);
    }
    assert.equal(buildStudentGameHarness({ search: '', storage }).requestedLevel, 2, 'missing ?level= is the Level 2 entry point');
    const { LevelAccessGuard } = require('../levels/level-2-tycoon/level-access-guard.js');
    assert.equal(new LevelAccessGuard('abc').assignedLevel, null);
});

// ---------------------------------------------------------------------------
// Immutability, reset generation and queued saves
// ---------------------------------------------------------------------------

test('loaded envelopes are frozen copies; later gameplay never mutates a captured snapshot', () => {
    const storage = createSessionStorage();
    const h = buildStudentGameHarness({ level: 2, storage });
    playSomeRounds(h.gameState, { round: 3, cash: 300 });
    const found = store.readLevelSave(storage, ID, 2);
    assert.equal(Object.isFrozen(found.envelope), true);
    assert.equal(Object.isFrozen(found.envelope.snapshot), true);
    h.gameState.cash = 1;
    h.gameState.roundHistory.push({ round: 3 });
    assert.equal(found.envelope.snapshot.cash, 300);
    assert.equal(found.envelope.snapshot.roundHistory.length, 1);
});

test('restarting one level archives it, advances generation, keeps other levels and earned access', () => {
    const storage = createSessionStorage({}, { assignedLevel: 3 });
    const l2 = buildStudentGameHarness({ level: 2, storage });
    playSomeRounds(l2.gameState, { round: 9, cash: 2600 });
    l2.gameState.setProgressionState?.(2, { checkpointStatus: 'quiz_passed', quizAttempts: [{ passed: true }] });
    store.recordProgressionEvidence(storage, ID, 2, { checkpointStatus: 'quiz_passed', quizAttempts: [{ passed: true }] });
    const l3 = buildStudentGameHarness({ level: 3, storage });
    playSomeRounds(l3.gameState, { round: 4, cash: 8000 });
    const oldL3 = store.readLevelSave(storage, ID, 3).envelope;

    const queued = [];
    const syncStub = {
        discardQueuedForProgressKey(key, reason) { queued.push({ key, reason }); return 1; }
    };
    l3.context.SharePointSync = syncStub;
    l3.context.resetGame();

    const ledger = store.readLedger(storage, ID);
    assert.equal(ledger.levelRuns['3'].generation, 2);
    assert.equal(store.readLevelSave(storage, ID, 3).envelope.generation, 2);
    assert.equal(store.readLevelSave(storage, ID, 3).envelope.snapshot.round, 1);
    assert.equal(store.readLevelSave(storage, ID, 2).envelope.snapshot.round, 9, 'Level 2 untouched');
    assert.equal(ledger.progressionStateByLevel['2'].checkpointStatus, 'quiz_passed', 'earned access kept');
    assert.deepEqual(queued, [{ key: '6B|SC-1|3', reason: 'superseded_by_reset' }]);
    const archive = JSON.parse(storage.getItem(store.buildArchiveKey(ID, 3)));
    assert.equal(JSON.parse(archive[0].raw).snapshot.round, 4);

    // A delayed pre-reset write can never resurrect the old run locally.
    assert.equal(store.writeLevelSave(storage, oldL3, { identity: ID, level: 3 }).reason, 'stale_generation');
});

test('another tab restarting this level locks this tab instead of overwriting', () => {
    const storage = createSessionStorage();
    const tab1 = buildStudentGameHarness({ level: 2, storage });
    playSomeRounds(tab1.gameState, { round: 3, cash: 10 });
    store.resetLevelSave(storage, ID, 2, { reason: 'other_tab' });
    assert.equal(tab1.context.handleLevelSaveStorageChange(store.buildLedgerKey(ID)), true);
    assert.equal(tab1.gameState.saveLocked, true);
    assert.equal(tab1.gameState.saveToLocalStorage(), false);
    assert.equal(tab1.context.getLevelLoadState().status, 'conflict');
});

// ---------------------------------------------------------------------------
// Legacy migration
// ---------------------------------------------------------------------------

function legacyAutosave(overrides = {}) {
    return JSON.stringify({
        timestamp: '2025-06-01T00:00:00.000Z',
        gameState: {
            round: 12,
            cash: 4567,
            assignedLevel: 3,
            player: { studentCode: 'SC-1', classCode: '6B', studentName: 'Alex Smith', studentId: '123456' },
            ownedMines: { southern_cross: { id: 'southern_cross', owned: true } },
            machinery: [],
            roundHistory: [{ round: 11 }],
            investmentPlans: {},
            totalProfitLoss: 200,
            progressionStateByLevel: { 2: { checkpointStatus: 'quiz_passed' } },
            ...overrides
        }
    });
}

test('legacy migration is idempotent, backs up first, never deletes or fabricates other levels', () => {
    const raw = legacyAutosave();
    const storage = createSessionStorage({ level2_autosave: raw }, { assignedLevel: 3 });
    const first = store.migrateLegacyAutosave(storage, ID);
    assert.equal(first.status, 'migrated');
    assert.equal(first.level, 3);
    assert.equal(storage.getItem('level2_autosave'), raw, 'legacy slot untouched');
    const backups = JSON.parse(storage.getItem(store.LEGACY_BACKUP_KEY));
    assert.equal(backups.length, 1);
    assert.equal(backups[0].raw, raw);
    const migrated = store.readLevelSave(storage, ID, 3).envelope;
    assert.equal(migrated.snapshot.round, 12);
    assert.equal(migrated.startingNetWorth, null, 'unknown baseline is not invented');
    assert.equal(migrated.cloud.status, 'unknown');
    assert.doesNotMatch(JSON.stringify(migrated), /Alex Smith|123456/);
    for (const level of [2, 4, 5]) assert.equal(store.readLevelSave(storage, ID, level).status, 'missing');
    assert.equal(store.readLedger(storage, ID).progressionStateByLevel['2'].checkpointStatus, 'quiz_passed');

    const second = store.migrateLegacyAutosave(storage, ID);
    assert.equal(second.status, 'already_processed');
    assert.equal(JSON.parse(storage.getItem(store.LEGACY_BACKUP_KEY)).length, 1);

    // The page load resumes the migrated Level 3 game and does not touch Level 2.
    const l3 = buildStudentGameHarness({ level: 3, storage });
    assert.equal(l3.loadResult.status, 'resumed');
    assert.equal(l3.gameState.round, 12);
    const l2 = buildStudentGameHarness({ level: 2, storage });
    assert.equal(l2.loadResult.status, 'started');
});

test('legacy migration preserves an existing new slot and leaves foreign/malformed records alone', () => {
    const storage = createSessionStorage({}, { assignedLevel: 3 });
    const h = buildStudentGameHarness({ level: 3, storage });
    playSomeRounds(h.gameState, { round: 2, cash: 50 });
    const before = storage.getItem(store.buildSaveKey(ID, 3));
    storage.setItem('level2_autosave', legacyAutosave());
    assert.equal(store.migrateLegacyAutosave(storage, ID).status, 'preserved_existing');
    assert.equal(storage.getItem(store.buildSaveKey(ID, 3)), before);

    for (const [raw, reason] of [
        [legacyAutosave({ player: { studentCode: 'SC-9', classCode: '6B' } }), 'other_student'],
        [legacyAutosave({ player: {} }), 'unowned'],
        ['{oops', 'malformed']
    ]) {
        const s = createSessionStorage({ level2_autosave: raw });
        const result = store.migrateLegacyAutosave(s, ID);
        assert.equal(result.status, 'skipped');
        assert.equal(result.reason, reason);
        assert.equal(s.getItem('level2_autosave'), raw);
        assert.equal(store.readLevelSave(s, ID, 3).status, 'missing');
    }
});

test('ambiguous legacy records need review and hold cloud uploads for that level only', () => {
    const storage = createSessionStorage({
        level2_autosave: legacyAutosave({ player: { studentCode: 'SC-1' } })
    }, { assignedLevel: 3 });
    const h = buildStudentGameHarness({ level: 3, storage });
    assert.equal(h.loadResult.status, 'error');
    assert.equal(store.readLevelSave(storage, ID, 3).status, 'missing');
    assert.equal(h.context.getCloudUploadHold(), 'legacy_missing_class');
    assert.equal(store.readLedger(storage, ID).legacyMigration.status, 'needs_review');
    const l2 = buildStudentGameHarness({ level: 2, storage });
    assert.equal(l2.context.getCloudUploadHold(), '');

    const otherClass = createSessionStorage({ level2_autosave: legacyAutosave({ player: { studentCode: 'SC-1', classCode: '9Z' } }) });
    assert.equal(store.migrateLegacyAutosave(otherClass, ID).reason, 'class_mismatch');
    assert.equal(store.readLevelSave(otherClass, ID, 3).status, 'missing');
});

test('held or pristine games are never uploaded; v2 fields only when the flag is on', () => {
    const storage = createSessionStorage({ level2_autosave: legacyAutosave({ player: { studentCode: 'SC-1' } }) }, { assignedLevel: 3 });
    const scheduled = [];
    const h = buildStudentGameHarness({ level: 3, storage, stubSync: false, extraGlobals: { SharePointSync: { buildProgressPayload: (p) => p } } });
    vm.runInContext('getProgressSaveScheduler = () => ({ schedule: (p) => { this.__scheduled.push(p); } });', Object.assign(h.context, { __scheduled: scheduled }));
    h.gameState.round = 3;
    h.gameState.cash = 10;
    h.gameState.roundHistory = [{ round: 2, totalProfit: 10 }];
    vm.runInContext('syncPlayerRecord()', h.context);
    assert.equal(scheduled.length, 0, 'held by legacy review');

    const fresh = createSessionStorage({}, { assignedLevel: 3 });
    const g = buildStudentGameHarness({
        level: 3,
        storage: fresh,
        stubSync: false,
        extraGlobals: { SharePointSync: { buildProgressPayload: (p) => p }, WA_GOLD_RUSH_RUNTIME_CONFIG: { featureFlags: { saveProtocolV2: true } } }
    });
    vm.runInContext('getProgressSaveScheduler = () => ({ schedule: (p) => { this.__scheduled.push(p); } });', Object.assign(g.context, { __scheduled: scheduled }));
    vm.runInContext('syncPlayerRecord()', g.context);
    assert.equal(scheduled.length, 0, 'pristine round-1 defaults are never uploaded');
    playSomeRounds(g.gameState, { round: 2, cash: 10 });
    vm.runInContext('syncPlayerRecord()', g.context);
    assert.equal(scheduled.length, 1);
    assert.equal(scheduled[0].protocolVersion, 2);
    assert.equal(scheduled[0].runGeneration, 1);
    assert.equal(typeof scheduled[0].runId, 'string');
    assert.equal(scheduled[0].level, 3);
});

// ---------------------------------------------------------------------------
// Save protocol v2 against the reference server model
// ---------------------------------------------------------------------------

function v2Request(overrides = {}) {
    return {
        protocolVersion: 2,
        saveRequestId: overrides.saveRequestId || `req-${Math.random().toString(36).slice(2)}`,
        progressKey: '6B|SC-1|2',
        runGeneration: 1,
        runId: 'run_a',
        baseRevision: null,
        contentHash: 'c53-a',
        ...overrides
    };
}

test('reference server: CAS lets one of two writers win and the other conflict', () => {
    const server = new ReferenceSaveServer();
    assert.equal(server.handle(v2Request({ saveRequestId: 'create' })).revision, 1);
    const deviceA = server.handle(v2Request({ saveRequestId: 'a1', baseRevision: 1, contentHash: 'c53-A' }));
    const deviceB = server.handle(v2Request({ saveRequestId: 'b1', baseRevision: 1, contentHash: 'c53-B' }));
    assert.equal(deviceA.ok, true);
    assert.equal(deviceA.revision, 2);
    assert.equal(deviceB.ok, false);
    assert.equal(deviceB.code, 'revision_conflict');
    assert.equal(deviceB.currentRevision, 2);
    assert.equal(server.rows.get('6B|SC-1|2').contentHash, 'c53-A', 'no last-writer data loss');
    const secondCreate = server.handle(v2Request({ saveRequestId: 'create-2', contentHash: 'c53-defaults' }));
    assert.equal(secondCreate.code, 'row_exists', 'create-only never overwrites an existing row');
});

test('reference server: duplicate retry returns the original success, even after newer writes', () => {
    const server = new ReferenceSaveServer();
    const first = server.handle(v2Request({ saveRequestId: 'r1' }));
    server.handle(v2Request({ saveRequestId: 'r2', baseRevision: 1, contentHash: 'c53-b' }));
    server.handle(v2Request({ saveRequestId: 'r3', baseRevision: 2, contentHash: 'c53-c' }));
    const retry = server.handle(v2Request({ saveRequestId: 'r1' }));
    assert.equal(retry.ok, true);
    assert.equal(retry.revision, first.revision);
    assert.equal(retry.deduplicated, true);
    assert.equal(server.rows.get('6B|SC-1|2').revision, 3, 'not re-applied or downgraded');
    const altered = server.handle(v2Request({ saveRequestId: 'r1', contentHash: 'c53-tampered' }));
    assert.equal(altered.code, 'request_id_reused');
});

test('reference server: crash between row write and receipt is recovered on retry', () => {
    const server = new ReferenceSaveServer();
    server.failNextReceiptWrite = true;
    assert.throws(() => server.handle(v2Request({ saveRequestId: 'crash' })));
    const retry = server.handle(v2Request({ saveRequestId: 'crash' }));
    assert.equal(retry.ok, true);
    assert.equal(retry.revision, 1);
    assert.equal(retry.deduplicated, true);
});

test('reference server: reset advances generation and rejects pre-reset requests', () => {
    const server = new ReferenceSaveServer();
    server.handle(v2Request({ saveRequestId: 'g1' }));
    const nextGeneration = server.reset('6B|SC-1|2');
    assert.equal(nextGeneration, 2);
    const delayed = server.handle(v2Request({ saveRequestId: 'late', baseRevision: 1 }));
    assert.equal(delayed.code, 'generation_stale');
    const newRun = server.handle(v2Request({ saveRequestId: 'g2', runGeneration: 2, runId: 'run_b' }));
    assert.equal(newRun.ok, true);
    assert.equal(newRun.revision, 1);
    const selfAdvanced = server.handle(v2Request({ saveRequestId: 'g3', runGeneration: 3, runId: 'run_c' }));
    assert.equal(selfAdvanced.code, 'precondition_failed', 'clients cannot start a new server run on their own');
});

function loadSync() {
    delete require.cache[require.resolve('../shared/sharepoint-sync.js')];
    return require('../shared/sharepoint-sync.js');
}

function seedLocalSave(storage, overrides = {}) {
    const run = store.ensureLevelRun(storage, ID, 2);
    const snapshot = {
        level: 2, round: 3, cash: 100, player: { classCode: '6B', studentCode: 'SC-1' },
        ownedMines: {}, machinery: [], roundHistory: [{ round: 2 }], investmentPlans: {}, totalProfitLoss: 0
    };
    const envelope = store.createEnvelope({ identity: ID, level: 2, generation: run.generation, runId: run.runId, startingNetWorth: 300, snapshot, ...overrides });
    // Same run on another device (e.g. after a restore): adopt it first.
    if (overrides.runId) assert.equal(store.adoptLevelRun(storage, envelope), true);
    assert.equal(store.writeLevelSave(storage, envelope, { identity: ID, level: 2 }).ok, true);
    return { generation: envelope.generation, runId: envelope.runId };
}

function v2Opts(run, extra = {}) {
    return {
        studentCode: 'SC-1', classCode: '6B', level: 2, currentRound: 3, currentCash: 100, netWorth: 400,
        protocolVersion: 2, runGeneration: run.generation, runId: run.runId, startingNetWorth: 300, storageSchemaVersion: 1,
        ...extra
    };
}

function enableV2(server, options) {
    global.WA_GOLD_RUSH_RUNTIME_CONFIG = { featureFlags: { saveProtocolV2: true } };
    global.WA_GOLD_RUSH_FLOW_ENDPOINTS = { saveProgress: 'https://example.com/save' };
    global.WA_GOLD_RUSH_POWER_AUTOMATE = {
        callFlow: server.transport(options),
        resolveFlowEndpoint: (key) => global.WA_GOLD_RUSH_FLOW_ENDPOINTS[key] || ''
    };
}

test('SharePointSync v2: two devices on the same base revision → one saved, one conflict (no overwrite)', async () => {
    const server = new ReferenceSaveServer();
    enableV2(server);
    const deviceA = createSessionStorage();
    const deviceB = createSessionStorage();
    const runA = seedLocalSave(deviceA);
    // Device B holds the same run (e.g. restored) and the same acknowledged base.
    seedLocalSave(deviceB, { generation: runA.generation, runId: runA.runId });

    global.localStorage = deviceA;
    const sync = loadSync();
    const created = await sync.syncProgress(v2Opts(runA, { currentRound: 3 }));
    assert.equal(created.ok, true);
    assert.equal(created.revision, 1);
    assert.equal(store.readLevelSave(deviceA, ID, 2).envelope.cloud.revision, 1);

    global.localStorage = deviceB;
    const fromB = await sync.syncProgress(v2Opts(runA, { currentRound: 9, netWorth: 9999 }));
    assert.equal(fromB.ok, false);
    assert.equal(fromB.conflict, true);
    assert.equal(server.rows.get('6B|SC-1|2').revision, 1);
    assert.equal(store.readLevelSave(deviceB, ID, 2).envelope.cloud.status, 'conflict');
    // Further saves for that game on device B are held, not sent.
    const held = await sync.syncProgress(v2Opts(runA, { currentRound: 10 }));
    assert.equal(held.held, true);
    assert.equal(server.log.length, 2);
});

test('SharePointSync v2: lost response is retried with the same ID and confirmed, never reported stale', async () => {
    const server = new ReferenceSaveServer();
    let drop = true;
    enableV2(server, { dropResponse: () => { const d = drop; drop = false; return d; } });
    const storage = createSessionStorage();
    const run = seedLocalSave(storage);
    global.localStorage = storage;
    const sync = loadSync();
    const first = await sync.syncProgress(v2Opts(run));
    assert.equal(first.queued, true);
    assert.equal(server.rows.get('6B|SC-1|2').revision, 1, 'server applied the write');
    const queuedItem = JSON.parse(storage.getItem('wa_gr_sync_queue'))[0];
    assert.equal(queuedItem.payload.saveRequestId, first.saveRequestId);
    assert.equal(queuedItem.payload.baseRevision, null, 'retry keeps its original base');
    await sync.retryQueue();
    assert.equal(sync.queueLength(), 0);
    assert.equal(server.log.at(-1).saveRequestId, first.saveRequestId);
    assert.equal(store.readLevelSave(storage, ID, 2).envelope.cloud.revision, 1);
    assert.equal(store.readLevelSave(storage, ID, 2).envelope.cloud.status, 'synced');
    assert.equal(server.rows.get('6B|SC-1|2').revision, 1, 'duplicate not re-applied');
});

test('SharePointSync v2: a legacy 200 is not treated as a confirmed v2 save', async () => {
    global.WA_GOLD_RUSH_RUNTIME_CONFIG = { featureFlags: { saveProtocolV2: true } };
    global.WA_GOLD_RUSH_FLOW_ENDPOINTS = { saveProgress: 'https://example.com/save' };
    global.WA_GOLD_RUSH_POWER_AUTOMATE = {
        callFlow: async () => ({ success: true, status: 200, data: { ok: true } }),
        resolveFlowEndpoint: (key) => global.WA_GOLD_RUSH_FLOW_ENDPOINTS[key] || ''
    };
    const storage = createSessionStorage();
    const run = seedLocalSave(storage);
    global.localStorage = storage;
    const sync = loadSync();
    const result = await sync.syncProgress(v2Opts(run));
    assert.equal(result.ok, false);
    assert.match(result.reason, /protocol_unconfirmed/);
    assert.equal(store.readLevelSave(storage, ID, 2).envelope.cloud.revision, null);
});

test('SharePointSync v2: queued pre-reset saves are withdrawn and a stale generation is never replayed', async () => {
    const server = new ReferenceSaveServer();
    enableV2(server, { dropResponse: () => true });
    const storage = createSessionStorage();
    const run = seedLocalSave(storage);
    global.localStorage = storage;
    const sync = loadSync();
    await sync.syncProgress(v2Opts(run));
    assert.equal(sync.queueLength(), 1);
    store.resetLevelSave(storage, ID, 2);
    assert.equal(sync.discardQueuedForProgressKey('6B|SC-1|2', 'superseded_by_reset'), 1);
    assert.equal(sync.queueLength(), 0);
    assert.ok(sync.getQuarantine().some((entry) => entry.reason === 'superseded_by_reset'));

    // An unsealed capture from the old run is refused at seal time.
    const sealed = require('../shared/save-protocol.js').seal({ ...v2Opts(run), progressKey: '6B|SC-1|2' }, storage);
    assert.equal(sealed.reason, 'local_save_missing');
});

test('SharePointSync: v2 queue items are held (not replayed) when the flag is turned off (rollback)', async () => {
    const server = new ReferenceSaveServer();
    enableV2(server, { dropResponse: () => true });
    const storage = createSessionStorage();
    const run = seedLocalSave(storage);
    global.localStorage = storage;
    const sync = loadSync();
    await sync.syncProgress(v2Opts(run));
    const calls = server.log.length;
    global.WA_GOLD_RUSH_RUNTIME_CONFIG = { featureFlags: {} };
    await sync.retryQueue();
    assert.equal(server.log.length, calls);
    assert.equal(sync.queueLength(), 1);
});

for (const mode of ['legacy', 'v2', 'rollback']) {
    for (const protection of ['conflict', 'hold', 'held', 'stale_generation', 'malformed', 'unsupported',
        'generation_mismatch', 'run_mismatch', 'recorded_conflict', 'unverified_new_slot']) {
        test(`SharePointSync ${mode}: ${protection} blocks direct and retry dispatch without changing protected data`, async () => {
            const server = new ReferenceSaveServer();
            enableV2(server);
            if (mode === 'legacy') global.WA_GOLD_RUSH_RUNTIME_CONFIG = { featureFlags: {} };
            const storage = createSessionStorage();
            const run = seedLocalSave(storage);
            global.localStorage = storage;
            const sync = loadSync();
            let calls = 0;
            let offline = true;
            const transport = server.transport();
            global.WA_GOLD_RUSH_POWER_AUTOMATE.callFlow = async (name, payload) => {
                calls += 1;
                if (offline) throw new Error('offline');
                return payload.protocolVersion === 2 ? transport(name, payload)
                    : { success: true, status: 200, data: { ok: true } };
            };
            const opts = v2Opts(run, mode === 'legacy' ? { protocolVersion: undefined } : {});
            assert.equal((await sync.syncProgress(opts)).queued, true);
            const queueBefore = storage.getItem('wa_gr_sync_queue');
            const queued = JSON.parse(queueBefore)[0];
            if (mode !== 'legacy') {
                assert.equal(queued.payload.baseRevision, null, 'the retained request is sealed');
                assert.ok(queued.payload.contentHash);
            }
            const saveKey = store.buildSaveKey(ID, 2);
            const ledgerKey = store.buildLedgerKey(ID);
            const envelope = JSON.parse(storage.getItem(saveKey));
            const ledger = JSON.parse(storage.getItem(ledgerKey));
            if (protection === 'malformed') storage.setItem(saveKey, '{unreadable');
            else if (protection === 'unsupported') {
                envelope.storageSchemaVersion = 999;
                storage.setItem(saveKey, JSON.stringify(envelope));
            } else if (protection === 'generation_mismatch' || protection === 'run_mismatch') {
                if (protection === 'generation_mismatch') ledger.levelRuns['2'].generation += 1;
                else ledger.levelRuns['2'].runId = 'another_run';
                storage.setItem(ledgerKey, JSON.stringify(ledger));
            } else if (protection === 'unverified_new_slot') {
                ledger.levelRuns['2'].cloudUploadHold = protection;
                storage.setItem(ledgerKey, JSON.stringify(ledger));
                assert.equal(store.getLevelWriteProtection(storage, ID, 2), '', 'local writes remain allowed');
            } else if (protection === 'recorded_conflict') {
                const protocol = require('../shared/save-protocol.js');
                const conflictedPayload = { ...queued.payload, protocolVersion: 2, runGeneration: run.generation, runId: run.runId };
                assert.equal(protocol.recordConflict(storage, conflictedPayload), true);
                assert.equal(protocol.hasConflict(storage, opts.progressKey || '6B|SC-1|2'), false,
                    'generation-qualified conflict keys do not match legacy rollback keys');
            } else {
                envelope.cloud = { ...envelope.cloud, status: protection, currentRevision: 7 };
                storage.setItem(saveKey, JSON.stringify(envelope));
            }
            if (mode === 'rollback') global.WA_GOLD_RUSH_RUNTIME_CONFIG = { featureFlags: {} };
            const saveBefore = storage.getItem(saveKey);
            const ledgerBefore = storage.getItem(ledgerKey);
            const conflictsBefore = storage.getItem('wa_gr_sync_conflicts');
            const expectedReason = protection === 'unverified_new_slot' ? protection
                : store.getLevelWriteProtection(storage, ID, 2);
            assert.ok(expectedReason);
            offline = false;
            const result = await sync.syncProgress(mode === 'rollback' ? { ...opts, protocolVersion: undefined } : opts);
            assert.equal(result.held, true);
            assert.equal(result.reason, expectedReason);
            assert.equal(result.queued, false, 'a new capture must not replace the held request');
            await sync.retryQueue();
            await sync.retryQueue();
            assert.equal(calls, 1, 'neither direct nor repeated retry dispatch may reach the flow');
            assert.equal(storage.getItem(saveKey), saveBefore, 'save slot and all cloud metadata are unchanged');
            assert.equal(storage.getItem(ledgerKey), ledgerBefore, 'historical ledger and run metadata are unchanged');
            assert.equal(storage.getItem('wa_gr_sync_conflicts'), conflictsBefore);
            assert.equal(storage.getItem('wa_gr_sync_queue'), queueBefore, 'exact payload, request ID, base and attempts are retained');
            assert.equal(sync.getQuarantine().length, 0, 'held requests are not rejected or deleted');
        });
    }
}

for (const v2 of [false, true]) {
    test(`SharePointSync ${v2 ? 'v2' : 'legacy'}: a protected level does not block another level's direct or retry saves`, async () => {
        const server = new ReferenceSaveServer();
        enableV2(server);
        if (!v2) global.WA_GOLD_RUSH_RUNTIME_CONFIG = { featureFlags: {} };
        const storage = createSessionStorage({}, { assignedLevel: 4 });
        const protectedRun = seedLocalSave(storage);
        const other = validCloudSave(4);
        assert.equal(store.adoptLevelRun(storage, other), true);
        assert.equal(store.writeLevelSave(storage, other).ok, true);
        global.localStorage = storage;
        const sync = loadSync();
        const captures = [
            v2Opts(protectedRun, { protocolVersion: v2 ? 2 : undefined }),
            v2Opts({ generation: other.generation, runId: other.runId }, { level: 4, protocolVersion: v2 ? 2 : undefined })
        ];
        global.WA_GOLD_RUSH_POWER_AUTOMATE.callFlow = async () => { throw new Error('offline'); };
        for (const opts of captures) assert.equal((await sync.syncProgress(opts)).queued, true);
        const heldItem = JSON.parse(storage.getItem('wa_gr_sync_queue'))[0];
        store.updateCloudState(storage, ID, 2, { cloud: { status: 'conflict', revision: 7 } });
        const protectedSave = storage.getItem(store.buildSaveKey(ID, 2));
        const ledgerBefore = storage.getItem(store.buildLedgerKey(ID));
        const sent = [];
        const transport = server.transport();
        global.WA_GOLD_RUSH_POWER_AUTOMATE.callFlow = async (name, payload) => {
            sent.push(payload);
            return v2 ? transport(name, payload) : { success: true, status: 200, data: { ok: true } };
        };
        await sync.retryQueue();
        assert.equal(sent.length, 1);
        assert.equal(sent[0].progressKey, '6B|SC-1|4');
        assert.equal((await sync.syncProgress(captures[1])).ok, true);
        assert.equal(sent.length, 2);
        assert.deepEqual(JSON.parse(storage.getItem('wa_gr_sync_queue')), [heldItem]);
        assert.equal(storage.getItem(store.buildSaveKey(ID, 2)), protectedSave);
        assert.equal(storage.getItem(store.buildLedgerKey(ID)), ledgerBefore);
        if (v2) assert.equal(store.readLevelSave(storage, ID, 4).envelope.cloud.revision, 2);
    });
}

test('SharePointSync: incompatible legacy captures are quarantined intact and never replayed after rollback', async () => {
    const server = new ReferenceSaveServer();
    enableV2(server);
    global.WA_GOLD_RUSH_RUNTIME_CONFIG = { featureFlags: {} };
    const storage = createSessionStorage({}, { assignedLevel: 4 });
    const run = seedLocalSave(storage);
    const other = validCloudSave(4);
    assert.equal(store.adoptLevelRun(storage, other), true);
    assert.equal(store.writeLevelSave(storage, other).ok, true);
    global.localStorage = storage;
    const sync = loadSync();
    global.WA_GOLD_RUSH_POWER_AUTOMATE.callFlow = async () => { throw new Error('offline'); };
    assert.equal((await sync.syncProgress(v2Opts(run, { protocolVersion: undefined }))).queued, true);
    const queueBefore = storage.getItem('wa_gr_sync_queue');
    const saveBefore = storage.getItem(store.buildSaveKey(ID, 2));
    const ledgerBefore = storage.getItem(store.buildLedgerKey(ID));
    const sent = [];
    const transport = server.transport();
    global.WA_GOLD_RUSH_POWER_AUTOMATE.callFlow = async (name, payload) => {
        sent.push(payload);
        return payload.protocolVersion === 2 ? transport(name, payload)
            : { success: true, status: 200, data: { ok: true } };
    };
    global.WA_GOLD_RUSH_RUNTIME_CONFIG = { featureFlags: { saveProtocolV2: true } };
    await sync.retryQueue();
    await sync.retryQueue();
    assert.equal(sent.length, 0, 'legacy requests are not upgraded or replayed');
    assert.equal(sync.queueLength(), 0);
    const quarantined = sync.getQuarantine();
    assert.equal(quarantined.length, 1);
    assert.equal(quarantined[0].reason, 'legacy_item_held_v2_active');
    const original = JSON.parse(queueBefore)[0];
    for (const field of ['type', 'payload', 'queuedAt', 'attempts']) {
        assert.deepEqual(quarantined[0][field], original[field], `${field} is preserved for manual reconciliation`);
    }
    assert.equal(storage.getItem(store.buildSaveKey(ID, 2)), saveBefore);
    assert.equal(storage.getItem(store.buildLedgerKey(ID)), ledgerBefore);
    assert.equal((await sync.syncProgress(v2Opts(
        { generation: other.generation, runId: other.runId }, { level: 4 }
    ))).ok, true);
    assert.equal(sent.length, 1);
    assert.equal(sync.queueLength(), 0);
    global.WA_GOLD_RUSH_RUNTIME_CONFIG = { featureFlags: {} };
    await sync.retryQueue();
    assert.equal(sent.length, 1, 'obsolete unconditional captures cannot overwrite newer saves after rollback');
    assert.deepEqual(sync.getQuarantine(), quarantined);
    assert.equal(sync.queueLength(), 0);
});

// ---------------------------------------------------------------------------
// Cloud restore adapter (gated)
// ---------------------------------------------------------------------------

function restoreGlobals(callFlow, flags = { fullCloudRestore: true }) {
    return {
        WA_GOLD_RUSH_RUNTIME_CONFIG: { featureFlags: flags },
        WA_GOLD_RUSH_FLOW_ENDPOINTS: { getStudentProgress: 'https://example.com/get-progress' },
        WA_GOLD_RUSH_POWER_AUTOMATE: {
            callFlow,
            resolveFlowEndpoint: (key) => (key === 'getStudentProgress' ? 'https://example.com/get-progress' : '')
        },
        WA_GOLD_RUSH_LEVEL_CAPABILITIES: caps,
        WA_GOLD_RUSH_LEVEL_SAVE_STORE: store
    };
}

function validCloudSave(level = 2, round = 8) {
    const snapshot = {
        level, round, cash: 1234, player: { classCode: '6B', studentCode: 'SC-1' },
        ownedMines: {}, machinery: [], roundHistory: [{ round: round - 1 }], investmentPlans: {}, totalProfitLoss: 5
    };
    return store.createEnvelope({ identity: ID, level, generation: 1, runId: 'run_cloud', startingNetWorth: 300, snapshot });
}

test('cloud restore: disabled or unconfigured makes no call', async () => {
    let calls = 0;
    const off = restoreGlobals(async () => { calls += 1; }, {});
    assert.equal((await cloudRestore.fetchLevelSave({ session: buildRosterSession(), level: 2 }, off)).reason, 'feature_disabled');
    const unconfigured = restoreGlobals(async () => { calls += 1; });
    unconfigured.WA_GOLD_RUSH_POWER_AUTOMATE.resolveFlowEndpoint = () => '';
    assert.equal((await cloudRestore.fetchLevelSave({ session: buildRosterSession(), level: 2 }, unconfigured)).reason, 'flow_unconfigured');
    assert.equal(calls, 0);
});

test('cloud restore: unknown, timeout, partial or legacy responses are never "missing"', async () => {
    const session = buildRosterSession();
    const cases = [
        [async () => new Promise(() => {}), 'failed'],
        [async () => ({ success: false, status: 500 }), 'failed'],
        [async () => ({ success: false, networkError: true }), 'failed'],
        [async () => ({ success: true, status: 200, data: null }), 'incomplete'],
        [async () => ({ success: true, status: 200, data: { ok: true, progress: [{ CheckpointStatus: 'quiz_passed' }] } }), 'incomplete'],
        [async () => ({ success: true, status: 200, data: { ok: true, contractVersion: cloudRestore.CONTRACT_VERSION, progressKey: '6B|SC-1|2' } }), 'incomplete'],
        [async () => ({ success: true, status: 200, data: { ok: true, contractVersion: cloudRestore.CONTRACT_VERSION, progressKey: '6B|SC-1|3', found: false } }), 'failed'],
        [async () => { throw new Error('boom'); }, 'failed']
    ];
    for (const [callFlow, expected] of cases) {
        const result = await cloudRestore.fetchLevelSave({ session, level: 2, timeoutMs: 20 }, restoreGlobals(callFlow));
        assert.equal(result.status, expected, `${result.reason}`);
        const decision = cloudRestore.reconcile({ status: 'missing' }, result);
        assert.equal(decision.action, 'start_local_unsynced', 'unknown cloud state never authorises create/upload');
    }
});

test('cloud restore: explicit not-found, malformed save and mismatched owner are distinguished', async () => {
    const session = buildRosterSession();
    const body = (extra) => async () => ({ success: true, status: 200, data: { ok: true, contractVersion: cloudRestore.CONTRACT_VERSION, progressKey: '6B|SC-1|2', ...extra } });
    assert.equal((await cloudRestore.fetchLevelSave({ session, level: 2 }, restoreGlobals(body({ found: false })))).status, 'missing');
    const malformed = { ...store.clone(validCloudSave()), snapshot: { level: 2 } };
    assert.equal((await cloudRestore.fetchLevelSave({ session, level: 2 }, restoreGlobals(body({ found: true, revision: 3, save: malformed })))).status, 'incomplete');
    const otherOwner = store.createEnvelope({ ...validCloudSave(), identity: { classCode: '6B', studentCode: 'SC-2' }, level: 2, generation: 1, runId: 'r', snapshot: { ...validCloudSave().snapshot, player: { classCode: '6B', studentCode: 'SC-2' } } });
    assert.equal((await cloudRestore.fetchLevelSave({ session, level: 2 }, restoreGlobals(body({ found: true, revision: 3, save: otherOwner })))).reason, 'owner_mismatch');
    const wrongLevel = validCloudSave(3);
    assert.equal((await cloudRestore.fetchLevelSave({ session, level: 2 }, restoreGlobals(body({ found: true, revision: 3, save: wrongLevel })))).status, 'failed');
    const ok = await cloudRestore.fetchLevelSave({ session, level: 2 }, restoreGlobals(body({ found: true, revision: 3, save: validCloudSave() })));
    assert.equal(ok.status, 'found');
    assert.equal(ok.revision, 3);
    assert.equal(Object.isFrozen(ok.envelope), true);
});

test('cloud restore: reconcile never auto-overwrites unsent local changes', () => {
    const cloud = { status: 'found', revision: 5, envelope: { ...validCloudSave(), cloud: { status: 'synced', revision: 5 } } };
    const local = (cloudState, runId = 'run_cloud') => ({ status: 'found', envelope: { ...validCloudSave(), runId, cloud: cloudState } });
    assert.equal(cloudRestore.reconcile({ status: 'missing' }, cloud).action, 'adopt_cloud');
    assert.equal(cloudRestore.reconcile(local({ status: 'synced', revision: 4 }), cloud).action, 'adopt_cloud');
    assert.equal(cloudRestore.reconcile(local({ status: 'pending', revision: 4 }), cloud).action, 'conflict');
    assert.equal(cloudRestore.reconcile(local({ status: 'pending', revision: 5 }), cloud).action, 'resume_local');
    assert.equal(cloudRestore.reconcile(local({ status: 'synced', revision: 5 }, 'run_other'), cloud).action, 'conflict');
    assert.equal(cloudRestore.reconcile(local({ status: 'local_only', revision: null }), { status: 'missing' }).action, 'upload_local_create');
    assert.equal(cloudRestore.reconcile(local({ status: 'synced', revision: 2 }), { status: 'missing' }).action, 'conflict');
    assert.equal(cloudRestore.reconcile({ status: 'missing' }, { status: 'missing' }).action, 'start_new');
});

test('cloud restore: cross-device harness adopts the exact saved game on a new device', async () => {
    // Device A plays Level 3 and its (mocked) cloud row holds the full save.
    const deviceA = createSessionStorage({}, { assignedLevel: 3 });
    const a = buildStudentGameHarness({ level: 3, storage: deviceA });
    playSomeRounds(a.gameState, { round: 6, cash: 6543 });
    const cloudSave = store.clone(store.readLevelSave(deviceA, ID, 3).envelope);

    const deviceB = createSessionStorage({}, { assignedLevel: 3 });
    const callFlow = async (name, payload) => {
        assert.equal(name, 'getStudentProgress');
        assert.equal(payload.progressKey, '6B|SC-1|3');
        return { success: true, status: 200, data: { ok: true, contractVersion: cloudRestore.CONTRACT_VERSION, progressKey: '6B|SC-1|3', found: true, revision: 4, runGeneration: 1, save: cloudSave } };
    };
    const globals = restoreGlobals(callFlow);
    const b = buildStudentGameHarness({ level: 3, storage: deviceB, extraGlobals: { ...globals, WA_GOLD_RUSH_LEVEL_CAPABILITIES: undefined, WA_GOLD_RUSH_LEVEL_SAVE_STORE: undefined } });
    assert.equal(b.loadResult.status, 'started');
    const decision = await b.context.maybeRestoreLevelFromCloud(buildRosterSession({ assignedLevel: 3 }), 3);
    assert.equal(decision.action, 'adopt_cloud');
    assert.equal(b.context.getLevelLoadState().status, 'restored');
    assert.equal(b.gameState.round, 6);
    assert.equal(b.gameState.cash, 6543);
    assert.equal(store.readLevelSave(deviceB, ID, 3).envelope.cloud.revision, 4);
});

test('cloud restore: unknown cloud state holds legacy uploads and discloses local-only play', async () => {
    const storage = createSessionStorage();
    const globals = restoreGlobals(async () => ({ success: false, status: 503 }));
    const h = buildStudentGameHarness({ level: 2, storage, extraGlobals: { ...globals, WA_GOLD_RUSH_LEVEL_CAPABILITIES: undefined, WA_GOLD_RUSH_LEVEL_SAVE_STORE: undefined } });
    const decision = await h.context.maybeRestoreLevelFromCloud(buildRosterSession(), 2);
    assert.equal(decision.action, 'start_local_unsynced');
    assert.equal(h.context.getCloudUploadHold(), 'cloud_state_unknown');
    assert.equal(h.context.getLevelLoadState().status, 'local_only');
});

// ---------------------------------------------------------------------------
// Leaderboards
// ---------------------------------------------------------------------------

const ROSTER = [
    { studentCode: 'SC-1', classCode: '6B', leaderboardName: 'Gold Miner', LeaderboardName: 'Gold Miner', studentName: 'Alex Smith', studentId: '123456', level: 2, currentLevel: 5, progressedLevel: 5 },
    { studentCode: 'SC-2', classCode: '6B', leaderboardName: 'Nugget', LeaderboardName: 'Nugget', studentName: 'Sam Lee', studentId: '654321', level: 2 },
    { studentCode: 'SC-3', classCode: '6B', leaderboardName: 'Pat Doe', studentName: 'Pat Doe', studentId: '111111', level: 2 }
];

function row(studentCode, level, extra = {}) {
    return { studentCode, classCode: '6B', level, progressKey: `6B|${studentCode}|${level}`, round: 5, netWorth: 1000, ...extra };
}

test('leaderboard ranks per-level saved rows; the same student appears on several levels', () => {
    const progress = [
        row('SC-1', 2, { netWorth: 50000, startingNetWorth: 300 }),
        row('SC-1', 5, { netWorth: 1000, startingNetWorth: 900 }),
        row('SC-2', 2, { netWorth: 2000, startingNetWorth: 300 })
    ];
    const l2 = leaderboard.buildLevelLeaderboard({ students: ROSTER, progress, level: 2 });
    assert.deepEqual(l2.entries.map((e) => [e.rank, e.leaderboardName, e.netWorth]), [[1, 'Gold Miner', 50000], [2, 'Nugget', 2000]]);
    const l5 = leaderboard.buildLevelLeaderboard({ students: ROSTER, progress, level: 5 });
    assert.deepEqual(l5.entries.map((e) => e.leaderboardName), ['Gold Miner']);
    const l3 = leaderboard.buildLevelLeaderboard({ students: ROSTER, progress, level: 3 });
    assert.equal(l3.entries.length, 0, 'roster CurrentLevel/ProgressedLevel never place a student on a board');
    for (const entry of [...l2.entries, ...l5.entries]) {
        const json = JSON.stringify(entry);
        assert.doesNotMatch(json, /Alex Smith|Sam Lee|123456|654321|SC-1|SC-2|studentName|studentId|studentCode/);
    }
});

test('leaderboard excludes unplayed defaults, held rows, unknown roster and never uses real names', () => {
    const progress = [
        row('SC-1', 2, { round: 1, netWorth: 300 }),
        row('SC-2', 2, { LeaderboardStatus: 'held' }),
        row('SC-9', 2),
        row('SC-3', 2, { netWorth: 1500 }),
        { studentCode: 'SC-2', classCode: '', level: 2, round: 5, netWorth: 1 }
    ];
    const board = leaderboard.buildLevelLeaderboard({ students: ROSTER, progress, level: 2 });
    assert.deepEqual(board.entries.map((e) => e.leaderboardName), [leaderboard.PLACEHOLDER_NAME]);
    assert.equal(board.excluded.not_yet_played, 1);
    assert.equal(board.excluded.held_for_review, 1);
    assert.equal(board.excluded.not_on_authorized_roster, 1);
    assert.equal(board.excluded.class_or_student_missing, 1);
});

test('leaderboard profit/ROI need this run\'s baseline; zero or missing baselines are unrankable', () => {
    const progress = [
        row('SC-1', 2, { netWorth: 1300, startingNetWorth: 300 }),
        row('SC-2', 2, { netWorth: 9999 }),
        row('SC-3', 2, { netWorth: 500, startingNetWorth: 0, totalProfitLoss: 500 })
    ];
    const profit = leaderboard.buildLevelLeaderboard({ students: ROSTER, progress, level: 2, metric: 'profit' });
    assert.deepEqual(profit.entries.map((e) => [e.leaderboardName, e.value]), [[leaderboard.PLACEHOLDER_NAME, 500], ['Gold Miner', 1000]].sort((a, b) => b[1] - a[1]));
    assert.equal(profit.unrankable.missing_baseline, 1, 'missing baseline is not back-filled from netWorth');
    const roi = leaderboard.buildLevelLeaderboard({ students: ROSTER, progress, level: 2, metric: 'roi' });
    assert.deepEqual(roi.entries.map((e) => e.leaderboardName), ['Gold Miner']);
    assert.equal(roi.entries[0].value, 1000 / 300);
    assert.equal(roi.unrankable.non_positive_baseline, 1);
    assert.equal(roi.unrankable.missing_baseline, 1);

    const markerRow = row('SC-2', 2, { netWorth: 600, ProgressionMarkersJson: JSON.stringify({ run: { generation: 1, startingNetWorth: 300 } }) });
    assert.equal(leaderboard.readStartingNetWorth(markerRow), 300);
    assert.equal(leaderboard.readStartingNetWorth({ ...markerRow, RunGeneration: 2 }), null, 'baseline from another run is ignored');
});

function competitionBaseline(studentCode, level, overrides = {}) {
    return {
        competitionId: 'term-1',
        classCode: '6B',
        level,
        studentCode,
        baselineNetWorth: 300,
        baselineRevision: 1,
        baselineGeneration: 1,
        baselineCapturedAt: '2026-10-22T12:00:00.000Z',
        status: 'active',
        ...overrides
    };
}

test('competition baseline capture and read are additive, level-keyed, and reject held or conflicted saves', () => {
    const progressRow = row('SC-1', 2, { netWorth: 1400, Revision: 3, RunGeneration: 1 });
    const captured = competitionBaselines.captureCompetitionBaseline({
        competitionId: 'term-1',
        progressRow,
        baselineCapturedAt: '2026-10-22T12:00:00.000Z'
    });
    assert.equal(captured.ok, true);
    assert.deepEqual(Object.keys(captured.baseline), [
        'competitionId', 'classCode', 'level', 'studentCode', 'baselineNetWorth',
        'baselineRevision', 'baselineGeneration', 'baselineCapturedAt', 'status'
    ]);
    assert.equal(captured.baseline.baselineRevision, 3);
    assert.equal(captured.baseline.baselineGeneration, 1);
    assert.equal(competitionBaselines.readCompetitionBaseline(
        [captured.baseline, competitionBaseline('SC-1', 4)],
        { competitionId: 'term-1', classCode: '6B', level: 2, studentCode: 'SC-1' }
    ).baseline.level, 2);
    assert.equal(competitionBaselines.readCompetitionBaseline(
        [captured.baseline, competitionBaseline('SC-1', 4)],
        { competitionId: 'term-1', classCode: '6B', level: 4, studentCode: 'SC-1' }
    ).baseline.level, 4);
    const legacyBaseline = competitionBaselines.captureCompetitionBaseline({
        competitionId: 'term-1',
        progressRow: row('SC-2', 2, { netWorth: 900 }),
        baselineCapturedAt: '2026-10-22T12:00:00.000Z'
    });
    assert.equal(legacyBaseline.ok, true);
    assert.equal(legacyBaseline.baseline.baselineRevision, null);
    assert.equal(legacyBaseline.baseline.baselineGeneration, null);
    const frozenBaseline = competitionBaselines.transitionBaselineStatus(captured.baseline, 'frozen');
    assert.equal(frozenBaseline.baseline.status, 'frozen');
    assert.equal(competitionBaselines.transitionBaselineStatus(frozenBaseline.baseline, 'active').reason, 'invalid_status_transition');
    assert.equal(competitionBaselines.captureCompetitionBaseline({
        competitionId: 'term-1',
        progressRow: { ...progressRow, ReviewStatus: 'Under Review' },
        baselineCapturedAt: '2026-10-22T12:00:00.000Z'
    }).reason, 'held_for_review');
    assert.equal(competitionBaselines.captureCompetitionBaseline({
        competitionId: 'term-1',
        progressRow: { ...progressRow, SaveStatus: 'revision_conflict' },
        baselineCapturedAt: '2026-10-22T12:00:00.000Z'
    }).reason, 'save_conflict');
    assert.equal(competitionBaselines.readCompetitionBaseline(
        [captured.baseline, captured.baseline],
        { competitionId: 'term-1', classCode: '6B', level: 2, studentCode: 'SC-1' }
    ).reason, 'duplicate_baseline');
});

test('competitionProfit ranks per class and level; missing, held, reset, and conflicted rows never win', () => {
    global.WA_GOLD_RUSH_RUNTIME_CONFIG = {
        featureFlags: { competitionBaselines: true, competitionLeaderboardMetric: true }
    };
    const students = [
        ...ROSTER,
        { studentCode: 'SC-4', classCode: '6B', leaderboardName: 'Reset' },
        { studentCode: 'SC-5', classCode: '6B', leaderboardName: 'Conflict' },
        { studentCode: 'SC-6', classCode: '7B', leaderboardName: 'Other class' },
        { studentCode: 'SC-7', classCode: '6B', leaderboardName: 'No baseline' },
        { studentCode: 'SC-8', classCode: '6B', leaderboardName: 'Stale revision' }
    ];
    const progress = [
        row('SC-1', 2, { netWorth: 1000, Revision: 2, RunGeneration: 1 }),
        row('SC-1', 4, { netWorth: 950, Revision: 2, RunGeneration: 1 }),
        row('SC-2', 2, { netWorth: 2000, Revision: 2, RunGeneration: 1 }),
        row('SC-3', 2, { netWorth: 3000, Revision: 2, RunGeneration: 1, ReviewStatus: 'Under Review' }),
        row('SC-4', 2, { netWorth: 4000, Revision: 2, RunGeneration: 2 }),
        row('SC-5', 2, { netWorth: 5000, Revision: 2, RunGeneration: 1, revisionConflict: true }),
        { ...row('SC-6', 2, { netWorth: 800, Revision: 2, RunGeneration: 1 }), classCode: '7B', progressKey: '7B|SC-6|2' },
        row('SC-7', 2, { netWorth: 2000, Revision: 2, RunGeneration: 1 }),
        row('SC-8', 2, { netWorth: 2000, Revision: 0, RunGeneration: 1 })
    ];
    const baselines = [
        competitionBaseline('SC-1', 2, { baselineNetWorth: 300, baselineRevision: 1 }),
        competitionBaseline('SC-1', 4, { baselineNetWorth: 900, baselineRevision: 1 }),
        competitionBaseline('SC-2', 2, { baselineNetWorth: 400, baselineRevision: 1 }),
        competitionBaseline('SC-4', 2, { baselineNetWorth: 500, baselineRevision: 1 }),
        competitionBaseline('SC-5', 2, { baselineNetWorth: 500, baselineRevision: 1 }),
        competitionBaseline('SC-6', 2, { classCode: '7B', baselineNetWorth: 300, baselineRevision: 1 }),
        competitionBaseline('SC-8', 2, { baselineNetWorth: 500, baselineRevision: 1 })
    ];

    const level2 = leaderboard.buildLevelLeaderboard({
        students, progress, level: 2, metric: 'competitionProfit',
        competitionId: 'term-1', competitionBaselines: baselines
    });
    assert.deepEqual(level2.entries.map(({ classCode, rank, leaderboardName, value }) =>
        [classCode, rank, leaderboardName, value]), [
        ['6B', 1, 'Nugget', 1600],
        ['6B', 2, 'Gold Miner', 700],
        ['7B', 1, 'Other class', 500]
    ]);
    assert.equal(level2.unrankable.missing_baseline, 1);
    assert.equal(level2.unrankable.generation_changed, 1);
    assert.equal(level2.unrankable.save_conflict, 1);
    assert.equal(level2.unrankable.revision_stale, 1);
    assert.equal(level2.excluded.held_for_review, 1);
    assert.equal(Object.hasOwn(level2.entries[0], 'startingNetWorth'), false);

    const level4 = leaderboard.buildLevelLeaderboard({
        students, progress, level: 4, metric: 'competitionProfit',
        competitionId: 'term-1', competitionBaselines: baselines
    });
    assert.deepEqual(level4.entries.map((entry) => [entry.level, entry.leaderboardName, entry.value]), [
        [4, 'Gold Miner', 50]
    ]);
    assert.doesNotMatch(JSON.stringify([...level2.entries, ...level4.entries]),
        /Alex Smith|Sam Lee|123456|654321|SC-[1-8]|studentName|studentId|studentCode/i);
    const duplicateSave = leaderboard.buildLevelLeaderboard({
        students,
        progress: [...progress, row('SC-1', 2, { netWorth: 1100, Revision: 2, RunGeneration: 1 })],
        level: 2,
        metric: 'competitionProfit',
        competitionId: 'term-1',
        competitionBaselines: baselines
    });
    assert.equal(duplicateSave.entries.some((entry) => entry.leaderboardName === 'Gold Miner'), false);
    assert.equal(duplicateSave.unrankable.duplicate_progress_row, 1);
    const frozenBaselineBoard = leaderboard.buildLevelLeaderboard({
        students,
        progress: [row('SC-1', 2, { netWorth: 1100, Revision: 2, RunGeneration: 1 })],
        level: 2,
        metric: 'competitionProfit',
        competitionId: 'term-1',
        competitionBaselines: [competitionBaseline('SC-1', 2, { status: 'frozen' })]
    });
    assert.equal(frozenBaselineBoard.entries.length, 0);
    assert.equal(frozenBaselineBoard.unrankable.baseline_not_active, 1);
});

test('competition ranking flags default OFF without changing existing leaderboard metrics', () => {
    assert.equal(caps.getFeatureFlags({}).competitionBaselines, false);
    assert.equal(caps.getFeatureFlags({}).competitionLeaderboardMetric, false);
    assert.equal(caps.getFeatureFlags({}).competitionSnapshots, false);
    const input = {
        students: ROSTER,
        progress: [row('SC-1', 2, { netWorth: 1300, startingNetWorth: 300 })],
        level: 2,
        metric: 'netWorth',
        competitionId: 'term-1',
        competitionBaselines: []
    };
    const before = leaderboard.buildLevelLeaderboard({ ...input, metric: 'netWorth' });
    const after = leaderboard.buildLevelLeaderboard(input);
    assert.deepEqual(after.entries, before.entries);
    assert.equal(leaderboard.buildLevelLeaderboard({
        ...input,
        metric: 'competitionProfit'
    }).reason, 'feature_disabled');
});

test('competition rankings replace a nickname matching the real name', () => {
    global.WA_GOLD_RUSH_RUNTIME_CONFIG = {
        featureFlags: { competitionBaselines: true, competitionLeaderboardMetric: true }
    };
    const privateName = 'Private Student';
    const board = leaderboard.buildLevelLeaderboard({
        students: [{
            studentCode: 'SC-1',
            classCode: '6B',
            leaderboardName: privateName,
            LeaderboardName: privateName,
            studentName: privateName,
            StudentName: privateName
        }],
        progress: [row('SC-1', 2, { netWorth: 1000, Revision: 2, RunGeneration: 1 })],
        competitionId: 'term-1',
        competitionBaselines: [competitionBaseline('SC-1', 2)],
        level: 2,
        metric: 'competitionProfit'
    });
    assert.equal(board.entries[0].leaderboardName, leaderboard.PLACEHOLDER_NAME);
    assert.doesNotMatch(JSON.stringify(board.entries), /Private Student|SC-1/i);
});

test('competition snapshot scaffold does not call an unconfigured or disabled endpoint', async () => {
    let attempts = 0;
    const payload = { competitionId: 'term-1', classCodes: ['6B'], level: 2 };
    const callFlow = async () => { attempts++; return { success: true, data: {} }; };
    const root = {
        WA_GOLD_RUSH_LEVEL_CAPABILITIES: caps,
        WA_GOLD_RUSH_RUNTIME_CONFIG: { featureFlags: { competitionBaselines: true } },
        WA_GOLD_RUSH_FLOW_ENDPOINTS: {},
        WA_GOLD_RUSH_POWER_AUTOMATE: { callFlow }
    };
    const missing = await competitionSnapshot.requestCompetitionSnapshot('capture_baseline', payload, { root });
    assert.deepEqual(missing, { ok: false, status: 'unavailable', reason: 'endpoint_unconfigured' });
    assert.equal(attempts, 0);

    root.WA_GOLD_RUSH_FLOW_ENDPOINTS.copyCompetitionSnapshot = 'REPLACE-WITH-FLOW-URL';
    const placeholder = await competitionSnapshot.requestCompetitionSnapshot('capture_baseline', payload, { root });
    assert.equal(placeholder.reason, 'endpoint_unconfigured');
    assert.equal(attempts, 0);

    root.WA_GOLD_RUSH_FLOW_ENDPOINTS.copyCompetitionSnapshot = 'https://example.test/competition';
    const freezeDisabled = await competitionSnapshot.requestCompetitionSnapshot('freeze', payload, { root });
    assert.equal(freezeDisabled.reason, 'feature_disabled');
    assert.equal(attempts, 0);

    root.WA_GOLD_RUSH_RUNTIME_CONFIG.featureFlags.competitionBaselines = false;
    const disabled = await competitionSnapshot.requestCompetitionSnapshot('capture_baseline', payload, { root });
    assert.equal(disabled.reason, 'feature_disabled');
    assert.equal(attempts, 0);
});

test('competition snapshot calls require flags and return no private flow fields', async () => {
    let request;
    const root = {
        WA_GOLD_RUSH_LEVEL_CAPABILITIES: caps,
        WA_GOLD_RUSH_RUNTIME_CONFIG: {
            featureFlags: { competitionBaselines: true, competitionSnapshots: true }
        },
        WA_GOLD_RUSH_FLOW_ENDPOINTS: { copyCompetitionSnapshot: 'https://example.test/competition' },
        WA_GOLD_RUSH_POWER_AUTOMATE: {
            callFlow: async (name, payload) => {
                request = { name, payload };
                return {
                    success: true,
                    data: {
                        ok: true,
                        contractVersion: competitionSnapshot.CONTRACT_VERSION,
                        operation: 'freeze',
                        status: 'frozen',
                        competitionId: 'term-1',
                        level: 2,
                        recordCount: 2,
                        StudentName: 'Private Name',
                        StudentID: '123456',
                        StudentCode: 'SC-1'
                    }
                };
            }
        }
    };
    const frozen = await competitionSnapshot.requestCompetitionSnapshot(
        'freeze', { competitionId: 'term-1', classCodes: ['6B'], level: 2 }, { root }
    );
    assert.equal(request.name, 'copyCompetitionSnapshot');
    assert.equal(request.payload.contractVersion, competitionSnapshot.CONTRACT_VERSION);
    assert.equal(frozen.status, 'frozen');
    assert.equal(frozen.recordCount, 2);
    assert.doesNotMatch(JSON.stringify(frozen), /Private Name|123456|SC-1|studentName|studentId|studentCode/i);
});

test('competition snapshot timeout fails closed', async () => {
    const root = {
        WA_GOLD_RUSH_LEVEL_CAPABILITIES: caps,
        WA_GOLD_RUSH_RUNTIME_CONFIG: { featureFlags: { competitionBaselines: true } },
        WA_GOLD_RUSH_FLOW_ENDPOINTS: { copyCompetitionSnapshot: 'https://example.test/competition' },
        WA_GOLD_RUSH_POWER_AUTOMATE: { callFlow: () => new Promise(() => {}) }
    };
    const result = await competitionSnapshot.requestCompetitionSnapshot(
        'capture_baseline',
        { competitionId: 'term-1', classCodes: ['6B'], level: 2 },
        { root, timeoutMs: 1 }
    );
    assert.deepEqual(result, { ok: false, status: 'unavailable', reason: 'flow_timeout' });
});

test('teacher dashboard getLevelLeaderboard filters by level and labels current (not all-time) standings', () => {
    const TeacherDashboard = require('../teacher/dashboard-state.js');
    const dashboard = new TeacherDashboard();
    dashboard.students = ROSTER.map((student) => ({
        ...student,
        progressRecords: [row(student.studentCode, 2, { netWorth: student.studentCode === 'SC-2' ? 5000 : 1000 }), row(student.studentCode, 4, { netWorth: 70 })]
    }));
    const l2 = dashboard.getLevelLeaderboard(2);
    assert.equal(l2.top20.length, 3);
    assert.equal(l2.topCurrent.leaderboardName, 'Nugget');
    assert.equal(l2.allTimeRecord, undefined);
    const l4 = dashboard.getLevelLeaderboard(4);
    assert.ok(l4.top20.every((entry) => entry.level === 4 && entry.netWorth === 70));
    assert.equal(dashboard.getLevelLeaderboard(3).top20.length, 0);
    const html = fs.readFileSync(require.resolve('../teacher/dashboard.html'), 'utf8');
    assert.doesNotMatch(html, /All-Time Level/);
    assert.match(html, /id="leaderboardMetric"/);
    assert.match(html, /#leaderboardTabs \.tab-btn'\)\.forEach\(btn => \{\s*btn\.addEventListener\('click'/);
});

// ---------------------------------------------------------------------------
// Capabilities: planned flows and Level 6
// ---------------------------------------------------------------------------

test('planned flows are never callable without their flag and a configured endpoint', () => {
    const root = {
        WA_GOLD_RUSH_FLOW_ENDPOINTS: {
            resetLevelProgress: 'https://example.com/reset',
            getLeaderboard: 'https://example.com/lb',
            copyCompetitionSnapshot: 'https://example.com/copy',
            level6HistoricalResults: 'https://example.com/l6'
        }
    };
    for (const flow of ['resetLevelProgress', 'getLeaderboard', 'copyCompetitionSnapshot', 'level6HistoricalResults']) {
        assert.equal(caps.isFlowCallable(flow, root), false, `${flow} must stay off by default`);
        assert.equal(caps.FLOWS[flow].status, 'planned');
    }
    assert.equal(caps.isFlowCallable('resetLevelProgress', { ...root, WA_GOLD_RUSH_RUNTIME_CONFIG: { featureFlags: { levelResetFlow: true } } }), true);
    assert.equal(caps.isFlowCallable('resetLevelProgress', { WA_GOLD_RUSH_RUNTIME_CONFIG: { featureFlags: { levelResetFlow: true } } }), false);
    assert.equal(caps.isFlowCallable('getLeaderboard', { ...root, WA_GOLD_RUSH_RUNTIME_CONFIG: { featureFlags: { serverLeaderboard: 'true' } } }), false, 'only literal true enables a flag');
    assert.ok(Object.values(caps.getFeatureFlags({})).every((value) => value === false));
    const registry = read('shared/level-capabilities.js');
    assert.doesNotMatch(registry, /https:\/\//, 'no endpoint URLs in the registry');
});

test('Level 6 is recognised but not playable, assignable, unlockable or routable', () => {
    assert.equal(caps.isRecognizedLevel(6), true);
    assert.equal(caps.isPlayableLevel(6), false);
    assert.equal(caps.isSavePipelineLevel(6), false);
    assert.equal(caps.isRosterAssignableLevel(6), false);
    assert.equal(caps.getNextPlayableLevel(5), null);
    assert.equal(caps.getLevel(6).title, 'Goldfields Mastery');

    const storage = createSessionStorage({}, { assignedLevel: 5 });
    store.recordProgressionEvidence(storage, ID, 5, { checkpointStatus: 'quiz_passed' });
    const { LevelAccessGuard } = require('../levels/level-2-tycoon/level-access-guard.js');
    global.localStorage = storage;
    assert.equal(new LevelAccessGuard(6).isLevelAccessible(), false);
    const l5 = buildStudentGameHarness({ level: 5, storage });
    assert.equal(l5.context.getNextAssignedLevel(), null, 'passing Level 5 does not unlock planned Level 6');

    const sessionApi = require('../shared/student-session.js');
    const login = sessionApi.createSessionFromLogin({ ok: true, studentCode: 'SC-1', studentId: '1', studentName: 'A', leaderboardName: 'B', classCode: '6B', level: 5, progressedLevel: 6, currentLevel: 6 });
    assert.equal(login.ok, true, 'a recorded Level 6 progression does not invalidate login');
    assert.equal(login.session.progressedLevel, 5, 'and never raises entitlement to planned Level 6');
    assert.equal(login.session.currentLevel, 5);

    const home = read('index.html');
    assert.match(home, /id: 6,[\s\S]*?status: 'planned'/);
    assert.match(home, /function isLevelAccessible\(level\) \{\s*if \(!isLevelPlayable\(level\)\) return false;/);
    const dashboard = read('teacher/dashboard.html');
    assert.match(dashboard, /<option value="6" disabled>/);
});

test('home page level cards run legacy migration and use roster entitlement plus per-level save status', () => {
    const home = read('index.html');
    assert.ok(home.indexOf('shared/level-save-store.js') < home.indexOf('level-access-guard.js'));
    assert.match(home, /function renderLevels\(\) \{\s*ensureLegacySaveMigration\(\);/);
    assert.match(home, /describeLevelSave\(localStorage, session, level\.number\)/);
    const levelPage = read('levels/level-2-tycoon/index.html');
    for (const script of ['level-capabilities.js', 'level-save-store.js', 'save-protocol.js', 'cloud-restore.js']) {
        assert.ok(levelPage.indexOf(script) > 0 && levelPage.indexOf(script) < levelPage.indexOf('game-state.js'), `${script} loads before game-state.js`);
    }
    assert.match(levelPage, /id="levelSaveStatus"[^>]*role="status"/);
});

// AC2, AC5, AC8, AC9 Regression Tests
test('AC2: sealed v2 requests in queue are not replaced by new enqueue (prevent race)', async () => {
    const server = new ReferenceSaveServer();
    enableV2(server, { dropResponse: () => true });
    const storage = createSessionStorage();
    const run = seedLocalSave(storage);
    global.localStorage = storage;
    const sync = loadSync();

    await sync.syncProgress(v2Opts(run, { currentRound: 3 }));
    assert.equal(sync.queueLength(), 1);
    const queue1 = JSON.parse(storage.getItem('wa_gr_sync_queue'));
    assert.equal(queue1[0].payload.baseRevision, null);

    await sync.syncProgress(v2Opts(run, { currentRound: 9 }));
    assert.equal(sync.queueLength(), 2, 'AC2: new pending appended, sealed preserved');
    const queue2 = JSON.parse(storage.getItem('wa_gr_sync_queue'));
    assert.equal(queue2[0].payload.baseRevision, null);
    assert.equal(queue2[1].payload.baseRevision, undefined);
});

test('AC5: legacy upload holds are scoped to the recorded level', () => {
    const storage = createSessionStorage(
        { level2_autosave: legacyAutosave({ player: { studentCode: 'SC-1' } }) },
        { assignedLevel: 3 }
    );
    store.migrateLegacyAutosave(storage, ID);
    assert.equal(store.getUploadHold(storage, ID, 3), 'legacy_missing_class');
    assert.equal(store.getUploadHold(storage, ID, 2), '');
});

test('AC8: unconfirmed saves mark cloud state unknown without recording revision', async () => {
    global.WA_GOLD_RUSH_RUNTIME_CONFIG = { featureFlags: { saveProtocolV2: true } };
    global.WA_GOLD_RUSH_FLOW_ENDPOINTS = { saveProgress: 'https://example.com/save' };
    global.WA_GOLD_RUSH_POWER_AUTOMATE = {
        callFlow: async () => ({ success: true, status: 200, data: { ok: true } }),
        resolveFlowEndpoint: (key) => global.WA_GOLD_RUSH_FLOW_ENDPOINTS[key] || ''
    };
    const storage = createSessionStorage();
    const run = seedLocalSave(storage);
    global.localStorage = storage;
    const sync = loadSync();

    const result = await sync.syncProgress(v2Opts(run));
    assert.match(result.reason, /unconfirmed/);

    const env = store.readLevelSave(storage, ID, 2).envelope;
    assert.equal(env.cloud.revision, null, 'AC8: revision not recorded from unconfirmed');
    assert.equal(env.cloud.status, 'unknown', 'AC8: status reset');
});

test('AC9: v2 queue items held (not replayed) when v2 disabled during retry', async () => {
    const server = new ReferenceSaveServer();
    enableV2(server, { dropResponse: () => true });
    const storage = createSessionStorage();
    const run = seedLocalSave(storage);
    global.localStorage = storage;
    const sync = loadSync();

    await sync.syncProgress(v2Opts(run));
    assert.equal(sync.queueLength(), 1);
    const itemBefore = JSON.parse(storage.getItem('wa_gr_sync_queue'))[0];

    global.WA_GOLD_RUSH_RUNTIME_CONFIG = { featureFlags: {} };
    const callsBefore = server.log.length;

    await sync.retryQueue();
    assert.equal(server.log.length, callsBefore, 'AC9: no server call during rollback');
    assert.equal(sync.queueLength(), 1);

    const itemAfter = JSON.parse(storage.getItem('wa_gr_sync_queue'))[0];
    assert.equal(itemAfter.payload.saveRequestId, itemBefore.payload.saveRequestId);
});

function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}

function ackFor(payload, revision = 1) {
    return { success: true, status: 200, data: {
        ok: true, protocolVersion: 2, saveRequestId: payload.saveRequestId,
        progressKey: payload.progressKey, runGeneration: payload.runGeneration, revision
    } };
}

test('retry drains serialize and preserve enqueue during await with immutable sealed IDs', async () => {
    enableV2(new ReferenceSaveServer());
    const storage = createSessionStorage();
    const run = seedLocalSave(storage);
    global.localStorage = storage;
    const sync = loadSync();
    global.WA_GOLD_RUSH_POWER_AUTOMATE.callFlow = async () => ({ success: false, status: 503 });
    const first = await sync.syncProgress(v2Opts(run));
    const waiting = deferred();
    const sent = [];
    global.WA_GOLD_RUSH_POWER_AUTOMATE.callFlow = (key, payload) => {
        sent.push(payload);
        return waiting.promise;
    };
    const drain = sync.retryQueue();
    assert.equal(sync.retryQueue(), drain);
    await sync.syncProgress(v2Opts(run, { currentRound: 8 }));
    await sync.syncProgress(v2Opts(run, { currentRound: 9 }));
    assert.equal(sent.length, 1);
    assert.equal(sent[0].saveRequestId, first.saveRequestId);
    assert.equal(JSON.parse(storage.getItem('wa_gr_sync_queue'))[0].payload.baseRevision, null);
    waiting.resolve(ackFor(sent[0]));
    await drain;
    const pending = JSON.parse(storage.getItem('wa_gr_sync_queue'));
    assert.equal(pending.length, 1, 'new capture survives completion of the old drain');
    assert.equal(pending[0].payload.currentRound, 9);
    assert.equal(pending[0].payload.baseRevision, undefined);
    global.WA_GOLD_RUSH_POWER_AUTOMATE.callFlow = async (key, payload) => {
        assert.equal(payload.baseRevision, 1);
        assert.equal(payload.saveRequestId, pending[0].payload.saveRequestId);
        return ackFor(payload, 2);
    };
    await sync.retryQueue();
    assert.equal(sync.queueLength(), 0);
});

test('simultaneous captures persist the sealed request and coalesce only pending state', async () => {
    enableV2(new ReferenceSaveServer());
    const storage = createSessionStorage();
    const run = seedLocalSave(storage);
    global.localStorage = storage;
    const waiting = deferred();
    const sent = [];
    global.WA_GOLD_RUSH_POWER_AUTOMATE.callFlow = (key, payload) => {
        sent.push(payload);
        return waiting.promise;
    };
    const sync = loadSync();
    const first = sync.syncProgress(v2Opts(run));
    await Promise.all([
        sync.syncProgress(v2Opts(run, { currentRound: 5 })),
        sync.syncProgress(v2Opts(run, { currentRound: 6 }))
    ]);
    await sync.retryQueue();
    assert.equal(sent.length, 1, 'captures and drains never race the active request');
    const items = JSON.parse(storage.getItem('wa_gr_sync_queue'));
    assert.equal(items.length, 2);
    assert.equal(items[0].payload.saveRequestId, sent[0].saveRequestId);
    assert.equal(items[1].payload.currentRound, 6);
    waiting.resolve(ackFor(sent[0]));
    await first;
    assert.equal(sync.queueLength(), 1);
});

for (const success of [true, false]) {
    for (const retry of [true, false]) {
        test(`discard during pending ${retry ? 'retry' : 'direct save'} ${success ? 'success' : 'failure'} never resurrects old captures`, async () => {
            enableV2(new ReferenceSaveServer());
            const storage = createSessionStorage();
            const run = seedLocalSave(storage);
            global.localStorage = storage;
            const sync = loadSync();
            if (retry) {
                global.WA_GOLD_RUSH_POWER_AUTOMATE.callFlow = async () => ({ success: false, status: 503 });
                await sync.syncProgress(v2Opts(run));
                await sync.syncProgress(v2Opts(run, { currentRound: 8 }));
            }
            const waiting = deferred();
            let calls = 0;
            let active;
            global.WA_GOLD_RUSH_POWER_AUTOMATE.callFlow = (key, payload) => {
                calls += 1;
                active = payload;
                return waiting.promise;
            };
            const drain = retry ? sync.retryQueue() : sync.syncProgress(v2Opts(run));
            assert.equal(sync.discardQueuedForProgressKey('6B|SC-1|2'), retry ? 2 : 1);
            waiting.resolve(success ? ackFor(active) : { success: false, status: 503 });
            await drain;
            await sync.retryQueue();
            assert.equal(calls, 1);
            assert.equal(sync.queueLength(), 0);
            assert.equal(store.readLevelSave(storage, ID, 2).envelope.cloud.revision, null);
        });
    }
}

test('dispatch and retry respect per-level ledger holds and conflicts without blocking unrelated games', async () => {
    const server = new ReferenceSaveServer();
    enableV2(server);
    const storage = createSessionStorage({}, { assignedLevel: 3 });
    const run = seedLocalSave(storage);
    global.localStorage = storage;
    const sync = loadSync();
    global.WA_GOLD_RUSH_POWER_AUTOMATE.callFlow = async () => ({ success: false, status: 503 });
    await sync.syncProgress(v2Opts(run));
    const ledger = store.readLedger(storage, ID);
    ledger.levelRuns['2'].cloudUploadHold = 'cloud_conflict';
    store.writeLedger(storage, ledger);
    global.WA_GOLD_RUSH_POWER_AUTOMATE.callFlow = server.transport();
    assert.equal((await sync.syncProgress(v2Opts(run))).reason, 'cloud_conflict');
    await sync.retryQueue();
    assert.equal(server.log.length, 0);
    assert.equal(sync.queueLength(), 1);
    const other = validCloudSave(3);
    store.adoptLevelRun(storage, other);
    store.writeLevelSave(storage, other);
    assert.equal((await sync.syncProgress(v2Opts({ generation: 1, runId: other.runId }, { level: 3 }))).ok, true);
    assert.equal(server.log.length, 1);
    const updated = store.readLedger(storage, ID);
    updated.levelRuns['2'].cloudUploadHold = '';
    store.writeLedger(storage, updated);
    require('../shared/save-protocol.js').recordConflict(storage, JSON.parse(storage.getItem('wa_gr_sync_queue'))[0].payload);
    await sync.retryQueue();
    assert.equal(server.log.length, 1);
});

test('strict v2 metadata never falls back to a legacy dispatch', async () => {
    const server = new ReferenceSaveServer();
    enableV2(server);
    const storage = createSessionStorage();
    const run = seedLocalSave(storage);
    global.localStorage = storage;
    const sync = loadSync();
    for (const field of ['runGeneration', 'runId', 'storageSchemaVersion']) {
        for (const value of [undefined, null, '', false, field === 'runId' ? ' ' : '1']) {
            assert.equal((await sync.syncProgress(v2Opts(run, { [field]: value }))).ok, false, `${field}=${String(value)}`);
        }
    }
    assert.equal(server.log.length, 0);
    assert.equal(sync.queueLength(), 0);
    assert.equal((await sync.syncProgress(v2Opts(run))).ok, true);
});

test('missing and mismatched v2 acknowledgement fields are never confirmed; exact acknowledgements confirm', () => {
    const protocol = require('../shared/save-protocol.js');
    const payload = v2Request();
    const good = ackFor(payload);
    const fields = {
        ok: [false, 'true', null], protocolVersion: [1, '2', null],
        saveRequestId: ['other', '', null], progressKey: ['6B|SC-1|3', '', null],
        runGeneration: [2, '1', 1.5, null], revision: [0, '1', 1.5, null]
    };
    for (const [field, values] of Object.entries(fields)) {
        for (const value of [undefined, ...values]) {
            const response = { ...good, data: { ...good.data, [field]: value } };
            if (value === undefined) delete response.data[field];
            const outcome = protocol.classifyResponse(payload, response).outcome;
            assert.notEqual(outcome, 'confirmed', `${field}=${String(value)}`);
            if (field !== 'ok' || value !== false) assert.equal(outcome, 'unconfirmed');
        }
    }
    assert.equal(protocol.classifyResponse(payload, good).outcome, 'confirmed');
});

test('unconfirmed retry stays unverified after completion and unrelated subsequent successes', async () => {
    enableV2(new ReferenceSaveServer());
    const storage = createSessionStorage({}, { assignedLevel: 3 });
    const run = seedLocalSave(storage);
    global.localStorage = storage;
    const sync = loadSync();
    global.WA_GOLD_RUSH_POWER_AUTOMATE.callFlow = async () => ({ success: false, status: 503 });
    await sync.syncProgress(v2Opts(run));
    global.WA_GOLD_RUSH_POWER_AUTOMATE.callFlow = async () => ({ success: true, status: 200, data: { ok: true } });
    await sync.retryQueue();
    assert.equal(sync.queueLength(), 0);
    assert.equal(sync.getCloudSaveStatus(), 'cloud save not verified');
    const other = validCloudSave(3);
    store.adoptLevelRun(storage, other);
    store.writeLevelSave(storage, other);
    global.WA_GOLD_RUSH_POWER_AUTOMATE.callFlow = async (key, payload) => ackFor(payload);
    await sync.syncProgress(v2Opts({ generation: 1, runId: other.runId }, { level: 3 }));
    assert.equal(sync.getCloudSaveStatus(), 'cloud save not verified');
    await sync.syncProgress(v2Opts(run));
    assert.equal(sync.getCloudSaveStatus(), 'saved to cloud');
});

for (const failure of ['backup', 'target', 'initial_ledger', 'final_ledger']) {
    test(`legacy migration retries ${failure} failure without marking incomplete work processed`, () => {
        const raw = legacyAutosave();
        const storage = createSessionStorage({ level2_autosave: raw });
        const originalSet = storage.setItem.bind(storage);
        let fail = true;
        let targetWritten = false;
        storage.setItem = (key, value) => {
            if (fail && ((failure === 'backup' && key === store.LEGACY_BACKUP_KEY)
                || (failure === 'target' && key === store.buildSaveKey(ID, 3))
                || (failure === 'initial_ledger' && key === store.buildLedgerKey(ID))
                || (failure === 'final_ledger' && targetWritten && key === store.buildLedgerKey(ID)))) {
                throw new Error('injected write failure');
            }

            originalSet(key, value);
            if (key === store.buildSaveKey(ID, 3)) targetWritten = true;
        };
        assert.notEqual(store.migrateLegacyAutosave(storage, ID).status, 'migrated');
        assert.equal(store.readLedger(storage, ID).legacyMigration, null);
        if (failure === 'final_ledger') assert.equal(store.readLevelSave(storage, ID, 3).status, 'found');
        fail = false;
        assert.equal(store.migrateLegacyAutosave(storage, ID).status, 'migrated');
        assert.equal(store.readProgressionEvidence(storage, ID, 2).checkpointStatus, 'quiz_passed');
        assert.equal(store.migrateLegacyAutosave(storage, ID).status, 'already_processed');
        assert.equal(storage.getItem('level2_autosave'), raw);
    });
}

for (const failure of ['backup', 'target', 'ledger', 'read']) {
    test(`page loader locks a missing slot after migration ${failure} failure, then retries the original game`, () => {
        const raw = legacyAutosave();
        const storage = createSessionStorage({ level2_autosave: raw }, { assignedLevel: 3 });
        const originalSet = storage.setItem.bind(storage);
        const originalGet = storage.getItem.bind(storage);
        let fail = true;
        storage.setItem = (key, value) => {
            if (fail && ((failure === 'backup' && key === store.LEGACY_BACKUP_KEY)
                || (failure === 'target' && key === store.buildSaveKey(ID, 3))
                || (failure === 'ledger' && key === store.buildLedgerKey(ID)))) {
                throw new Error('quota exceeded');
            }
            originalSet(key, value);
        };
        storage.getItem = (key) => {
            if (fail && failure === 'read' && key === store.LEGACY_AUTOSAVE_KEY) throw new Error('storage unavailable');
            return originalGet(key);
        };
        const h = buildStudentGameHarness({ level: 3, storage });
        assert.equal(h.loadResult.status, 'unavailable');
        assert.match(h.loadResult.reason, /backup_failed|storage_write_failed|ledger_write_failed|storage_read_failed/);
        assert.equal(h.gameState.saveLocked, true);
        assert.equal(h.gameState.activeRun, null, 'a missing slot is not permission to create a replacement run');
        fail = false;
        const ledgerBefore = storage.getItem(store.buildLedgerKey(ID));
        assert.equal(h.gameState.saveToLocalStorage(), false);
        assert.equal(h.gameState.beginLevelRun(), null);
        assert.equal(store.readLevelSave(storage, ID, 3).status, 'missing');
        assert.equal(storage.getItem(store.buildLedgerKey(ID)), ledgerBefore);
        const retried = buildStudentGameHarness({ level: 3, storage });
        assert.equal(retried.loadResult.status, 'resumed');
        assert.equal(retried.gameState.round, 12);
        assert.equal(retried.gameState.cash, 4567);
        assert.equal(store.readProgressionEvidence(storage, ID, 2).checkpointStatus, 'quiz_passed');
        assert.equal(store.readLevelSave(storage, ID, 3).envelope.migratedFrom.hash, store.hashString(raw));
        assert.equal(storage.getItem(store.LEGACY_AUTOSAVE_KEY), raw);
    });
}

test('migration failure for a known other level does not block a first visit or an existing valid save', () => {
    const storage = createSessionStorage({ level2_autosave: legacyAutosave() }, { assignedLevel: 4 });
    const originalSet = storage.setItem.bind(storage);
    storage.setItem = (key, value) => {
        if (key === store.buildSaveKey(ID, 3)) throw new Error('quota exceeded for large legacy snapshot');
        originalSet(key, value);
    };
    const other = buildStudentGameHarness({ level: 4, storage });
    assert.equal(other.loadResult.status, 'started');
    playSomeRounds(other.gameState, { round: 5, cash: 987 });
    storage.setItem = (key, value) => {
        if (key === store.LEGACY_BACKUP_KEY) throw new Error('backup unavailable');
        originalSet(key, value);
    };
    storage.removeItem(store.LEGACY_BACKUP_KEY);
    const existing = buildStudentGameHarness({ level: 4, storage });
    assert.equal(existing.loadResult.status, 'resumed');
    assert.equal(existing.gameState.round, 5);
    assert.equal(existing.gameState.cash, 987);
});

test('queue capacity never evicts a sealed unknown-outcome request', async () => {
    enableV2(new ReferenceSaveServer());
    const storage = createSessionStorage();
    const run = seedLocalSave(storage);
    global.localStorage = storage;
    const sync = loadSync();
    sync.configure({ maxQueueSize: 1 });
    global.WA_GOLD_RUSH_POWER_AUTOMATE.callFlow = async () => ({ success: false, status: 504 });
    const first = await sync.syncProgress(v2Opts(run));
    const result = await sync.syncProgress(v2Opts(run, { currentRound: 9 }));
    assert.equal(result.queued, false);
    assert.equal(result.reason, 'queue_capacity');
    const items = JSON.parse(storage.getItem('wa_gr_sync_queue'));
    assert.equal(items.length, 1);
    assert.equal(items[0].payload.saveRequestId, first.saveRequestId);
    assert.ok(sync.getQuarantine().some((entry) => entry.reason === 'queue_capacity'));
});

test('unconfirmed acknowledgement preserves the last confirmed base revision', async () => {
    enableV2(new ReferenceSaveServer());
    const storage = createSessionStorage();
    const run = seedLocalSave(storage, { cloud: { status: 'synced', revision: 7 } });
    global.localStorage = storage;
    const sync = loadSync();
    global.WA_GOLD_RUSH_POWER_AUTOMATE.callFlow = async () => ({ success: true, status: 200, data: { ok: true } });
    await sync.syncProgress(v2Opts(run));
    const envelope = store.readLevelSave(storage, ID, 2).envelope;
    assert.equal(envelope.cloud.revision, 7);
    assert.equal(envelope.cloud.status, 'unknown');
});

test('retry reevaluates a key hold immediately after awaiting an unrelated game', async () => {
    enableV2(new ReferenceSaveServer());
    const storage = createSessionStorage({}, { assignedLevel: 3 });
    const run = seedLocalSave(storage);
    const other = validCloudSave(3);
    store.adoptLevelRun(storage, other);
    store.writeLevelSave(storage, other);
    global.localStorage = storage;
    const sync = loadSync();
    global.WA_GOLD_RUSH_POWER_AUTOMATE.callFlow = async () => ({ success: false, status: 503 });
    await sync.syncProgress(v2Opts({ generation: 1, runId: other.runId }, { level: 3 }));
    await sync.syncProgress(v2Opts(run));
    const waiting = deferred();
    const sent = [];
    global.WA_GOLD_RUSH_POWER_AUTOMATE.callFlow = (key, payload) => {
        sent.push(payload);
        return waiting.promise;
    };
    const drain = sync.retryQueue();
    const ledger = store.readLedger(storage, ID);
    ledger.levelRuns['2'].cloudUploadHold = 'cloud_restore_failed';
    store.writeLedger(storage, ledger);
    waiting.resolve(ackFor(sent[0]));
    await drain;
    assert.equal(sent.length, 1);
    assert.equal(sent[0].level, 3);
    assert.equal(sync.queueLength(), 1);
});

test('v2 dispatch fails closed when the sealed request cannot be persisted', async () => {
    const server = new ReferenceSaveServer();
    enableV2(server);
    const storage = createSessionStorage();
    const run = seedLocalSave(storage);
    global.localStorage = storage;
    const sync = loadSync();
    const originalSet = storage.setItem.bind(storage);
    storage.setItem = (key, value) => {
        if (key === 'wa_gr_sync_queue') throw new Error('injected queue failure');
        originalSet(key, value);
    };
    assert.equal((await sync.syncProgress(v2Opts(run))).reason, 'queue_write_failed');
    assert.equal(server.log.length, 0);
});

test('nested v2 application rejection is never reported as a confirmed save', async () => {
    enableV2(new ReferenceSaveServer());
    const storage = createSessionStorage();
    const run = seedLocalSave(storage);
    global.localStorage = storage;
    const sync = loadSync();
    global.WA_GOLD_RUSH_POWER_AUTOMATE.callFlow = async () => ({
        success: true, status: 200, data: { body: { ok: false, message: 'rejected' } }
    });
    const result = await sync.syncProgress(v2Opts(run));
    assert.equal(result.ok, false);
    assert.equal(sync.queueLength(), 0);
    assert.notEqual(sync.getCloudSaveStatus(), 'saved to cloud');
});

test('persisted per-level holds also protect legacy dispatch and retry after rollback', async () => {
    const server = new ReferenceSaveServer();
    enableV2(server);
    global.WA_GOLD_RUSH_RUNTIME_CONFIG = { featureFlags: {} };
    const storage = createSessionStorage();
    seedLocalSave(storage);
    global.localStorage = storage;
    const sync = loadSync();
    const legacy = { ...ID, level: 2, currentRound: 3 };
    global.WA_GOLD_RUSH_POWER_AUTOMATE.callFlow = async () => ({ success: false, status: 503 });
    await sync.syncProgress(legacy);
    const ledger = store.readLedger(storage, ID);
    ledger.levelRuns['2'].cloudUploadHold = 'cloud_conflict';
    store.writeLedger(storage, ledger);
    global.WA_GOLD_RUSH_POWER_AUTOMATE.callFlow = server.transport();
    assert.equal((await sync.syncProgress(legacy)).reason, 'cloud_conflict');
    await sync.retryQueue();
    assert.equal(server.log.length, 0);
    assert.equal(sync.queueLength(), 1);
});

test('verified legacy migration can reconcile an earlier review marker without bypassing other holds', () => {
    const storage = createSessionStorage({
        level2_autosave: legacyAutosave({ player: { studentCode: 'SC-1' } })
    });
    assert.equal(store.migrateLegacyAutosave(storage, ID).status, 'needs_review');
    assert.equal(store.ensureLevelRun(storage, ID, 3), null);
    storage.setItem('level2_autosave', legacyAutosave());
    assert.equal(store.migrateLegacyAutosave(storage, ID).status, 'migrated');
    assert.equal(store.getUploadHold(storage, ID, 3), '');
    assert.equal(store.readProgressionEvidence(storage, ID, 2).checkpointStatus, 'quiz_passed');

    for (const hold of ['cloud_conflict', 'cloud_state_unknown']) {
        const held = createSessionStorage({ level2_autosave: legacyAutosave() });
        const run = store.ensureLevelRun(held, ID, 3);
        const ledger = store.readLedger(held, ID);
        ledger.levelRuns['3'] = { ...run, cloudUploadHold: hold };
        store.writeLedger(held, ledger);
        assert.equal(store.migrateLegacyAutosave(held, ID).reason, hold);
        assert.equal(store.readLevelSave(held, ID, 3).status, 'missing');
        assert.equal(store.getUploadHold(held, ID, 3), hold);
    }
});

test('direct store writes, resets and run creation preserve every protected slot and ledger', () => {
    for (const protection of ['malformed', 'schema', 'conflict', 'hold', 'ledger_hold', 'cloud_state_unknown', 'legacy_review', 'stale_generation']) {
        const storage = createSessionStorage();
        const run = seedLocalSave(storage);
        const key = store.buildSaveKey(ID, 2);
        const replacement = store.clone(store.readLevelSave(storage, ID, 2).envelope);
        replacement.snapshot.cash = 9999;
        if (protection === 'malformed') storage.setItem(key, '{broken');
        else if (['schema', 'conflict', 'hold'].includes(protection)) {
            const envelope = JSON.parse(storage.getItem(key));
            if (protection === 'schema') envelope.storageSchemaVersion = 999;
            else envelope.cloud.status = protection;
            storage.setItem(key, JSON.stringify(envelope));
        } else {
            const ledger = store.readLedger(storage, ID);
            if (protection === 'ledger_hold') ledger.levelRuns['2'].cloudUploadHold = 'cloud_restore_failed';
            else if (protection === 'cloud_state_unknown') ledger.levelRuns['2'].cloudUploadHold = 'cloud_state_unknown';
            else if (protection === 'legacy_review') {
                ledger.legacyMigration = { status: 'needs_review', reason: 'missing_class', level: 2 };
            } else ledger.levelRuns['2'] = { ...run, generation: run.generation + 1 };
            store.writeLedger(storage, ledger);
        }
        const contents = () => JSON.stringify(storage.__keys().sort().map((entry) => [entry, storage.getItem(entry)]));
        const before = contents();
        assert.notEqual(store.getLevelWriteProtection(storage, ID, 2), '', protection);
        assert.equal(store.writeLevelSave(storage, replacement).ok, false, protection);
        assert.equal(store.resetLevelSave(storage, ID, 2).ok, false, protection);
        assert.equal(store.ensureLevelRun(storage, ID, 2), null, protection);
        assert.equal(store.adoptLevelRun(storage, replacement), false, protection);
        assert.equal(contents(), before, protection);
    }
});

test('protected slots allow explicit same-run conflict metadata recording without economy or ledger mutation', () => {
    const storage = createSessionStorage();
    const run = seedLocalSave(storage);
    const ledger = store.readLedger(storage, ID);
    ledger.levelRuns['2'].cloudUploadHold = 'cloud_conflict';
    store.writeLedger(storage, ledger);
    const before = store.readLevelSave(storage, ID, 2).envelope;
    const ledgerRaw = storage.getItem(store.buildLedgerKey(ID));
    const protocol = require('../shared/save-protocol.js');
    assert.equal(protocol.recordConflict(storage, {
        ...v2Opts(run), progressKey: before.progressKey, saveRequestId: 'conflicted'
    }, { code: 'revision_conflict', currentRevision: 4 }), true);
    const after = store.readLevelSave(storage, ID, 2).envelope;
    assert.equal(after.cloud.status, 'conflict');
    assert.deepEqual(after.snapshot, before.snapshot);
    assert.equal(after.generation, before.generation);
    assert.equal(after.runId, before.runId);
    assert.equal(storage.getItem(store.buildLedgerKey(ID)), ledgerRaw);
    assert.equal(store.writeLevelSave(storage, before).ok, false);
    assert.equal(store.updateCloudState(storage, ID, 2, {
        generation: run.generation + 1, cloud: { status: 'synced' }
    }).ok, false);
});

test('store write protection excludes only the provisional unverified new slot hold', () => {
    for (const hold of ['unverified_new_slot']) {
        const storage = createSessionStorage();
        seedLocalSave(storage);
        const ledger = store.readLedger(storage, ID);
        ledger.levelRuns['2'].cloudUploadHold = hold;
        store.writeLedger(storage, ledger);
        assert.equal(store.getLevelWriteProtection(storage, ID, 2), '');
        const envelope = store.clone(store.readLevelSave(storage, ID, 2).envelope);
        envelope.snapshot.cash = 101;
        assert.equal(store.writeLevelSave(storage, envelope).ok, true);
        assert.equal(store.readLedger(storage, ID).levelRuns['2'].cloudUploadHold, hold);
    }
});

test('run adoption preserves a protected save with missing run metadata and permits ordinary safe adoption', () => {
    const storage = createSessionStorage();
    seedLocalSave(storage);
    const key = store.buildSaveKey(ID, 2);
    const envelope = JSON.parse(storage.getItem(key));
    envelope.cloud.status = 'conflict';
    storage.setItem(key, JSON.stringify(envelope));
    const ledger = store.readLedger(storage, ID);
    delete ledger.levelRuns['2'];
    store.writeLedger(storage, ledger);
    const before = storage.getItem(store.buildLedgerKey(ID));
    assert.equal(store.adoptLevelRun(storage, envelope), false);
    assert.equal(storage.getItem(store.buildLedgerKey(ID)), before);
    const clean = createSessionStorage();
    assert.equal(store.adoptLevelRun(clean, validCloudSave()), true);
    assert.equal(store.readLedger(clean, ID).levelRuns['2'].runId, 'run_cloud');
});
