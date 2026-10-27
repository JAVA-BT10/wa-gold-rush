const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { read, createSessionStorage, buildStudentGameHarness, setSession } = require('./support/harness.js');
const { ReferenceSaveServer } = require('./support/reference-save-server.js');

function harness({ storage = createSessionStorage(), v2 = true, restore = true, transport, globals = {} } = {}) {
    const calls = [];
    const h = buildStudentGameHarness({
        storage,
        stubSync: false,
        extraGlobals: {
            setInterval() { return { unref() {} }; },
            clearInterval() {},
            WA_GOLD_RUSH_RUNTIME_CONFIG: { featureFlags: { saveProtocolV2: v2, fullCloudRestore: restore } },
            WA_GOLD_RUSH_FLOW_ENDPOINTS: {
                getStudentProgress: 'https://school.example/restore',
                saveProgress: 'https://school.example/save'
            },
            WA_GOLD_RUSH_POWER_AUTOMATE: {
                callFlow: async (name, payload) => {
                    calls.push({ name, payload });
                    return transport ? transport(name, payload) : {
                        success: true, status: 200,
                        data: { ok: true, contractVersion: 'ggr.getStudentProgress.v2', progressKey: payload.progressKey, found: false }
                    };
                }
            },
            WA_GOLD_RUSH_STUDENT_PROGRESS_PROOF_PROVIDER: {
                async getProof() { return { authorization: ['Bearer', 'test-proof'].join(' ') }; }
            },
            ...globals
        }
    });
    vm.runInContext(read('shared/student-progress-auth.js') + '\n' + read('shared/sharepoint-sync.js') + '\nthis.sync = SharePointSync;', h.context);
    return { ...h, calls };
}

function payload(h, legacy = false) {
    h.gameState.round = 3;
    assert.equal(h.gameState.saveToLocalStorage(), true);
    return h.context.sync.buildProgressPayload({
        classCode: '6B', studentCode: 'SC-1', level: 2,
        ...(legacy ? {} : {
            protocolVersion: 2, runGeneration: h.gameState.activeRun.generation,
            runId: h.gameState.activeRun.runId, startingNetWorth: h.gameState.startingNetWorth,
            storageSchemaVersion: 1
        })
    });
}

test('all resumed slots require an actual startup lookup; persisted acknowledgement is not proof', async () => {
    const first = harness();
    payload(first);
    first.context.WA_GOLD_RUSH_LEVEL_SAVE_STORE.updateCloudState(first.storage,
        { classCode: '6B', studentCode: 'SC-1' }, 2, { cloud: { status: 'synced', revision: 4 } });
    const resumed = harness({ storage: first.storage });
    const result = await resumed.context.sync.syncProgress(payload(resumed));
    assert.equal(result.held, true);
    assert.equal(result.reason, 'startup_lookup_required');
    assert.equal(resumed.calls.length, 0);
    assert.equal(resumed.gameState.saveLocked, false);
});

test('disabled restore is explicit local-only, and legacy dispatch remains held', async () => {
    const h = harness({ restore: false, v2: false });
    await h.context.maybeRestoreLevelFromCloud(h.context.getAuthenticatedStudentSession(), 2);
    assert.equal(h.context.getLevelLoadState().status, 'local_only');
    assert.equal(h.gameState.saveLocked, false);
    assert.equal(h.gameState.saveToLocalStorage(), true);
    const result = await h.context.sync.syncProgress(payload(h, true));
    assert.equal(result.held, true);
    assert.equal(h.calls.length, 0);
});

test('network lookup hold can be checked again without reload and preserves local work', async () => {
    let online = false;
    const h = harness({ transport: async (name, p) => online
        ? { success: true, status: 200, data: { ok: true, contractVersion: 'ggr.getStudentProgress.v2', progressKey: p.progressKey, found: false } }
        : { success: false, networkError: true } });
    const session = h.context.getAuthenticatedStudentSession();
    await h.context.maybeRestoreLevelFromCloud(session, 2);
    assert.equal(h.context.getCloudUploadHold(), 'cloud_state_unknown');
    h.gameState.round = 8;
    h.gameState.cash = 12345;
    assert.equal(h.gameState.saveToLocalStorage(), true);
    online = true;
    await h.context.maybeRestoreLevelFromCloud(session, 2);
    assert.equal(h.context.getCloudUploadHold(), '');
    assert.equal(h.gameState.round, 8);
    assert.equal(h.gameState.cash, 12345);
    assert.equal(h.calls.filter(c => c.name === 'saveProgress').length, 0);
});

test('session replacement during actual restore cannot adopt or unlock the old slot', async () => {
    let release;
    const h = harness({ transport: (name, p) => new Promise(resolve => {
        release = () => resolve({ success: true, status: 200, data: {
            ok: true, contractVersion: 'ggr.getStudentProgress.v2', progressKey: p.progressKey, found: false
        } });
    }) });
    const check = h.context.maybeRestoreLevelFromCloud(h.context.getAuthenticatedStudentSession(), 2);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(typeof release, 'function');
    setSession(h.storage, { studentCode: 'SC-2' });
    release();
    await check;
    assert.notEqual(h.context.getCloudUploadHold(), '');
    assert.equal(h.calls.filter(c => c.name === 'saveProgress').length, 0);
});

test('v2 restart is blocked without a backend reset, keeping the run and economy', () => {
    const h = harness();
    const before = h.gameState.activeRun.runId;
    h.gameState.cash = 9999;
    h.context.resetGame();
    assert.equal(h.gameState.activeRun.runId, before);
    assert.equal(h.gameState.cash, 9999);
});

test('fresh-browser DOM startup fetches and adopts a full real restore response, without uploading defaults', async () => {
    const source = harness();
    source.gameState.round = 9;
    source.gameState.cash = 7654;
    source.gameState.saveToLocalStorage();
    const cloud = source.context.WA_GOLD_RUSH_LEVEL_SAVE_STORE.readLevelSave(source.storage, { classCode: '6B', studentCode: 'SC-1' }, 2).envelope;
    let startup;
    const h = harness({
        globals: {
            document: {
                addEventListener(name, callback) { if (name === 'DOMContentLoaded') startup = callback; },
                getElementById() { return null; }, querySelector() { return null; },
                querySelectorAll() { return []; }
            },
            fetch: async () => ({ ok: true, json: async () => JSON.parse(read('shared/game-config.json')) })
        },
        transport: async (name, p) => ({ success: true, status: 200, data: {
            ok: true, contractVersion: 'ggr.getStudentProgress.v2', progressKey: p.progressKey,
            found: true, revision: 4, runGeneration: cloud.generation, save: cloud
        } })
    });
    // Discard the helper's preloaded slot, then exercise the actual page entry.
    h.storage.__keys().filter(key => key !== 'wa_gold_rush_student_session').forEach(key => h.storage.removeItem(key));
    await startup();
    assert.equal(h.context.getLevelLoadState().status, 'restored');
    assert.equal(vm.runInContext('gameState.round', h.context), 9);
    assert.equal(vm.runInContext('gameState.cash', h.context), 7654);
    assert.equal(h.calls.filter(c => c.name === 'getStudentProgress').length, 1);
    assert.equal(h.calls.filter(c => c.name === 'saveProgress').length, 0);
});

test('verified conditional saves and retries get fresh proof; a later browser cannot replay the queue unverified', async () => {
    let fail = true;
    let revision = 0;
    const h = harness({ transport: async (name, p) => {
        if (name === 'getStudentProgress') return { success: true, status: 200, data: {
            ok: true, contractVersion: 'ggr.getStudentProgress.v2', progressKey: p.progressKey, found: false
        } };
        if (fail) return { success: false, status: 503 };
        return { success: true, status: 200, data: {
            ok: true, protocolVersion: 2, saveRequestId: p.saveRequestId, progressKey: p.progressKey,
            runGeneration: p.runGeneration, revision: ++revision
        } };
    } });
    await h.context.maybeRestoreLevelFromCloud(h.context.getAuthenticatedStudentSession(), 2);
    const result = await h.context.sync.syncProgress(payload(h));
    assert.equal(result.queued, true);
    const anotherBrowser = harness({ storage: h.storage });
    await anotherBrowser.context.sync.retryQueue();
    assert.equal(anotherBrowser.calls.length, 0);
    fail = false;
    await h.context.sync.retryQueue();
    assert.equal(h.context.sync.queueLength(), 0);
    assert.equal(h.calls.filter(c => c.name === 'saveProgress').length, 2);
    const second = await h.context.sync.syncProgress(payload(h));
    assert.equal(second.ok, true, 'verified revision follows confirmed acknowledgements');
});

test('malformed local slot stays protected and cannot be bypassed by retry', async () => {
    const h = harness();
    const store = h.context.WA_GOLD_RUSH_LEVEL_SAVE_STORE;
    h.storage.setItem(store.buildSaveKey({ classCode: '6B', studentCode: 'SC-1' }, 2), '{broken');
    h.context.loadLevelGameForSession(h.context.getAuthenticatedStudentSession(), 2);
    assert.equal(h.gameState.saveLocked, true);
    await h.context.maybeRestoreLevelFromCloud(h.context.getAuthenticatedStudentSession(), 2);
    assert.equal(h.calls.length, 0);
    assert.equal(h.gameState.saveToLocalStorage(), false);
});

test('session replacement during write proof acquisition blocks the actual transport', async () => {
    const h = harness();
    await h.context.maybeRestoreLevelFromCloud(h.context.getAuthenticatedStudentSession(), 2);
    let release;
    h.context.WA_GOLD_RUSH_STUDENT_PROGRESS_PROOF_PROVIDER.getProof = () => new Promise(resolve => {
        release = () => resolve({ authorization: ['Bearer', 'test-proof'].join(' ') });
    });
    const saving = h.context.sync.syncProgress(payload(h));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(typeof release, 'function');
    setSession(h.storage, { authenticatedAt: '2026-10-27T15:00:00Z' });
    release();
    const result = await saving;
    assert.equal(result.held, true);
    assert.equal(h.calls.filter(c => c.name === 'saveProgress').length, 0);
    assert.equal(h.context.sync.queueLength(), 1, 'sealed capture is kept, not lost on session change');
});

test('a different cloud run never wins by round or timestamp and local play remains saveable', async () => {
    const source = harness();
    source.gameState.round = 50;
    source.gameState.saveToLocalStorage();
    const cloud = source.context.WA_GOLD_RUSH_LEVEL_SAVE_STORE.readLevelSave(source.storage, { classCode: '6B', studentCode: 'SC-1' }, 2).envelope;
    const h = harness({ transport: async (name, p) => ({ success: true, status: 200, data: {
        ok: true, contractVersion: 'ggr.getStudentProgress.v2', progressKey: p.progressKey,
        found: true, revision: 3, runGeneration: cloud.generation, save: cloud
    } }) });
    h.gameState.round = 3;
    h.gameState.cash = 1234;
    h.gameState.saveToLocalStorage();
    const runId = h.gameState.activeRun.runId;
    await h.context.maybeRestoreLevelFromCloud(h.context.getAuthenticatedStudentSession(), 2);
    assert.equal(h.context.getCloudUploadHold(), 'cloud_conflict');
    assert.equal(h.gameState.activeRun.runId, runId);
    assert.equal(h.gameState.round, 3);
    assert.equal(h.gameState.cash, 1234);
    h.gameState.round = 4;
    assert.equal(h.gameState.saveToLocalStorage(), true);
    assert.equal((await h.context.sync.syncProgress(payload(h))).held, true);
});

test('recovery controls and status are accessible without exposing private identity fields', () => {
    const html = read('levels/level-2-tycoon/index.html');
    assert.match(html, /id="cloudSaveStatus"[^>]*role="status"[^>]*aria-live="polite"/);
    assert.match(html, /<button[^>]+onclick="retryCloudRecovery\(\)"[^>]*>Check cloud \/ retry sync<\/button>/);
    assert.match(html, /<button[^>]+onclick="exportRecoveryBackup\(\)"[^>]*>Export local backup<\/button>/);
});

test('retry completes pending adoption cleanup and reloads the committed save without clearing storage', async () => {
    const source = harness();
    source.gameState.round = 9;
    source.gameState.cash = 4567;
    source.gameState.saveToLocalStorage();
    const identity = { classCode: '6B', studentCode: 'SC-1' };
    const envelope = JSON.parse(JSON.stringify(source.context.WA_GOLD_RUSH_LEVEL_SAVE_STORE
        .readLevelSave(source.storage, identity, 2).envelope));
    envelope.cloud = { status: 'synced', revision: 3 };
    const h = harness({ transport: async (name, p) => ({ success: true, status: 200, data: name === 'getStudentProgress' ? {
        ok: true, contractVersion: 'ggr.getStudentProgress.v2', progressKey: p.progressKey,
        found: true, revision: 3, runGeneration: envelope.generation, save: envelope
    } : {
        ok: true, protocolVersion: 2, saveRequestId: p.saveRequestId, progressKey: p.progressKey,
        runGeneration: p.runGeneration, revision: 4
    } }) });
    const store = h.context.WA_GOLD_RUSH_LEVEL_SAVE_STORE;
    const journalKey = `${store.buildSaveKey(identity, 2)}|adoption`;
    const removeItem = h.storage.removeItem.bind(h.storage);
    let cleanupBlocked = true;
    h.storage.removeItem = key => {
        if (key === journalKey && cleanupBlocked) throw new Error('device storage temporarily unavailable');
        removeItem(key);
    };
    assert.equal(store.adoptCloudEnvelope(h.storage, envelope).ok, false);
    assert.notEqual(h.storage.getItem(journalKey), null);
    h.context.loadLevelGameForSession(h.context.getAuthenticatedStudentSession(), 2);
    assert.equal(h.gameState.saveLocked, true);
    cleanupBlocked = false;
    await vm.runInContext('retryCloudRecovery()', h.context);
    assert.equal(h.storage.getItem(journalKey), null);
    assert.equal(h.gameState.saveLocked, false);
    assert.equal(h.gameState.round, 9);
    assert.equal(h.gameState.cash, 4567);
    assert.equal(h.gameState.activeRun.runId, envelope.runId);
});

test('runtime diagnostics report actual prerequisites without session, slot, or proof values', async () => {
    const h = harness();
    const before = h.context.sync.getDiagnostics({ level: 2 });
    assert.equal(before.startupSlotVerified, false);
    assert.equal(before.protocolVersion, 2);
    assert.equal(before.conditionalSavesEnabled, true);
    assert.equal(before.proofProviderConfigured, true);
    await h.context.maybeRestoreLevelFromCloud(h.context.getAuthenticatedStudentSession(), 2);
    assert.equal(h.context.sync.getDiagnostics({ level: 2 }).startupSlotVerified, true);
    const json = JSON.stringify(h.context.sync.getDiagnostics({ level: 2 }));
    assert.doesNotMatch(json, /SC-1|6B|123456|Alex Smith|test-proof|authorization|runId|progressKey/i);
});

test('a fresh browser recovers a committed lost response by retrying the original conditional receipt', async () => {
    const server = new ReferenceSaveServer();
    let remote = null;
    let committedRequest;
    let first;
    const transport = async (name, p) => {
        if (name === 'getStudentProgress') return { success: true, status: 200, data: {
            ok: true, contractVersion: 'ggr.getStudentProgress.v2', progressKey: p.progressKey,
            found: !!remote, ...(remote ? { revision: 1, runGeneration: remote.generation, save: remote } : {})
        } };
        if (!committedRequest) {
            assert.equal(server.handle(p).ok, true);
            committedRequest = JSON.parse(JSON.stringify(p));
            remote = JSON.parse(JSON.stringify(first.context.WA_GOLD_RUSH_LEVEL_SAVE_STORE
                .readLevelSave(first.storage, p, p.level).envelope));
            remote.cloud = { status: 'synced', revision: 1 };
            return { success: false, networkError: true };
        }
        assert.equal(p.saveRequestId, committedRequest.saveRequestId, 'ask for the immutable receipt, not a rebased overwrite');
        assert.equal(p.baseRevision, null);
        return { success: true, status: 200, data: server.handle(p) };
    };
    first = harness({ transport });
    await first.context.maybeRestoreLevelFromCloud(first.context.getAuthenticatedStudentSession(), 2);
    const capture = payload(first);
    capture.progressionMarkersJson = JSON.stringify({
        ...first.gameState.captureLevelSnapshot(), companyName: first.gameState.player.companyName
    });
    assert.equal((await first.context.sync.syncProgress(capture)).queued, true);
    const second = harness({ storage: first.storage, transport });
    vm.runInContext('syncPlayerRecord = () => {};', second.context);
    await vm.runInContext('retryCloudRecovery()', second.context);
    assert.equal(second.context.sync.queueLength(), 0);
    assert.equal(second.context.getCloudUploadHold(), '');
    assert.equal(second.gameState.round, 3);
    assert.equal(second.gameState.activeRun.runId, remote.runId);
    assert.equal(server.rows.get(committedRequest.progressKey).revision, 1, 'server applied exactly one write');
    assert.equal(server.receipts.size, 1);
});

test('raw session-instance replacement invalidates startup proof even when normalized fields are identical', async () => {
    const h = harness();
    await h.context.maybeRestoreLevelFromCloud(h.context.getAuthenticatedStudentSession(), 2);
    assert.equal(h.context.sync.getRuntimeDiagnostics({ level: 2 }).startupSlotVerified, true);
    const raw = JSON.parse(h.storage.getItem('wa_gold_rush_student_session'));
    raw.sessionInstanceId = 'different-login-instance';
    h.storage.setItem('wa_gold_rush_student_session', JSON.stringify(raw));
    assert.equal(h.context.sync.getRuntimeDiagnostics({ level: 2 }).startupSlotVerified, false);
    const result = await h.context.sync.syncProgress(payload(h));
    assert.equal(result.held, true);
    assert.equal(result.reason, 'startup_lookup_required');
    assert.equal(h.calls.filter(c => c.name === 'saveProgress').length, 0);
});

test('logout and identical-session relogin cannot revive prior startup verification', async () => {
    const h = harness();
    const original = h.storage.getItem('wa_gold_rush_student_session');
    await h.context.maybeRestoreLevelFromCloud(h.context.getAuthenticatedStudentSession(), 2);
    assert.equal(h.context.sync.getRuntimeDiagnostics({ level: 2 }).startupSlotVerified, true);
    vm.runInContext('logoutCompetitionSession()', h.context);
    h.storage.setItem('wa_gold_rush_student_session', original);
    assert.equal(h.context.sync.getRuntimeDiagnostics({ level: 2 }).startupSlotVerified, false);
    assert.equal((await h.context.sync.syncProgress(payload(h))).reason, 'startup_lookup_required');
});

test('progress logs omit private slot, run, request, provider and flow details', async () => {
    const logs = [];
    const h = harness({ transport: async (name, p) => name === 'getStudentProgress'
        ? { success: true, status: 200, data: {
            ok: true, contractVersion: 'ggr.getStudentProgress.v2', progressKey: p.progressKey, found: false
        } }
        : { success: false, error: 'PRIVATE-FLOW-DETAIL' } });
    h.context.console.info = (...args) => logs.push(args);
    h.context.console.warn = (...args) => logs.push(args);
    await h.context.maybeRestoreLevelFromCloud(h.context.getAuthenticatedStudentSession(), 2);
    h.context.WA_GOLD_RUSH_STUDENT_PROGRESS_PROOF_PROVIDER.getProof = async () => {
        throw new Error('PRIVATE-PROVIDER-DETAIL');
    };
    const p = payload(h);
    p.saveRequestId = 'PRIVATE-REQUEST-ID';
    await h.context.sync.syncProgress(p);
    h.context.WA_GOLD_RUSH_STUDENT_PROGRESS_PROOF_PROVIDER.getProof = async () => ({
        authorization: ['Bearer', 'PRIVATE-PROOF'].join(' ')
    });
    await h.context.sync.retryQueue();
    const json = JSON.stringify(logs);
    assert.doesNotMatch(json, /SC-1|6B|PRIVATE-|progressKey|runId|saveRequestId|studentId|studentName/i);
    assert.match(json, /"level":2/);
});
