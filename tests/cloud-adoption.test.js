const test = require('node:test');
const assert = require('node:assert/strict');
const store = require('../shared/level-save-store.js');
const restore = require('../shared/cloud-restore.js');
const protocol = require('../shared/save-protocol.js');
const sessions = require('../shared/student-session.js');
const { createSessionStorage, buildStudentGameHarness } = require('./support/harness.js');

const identity = { classCode: '6B', studentCode: 'SC-1' };

function setup() {
    const storage = createSessionStorage();
    const { gameState } = buildStudentGameHarness({ level: 2, storage });
    gameState.round = 9;
    gameState.cash = 109.11399999999995;
    assert.equal(gameState.saveToLocalStorage(), true);
    assert.equal(store.updateCloudState(storage, identity, 2, { cloud: { status: 'synced', revision: 1 } }).ok, true);
    const original = store.readLevelSave(storage, identity, 2).envelope;
    const target = store.clone(original);
    target.cloud = { status: 'synced', revision: 3 };
    target.snapshot.round = 94;
    target.snapshot.player.companyName = 'Anonymous Mining';
    return { storage, original, target };
}

test('cloud adoption archives exact source, commits run and preserves unrelated ledger evidence', () => {
    const { storage, original, target } = setup();
    store.recordProgressionEvidence(storage, identity, 4, { checkpointStatus: 'quiz_passed' });
    assert.equal(restore.adoptCloudSave(storage, { status: 'found', envelope: target }).ok, true);
    assert.deepEqual(store.readLevelSave(storage, identity, 2).envelope, target);
    assert.equal(store.readLedger(storage, identity).levelRuns['2'].runId, target.runId);
    assert.equal(store.readProgressionEvidence(storage, identity, 4).checkpointStatus, 'quiz_passed');
    const archive = JSON.parse(storage.getItem(store.buildArchiveKey(identity, 2)));
    assert.deepEqual(JSON.parse(archive.at(-1).raw), original);
    assert.equal(store.getLevelWriteProtection(storage, identity, 2), '');
});

for (const stage of ['archive', 'journal', 'slot', 'ledger', 'cleanup']) {
    test(`cloud adoption recovers a storage failure at ${stage} without invalidating the source run`, () => {
        const { storage, original, target } = setup();
        const key = store.buildSaveKey(identity, 2);
        const ledgerKey = store.buildLedgerKey(identity);
        const archiveKey = store.buildArchiveKey(identity, 2);
        let failed = false;
        const failing = {
            getItem: storage.getItem.bind(storage),
            setItem(k, v) {
                if (!failed && ((stage === 'archive' && k === archiveKey)
                    || (stage === 'journal' && k === `${key}|adoption`)
                    || (stage === 'slot' && k === key)
                    || (stage === 'ledger' && k === ledgerKey))) {
                    failed = true;
                    throw new Error('simulated quota');
                }
                storage.setItem(k, v);
            },
            removeItem(k) {
                if (!failed && stage === 'cleanup' && k === `${key}|adoption`) {
                    failed = true;
                    throw new Error('simulated quota');
                }
                storage.removeItem(k);
            }
        };
        restore.adoptCloudSave(failing, { status: 'found', envelope: target });
        assert.equal(failed, true);
        assert.equal(store.recoverCloudAdoption(storage, identity, 2).ok, true);
        const saved = store.readLevelSave(storage, identity, 2);
        assert.equal(saved.status, 'found');
        assert.ok([original.runId, target.runId].includes(saved.envelope.runId));
        assert.equal(store.getLevelWriteProtection(storage, identity, 2), '');
        assert.equal(store.readLedger(storage, identity).levelRuns['2'].runId, saved.envelope.runId);
    });
}

test('interrupted adoption holds writes and refuses to replace a concurrent ledger change', () => {
    const { storage, target } = setup();
    const key = store.buildSaveKey(identity, 2);
    const ledgerKey = store.buildLedgerKey(identity);
    const failing = {
        getItem: storage.getItem.bind(storage),
        setItem(k, v) {
            if (k === ledgerKey || k === key && storage.getItem(`${key}|adoption`)) {
                throw new Error('storage unavailable');
            }
            storage.setItem(k, v);
        },
        removeItem() { throw new Error('storage unavailable'); }
    };
    assert.equal(restore.adoptCloudSave(failing, { status: 'found', envelope: target }).ok, false);
    assert.equal(store.readLevelSave(storage, identity, 2).reason, 'adoption_pending');
    const changed = store.readLedger(storage, identity);
    changed.levelRuns['3'] = { generation: 1, runId: 'run-other-level' };
    store.writeLedger(storage, changed);
    const ledger = storage.getItem(ledgerKey);
    assert.equal(store.recoverCloudAdoption(storage, identity, 2).reason, 'adoption_concurrent_change');
    assert.equal(storage.getItem(ledgerKey), ledger);
    assert.equal(store.writeLevelSave(storage, target).ok, false);
});

test('direct cloud-backed reset is refused even when the UI is bypassed', () => {
    const { storage, target } = setup();
    assert.equal(store.adoptCloudEnvelope(storage, target).ok, true);
    const key = store.buildSaveKey(identity, 2);
    const before = storage.getItem(key);
    const ledger = storage.getItem(store.buildLedgerKey(identity));
    assert.deepEqual(store.resetLevelSave(storage, identity, 2), {
        ok: false, reason: 'cloud_reset_unavailable'
    });
    assert.equal(storage.getItem(key), before);
    assert.equal(storage.getItem(store.buildLedgerKey(identity)), ledger);
});

test('missing rows with an advanced server generation cannot authorise a fresh create', () => {
    const request = { identity, level: 2, progressKey: store.buildProgressKey(identity, 2) };
    const response = {
        success: true, status: 200, data: {
            ok: true, contractVersion: restore.CONTRACT_VERSION,
            progressKey: request.progressKey, found: false, runGeneration: 2
        }
    };
    const cloud = restore.interpretResponse(response, request);
    assert.equal(cloud.status, 'missing');
    assert.equal(restore.reconcile({ status: 'missing' }, cloud).action, 'conflict');
    response.data.runGeneration = -1;
    assert.equal(restore.interpretResponse(response, request).reason, 'generation_invalid');
});

test('delayed acknowledgement cannot mark different local economy synced in the same millisecond', () => {
    const { storage, original } = setup();
    const snapshot = store.clone(original.snapshot);
    snapshot.cash -= 1;
    const captured = { ...snapshot, companyName: snapshot.player.companyName };
    const payload = {
        ...identity, level: 2, protocolVersion: 2, runGeneration: original.generation,
        runId: original.runId, saveRequestId: 'request-anonymous',
        clientTimestampUtc: original.savedAt, progressionMarkersJson: JSON.stringify(captured)
    };
    assert.equal(protocol.recordAcknowledgement(storage, payload, { revision: 2 }), true);
    const after = store.readLevelSave(storage, identity, 2).envelope;
    assert.equal(after.cloud.status, 'pending');
    assert.equal(after.cloud.revision, 2);
    assert.equal(after.snapshot.cash, original.snapshot.cash);
});

test('adoption never replaces an unknown ledger schema with an empty ledger', () => {
    const { storage, target } = setup();
    const key = store.buildLedgerKey(identity);
    const ledger = JSON.stringify({
        storageSchemaVersion: 99, owner: identity, futureEvidence: { keep: true }
    });
    storage.setItem(key, ledger);
    assert.equal(store.adoptCloudEnvelope(storage, target).reason, 'ledger_schema_unsupported');
    assert.equal(storage.getItem(key), ledger);
});

test('fresh startup cannot replace future ledger evidence before cloud adoption checks', () => {
    const storage = createSessionStorage();
    const key = store.buildLedgerKey(identity);
    const raw = JSON.stringify({ storageSchemaVersion: 99, owner: identity, futureEvidence: { keep: true } });
    storage.setItem(key, raw);
    const { gameState } = buildStudentGameHarness({ level: 2, storage });
    assert.equal(gameState.saveToLocalStorage(), false);
    assert.equal(storage.getItem(key), raw);
    assert.equal(store.ensureLevelRun(storage, identity, 2), null);
});

test('full envelope validation rejects unsupported snapshots and contradictory run metadata', () => {
    const { target } = setup();
    const future = store.clone(target);
    future.snapshot.schemaVersion = 99;
    assert.equal(store.validateEnvelope(future).reason, 'snapshot_schema_unsupported');
    const wrongRun = store.clone(target);
    wrongRun.snapshot.run = { generation: wrongRun.generation, runId: 'run-not-this-save', startingNetWorth: null };
    assert.equal(store.validateEnvelope(wrongRun).reason, 'snapshot_run_mismatch');
    const partial = store.clone(target);
    delete partial.snapshot.progression;
    assert.equal(store.validateEnvelope(partial).reason, 'snapshot_progression_invalid');
    const profile = store.clone(target);
    profile.snapshot.investmentProfile = { highRisk: 1 };
    assert.equal(store.validateEnvelope(profile).reason, 'snapshot_profile_invalid');
});

test('direct cloud adoption cannot bypass a genuine different-run conflict', () => {
    const { storage, target, original } = setup();
    target.runId = 'run-anonymous-other-device';
    assert.equal(restore.adoptCloudSave(storage, { status: 'found', envelope: target }).reason,
        'cloud_reconciliation_required');
    assert.deepEqual(store.readLevelSave(storage, identity, 2).envelope, original);
});

test('typed duplicate, malformed and unavailable responses stay unknown rather than permitting create', () => {
    const request = { identity, level: 2, progressKey: store.buildProgressKey(identity, 2) };
    const vectors = [
        { success: true, status: 200, data: {
            contractVersion: restore.CONTRACT_VERSION, progressKey: request.progressKey,
            ok: false, code: 'duplicate_rows'
        } },
        { success: true, status: 200, data: 'malformed-response' },
        { success: false, status: 503, data: { ok: false, code: 'unavailable', retryable: true } }
    ];
    for (const response of vectors) {
        const cloud = restore.interpretResponse(response, request);
        assert.ok(['failed', 'incomplete'].includes(cloud.status));
        assert.equal(restore.reconcile({ status: 'missing' }, cloud).action, 'start_local_unsynced');
    }
});

test('identical same-tab session rewrites have distinct non-authentication lifecycle markers', () => {
    const storage = createSessionStorage();
    const session = sessions.readSession(storage);
    assert.equal(sessions.writeSession(storage, session), true);
    const first = storage.getItem(sessions.STORAGE_KEY);
    assert.equal(sessions.clearSession(storage), true);
    assert.equal(sessions.writeSession(storage, session), true);
    assert.notEqual(storage.getItem(sessions.STORAGE_KEY), first);
    assert.deepEqual(sessions.readSession(storage), session, 'normalised identity contract stays unchanged');
});
