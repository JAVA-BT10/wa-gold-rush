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
    assert.equal(h.calls.length, 1, 'a protected local slot may still make an authenticated cloud read');
    assert.equal(h.calls[0].name, 'getStudentProgress');
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

function backupHarness() {
    const blobs = [];
    const warnings = [];
    const alerts = [];
    const downloads = [];
    const h = harness({ globals: {
        Blob,
        URL: class extends URL {
            static createObjectURL(blob) { blobs.push(blob); return 'blob:private-backup'; }
            static revokeObjectURL() {}
        },
        confirm(message) { warnings.push(message); return true; },
        alert(message) { alerts.push(message); }
    } });
    h.context.document.createElement = () => ({
        click() { downloads.push(this.download); }
    });
    return { ...h, blobs, warnings, alerts, downloads };
}

for (const protection of ['malformed', 'adoption_pending']) {
    test(`private export preserves exact ${protection} source without substituting defaults or other slots`, async () => {
        const h = backupHarness();
        const store = h.context.WA_GOLD_RUSH_LEVEL_SAVE_STORE;
        const identity = { classCode: '6B', studentCode: 'SC-1' };
        const key = store.buildSaveKey(identity, 2);
        const rawStoredSave = '  {"studentName":"private-source", "broken": }\n';
        const pendingAdoption = protection === 'adoption_pending'
            ? ' {"sourceSlot":"original private bytes", "targetSlot":"pending bytes"}\n' : null;
        h.storage.setItem(key, rawStoredSave);
        if (pendingAdoption !== null) h.storage.setItem(`${key}|adoption`, pendingAdoption);
        h.storage.setItem(store.buildSaveKey({ classCode: '6B', studentCode: 'SC-2' }, 2), 'OTHER-STUDENT-PRIVATE');
        h.storage.setItem(store.buildSaveKey(identity, 3), 'OTHER-LEVEL-PRIVATE');
        h.storage.setItem('runtime-config', 'GLOBAL-RUNTIME-PRIVATE');
        h.gameState.saveLocked = true;
        h.gameState.captureLevelSnapshot = () => { throw new Error('must not export protected defaults'); };
        const before = h.storage.__keys().map(k => [k, h.storage.getItem(k)]);
        h.context.exportRecoveryBackup();
        assert.equal(h.blobs.length, 1);
        assert.equal(h.downloads.length, 1);
        assert.equal(h.alerts.length, 0);
        assert.match(h.warnings[0], /private backup/i);
        const json = await h.blobs[0].text();
        const backup = JSON.parse(json);
        assert.equal(backup.rawStoredSave, rawStoredSave);
        assert.equal(backup.pendingAdoption, pendingAdoption);
        assert.equal(backup.sourceStatus, protection === 'malformed' ? 'invalid' : 'unavailable');
        assert.equal(backup.savedGame, null);
        assert.equal(backup.currentGame, null);
        assert.equal(backup.privateBackup, true);
        assert.match(backup.warning, /private.*do not post it publicly/i);
        assert.doesNotMatch(json, /OTHER-STUDENT-PRIVATE|OTHER-LEVEL-PRIVATE|GLOBAL-RUNTIME-PRIVATE|Alex Smith|123456/);
        assert.deepEqual(h.storage.__keys().map(k => [k, h.storage.getItem(k)]), before);
    });
}

for (const failure of ['slot', 'journal', 'validation_read']) {
    test(`private export reports ${failure} read failure without downloading a misleading backup`, () => {
        const h = backupHarness();
        payload(h);
        const key = h.context.WA_GOLD_RUSH_LEVEL_SAVE_STORE.buildSaveKey(
            { classCode: '6B', studentCode: 'SC-1' }, 2);
        const originalGet = h.storage.getItem.bind(h.storage);
        let slotReads = 0;
        h.storage.getItem = selectedKey => {
            if (selectedKey === key) slotReads++;
            if ((failure === 'slot' && selectedKey === key)
                || (failure === 'journal' && selectedKey === `${key}|adoption`)
                || (failure === 'validation_read' && selectedKey === key && slotReads > 1)) {
                throw new Error('private storage failure details must not escape');
            }
            return originalGet(selectedKey);
        };
        h.context.exportRecoveryBackup();
        assert.equal(h.downloads.length, 0);
        assert.equal(h.blobs.length, 0);
        assert.equal(h.alerts.length, 1);
        assert.match(h.alerts[0], /could not read.*Nothing was exported/);
        assert.doesNotMatch(h.alerts[0], /private storage failure details/);
    });
}

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
    await h.context.sync.checkLevelSave(h.context.getAuthenticatedStudentSession(), 2);
    await h.context.sync.retryQueue();
    const json = JSON.stringify(logs);
    assert.doesNotMatch(json, /SC-1|6B|PRIVATE-|progressKey|runId|saveRequestId|studentId|studentName/i);
    assert.match(json, /"level":2/);
});

test('retry after a failed fresh-browser lookup does not persist defaults and adopts the actual cloud save', async () => {
        const source = harness();
        source.gameState.round = 7;
        source.gameState.cash = 8765;
        source.gameState.saveToLocalStorage();
        const identity = { classCode: '6B', studentCode: 'SC-1' };
        const remote = source.context.WA_GOLD_RUSH_LEVEL_SAVE_STORE.readLevelSave(source.storage, identity, 2).envelope;
        let online = false;
        let h;
        h = harness({ transport: async (name, p) => {
            assert.equal(name, 'getStudentProgress');
            if (!online) return { success: false, networkError: true };
            assert.equal(h.context.WA_GOLD_RUSH_LEVEL_SAVE_STORE.readLevelSave(h.storage, identity, 2).status,
                'missing', 'retry must not manufacture a competing saved run');
            return { success: true, status: 200, data: {
                ok: true, contractVersion: 'ggr.getStudentProgress.v2', progressKey: p.progressKey,
                found: true, revision: 3, runGeneration: remote.generation, save: remote
            } };
        } });
        await h.context.maybeRestoreLevelFromCloud(h.context.getAuthenticatedStudentSession(), 2);
        assert.equal(h.context.getCloudUploadHold(), 'cloud_state_unknown');
        assert.equal(h.gameState.saveLocked, false);
        online = true;
        vm.runInContext('syncPlayerRecord = () => {};', h.context);
        await vm.runInContext('retryCloudRecovery()', h.context);
        assert.equal(h.context.getCloudUploadHold(), '');
        assert.equal(h.context.getLevelLoadState().status, 'restored');
        assert.equal(h.gameState.round, 7);
        assert.equal(h.gameState.cash, 8765);
        assert.equal(h.gameState.activeRun.runId, remote.runId);
        assert.equal(h.calls.filter(call => call.name === 'saveProgress').length, 0);
    });

test('retry unlocks only stale network protections and preserves genuine in-memory work', async () => {
        for (const reason of ['cloud_state_unknown', 'cloud_restore_failed']) {
            const h = harness({ transport: async () => ({ success: false, networkError: true }) });
            const store = h.context.WA_GOLD_RUSH_LEVEL_SAVE_STORE;
            const identity = { classCode: '6B', studentCode: 'SC-1' };
            payload(h);
            const ledger = store.readLedger(h.storage, identity);
            ledger.levelRuns['2'].cloudUploadHold = reason;
            store.writeLedger(h.storage, ledger);
            vm.runInContext(`gameState.saveLocked = true; setLevelLoadState('error', ${JSON.stringify(reason)}); cloudUploadHold = ${JSON.stringify(reason)};`, h.context);
            h.gameState.cash = 5432;
            await vm.runInContext('retryCloudRecovery()', h.context);
            assert.equal(h.gameState.saveLocked, false, reason);
            assert.equal(h.gameState.cash, 5432, reason);
            assert.equal(store.readLevelSave(h.storage, identity, 2).envelope.snapshot.cash, 5432, reason);
            const key = store.buildSaveKey(identity, 2);
            h.storage.setItem(key, '{malformed');
            vm.runInContext(`gameState.saveLocked = true; setLevelLoadState('error', ${JSON.stringify(reason)});`, h.context);
            await vm.runInContext('retryCloudRecovery()', h.context);
            assert.equal(h.gameState.saveLocked, true, 'network reason must not bypass malformed slot protection');
            assert.equal(h.storage.getItem(key), '{malformed');
        }
    });

test('unavailable proof holds the sealed request and invalidates startup verification without transport', async () => {
    const h = harness();
    await h.context.maybeRestoreLevelFromCloud(h.context.getAuthenticatedStudentSession(), 2);
    delete h.context.WA_GOLD_RUSH_STUDENT_PROGRESS_PROOF_PROVIDER;
    const result = await h.context.sync.syncProgress(payload(h));
    assert.equal(result.held, true);
    assert.equal(result.reason, 'auth_provider_unavailable');
    assert.equal(result.queued, true);
    assert.equal(h.context.sync.getRuntimeDiagnostics({ level: 2 }).startupSlotVerified, false);
    const queued = h.storage.getItem('wa_gr_sync_queue');
    await h.context.sync.retryQueue();
    await h.context.sync.retryQueue();
    assert.equal(h.storage.getItem('wa_gr_sync_queue'), queued);
    assert.equal(h.calls.filter(call => call.name === 'saveProgress').length, 0);
});

for (const status of [401, 403]) {
    test(`HTTP ${status} expires verification and holds retries until fresh proof and slot lookup`, async () => {
        let expired = true;
        const h = harness({ transport: async (name, p) => {
            if (name === 'getStudentProgress') return { success: true, status: 200, data: {
                ok: true, contractVersion: 'ggr.getStudentProgress.v2', progressKey: p.progressKey, found: false
            } };
            if (expired) return { success: false, status };
            return { success: true, status: 200, data: {
                ok: true, protocolVersion: 2, saveRequestId: p.saveRequestId, progressKey: p.progressKey,
                runGeneration: p.runGeneration, revision: 1
            } };
        } });
        await h.context.maybeRestoreLevelFromCloud(h.context.getAuthenticatedStudentSession(), 2);
        const result = await h.context.sync.syncProgress(payload(h));
        assert.equal(result.held, true);
        assert.equal(result.reason, 'auth_required');
        assert.equal(result.queued, true);
        assert.equal(h.context.sync.getRuntimeDiagnostics({ level: 2 }).startupSlotVerified, false);
        const queued = h.storage.getItem('wa_gr_sync_queue');
        await h.context.sync.retryQueue();
        await h.context.sync.retryQueue();
        assert.equal(h.calls.filter(call => call.name === 'saveProgress').length, 1);
        assert.equal(h.storage.getItem('wa_gr_sync_queue'), queued);
        expired = false;
        vm.runInContext('syncPlayerRecord = () => {};', h.context);
        await vm.runInContext('retryCloudRecovery()', h.context);
        assert.equal(h.context.sync.queueLength(), 0);
        const saves = h.calls.filter(call => call.name === 'saveProgress');
        assert.equal(saves.length, 2);
        assert.equal(saves[1].payload.saveRequestId, saves[0].payload.saveRequestId);
        assert.equal(saves[1].payload.baseRevision, saves[0].payload.baseRevision);
    });
}

test('a different signed-in student cannot dispatch or retry another student’s sealed capture', async () => {
    const h = harness({ transport: async (name, p) => name === 'getStudentProgress'
        ? { success: true, status: 200, data: {
            ok: true, contractVersion: 'ggr.getStudentProgress.v2', progressKey: p.progressKey, found: false
        } }
        : { success: false, status: 503 } });
    await h.context.maybeRestoreLevelFromCloud(h.context.getAuthenticatedStudentSession(), 2);
    const capture = payload(h);
    assert.equal((await h.context.sync.syncProgress(capture)).queued, true);
    const queue = h.storage.getItem('wa_gr_sync_queue');
    setSession(h.storage, { studentCode: 'SC-2' });
    const result = await h.context.sync.syncProgress(capture);
    assert.equal(result.rejected, true);
    assert.equal(result.reason, 'identity_mismatch');
    await h.context.sync.retryQueue();
    assert.equal(h.calls.filter(call => call.name === 'saveProgress').length, 1);
    assert.equal(h.storage.getItem('wa_gr_sync_queue'), queue);
});

test('HTTP auth expiry during queue drain preserves the immutable request without timer redispatch', async () => {
    let responseStatus = 503;
    const h = harness({ transport: async (name, p) => name === 'getStudentProgress'
        ? { success: true, status: 200, data: {
            ok: true, contractVersion: 'ggr.getStudentProgress.v2', progressKey: p.progressKey, found: false
        } }
        : { success: false, status: responseStatus } });
    await h.context.maybeRestoreLevelFromCloud(h.context.getAuthenticatedStudentSession(), 2);
    await h.context.sync.syncProgress(payload(h));
    const queued = h.storage.getItem('wa_gr_sync_queue');
    responseStatus = 401;
    await h.context.sync.retryQueue();
    assert.equal(h.context.sync.getRuntimeDiagnostics({ level: 2 }).startupSlotVerified, false);
    await h.context.sync.retryQueue();
    assert.equal(h.storage.getItem('wa_gr_sync_queue'), queued);
    assert.equal(h.calls.filter(call => call.name === 'saveProgress').length, 2);
});

test('session storage events invalidate verification after same-identity relogin', async () => {
    const listeners = [];
    const h = harness({ globals: {
        addEventListener(name, listener) { if (name === 'storage') listeners.push(listener); }
    } });
    await h.context.maybeRestoreLevelFromCloud(h.context.getAuthenticatedStudentSession(), 2);
    assert.equal(h.context.sync.getRuntimeDiagnostics({ level: 2 }).startupSlotVerified, true);
    const raw = h.storage.getItem('wa_gold_rush_student_session');
    for (const listener of listeners) listener({ key: 'wa_gold_rush_student_session', oldValue: null, newValue: raw });
    assert.equal(h.context.sync.getRuntimeDiagnostics({ level: 2 }).startupSlotVerified, false);
});

test('retry leaves an unchanged synced save clean so a newer full cloud revision can be adopted', async () => {
    let remote;
    let online = false;
    let h;
    const identity = { classCode: '6B', studentCode: 'SC-1' };
    h = harness({ transport: async (name, p) => {
        assert.equal(name, 'getStudentProgress');
        if (!online) return { success: false, networkError: true };
        assert.equal(h.context.WA_GOLD_RUSH_LEVEL_SAVE_STORE.readLevelSave(h.storage, identity, 2).envelope.cloud.status,
            'synced', 'an unchanged retry must not dirty its acknowledged base');
        return { success: true, status: 200, data: {
            ok: true, contractVersion: 'ggr.getStudentProgress.v2', progressKey: p.progressKey,
            found: true, revision: 2, runGeneration: remote.generation, save: remote
        } };
    } });
    payload(h);
    const store = h.context.WA_GOLD_RUSH_LEVEL_SAVE_STORE;
    store.updateCloudState(h.storage, identity, 2, { cloud: { status: 'synced', revision: 1 } });
    remote = JSON.parse(JSON.stringify(store.readLevelSave(h.storage, identity, 2).envelope));
    remote.snapshot.round = 6;
    remote.snapshot.cash = 7654;
    remote.cloud = { status: 'synced', revision: 2 };
    await h.context.maybeRestoreLevelFromCloud(h.context.getAuthenticatedStudentSession(), 2);
    online = true;
    vm.runInContext('syncPlayerRecord = () => {};', h.context);
    await vm.runInContext('retryCloudRecovery()', h.context);
    assert.equal(h.context.getLevelLoadState().status, 'restored');
    assert.equal(h.gameState.round, 6);
    assert.equal(h.gameState.cash, 7654);
    assert.equal(store.readLevelSave(h.storage, identity, 2).envelope.cloud.status, 'synced');
    assert.equal(store.readLevelSave(h.storage, identity, 2).envelope.cloud.revision, 2);
});

test('retry persists genuine changes before lookup and never adopts another same-run change over them', async () => {
    let remote;
    const h = harness({ transport: async (name, p) => ({ success: true, status: 200, data: {
        ok: true, contractVersion: 'ggr.getStudentProgress.v2', progressKey: p.progressKey,
        found: true, revision: 2, runGeneration: remote.generation, save: remote
    } }) });
    const identity = { classCode: '6B', studentCode: 'SC-1' };
    payload(h);
    const store = h.context.WA_GOLD_RUSH_LEVEL_SAVE_STORE;
    store.updateCloudState(h.storage, identity, 2, { cloud: { status: 'synced', revision: 1 } });
    remote = JSON.parse(JSON.stringify(store.readLevelSave(h.storage, identity, 2).envelope));
    remote.snapshot.cash = 9000;
    remote.cloud = { status: 'synced', revision: 2 };
    h.gameState.cash = 4321;
    await vm.runInContext('retryCloudRecovery()', h.context);
    assert.equal(h.context.getCloudUploadHold(), 'cloud_conflict');
    assert.equal(h.gameState.cash, 4321);
    const local = store.readLevelSave(h.storage, identity, 2).envelope;
    assert.equal(local.snapshot.cash, 4321);
    assert.equal(local.cloud.status, 'pending');
    assert.equal(local.cloud.revision, 1);
    assert.equal(h.calls.filter(call => call.name === 'saveProgress').length, 0);
});

test('student entry HTML loads authenticated proof support before any full restore adapter', () => {
    for (const path of ['index.html', 'levels/level-1-basic/index.html', 'levels/level-2-tycoon/index.html']) {
        const scripts = [...read(path).matchAll(/<script\b[^>]*src="([^"]+)"/g)].map(match => match[1]);
        const restore = scripts.findIndex(src => src.endsWith('/cloud-restore.js'));
        const auth = scripts.findIndex(src => src.endsWith('/student-progress-auth.js'));
        if (path === 'levels/level-2-tycoon/index.html') assert.ok(restore >= 0);
        if (restore >= 0) assert.ok(auth >= 0 && auth < restore, path);
    }
});

for (const unsentLocalWork of [false, true]) {
test(`a sealed lost-response receipt recovers after newer cloud writes${unsentLocalWork ? ' while retaining unsent local conflict' : ''}`, async () => {
    const server = new ReferenceSaveServer();
    let remote;
    let originalRequest;
    let first;
    const transport = async (name, p) => {
        if (name === 'getStudentProgress') return { success: true, status: 200, data: {
            ok: true, contractVersion: 'ggr.getStudentProgress.v2', progressKey: p.progressKey,
            found: !!remote, ...(remote ? {
                revision: remote.cloud.revision, runGeneration: remote.generation, save: remote
            } : {})
        } };
        if (!originalRequest) {
            originalRequest = JSON.parse(JSON.stringify(p));
            assert.equal(server.handle(p).revision, 1);
            remote = JSON.parse(JSON.stringify(first.context.WA_GOLD_RUSH_LEVEL_SAVE_STORE
                .readLevelSave(first.storage, p, p.level).envelope));
            remote.cloud = { status: 'synced', revision: 1 };
            return { success: false, networkError: true };
        }
        assert.equal(p.saveRequestId, originalRequest.saveRequestId);
        assert.equal(p.baseRevision, originalRequest.baseRevision);
        return { success: true, status: 200, data: server.handle(p) };
    };
    first = harness({ transport });
    await first.context.maybeRestoreLevelFromCloud(first.context.getAuthenticatedStudentSession(), 2);
    const capture = payload(first);
    capture.progressionMarkersJson = JSON.stringify({
        ...first.gameState.captureLevelSnapshot(), companyName: first.gameState.player.companyName
    });
    await first.context.sync.syncProgress(capture);
    remote.snapshot.round = 5;
    remote.snapshot.cash = 9876;
    const newer = { ...originalRequest, saveRequestId: 'independent-writer-request', baseRevision: 1,
        currentRound: 5, currentCash: 9876,
        progressionMarkersJson: JSON.stringify({ ...remote.snapshot, companyName: remote.snapshot.player.companyName }) };
    newer.contentHash = first.context.WA_GOLD_RUSH_SAVE_PROTOCOL.computeContentHash(newer);
    assert.equal(server.handle(newer).revision, 2);
    remote.cloud.revision = 2;
    if (unsentLocalWork) {
        first.gameState.round = 6;
        first.gameState.cash = 3141;
        assert.equal(first.gameState.saveToLocalStorage(), true);
    }
    const second = harness({ storage: first.storage, transport });
    vm.runInContext('syncPlayerRecord = () => {};', second.context);
    await vm.runInContext('retryCloudRecovery()', second.context);
    assert.equal(second.context.sync.queueLength(), 0);
    assert.equal(second.context.getCloudUploadHold(), unsentLocalWork ? 'cloud_conflict' : '');
    assert.equal(second.gameState.round, unsentLocalWork ? 6 : 5);
    assert.equal(second.gameState.cash, unsentLocalWork ? 3141 : 9876);
    if (unsentLocalWork) {
        const local = second.context.WA_GOLD_RUSH_LEVEL_SAVE_STORE.readLevelSave(second.storage, originalRequest, 2);
        assert.equal(local.envelope.cloud.status, 'pending');
        assert.equal(local.envelope.cloud.revision, 1);
    }
    assert.equal(server.rows.get(originalRequest.progressKey).revision, 2, 'receipt retry creates no third write');
    assert.equal(server.receipts.size, 2);
});
}

test('diagnostic build version accepts only dev or generated numeric run-attempt markers', () => {
    const h = harness();
    for (const [configured, expected] of [
        ['dev', 'dev'], ['123456789-2', '123456789-2'],
        ['private-class-SC-1', 'unknown'], ['123-4\n', 'unknown'],
        [' 123-4 ', 'unknown'], [123, 'unknown'], [null, 'unknown'], [undefined, 'unknown']
    ]) {
        h.context.WA_GOLD_RUSH_RUNTIME_CONFIG.version = configured;
        assert.equal(h.context.sync.getDiagnostics({ level: 2 }).buildVersion, expected);
    }
});

test('Retry reads cloud for malformed, schema and persisted-conflict saves without writing or unlocking them', async () => {
    for (const protection of ['malformed', 'schema', 'persisted_conflict']) {
        let remote;
        const h = harness({ transport: async (name, p) => {
            assert.equal(name, 'getStudentProgress', 'protected saves are read-only during recovery');
            return { success: true, status: 200, data: {
                ok: true, contractVersion: 'ggr.getStudentProgress.v2', progressKey: p.progressKey,
                found: true, revision: 3, runGeneration: remote.generation, save: remote
            } };
        } });
        payload(h);
        const store = h.context.WA_GOLD_RUSH_LEVEL_SAVE_STORE;
        const identity = { classCode: '6B', studentCode: 'SC-1' };
        const key = store.buildSaveKey(identity, 2);
        const ledgerKey = store.buildLedgerKey(identity);
        remote = JSON.parse(h.storage.getItem(key));
        const local = JSON.parse(h.storage.getItem(key));
        if (protection === 'malformed') h.storage.setItem(key, '{malformed-save');
        else if (protection === 'schema') {
            local.storageSchemaVersion = 999;
            h.storage.setItem(key, JSON.stringify(local));
        } else {
            const ledger = JSON.parse(h.storage.getItem(ledgerKey));
            ledger.levelRuns['2'].cloudUploadHold = 'cloud_conflict';
            h.storage.setItem(ledgerKey, JSON.stringify(ledger));
        }
        h.context.loadLevelGameForSession(h.context.getAuthenticatedStudentSession(), 2);
        vm.runInContext('gameState.saveLocked = true;', h.context);
        const raw = h.storage.getItem(key);
        const rawLedger = h.storage.getItem(ledgerKey);
        await vm.runInContext('retryCloudRecovery()', h.context);
        assert.equal(h.calls.length, 1, protection);
        assert.equal(h.calls[0].name, 'getStudentProgress', protection);
        assert.equal(h.gameState.saveLocked, true, protection);
        assert.equal(h.storage.getItem(key), raw, protection);
        assert.equal(h.storage.getItem(ledgerKey), rawLedger, protection);
        assert.equal(h.context.getLevelLoadState().status, 'protected', protection);
        assert.equal(h.context.getLevelLoadState().reason, 'found', protection);
    }
});
