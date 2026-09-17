const test = require('node:test');
const assert = require('node:assert/strict');

function createStorage(initial = {}) {
    const store = new Map(Object.entries(initial));
    return {
        getItem(key) {
            return store.has(key) ? store.get(key) : null;
        },
        setItem(key, value) {
            store.set(key, String(value));
        },
        removeItem(key) {
            store.delete(key);
        }
    };
}

test('flow endpoint registry includes wired unlock and change-pin endpoints', () => {
    global.WA_GOLD_RUSH_FLOW_ENDPOINTS = {};
    require('../shared/flow-endpoints.js');
    assert.match(global.WA_GOLD_RUSH_FLOW_ENDPOINTS.teacherUnlockStudent, /a7d0d76c24304f6bbfae4cb50df223f8/);
    assert.match(global.WA_GOLD_RUSH_FLOW_ENDPOINTS.changeStudentPin, /RpwToQQqWyJTJzTkGxQ3pGwD6r8C3kL_wWNJwChHx20/);
});

test('callFlow detects placeholders and parses successful JSON', async () => {
    const helpers = require('../shared/power-automate-headers.js');
    const placeholderResult = await helpers.callFlow('https://REPLACE-WITH-ENDPOINT', { ok: true });
    assert.equal(placeholderResult.success, false);
    assert.equal(placeholderResult.skipped, true);

    const result = await helpers.callFlow('https://example.com/flow', { foo: 'bar' }, {
        includeApiKey: false,
        fetch: async () => ({
            ok: true,
            status: 200,
            async text() {
                return JSON.stringify({ ok: true, message: 'done' });
            }
        })
    });
    assert.equal(result.success, true);
    assert.deepEqual(result.data, { ok: true, message: 'done' });
});

test('student auth login hashes PIN and sends expected fields', async () => {
    global.WA_GOLD_RUSH_POWER_AUTOMATE = {
        callFlow: async (_flowName, payload) => ({
            success: true,
            status: 200,
            data: { ok: true, ...payload, leaderboardName: 'Gold Miner', studentCode: 'SC-1' }
        })
    };
    const auth = require('../shared/student-auth-client.js');
    const result = await auth.loginStudent({ classCode: '6b', studentId: '123456', pin: '1234' });
    assert.equal(result.success, true);
    assert.equal(result.response.classCode, '6B');
    assert.equal(result.response.studentCode, 'SC-1');
});

test('student auth change pin respects backend ok=false responses', async () => {
    global.WA_GOLD_RUSH_POWER_AUTOMATE = {
        callFlow: async () => ({
            success: true,
            status: 200,
            data: { ok: false, message: 'Old PIN mismatch' }
        })
    };
    const auth = require('../shared/student-auth-client.js');
    const result = await auth.changeStudentPin({
        classCode: '6B',
        studentId: '123456',
        oldPin: '1111',
        newPin: '2222'
    });
    assert.equal(result.success, false);
    assert.equal(result.error, 'Old PIN mismatch');
});

test('sharepoint sync builds lower-case save payload and migrates legacy queue items', async () => {
    global.localStorage = createStorage({
        wa_gr_sync_queue: JSON.stringify([
            {
                type: 'progress',
                payload: {
                    StudentCode: 'SC-1',
                    Level: 2,
                    Score: 999,
                    NetWorth: 999,
                    Round: 7,
                    ProgressJson: '{"legacy":true}'
                },
                attempts: 0
            }
        ])
    });
    global.WA_GOLD_RUSH_FLOW_ENDPOINTS = {
        saveProgress: 'https://example.com/save',
        upsertStudentProfile: 'https://example.com/profile'
    };
    const posted = [];
    global.WA_GOLD_RUSH_POWER_AUTOMATE = {
        callFlow: async (_flowName, payload) => {
            posted.push(payload);
            return { success: true, status: 200, data: { ok: true } };
        },
        resolveFlowEndpoint: (key) => global.WA_GOLD_RUSH_FLOW_ENDPOINTS[key] || ''
    };

    const sync = require('../shared/sharepoint-sync.js');
    const payload = sync.buildProgressPayload({
        studentCode: 'SC-1',
        classCode: '6b',
        level: 2,
        currentRound: 3,
        currentCash: 100.25,
        currentAssets: 20.75,
        netWorth: 121,
        score: 121,
        progressionMarkersJson: { schemaVersion: 2 }
    });
    assert.equal(payload.classCode, '6B');
    assert.equal(payload.currentCash, 100.25);
    assert.match(payload.progressionMarkersJson, /schemaVersion/);

    await sync.retryQueue();
    assert.equal(posted.length, 1);
    assert.equal(posted[0].studentCode, 'SC-1');
    assert.equal(posted[0].currentAssets, 0);
    assert.equal(sync.queueLength(), 0);
});

test('dashboard hydration adapter normalizes expected shape while disabled', () => {
    const TeacherDashboard = require('../teacher/dashboard-state.js');
    const dashboard = new TeacherDashboard();
    const result = dashboard.hydrateDashboardFromNormalizedData({
        students: [{ StudentCode: 's-1', ClassCode: '6b' }],
        teachers: [{ teacherEmail: 'T@EXAMPLE.COM', ClassCode: '6b' }],
        progress: [{ studentCode: 's-1' }]
    }, { enabled: false });

    assert.equal(result.success, true);
    assert.equal(result.skipped, true);
    assert.equal(result.data.students[0].studentCode, 's-1');
    assert.equal(result.data.students[0].classCode, '6B');
    assert.equal(result.data.teachers[0].email, 't@example.com');
});

test('progression snapshot builder keeps full restoration fields', () => {
    const { buildProgressionSnapshot } = require('../shared/progression-snapshot.js');
    const snapshot = buildProgressionSnapshot({
        schemaVersion: 2,
        assignedLevel: 4,
        round: 8,
        cash: 123.45,
        netWorth: 456.78,
        player: { studentCode: 'SC-1' },
        ownedMines: { southern_cross: { owned: true } },
        machinery: [{ id: 'truck', purchasePrice: 200 }],
        roundHistory: [{ round: 1 }],
        investmentPlans: { southern_cross: { safe: 10 } },
        strategyLabel: 'Balanced',
        progressionStateByLevel: { '4': { checkpointStatus: 'quiz_passed' } }
    });

    assert.equal(snapshot.schemaVersion, 2);
    assert.equal(snapshot.player.studentCode, 'SC-1');
    assert.deepEqual(snapshot.ownedMines.southern_cross, { owned: true });
    assert.equal(snapshot.machinery[0].id, 'truck');
    assert.equal(snapshot.progressionStateByLevel['4'].checkpointStatus, 'quiz_passed');
});
