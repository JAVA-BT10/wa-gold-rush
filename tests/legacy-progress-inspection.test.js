'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const snapshot = require('../shared/progression-snapshot.js');
const { CONTRACT_VERSION, inspect } = require('../scripts/inspect-legacy-progress.js');

const request = {
    contractVersion: CONTRACT_VERSION, mode: 'full_save',
    classCode: '6B', studentCode: 'SC-1', level: 2, progressKey: '6B|SC-1|2'
};
function rawSnapshot(overrides = {}) {
    return JSON.stringify(snapshot.buildProgressionSnapshot({
        schemaVersion: 2, savedAt: '2026-01-02T03:04:05.000Z',
        assignedLevel: 2, currentLevel: 2, rosterAssignedLevel: 4,
        round: 94, cash: 109.11399999999995, netWorth: 396.1139999999999,
        player: { classCode: '6B', studentCode: 'SC-1', leaderboardName: 'Miner' },
        companyName: 'Example Mining', ownedMines: {}, machinery: [],
        roundHistory: [], totalProfitLoss: 75, investmentPlans: {},
        investmentProfile: { highRisk: 2, lowRisk: 3, profitChasing: 0, assetBuilding: 7, futureProofing: 1 },
        strategyLabel: 'Asset Building',
        run: { generation: 3, runId: 'existing-run', startingNetWorth: null, storageSchemaVersion: 1 },
        ...overrides
    }));
}
function input(bodyOverrides = {}, responseOverrides = {}) {
    return {
        request: { ...request },
        response: {
            success: true, status: 200,
            data: { ok: true, contractVersion: CONTRACT_VERSION, found: true, progressKey: request.progressKey,
                snapshot: rawSnapshot(), ...bodyOverrides },
            ...responseOverrides
        }
    };
}

test('only reports compatible without returning snapshot, envelope, or identity', () => {
    const value = input();
    const before = JSON.stringify(value);
    assert.deepEqual(inspect(value), { status: 'compatible', reason: 'operator_config_check_required' });
    assert.equal(JSON.stringify(value), before);
});

test('treats missing as reported only and errors, duplicates and invalid requests as failures', () => {
    assert.equal(inspect(input({ found: false })).status, 'reported_missing');
    assert.equal(inspect(input({ ok: false, code: 'duplicate_rows' })).reason, 'flow_failure');
    assert.equal(inspect(input({}, { success: false, status: 500 })).reason, 'transport_failure');
    assert.equal(inspect(input({}, { success: true, status: 500 })).reason, 'transport_failure');
    assert.equal(inspect(input({ progressKey: '6B|SC-2|2' })).reason, 'progress_key_mismatch');
    assert.equal(inspect(input({ found: null })).reason, 'found_flag_invalid');
    assert.equal(inspect(input({ contractVersion: 'ggr.getStudentProgress.v2' })).reason, 'invalid_contract');
    const invalid = input();
    invalid.request.level = '2';
    assert.equal(inspect(invalid).reason, 'invalid_request');
    invalid.request.level = 2;
    invalid.request.progressKey = 'wrong';
    assert.equal(inspect(invalid).reason, 'invalid_request');
});

test('rejects malformed, other-owner and unconvertible snapshots without fabricating metadata', () => {
    assert.equal(inspect(input({ snapshot: '{}' })).reason, 'unsupported_snapshot');
    assert.equal(inspect(input({ snapshot: '{' })).reason, 'malformed_json');
    assert.equal(inspect(input({ snapshot: {} })).reason, 'raw_snapshot_required');
    assert.equal(inspect(input({ snapshot: rawSnapshot({ player: { classCode: '6B', studentCode: 'SC-2' } }) })).reason, 'owner_mismatch');
    assert.equal(inspect(input({ snapshot: rawSnapshot({ run: null }) })).reason, 'run_metadata_required');
    assert.equal(inspect(input({ snapshot: rawSnapshot({ currentLevel: 3 }) })).reason, 'level_mismatch');
});

test('stdin CLI emits only the result and fails closed on malformed input', () => {
    const run = text => spawnSync(process.execPath, ['scripts/inspect-legacy-progress.js'], {
        cwd: require('node:path').join(__dirname, '..'), input: text, encoding: 'utf8'
    });
    const success = run(JSON.stringify(input()));
    assert.equal(success.status, 0);
    assert.deepEqual(JSON.parse(success.stdout), { status: 'compatible', reason: 'operator_config_check_required' });
    assert.equal(success.stdout.includes('SC-1'), false);
    const failure = run('{');
    assert.equal(failure.status, 1);
    assert.deepEqual(JSON.parse(failure.stdout), { status: 'failed', reason: 'invalid_input_json' });
});
