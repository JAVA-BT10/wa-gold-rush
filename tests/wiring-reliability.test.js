const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

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

function loadStudentAuth() {
    delete require.cache[require.resolve('../shared/student-auth-client.js')];
    return require('../shared/student-auth-client.js');
}

function loadSharePointSync() {
    delete require.cache[require.resolve('../shared/sharepoint-sync.js')];
    return require('../shared/sharepoint-sync.js');
}

function getHomePageInlineScript(html) {
    const scriptMatches = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
    assert.ok(scriptMatches.length > 0, 'Expected inline scripts in index.html');
    const inlineScript = scriptMatches[scriptMatches.length - 1]?.[1] || '';
    assert.match(inlineScript, /function syncStudentPinMode/);
    assert.match(inlineScript, /handleStudentPinChange/);
    return inlineScript;
}

function buildLevelProgressHarness() {
    const script = fs.readFileSync(require.resolve('../levels/level-2-tycoon/script.js'), 'utf8');
    const context = {
        console,
        document: {
            addEventListener() {},
            getElementById() { return null; },
            querySelector() { return null; },
            querySelectorAll() { return []; }
        },
        window: {
            location: {
                href: 'https://example.com/levels/level-2-tycoon/index.html',
                search: '',
                pathname: '/levels/level-2-tycoon/index.html'
            },
            addEventListener() {}
        },
        localStorage: createStorage(),
        URL,
        URLSearchParams,
        alert() {},
        confirm() { return true; },
        CustomEvent: function CustomEvent(type, init) {
            this.type = type;
            this.detail = init?.detail;
        }
    };
    vm.runInNewContext(
        [
            script,
            'this.createProgressSaveScheduler = createProgressSaveScheduler;'
        ].join('\n'),
        context
    );
    return {
        createProgressSaveScheduler: context.createProgressSaveScheduler
    };
}

async function flushMicrotasks() {
    await Promise.resolve();
    await Promise.resolve();
}

function renderDeployedPagesArtifacts({ dashboardTemplate, homeTemplate, levelTemplate, apiKey, version }) {
    const normalizedApiKey = String(apiKey || '').trim();
    const normalizedVersion = String(version || '').trim();
    assert.notEqual(normalizedVersion, '', 'Expected a non-empty deployed runtime config version');
    assert.notEqual(normalizedVersion, 'dev', 'Expected a non-dev deployed runtime config version');
    return {
        runtimeConfigScript: [
            '(function initRuntimeConfig(windowObj) {',
            '  const existingRuntimeConfig = windowObj.WA_GOLD_RUSH_RUNTIME_CONFIG || {};',
            `  const apiKey = String(${JSON.stringify(normalizedApiKey)} || '').trim();`,
            '  windowObj.WA_GOLD_RUSH_RUNTIME_CONFIG = {',
            '    ...existingRuntimeConfig,',
            '    apiKey,',
            "    buildTarget: 'github-pages',",
            `    version: ${JSON.stringify(normalizedVersion)}`,
            '  };',
            '  windowObj.WA_GOLD_RUSH_POWER_AUTOMATE_CONFIG = windowObj.WA_GOLD_RUSH_POWER_AUTOMATE_CONFIG || {};',
            '  if (apiKey) {',
            '    windowObj.WA_GOLD_RUSH_POWER_AUTOMATE_CONFIG.apiKey = apiKey;',
            '  }',
            '  windowObj.WA_GOLD_RUSH_RUNTIME_CONFIG_SCRIPT_LOADED = true;',
            '})(window);',
            ''
        ].join('\n'),
        dashboardHtml: String(dashboardTemplate || '').replaceAll('__WA_GGR_RUNTIME_CONFIG_VERSION__', normalizedVersion),
        homeHtml: String(homeTemplate || '').replaceAll('__WA_GGR_RUNTIME_CONFIG_VERSION__', normalizedVersion),
        levelHtml: String(levelTemplate || '').replaceAll('__WA_GGR_RUNTIME_CONFIG_VERSION__', normalizedVersion)
    };
}

function buildHomePageFunctionHarness() {
    const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
    const listeners = new Map();
    const elements = {
        firstTimePinSetupInput: { checked: false },
        oldPinInput: { value: '', required: true, disabled: false, placeholder: '' },
        oldPinLabelText: { textContent: 'Old PIN' },
        studentPinChangeBtn: { textContent: '🔁 Change PIN' },
        studentPinModeHint: { textContent: '' },
        pinClassCodeInput: { value: '' },
        pinStudentIdInput: { value: '' },
        newPinInput: { value: '' },
        confirmNewPinInput: { value: '' },
        studentPinStatus: { textContent: '', style: {} }
    };
    const document = {
        baseURI: 'https://example.com/index.html',
        addEventListener(type, listener) {
            listeners.set(type, listener);
        },
        getElementById(id) {
            return elements[id] || null;
        }
    };
    let capturedPayload = null;
    let changeStudentPinImpl = async (payload) => {
        capturedPayload = payload;
        return { success: true };
    };
    const context = {
        console,
        document,
        localStorage: createStorage(),
        sessionStorage: createStorage(),
        URL,
        URLSearchParams,
        window: {
            location: {
                href: 'https://example.com/index.html',
                search: '',
                pathname: '/index.html'
            },
            history: {
                replaceState() {}
            },
            WA_GOLD_RUSH_STUDENT_AUTH: {
                async changeStudentPin(payload) {
                    return changeStudentPinImpl(payload);
                }
            }
        }
    };
    vm.runInNewContext(
        [
            getHomePageInlineScript(html),
            'this.syncStudentPinMode = syncStudentPinMode;',
            'this.handleStudentPinChange = handleStudentPinChange;'
        ].join('\n'),
        context
    );
    return {
        elements,
        syncStudentPinMode: context.syncStudentPinMode,
        handleStudentPinChange: context.handleStudentPinChange,
        getCapturedPayload: () => JSON.parse(JSON.stringify(capturedPayload)),
        clearCapturedPayload: () => {
            capturedPayload = null;
        },
        setChangeStudentPinImpl: (impl) => {
            changeStudentPinImpl = async (payload) => {
                capturedPayload = payload;
                return impl(payload);
            };
        }
    };
}

test('flow endpoint registry includes wired unlock and change-pin endpoints', () => {
    global.WA_GOLD_RUSH_FLOW_ENDPOINTS = {};
    delete require.cache[require.resolve('../shared/flow-endpoints.js')];
    require('../shared/flow-endpoints.js');
    assert.match(global.WA_GOLD_RUSH_FLOW_ENDPOINTS.teacherUnlockStudent, /a7d0d76c24304f6bbfae4cb50df223f8/);
    assert.match(global.WA_GOLD_RUSH_FLOW_ENDPOINTS.changeStudentPin, /RpwToQQqWyJTJzTkGxQ3pGwD6r8C3kL_wWNJwChHx20/);
    assert.match(global.WA_GOLD_RUSH_FLOW_ENDPOINTS.getDashboardData, /a633ad56ceaf4cb487d3aeae05543bc9/);
});

test('dashboard config resolves getDashboardData from shared endpoint registry', () => {
    global.window = global;
    global.WA_GOLD_RUSH_POWER_AUTOMATE_CONFIG = { apiKey: 'key' };
    global.WA_GOLD_RUSH_FLOW_ENDPOINTS = {
        getDashboardData: 'https://example.com/get-dashboard-data'
    };
    global.WA_GOLD_RUSH_DASHBOARD_CONFIG = {
        apiKey: 'key',
        flowEndpoints: {
            getDashboardData: 'https://REPLACE-WITH-GGR_GetDashboardData-URL'
        }
    };
    delete require.cache[require.resolve('../teacher/dashboard-config.js')];
    require('../teacher/dashboard-config.js');
    assert.equal(
        global.WA_GOLD_RUSH_DASHBOARD_CONFIG.flowEndpoints.getDashboardData,
        'https://example.com/get-dashboard-data'
    );
});

test('runtime config script marks load status flag', () => {
    const script = fs.readFileSync(require.resolve('../teacher/runtime-config.js'), 'utf8');
    const context = {
        window: {
            WA_GOLD_RUSH_RUNTIME_CONFIG: {
                existing: true
            }
        }
    };
    vm.runInNewContext(script, context);
    assert.equal(context.window.WA_GOLD_RUSH_RUNTIME_CONFIG_SCRIPT_LOADED, true);
    assert.equal(context.window.WA_GOLD_RUSH_RUNTIME_CONFIG.existing, true);
    assert.equal(context.window.WA_GOLD_RUSH_RUNTIME_CONFIG.version, 'dev');
});

test('pages deploy workflow keeps secret injection and rendered runtime artifacts usable', () => {
    const workflow = fs.readFileSync(require.resolve('../.github/workflows/build-and-deploy.yml'), 'utf8');
    assert.ok(workflow.includes('WA_GGR_API_KEY: ${{ secrets.WA_GGR_API_KEY }}'));
    assert.ok(workflow.includes('WA_GGR_RUNTIME_CONFIG_VERSION: ${{ github.run_id }}-${{ github.run_attempt }}'));
    assert.ok(workflow.includes('WA_GGR_PAGES_BUILD_DIR: pages-dist'));
    assert.ok(workflow.includes('path: pages-dist'));
    assert.ok(workflow.includes('excluded_entry_names = {'));
    assert.ok(workflow.includes('for source in sorted(Path(".").iterdir(), key=lambda path: path.name):'));
    assert.ok(workflow.includes('shutil.copytree(source, destination, ignore=ignore_entries)'));
    assert.ok(workflow.includes('(build_dir / ".nojekyll").write_text("", encoding="utf-8")'));
    assert.ok(workflow.includes("buildTarget: 'github-pages'"));
    assert.ok(workflow.includes('html_paths = sorted(build_dir.rglob("*.html"))'));
    assert.ok(workflow.includes('replaced_html_paths.append(html_path)'));
    assert.ok(workflow.includes('Missing runtime config version token in built HTML files'));
    assert.ok(workflow.includes('Verify Pages artifact contents'));
    assert.ok(workflow.includes("for html_path in sorted(build_dir.rglob(\"*.html\"))"));
    assert.ok(workflow.includes("re.finditer(r'runtime-config\\.js\\?v="));
    assert.ok(workflow.includes('Built HTML contains an unexpected runtime config version'));
    assert.ok(workflow.includes('Built HTML does not reference cache-busted runtime config'));
    assert.ok(workflow.includes('"tar",'));
    assert.ok(workflow.includes('"--dereference"'));
    assert.ok(workflow.includes('"--hard-dereference"'));
    assert.ok(workflow.includes('str(archive_path)'));
    assert.ok(workflow.includes('candidate.name.lstrip("./") == "teacher/runtime-config.js"'));
    assert.ok(workflow.includes('Packaged Pages artifact does not contain teacher/runtime-config.js'));
    assert.ok(workflow.includes('raise SystemExit("WA_GGR_API_KEY secret is required to deploy teacher/runtime-config.js")'));
    assert.ok(workflow.includes('raise SystemExit("WA_GGR_RUNTIME_CONFIG_VERSION must be a non-dev build marker")'));

    const dashboardTemplate = fs.readFileSync(require.resolve('../teacher/dashboard.html'), 'utf8');
    const homeTemplate = fs.readFileSync(require.resolve('../index.html'), 'utf8');
    const levelTemplate = fs.readFileSync(require.resolve('../levels/level-2-tycoon/index.html'), 'utf8');
    const rendered = renderDeployedPagesArtifacts({
        dashboardTemplate,
        homeTemplate,
        levelTemplate,
        apiKey: 'runtime-key',
        version: '123-1'
    });
    const context = {
        window: {
            WA_GOLD_RUSH_RUNTIME_CONFIG: {
                existing: true
            }
        }
    };
    vm.runInNewContext(rendered.runtimeConfigScript, context);

    assert.equal(context.window.WA_GOLD_RUSH_RUNTIME_CONFIG.apiKey, 'runtime-key');
    assert.equal(context.window.WA_GOLD_RUSH_RUNTIME_CONFIG.version, '123-1');
    assert.equal(context.window.WA_GOLD_RUSH_RUNTIME_CONFIG.buildTarget, 'github-pages');
    assert.equal(context.window.WA_GOLD_RUSH_RUNTIME_CONFIG.existing, true);
    assert.equal(context.window.WA_GOLD_RUSH_POWER_AUTOMATE_CONFIG.apiKey, 'runtime-key');
    assert.equal(context.window.WA_GOLD_RUSH_RUNTIME_CONFIG_SCRIPT_LOADED, true);
    assert.ok(rendered.dashboardHtml.includes('runtime-config.js?v=123-1'));
    assert.ok(rendered.homeHtml.includes('teacher/runtime-config.js?v=123-1'));
    assert.ok(rendered.levelHtml.includes('../../teacher/runtime-config.js?v=123-1'));
    assert.ok(!rendered.dashboardHtml.includes('__WA_GGR_RUNTIME_CONFIG_VERSION__'));
    assert.ok(!rendered.homeHtml.includes('__WA_GGR_RUNTIME_CONFIG_VERSION__'));
    assert.ok(!rendered.levelHtml.includes('__WA_GGR_RUNTIME_CONFIG_VERSION__'));
    assert.ok(homeTemplate.includes('teacher/runtime-config.js?v=__WA_GGR_RUNTIME_CONFIG_VERSION__'));
    assert.ok(levelTemplate.includes('../../teacher/runtime-config.js?v=__WA_GGR_RUNTIME_CONFIG_VERSION__'));
    assert.ok(dashboardTemplate.includes('runtime-config.js?v=__WA_GGR_RUNTIME_CONFIG_VERSION__'));
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
    const auth = loadStudentAuth();
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
    const auth = loadStudentAuth();
    const result = await auth.changeStudentPin({
        classCode: '6B',
        studentId: '123456',
        oldPin: '1111',
        newPin: '2222'
    });
    assert.equal(result.success, false);
    assert.equal(result.error, 'Old PIN mismatch');
});

test('student auth change pin omits old pin hash for first-time setup', async () => {
    let capturedPayload = null;
    global.WA_GOLD_RUSH_POWER_AUTOMATE = {
        callFlow: async (_flowName, payload) => {
            capturedPayload = payload;
            return {
                success: true,
                status: 200,
                data: { ok: true }
            };
        }
    };
    const auth = loadStudentAuth();
    const result = await auth.changeStudentPin({
        classCode: '6b',
        studentId: '123456',
        newPin: '2222',
        firstTimeSetup: true
    });
    assert.equal(result.success, true);
    assert.equal(capturedPayload.classCode, '6B');
    assert.equal(capturedPayload.studentId, '123456');
    assert.equal(capturedPayload.firstTimeSetup, true);
    assert.equal(Object.prototype.hasOwnProperty.call(capturedPayload, 'oldPinHash'), false);
    assert.match(capturedPayload.newPinHash, /^[a-f0-9]{64}$/);
});

test('student auth change pin still requires old pin for normal changes', async () => {
    global.WA_GOLD_RUSH_POWER_AUTOMATE = {
        callFlow: async () => ({
            success: true,
            status: 200,
            data: { ok: true }
        })
    };
    const auth = loadStudentAuth();
    await assert.rejects(
        () => auth.changeStudentPin({
            classCode: '6B',
            studentId: '123456',
            newPin: '2222'
        }),
        /old PIN, and new PIN are required/
    );
});

test('home page first-time PIN mode disables old PIN and submits first-time payload', async () => {
    const harness = buildHomePageFunctionHarness();
    harness.elements.oldPinInput.value = '1111';
    harness.elements.firstTimePinSetupInput.checked = true;

    harness.syncStudentPinMode();

    assert.equal(harness.elements.oldPinInput.required, false);
    assert.equal(harness.elements.oldPinInput.disabled, true);
    assert.equal(harness.elements.oldPinInput.value, '');
    assert.equal(harness.elements.oldPinLabelText.textContent, 'Old PIN (not needed yet)');
    assert.equal(harness.elements.studentPinChangeBtn.textContent, '✅ Set PIN');

    harness.elements.pinClassCodeInput.value = '6b';
    harness.elements.pinStudentIdInput.value = '123456';
    harness.elements.newPinInput.value = '2222';
    harness.elements.confirmNewPinInput.value = '2222';

    await harness.handleStudentPinChange({ preventDefault() {} });

    assert.deepEqual(harness.getCapturedPayload(), {
        classCode: '6B',
        studentId: '123456',
        oldPin: '',
        newPin: '2222',
        firstTimeSetup: true
    });
    assert.equal(harness.elements.studentPinStatus.textContent, 'PIN set after backend confirmation.');
});

test('home page normal PIN mode keeps old PIN required and submits change payload', async () => {
    const harness = buildHomePageFunctionHarness();
    harness.elements.firstTimePinSetupInput.checked = false;
    harness.syncStudentPinMode();

    assert.equal(harness.elements.oldPinInput.required, true);
    assert.equal(harness.elements.oldPinInput.disabled, false);
    assert.equal(harness.elements.oldPinLabelText.textContent, 'Old PIN');
    assert.equal(harness.elements.studentPinChangeBtn.textContent, '🔁 Change PIN');

    harness.elements.pinClassCodeInput.value = '6b';
    harness.elements.pinStudentIdInput.value = '123456';
    harness.elements.oldPinInput.value = '1111';
    harness.elements.newPinInput.value = '2222';
    harness.elements.confirmNewPinInput.value = '2222';

    await harness.handleStudentPinChange({ preventDefault() {} });

    assert.deepEqual(harness.getCapturedPayload(), {
        classCode: '6B',
        studentId: '123456',
        oldPin: '1111',
        newPin: '2222',
        firstTimeSetup: false
    });
    assert.equal(harness.elements.studentPinStatus.textContent, 'PIN updated after backend confirmation.');
});

test('home page keeps PIN entries when backend rejects the change', async () => {
    const harness = buildHomePageFunctionHarness();
    harness.setChangeStudentPinImpl(async () => ({ success: false, error: 'Old PIN mismatch' }));
    harness.elements.pinClassCodeInput.value = '6b';
    harness.elements.pinStudentIdInput.value = '123456';
    harness.elements.oldPinInput.value = '1111';
    harness.elements.newPinInput.value = '2222';
    harness.elements.confirmNewPinInput.value = '2222';

    await harness.handleStudentPinChange({ preventDefault() {} });

    assert.equal(harness.elements.oldPinInput.value, '1111');
    assert.equal(harness.elements.newPinInput.value, '2222');
    assert.equal(harness.elements.confirmNewPinInput.value, '2222');
    assert.equal(harness.elements.studentPinStatus.textContent, 'Old PIN mismatch');
});

test('sharepoint sync loads cleanly, exposes progress sync helpers, and canonicalizes rebuilt payload keys', () => {
    global.localStorage = createStorage();
    const sync = loadSharePointSync();

    assert.equal(typeof sync.syncProgress, 'function');
    assert.equal(typeof sync.buildCanonicalProgressKey, 'function');

    const firstPayload = sync.buildProgressPayload({
        studentCode: 'hg-nb5-018',
        classCode: 'nb5',
        level: '2.9',
        currentRound: 3
    });
    const rebuiltPayload = sync.buildProgressPayload({
        ...firstPayload,
        currentRound: 4,
        currentCash: 125
    });

    assert.equal(sync.buildCanonicalProgressKey({
        classCode: ' nb5 ',
        studentCode: ' hg-nb5-018 ',
        level: '2.9'
    }), 'NB5|HG-NB5-018|2');
    assert.equal(firstPayload.progressKey, 'NB5|HG-NB5-018|2');
    assert.equal(rebuiltPayload.progressKey, 'NB5|HG-NB5-018|2');
    assert.equal(rebuiltPayload.saveRequestId, firstPayload.saveRequestId);
    assert.equal(rebuiltPayload.clientTimestampUtc, firstPayload.clientTimestampUtc);
    assert.equal(typeof rebuiltPayload.clientVersion, 'string');
    assert.notEqual(rebuiltPayload.clientVersion, '');
});

test('sharepoint sync keeps telemetry when retrying legacy queue items', async () => {
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

    const sync = loadSharePointSync();
    const payload = sync.buildProgressPayload({
        studentCode: 'SC-1',
        classCode: '6b',
        level: 2,
        currentRound: 3,
        currentCash: 100.25,
        currentAssets: 20.75,
        netWorth: 120.51,
        score: 120.49,
        progressionMarkersJson: { schemaVersion: 2 },
        badgesJson: { earned: ['steady_hand'] }
    });
    assert.equal(payload.classCode, '6B');
    assert.equal(payload.currentCash, 100);
    assert.equal(payload.currentAssets, 21);
    assert.equal(payload.netWorth, 121);
    assert.equal(payload.score, 120);
    assert.match(payload.progressionMarkersJson, /schemaVersion/);
    assert.match(payload.badgesJson, /steady_hand/);
    assert.equal(payload.progressKey, '6B|SC-1|2');
    assert.ok(payload.saveRequestId);

    await sync.retryQueue();
    assert.equal(posted.length, 1);
    assert.equal(posted[0].studentCode, 'SC-1');
    assert.equal(posted[0].currentCash, 0);
    assert.equal(posted[0].currentAssets, 0);
    assert.equal(posted[0].netWorth, 999);
    assert.equal(posted[0].score, 999);
    assert.equal(posted[0].progressKey, '|SC-1|2');
    assert.ok(posted[0].saveRequestId);
    assert.ok(posted[0].clientTimestampUtc);
    assert.ok(posted[0].clientVersion);
    assert.equal(sync.queueLength(), 0);
});

test('sharepoint sync treats timed-out saves as verification pending and keeps a retry item', async () => {
    global.localStorage = createStorage();
    global.WA_GOLD_RUSH_FLOW_ENDPOINTS = {
        saveProgress: 'https://example.com/save'
    };
    const logs = [];
    const originalInfo = console.info;
    console.info = (...args) => logs.push(args);
    global.WA_GOLD_RUSH_POWER_AUTOMATE = {
        callFlow: async (_flowName, _payload, options = {}) => new Promise((resolve) => {
        options.signal?.addEventListener('abort', () => {
            resolve({
                success: false,
                status: 504,
                data: { ok: true, saved: true },
                error: 'Timed out after upstream success'
            });
        });
        }),
        resolveFlowEndpoint: (key) => global.WA_GOLD_RUSH_FLOW_ENDPOINTS[key] || ''
    };

    try {
        const sync = loadSharePointSync();
        sync.configure({ progressRequestTimeoutMs: 5 });
        const result = await sync.syncProgress({
        studentCode: 'SC-1',
        classCode: '6B',
        level: 2,
        currentRound: 4
        });

        assert.equal(result.ok, false);
        assert.equal(result.queued, true);
        assert.equal(result.unknownOutcome, true);
        assert.equal(sync.getCloudSaveStatus(), 'verification pending');
        assert.equal(sync.queueLength(), 1);
        assert.ok(logs.some(entry => String(entry[0]).includes('Progress timeout/unknown outcome')));
        assert.ok(logs.some(entry => String(entry[0]).includes('Progress queueing')));
    } finally {
        console.info = originalInfo;
    }
});

test('sharepoint sync reuses queued saveRequestId on retry and coalesces same-key queued state', async () => {
    global.localStorage = createStorage();
    global.WA_GOLD_RUSH_FLOW_ENDPOINTS = {
        saveProgress: 'https://example.com/save'
    };
    const posted = [];
    let attempt = 0;
    global.WA_GOLD_RUSH_POWER_AUTOMATE = {
        callFlow: async (_flowName, payload) => {
        posted.push(payload);
        attempt += 1;
        if (attempt === 1) {
            return { success: false, error: 'Network down' };
        }
        return { success: true, status: 200, data: { ok: true } };
        },
        resolveFlowEndpoint: (key) => global.WA_GOLD_RUSH_FLOW_ENDPOINTS[key] || ''
    };

    const sync = loadSharePointSync();
    const firstResult = await sync.syncProgress({
        studentCode: 'SC-1',
        classCode: '6B',
        level: 2,
        currentRound: 2
    });
    const queuedAfterFailure = JSON.parse(global.localStorage.getItem('wa_gr_sync_queue'));
    assert.equal(firstResult.ok, false);
    assert.equal(queuedAfterFailure.length, 1);
    assert.equal(queuedAfterFailure[0].payload.saveRequestId, firstResult.saveRequestId);

    await sync.retryQueue();

    assert.equal(posted.length, 2);
    assert.equal(posted[1].saveRequestId, firstResult.saveRequestId);
    assert.equal(sync.queueLength(), 0);

    global.WA_GOLD_RUSH_POWER_AUTOMATE.callFlow = async () => ({ success: false, error: 'Network down' });
    const olderResult = await sync.syncProgress({
        studentCode: 'SC-1',
        classCode: '6B',
        level: 2,
        currentRound: 6,
        currentCash: 100
    });
    const newerResult = await sync.syncProgress({
        studentCode: 'SC-1',
        classCode: '6B',
        level: 2,
        currentRound: 8,
        currentCash: 150
    });
    const queuedAfterCoalesce = JSON.parse(global.localStorage.getItem('wa_gr_sync_queue'));

    assert.equal(queuedAfterCoalesce.length, 1);
    assert.equal(queuedAfterCoalesce[0].payload.progressKey, '6B|SC-1|2');
    assert.equal(queuedAfterCoalesce[0].payload.currentRound, 8);
    assert.equal(queuedAfterCoalesce[0].payload.currentCash, 150);
    assert.equal(queuedAfterCoalesce[0].payload.saveRequestId, newerResult.saveRequestId);
    assert.notEqual(olderResult.saveRequestId, newerResult.saveRequestId);
});

test('level progress scheduler coalesces overlapping saves by key while allowing independent keys', async () => {
    const harness = buildLevelProgressHarness();
    const dispatched = [];
    const resolvers = [];
    const scheduler = harness.createProgressSaveScheduler({
        resolveProgressKey(payload) {
        return payload.progressKey;
        },
        dispatchSave(payload) {
        dispatched.push(payload);
        return new Promise((resolve) => {
            resolvers.push(() => resolve({ ok: true, progressKey: payload.progressKey }));
        });
        }
    });

    const firstPromise = scheduler.schedule({ progressKey: 'NB5|SC-1|2', currentRound: 1 });
    scheduler.schedule({ progressKey: 'NB5|SC-1|2', currentRound: 2 });
    scheduler.schedule({ progressKey: 'NB5|SC-1|2', currentRound: 3 });
    const otherKeyPromise = scheduler.schedule({ progressKey: 'NB5|SC-2|2', currentRound: 1 });

    assert.equal(dispatched.length, 2);
    assert.equal(dispatched[0].currentRound, 1);
    assert.equal(dispatched[1].progressKey, 'NB5|SC-2|2');

    resolvers[0]();
    await firstPromise;
    await flushMicrotasks();

    assert.equal(dispatched.length, 3);
    assert.equal(dispatched[2].progressKey, 'NB5|SC-1|2');
    assert.equal(dispatched[2].currentRound, 3);

    resolvers[1]();
    resolvers[2]();
    await otherKeyPromise;
});

test('dashboard hydration adapter normalizes expected shape while disabled', () => {
    global.localStorage = createStorage();
    global.sessionStorage = createStorage();
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

function setupTeacherDashboardGlobals({ localItems = {}, session = true, apiKey = 'key', endpoints = {}, callFlow } = {}) {
    global.localStorage = createStorage(localItems);
    global.sessionStorage = createStorage(session ? {
        wa_gold_rush_teacher_session: JSON.stringify({
            ok: true,
            teacherEmail: 'teacher@example.com',
            teacherName: 'Teacher One',
            classCode: '6B',
            classCodes: ['6B'],
            role: 'teacher'
        })
    } : {});
    global.WA_GOLD_RUSH_DASHBOARD_CONFIG = {
        apiKey,
        flowEndpoints: {
            getDashboardData: 'https://example.com/get-dashboard-data',
            ...endpoints
        }
    };
    global.WA_GOLD_RUSH_POWER_AUTOMATE_CONFIG = { apiKey };
    global.WA_GOLD_RUSH_POWER_AUTOMATE = {
        getApiKey: () => apiKey,
        callFlow: callFlow || (async () => {
            throw new Error('Unexpected flow call');
        })
    };
    const TeacherDashboard = require('../teacher/dashboard-state.js');
    return new TeacherDashboard();
}

const STALE_LOCAL_DASHBOARD_ITEMS = {
    teacher_dashboard: JSON.stringify({
        students: [{
            id: 'stale-1',
            studentCode: 'STALE-1',
            classCode: '6B',
            gameState: { round: 9, netWorth: 9999, lastPlayed: '2020-01-01T00:00:00.000Z' }
        }]
    }),
    wa_gold_rush_teacher_list: JSON.stringify([{
        id: 'local.teacher@example.com',
        email: 'local.teacher@example.com',
        name: 'Local Teacher',
        classCode: '6C',
        role: 'teacher'
    }]),
    wa_gold_rush_class_records: JSON.stringify([{ studentCode: 'STALE-1', classCode: '6B', round: 9 }])
};

test('dashboard hydration loads students/teachers/progress from flow response (fresh browser)', async () => {
    const dashboard = setupTeacherDashboardGlobals({
        callFlow: async (flowName, payload) => {
            assert.equal(flowName, 'getDashboardData');
            assert.equal(payload.teacherEmail, 'teacher@example.com');
            return {
                success: true,
                status: 200,
                data: {
                    ok: true,
                    Students: [{
                        StudentCode: 'SC-1',
                        LeaderboardName: 'Gold One',
                        StudentName: 'Student One',
                        StudentID: '1001',
                        ClassCode: '6b',
                        Level: 2
                    }],
                    Teachers: [{
                        TeacherEmail: 'Teacher@Example.com',
                        TeacherName: 'Teacher One',
                        ClassCode: '6b',
                        Role: { Value: 'admin' }
                    }],
                    Progress: [{
                        StudentCode: 'SC-1',
                        ClassCode: '6b',
                        Level: 2,
                        CurrentRound: 4,
                        CurrentCash: 456.75,
                        NetWorth: 1234.5,
                        CheckpointStatus: 'quiz_passed',
                        QuizScore: 4
                    }]
                }
            };
        }
    });
    const result = await dashboard.hydrateDashboardFromFlow();

    assert.equal(result.success, true);
    assert.equal(result.source, 'flow');
    assert.deepEqual(result.missingArrays, []);
    assert.deepEqual(result.counts, { students: 1, teachers: 1, progress: 1 });
    assert.equal(result.diagnostics.teacherSessionFound, true);
    assert.equal(result.diagnostics.apiKeyPresent, true);
    assert.equal(result.diagnostics.hasConfiguredFlowEndpoint, true);
    assert.equal(result.diagnostics.flowRequestAttempted, true);
    assert.equal(result.diagnostics.flowRequestSucceeded, true);
    assert.equal(result.diagnostics.studentsReturned, 1);
    assert.equal(result.diagnostics.hydrationFailed, false);
    assert.equal(dashboard.students.length, 1);
    assert.equal(dashboard.students[0].studentCode, 'SC-1');
    assert.equal(dashboard.students[0].classCode, '6B');
    assert.equal(dashboard.students[0].gameState.round, 4);
    assert.equal(dashboard.students[0].gameState.cash, 456.75);
    assert.equal(dashboard.students[0].gameState.netWorth, 1234.5);
    assert.equal(dashboard.students[0].checkpointsByLevel[2].checkpointStatus, 'quiz_passed');
    assert.equal(dashboard.students[0].checkpointsByLevel[2].quizScore, 4);
    const teacher = dashboard.getTeacher('teacher@example.com');
    assert.equal(teacher?.email, 'teacher@example.com');
    assert.equal(teacher?.name, 'Teacher One');
    assert.equal(teacher?.role, 'admin');
    // Hydration never writes roster/progress data into browser storage.
    assert.equal(global.localStorage.getItem('wa_gold_rush_class_records'), null);
    assert.equal(global.localStorage.getItem('teacher_dashboard'), null);
    assert.equal(global.localStorage.getItem('wa_gold_rush_teacher_list'), null);
});

test('dashboard hydration accepts partial flow response when teachers array is missing', async () => {
    const dashboard = setupTeacherDashboardGlobals({
        callFlow: async () => ({
            success: true,
            status: 200,
            data: {
                ok: true,
                students: [{ studentCode: 'SC-2', leaderboardName: 'Two', classCode: '6B' }],
                progress: [{ studentCode: 'SC-2', classCode: '6B', level: 2, currentRound: 3 }]
            }
        })
    });
    const result = await dashboard.hydrateDashboardFromFlow();

    assert.equal(result.success, true);
    assert.deepEqual(result.missingArrays, ['teachers']);
    assert.equal(result.diagnostics.missingArrays.includes('teachers'), true);
    assert.equal(dashboard.students.length, 1);
    assert.equal(dashboard.students[0].gameState.round, 3);
    assert.equal(dashboard.teachers.length, 0);
    assert.match(result.statusMessage, /did not include: teachers/);
});

test('dashboard hydration never merges stale local teacher/dashboard caches into flow data', async () => {
    const dashboard = setupTeacherDashboardGlobals({
        localItems: STALE_LOCAL_DASHBOARD_ITEMS,
        callFlow: async () => ({
            success: true,
            status: 200,
            data: {
                ok: true,
                students: [{ studentCode: 'SC-1', leaderboardName: 'One', classCode: '6B' }],
                teachers: [{ teacherEmail: 'teacher@example.com', classCode: '6B', role: 'teacher' }],
                progress: []
            }
        })
    });
    const result = await dashboard.hydrateDashboardFromFlow();

    assert.equal(result.success, true);
    assert.deepEqual(dashboard.students.map(student => student.studentCode), ['SC-1']);
    assert.equal(dashboard.getTeacher('local.teacher@example.com'), null);
    assert.deepEqual(dashboard.teachers.map(teacher => teacher.email), ['teacher@example.com']);
});

test('dashboard progress joins are StudentCode-first with StudentID only as fallback', () => {
    const dashboard = setupTeacherDashboardGlobals();
    const result = dashboard.hydrateDashboardFromNormalizedData({
        students: [
            { StudentCode: 'abc-1', StudentID: 'shared-id', LeaderboardName: 'A', ClassCode: '6B' },
            { StudentCode: 'XYZ-2', StudentID: 'other-id', LeaderboardName: 'B', ClassCode: '6B' }
        ],
        teachers: [],
        progress: [
            // StudentID points at student B, but StudentCode identifies student A.
            { StudentCode: 'ABC-1', StudentID: 'other-id', ClassCode: '6B', Level: 2, CurrentRound: 7 },
            // No StudentCode → StudentID fallback.
            { StudentID: 'other-id', ClassCode: '6B', Level: 2, CurrentRound: 5 }
        ]
    }, { enabled: true });

    assert.equal(result.success, true);
    const studentA = dashboard.students.find(student => student.studentCode === 'abc-1');
    const studentB = dashboard.students.find(student => student.studentCode === 'XYZ-2');
    assert.equal(studentA.gameState.round, 7);
    assert.equal(studentB.gameState.round, 5);
});

test('dashboard hydration fails closed when teacher session is missing', async () => {
    const dashboard = setupTeacherDashboardGlobals({
        session: false,
        localItems: STALE_LOCAL_DASHBOARD_ITEMS,
        callFlow: async () => {
            throw new Error('Flow should not be called when teacher session is missing');
        }
    });
    const result = await dashboard.hydrateDashboardFromFlow();

    assert.equal(result.success, false);
    assert.equal(result.reason, 'missing_teacher_session');
    assert.equal(result.diagnostics.teacherSessionFound, false);
    assert.equal(result.diagnostics.teacherEmailPresent, false);
    assert.equal(result.diagnostics.flowRequestAttempted, false);
    assert.equal(result.diagnostics.hydrationFailed, true);
    assert.equal(result.diagnostics.failureReason, 'missing_teacher_session');
    assert.equal(dashboard.students.length, 0);
});

test('dashboard hydration reports flow_unavailable when api key is missing', async () => {
    const dashboard = setupTeacherDashboardGlobals({
        apiKey: '',
        callFlow: async () => {
            throw new Error('Flow helper should not run without API key');
        }
    });
    const result = await dashboard.hydrateDashboardFromFlow();

    assert.equal(result.success, false);
    assert.equal(result.reason, 'flow_unavailable');
    assert.equal(result.retryable, true);
    assert.equal(result.diagnostics.apiKeyPresent, false);
    assert.equal(result.diagnostics.flowRequestAttempted, false);
    assert.equal(result.diagnostics.failureReason, 'flow_unavailable');
});

test('dashboard hydration clears stale data and reports errors when flow fails or payload is invalid', async () => {
    const dashboard = setupTeacherDashboardGlobals({
        localItems: STALE_LOCAL_DASHBOARD_ITEMS,
        callFlow: async () => ({
            success: true,
            status: 200,
            data: { ok: true, students: [{ studentCode: 'SC-1', leaderboardName: 'One', classCode: '6B' }] }
        })
    });
    const firstResult = await dashboard.hydrateDashboardFromFlow();
    assert.equal(firstResult.success, true);
    assert.equal(dashboard.students.length, 1);

    global.WA_GOLD_RUSH_POWER_AUTOMATE.callFlow = async () => ({ success: false, error: 'Network down' });
    const failedResult = await dashboard.hydrateDashboardFromFlow();
    assert.equal(failedResult.success, false);
    assert.equal(failedResult.reason, 'flow_failed');
    assert.equal(failedResult.statusTone, 'error');
    assert.equal(failedResult.retryable, true);
    assert.equal(failedResult.diagnostics.flowRequestAttempted, true);
    assert.equal(failedResult.diagnostics.flowRequestSucceeded, false);
    assert.equal(dashboard.students.length, 0);
    assert.equal(dashboard.teachers.length, 0);

    global.WA_GOLD_RUSH_POWER_AUTOMATE.callFlow = async () => ({
        success: true,
        status: 200,
        data: { ok: true, message: 'missing arrays' }
    });
    const invalidResult = await dashboard.hydrateDashboardFromFlow();
    assert.equal(invalidResult.success, false);
    assert.equal(invalidResult.reason, 'invalid_flow_payload');
    assert.deepEqual(invalidResult.missingArrays.sort(), ['progress', 'students', 'teachers']);
    assert.equal(dashboard.students.length, 0);
});

test('dashboard hydration reuses one in-flight flow request and notifies onHydrated listeners', async () => {
    let flowCalls = 0;
    let resolveFlow;
    const flowResponse = new Promise((resolve) => {
        resolveFlow = resolve;
    });
    const dashboard = setupTeacherDashboardGlobals({
        callFlow: async () => {
            flowCalls += 1;
            return flowResponse;
        }
    });
    const notified = [];
    dashboard.onHydrated(result => notified.push(result.success));
    const firstHydration = dashboard.hydrateDashboardFromFlow();
    const secondHydration = dashboard.hydrateDashboardFromFlow();

    assert.equal(flowCalls, 1);

    resolveFlow({
        success: true,
        status: 200,
        data: { ok: true, students: [], teachers: [], progress: [] }
    });

    const [firstResult, secondResult] = await Promise.all([firstHydration, secondHydration]);
    assert.equal(firstResult.source, 'flow');
    assert.equal(secondResult.source, 'flow');
    assert.deepEqual(notified, [true]);
});

test('teacher auth always goes through loginTeacher with no permanent admin bypass', async () => {
    const calls = [];
    const dashboard = setupTeacherDashboardGlobals({
        session: false,
        endpoints: { loginTeacher: 'https://example.com/login-teacher' },
        callFlow: async (flowName, payload) => {
            calls.push({ flowName, payload });
            return {
                success: true,
                status: 200,
                data: {
                    ok: true,
                    TeacherEmail: 'ben.turner@education.wa.edu.au',
                    TeacherName: 'Ben Turner',
                    Role: 'admin',
                    ClassCodes: ['6B', '6C']
                }
            };
        }
    });
    const source = fs.readFileSync(require.resolve('../teacher/dashboard-state.js'), 'utf8');
    assert.doesNotMatch(source, /PERMANENT_ADMIN|isPermanentlyAuthorizedAdmin/);

    const result = await dashboard.authenticateTeacher({ teacherEmail: 'Ben.Turner@education.wa.edu.au', classCode: '6B' });
    assert.equal(result.success, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].flowName, 'loginTeacher');
    assert.equal(calls[0].payload.teacherEmail, 'ben.turner@education.wa.edu.au');
    assert.equal(dashboard.getTeacherSession()?.role, 'admin');

    global.WA_GOLD_RUSH_POWER_AUTOMATE.callFlow = async () => ({ success: true, status: 200, data: { ok: false, error: 'Not in GGR_Teachers' } });
    dashboard.clearTeacherSession?.();
    global.sessionStorage = createStorage();
    const denied = await dashboard.authenticateTeacher({ teacherEmail: 'ben.turner@education.wa.edu.au', classCode: 'ADMIN' });
    assert.equal(denied.success, false);
    assert.equal(dashboard.getTeacherSession(), null);
});

test('teacher dashboard writes wait for the flow and re-hydrate before reporting success', async () => {
    const calls = [];
    let upsertOk = false;
    const dashboard = setupTeacherDashboardGlobals({
        endpoints: { upsertStudentProfile: 'https://example.com/upsert-student' },
        callFlow: async (flowName) => {
            calls.push(flowName);
            if (flowName === 'upsertStudentProfile') {
                return upsertOk
                    ? { success: true, status: 200, data: { ok: true } }
                    : { success: false, status: 409, error: 'Duplicate' };
            }
            return {
                success: true,
                status: 200,
                data: { ok: true, students: [{ studentCode: 'NEW-1', leaderboardName: 'New', classCode: '6B' }], teachers: [], progress: [] }
            };
        }
    });

    const failed = await dashboard.addStudent({ studentCode: 'NEW-1', leaderboardName: 'New', classCode: '6B' });
    assert.equal(failed.success, false);
    assert.deepEqual(calls, ['upsertStudentProfile']);
    assert.equal(dashboard.students.length, 0);

    upsertOk = true;
    const saved = await dashboard.addStudent({ studentCode: 'NEW-1', leaderboardName: 'New', classCode: '6B' });
    assert.equal(saved.success, true);
    assert.deepEqual(calls.slice(1), ['upsertStudentProfile', 'getDashboardData']);
    assert.equal(dashboard.students[0].studentCode, 'NEW-1');
    assert.equal(global.localStorage.getItem('teacher_dashboard'), null);

    const deleted = dashboard.deleteTeacher('teacher@example.com');
    assert.equal(deleted.success, false);
    assert.match(deleted.error, /GGR_Teachers/);
});

test('dashboard html lifecycle invokes flow-only hydration for startup, login, and refresh button', () => {
    const html = fs.readFileSync(require.resolve('../teacher/dashboard.html'), 'utf8');
    const runtimeConfigScriptIndex = html.indexOf('runtime-config.js?v=__WA_GGR_RUNTIME_CONFIG_VERSION__');
    const dashboardConfigScriptIndex = html.indexOf('dashboard-config.js');
    assert.ok(runtimeConfigScriptIndex >= 0);
    assert.ok(dashboardConfigScriptIndex > runtimeConfigScriptIndex);
    assert.ok(
        html.includes("withBusyButton('refreshBtn', 'Loading…', () => refreshDashboardFromFlow({ showStatus: true }))")
    );
    assert.ok(html.includes('await initializeDashboard({ showHydrationStatus: true });'));
    assert.match(
        html,
        /async function refreshDashboardFromFlow\(options = \{\}\)\s*\{[\s\S]*dashboard\.hydrateDashboardFromFlow\(\)[\s\S]*applyHydrationResult\(hydration\)/
    );
    assert.match(
        html,
        /function applyHydrationResult\(hydration\)\s*\{[\s\S]*renderHydrationDiagnostics\(hydration\);[\s\S]*refresh\(\)[\s\S]*refreshTeachers\(\)[\s\S]*renderHydrationFailureTables/
    );
    assert.doesNotMatch(html, /hydrateDashboardFromFlowWithFallback|refreshDashboardFromBestSource|wa_gold_rush_class_records/);
    assert.ok(html.includes('id="hydrationSummary"'));
    assert.ok(html.includes('id="retryHydrationBtn"'));
    assert.ok(html.includes('id="hydrationMissingArrays"'));
    assert.ok(html.includes('id="hydrationDiagnosticsBanner"'));
    assert.ok(html.includes('id="diagTeacherSessionFound"'));
    assert.ok(html.includes('id="diagMetaSummary" role="status" aria-live="polite" aria-atomic="true"'));
    assert.ok(html.includes('window.WA_GOLD_RUSH_RUNTIME_CONFIG_SCRIPT_LOADED = window.WA_GOLD_RUSH_RUNTIME_CONFIG_SCRIPT_LOADED === true;'));
});

test('non-dashboard html pages cache-bust runtime config requests', () => {
    const homeHtml = fs.readFileSync(require.resolve('../index.html'), 'utf8');
    const levelHtml = fs.readFileSync(require.resolve('../levels/level-2-tycoon/index.html'), 'utf8');
    assert.ok(homeHtml.includes('teacher/runtime-config.js?v=__WA_GGR_RUNTIME_CONFIG_VERSION__'));
    assert.ok(levelHtml.includes('../../teacher/runtime-config.js?v=__WA_GGR_RUNTIME_CONFIG_VERSION__'));
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

function createStubElement(id) {
    const classes = new Set();
    return {
        id,
        style: {},
        textContent: '',
        innerHTML: '',
        disabled: false,
        onclick: null,
        classList: {
            add: (name) => classes.add(name),
            remove: (name) => classes.delete(name),
            contains: (name) => classes.has(name)
        },
        appendChild() {},
        setAttribute() {}
    };
}

function buildStudentGameHarness({ level = 2, storage = createStorage(), extraGlobals = {} } = {}) {
    const read = (path) => fs.readFileSync(require.resolve(path), 'utf8');
    const elements = new Map();
    const getElement = (id) => {
        if (!elements.has(id)) elements.set(id, createStubElement(id));
        return elements.get(id);
    };
    const context = {
        console: { log() {}, info() {}, warn() {}, error() {} },
        document: {
            addEventListener() {},
            getElementById: getElement,
            createElement: () => createStubElement('dynamic'),
            querySelector() { return null; },
            querySelectorAll(selector) {
                return selector === '.modal' ? [getElement('checkpointQuizModal')] : [];
            },
            body: { appendChild() {} }
        },
        location: {
            href: `https://example.com/levels/level-2-tycoon/index.html?level=${level}`,
            search: `?level=${level}`,
            pathname: '/levels/level-2-tycoon/index.html'
        },
        addEventListener() {},
        localStorage: storage,
        URL,
        URLSearchParams,
        setTimeout,
        clearTimeout,
        AbortController,
        alert() {},
        confirm() { return true; },
        CustomEvent: function CustomEvent(type, init) {
            this.type = type;
            this.detail = init?.detail;
        },
        ...extraGlobals
    };
    context.window = context;
    vm.createContext(context);
    vm.runInContext([
        read('../shared/progression-snapshot.js'),
        read('../shared/progression-quiz.js'),
        read('../levels/level-2-tycoon/game-state.js'),
        read('../levels/level-2-tycoon/level-access-guard.js'),
        read('../levels/level-2-tycoon/script.js'),
        'syncPlayerRecord = function syncPlayerRecordStub() { this.__syncCalls = (this.__syncCalls || 0) + 1; }.bind(this);',
        'this.__setGameState = (value) => { gameState = value; };',
        'this.__getGameState = () => gameState;',
        'this.GameStateClass = GameState;',
        'this.LevelAccessGuardClass = LevelAccessGuard;',
        'this.checkProgressionGoal = checkProgressionGoal;',
        'this.displayQuizResults = displayQuizResults;',
        'this.resolveCurrentLevelAccess = resolveCurrentLevelAccess;'
    ].join('\n'), context);

    const config = JSON.parse(read('../shared/game-config.json'));
    const gameState = new context.GameStateClass();
    gameState.originalGameConfig = config;
    gameState.gameConfig = JSON.parse(JSON.stringify(config));
    gameState.assignedLevel = level;
    gameState.loadFromLocalStorage();
    gameState.assignedLevel = level;
    gameState.applyLevelConfigAdapter();
    context.__setGameState(gameState);
    return { context, gameState, getElement, storage };
}

test('student checkpoint progression: goal opens quiz, pass persists quiz_passed, continue opens next level', async () => {
    const storage = createStorage();
    const level2 = buildStudentGameHarness({ level: 2, storage });
    const { context, gameState, getElement } = level2;

    // Reaching the goal opens the quiz modal.
    gameState.cash = 999999;
    context.checkProgressionGoal();
    assert.equal(getElement('checkpointQuizModal').classList.contains('active'), true);
    assert.equal(gameState.checkpointStatus, 'quiz_available');

    // Passing the quiz persists quiz_passed for Level 2 in the shared autosave slot.
    context.displayQuizResults({ passed: true, score: 4, totalQuestions: 5, results: [] }, {});
    const saved = JSON.parse(storage.getItem('level2_autosave'));
    const level2State = saved.gameState.progressionStateByLevel['2'];
    assert.equal(level2State.checkpointStatus, 'quiz_passed');
    assert.equal(level2State.quizScore, 4);
    assert.ok(level2State.quizPassedAt);
    assert.equal(level2State.quizAttempts.length, 1);
    assert.equal(level2State.approvalStatus, 'pending');
    assert.equal(context.__syncCalls, 1);

    // Continue navigates to Level 3 instead of only closing the modal.
    const continueBtn = getElement('quizContinueButton');
    assert.equal(continueBtn.textContent, 'Continue to Level 3 →');
    await continueBtn.onclick();
    assert.match(context.location.href, /level-2-tycoon\/index\.html\?level=3$/);

    // The access guard reads the same saved state the game wrote.
    global.localStorage = storage;
    assert.equal(new context.LevelAccessGuardClass(3).isLevelAccessible(), true);
    assert.equal(context.LevelAccessGuardClass.isCheckpointPassed(2, storage), true);
    assert.equal(new context.LevelAccessGuardClass(4).isLevelAccessible(), false);

    // Level 3 starts with its own (not yet passed) checkpoint.
    const level3 = buildStudentGameHarness({ level: 3, storage });
    assert.equal(await level3.context.resolveCurrentLevelAccess(), true);
    assert.equal(level3.gameState.checkpointStatus, null);
    assert.equal(level3.gameState.getProgressionState(2).checkpointStatus, 'quiz_passed');
});

test('home page level cards use the same saved-state reader as the level access guard', () => {
    const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
    assert.ok(html.includes('<script src="levels/level-2-tycoon/level-access-guard.js"></script>'));
    assert.ok(html.includes('<script src="shared/progression-snapshot.js"></script>'));
    assert.match(html, /function isCheckpointApproved\(requiredLevel\)\s*\{[\s\S]*LevelAccessGuard\.isCheckpointPassed\(requiredLevel\)/);
    assert.match(html, /refreshRemoteProgression\(\);/);
});

test('cross-device unlock uses getStudentProgress only when configured', async () => {
    const { LevelAccessGuard } = require('../levels/level-2-tycoon/level-access-guard.js');
    const storage = createStorage({
        wa_gold_rush_student_session: JSON.stringify({ studentCode: 'sc-1', classCode: '6b' })
    });
    const snapshotApi = require('../shared/progression-snapshot.js');

    const unconfigured = await LevelAccessGuard.hydrateRemoteProgression(2, {
        storage,
        globalObj: { WA_GOLD_RUSH_PROGRESS_SNAPSHOT: snapshotApi }
    });
    assert.equal(unconfigured.unlocked, false);
    assert.equal(unconfigured.reason, 'flow_unavailable');

    const calls = [];
    const globalObj = {
        WA_GOLD_RUSH_PROGRESS_SNAPSHOT: snapshotApi,
        WA_GOLD_RUSH_POWER_AUTOMATE: {
            resolveFlowEndpoint: (name) => (name === 'getStudentProgress' ? 'https://example.com/get-progress' : ''),
            isPlaceholderEndpoint: () => false,
            callFlow: async (name, payload) => {
                calls.push({ name, payload });
                return {
                    success: true,
                    data: {
                        ok: true,
                        progress: [{ StudentCode: 'SC-1', ClassCode: '6B', Level: 2, CheckpointStatus: 'quiz_passed', QuizScore: 5 }]
                    }
                };
            }
        }
    };
    const unlocked = await LevelAccessGuard.hydrateRemoteProgression(2, { storage, globalObj });
    assert.equal(unlocked.unlocked, true);
    assert.equal(calls[0].name, 'getStudentProgress');
    assert.deepEqual(calls[0].payload, { studentCode: 'sc-1', classCode: '6B', level: 2 });
    assert.equal(LevelAccessGuard.isCheckpointPassed(2, storage), true);
    assert.equal(JSON.parse(storage.getItem('level2_autosave')).gameState.progressionStateByLevel['2'].quizScore, 5);
});

test('level progress scheduler whenIdle waits for in-flight and queued saves', async () => {
    const harness = buildLevelProgressHarness();
    const resolvers = [];
    const scheduler = harness.createProgressSaveScheduler({
        dispatchSave(payload) {
            return new Promise((resolve) => resolvers.push(() => resolve({ ok: true, payload })));
        }
    });
    scheduler.schedule({ progressKey: 'NB5|SC-1|2', currentRound: 1 });
    scheduler.schedule({ progressKey: 'NB5|SC-1|2', currentRound: 2 });
    let idle = false;
    const idlePromise = scheduler.whenIdle().then(() => { idle = true; });
    resolvers[0]();
    await flushMicrotasks();
    await flushMicrotasks();
    assert.equal(idle, false);
    assert.equal(resolvers.length, 2);
    resolvers[1]();
    await idlePromise;
    assert.equal(idle, true);
});

test('SaveProgress payload carries checkpoint fields and keeps the canonical ProgressKey', () => {
    global.localStorage = createStorage();
    const sync = loadSharePointSync();
    const payload = sync.buildProgressPayload({
        studentCode: 'sc-1',
        classCode: '6b',
        level: 2,
        currentRound: 9,
        progressionMarkersJson: {
            schemaVersion: 2,
            assignedLevel: 2,
            progressionStateByLevel: {
                2: {
                    checkpointStatus: 'quiz_passed',
                    quizScore: 4,
                    quizPassedAt: '2026-01-02T03:04:05.000Z',
                    quizAttempts: [{ score: 4, totalQuestions: 5, passed: true }],
                    approvalStatus: 'pending'
                }
            }
        }
    });
    assert.equal(payload.progressKey, '6B|SC-1|2');
    assert.equal(payload.checkpointStatus, 'quiz_passed');
    assert.equal(payload.quizScore, 4);
    assert.equal(payload.quizPassedAt, '2026-01-02T03:04:05.000Z');
    assert.equal(payload.approvalStatus, 'pending');
    assert.ok('approverName' in payload);
    assert.ok('approvalTimestamp' in payload);
    assert.equal(Array.isArray(payload.quizAttempts), true);
    assert.equal(JSON.parse(payload.quizAttemptsJson)[0].score, 4);
    assert.equal(JSON.parse(payload.progressionStateJson)['2'].checkpointStatus, 'quiz_passed');
    assert.equal(payload.progressionStateByLevel['2'].checkpointStatus, 'quiz_passed');
});

test('SaveProgress flow spec upserts by canonical ProgressKey instead of create-first', () => {
    const spec = fs.readFileSync(require.resolve('../docs/power-automate/GGR_SaveProgress-repair-spec.md'), 'utf8');
    assert.match(spec, /UPPER\(ClassCode\)\|UPPER\(StudentCode\)\|Level/);
    assert.match(spec, /ProgressKey eq/);
    assert.match(spec, /Update item/);
    assert.match(spec, /CheckpointStatus/);
    assert.match(spec, /Do not.*Create item.*first/i);
});

test('checkpoint dashboard coerces tab levels and renders from hydrated flow data', () => {
    const CheckpointDashboard = require('../teacher/checkpoint-dashboard.js');
    assert.equal(CheckpointDashboard.normalizeLevel('3'), 3);
    assert.equal(CheckpointDashboard.normalizeLevel('3') + 1, 4);
    assert.equal(CheckpointDashboard.normalizeLevel('bogus'), 2);

    const students = [
        { studentCode: 'SC-1', leaderboardName: 'One', classCode: '6B', checkpointsByLevel: { 3: { checkpointStatus: 'quiz_passed', quizScore: 5, quizAttempts: [] } } },
        { studentCode: 'SC-2', leaderboardName: 'Two', classCode: '6B', checkpointsByLevel: { 3: { checkpointStatus: 'quiz_available' } } },
        { studentCode: 'SC-3', leaderboardName: 'Three', classCode: '6B', gameState: { progressionStateByLevel: { 2: { checkpointStatus: 'quiz_passed', quizScore: 4 } } } }
    ];
    const level3 = CheckpointDashboard.getStudentsWithPassedCheckpoint(students, '3');
    assert.deepEqual(level3.map(entry => entry.student.studentCode), ['SC-1']);
    assert.equal(CheckpointDashboard.formatQuizScore(level3[0].checkpoint), '5/5');
    const level2 = CheckpointDashboard.getStudentsWithPassedCheckpoint(students, 2);
    assert.deepEqual(level2.map(entry => entry.student.studentCode), ['SC-3']);
    const html = CheckpointDashboard.buildCheckpointTableHTML(level3, 3);
    assert.match(html, /SC-1|One/);
});

test('checkpoint approval is disabled when GGR_SaveCheckpointApproval is not configured', async () => {
    const dashboard = setupTeacherDashboardGlobals({
        endpoints: { saveCheckpointApproval: 'https://REPLACE-WITH-GGR_SaveCheckpointApproval-URL' },
        callFlow: async () => {
            throw new Error('Approval flow must not be called when unconfigured');
        }
    });
    const CheckpointApproval = require('../teacher/checkpoint-approval.js');
    assert.equal(CheckpointApproval.isApprovalFlowConfigured(dashboard), false);
    const result = await CheckpointApproval.saveApproval({
        dashboard,
        student: { studentCode: 'SC-1', classCode: '6B' },
        level: 2,
        status: 'approved'
    });
    assert.equal(result.success, false);
    assert.equal(result.unavailable, true);
    assert.equal(result.error, CheckpointApproval.UNAVAILABLE_MESSAGE);

    const reviewer = CheckpointApproval.getReviewerIdentity(dashboard);
    assert.equal(reviewer.reviewerEmail, 'teacher@example.com');
    assert.equal(reviewer.reviewerName, 'Teacher One');
    assert.match(CheckpointApproval.generateQuizReviewHTML(null, {}), /not stored/);
});

test('checkpoint approval saves through the flow with session reviewer and canonical key', async () => {
    const calls = [];
    const dashboard = setupTeacherDashboardGlobals({
        endpoints: { saveCheckpointApproval: 'https://example.com/save-approval' },
        callFlow: async (flowName, payload) => {
            calls.push({ flowName, payload });
            if (flowName === 'saveCheckpointApproval') return { success: true, status: 200, data: { ok: true } };
            return { success: true, status: 200, data: { ok: true, students: [], teachers: [], progress: [] } };
        }
    });
    const CheckpointApproval = require('../teacher/checkpoint-approval.js');
    const result = await CheckpointApproval.saveApproval({
        dashboard,
        student: { studentCode: 'sc-1', classCode: '6b' },
        level: '2',
        status: 'approved'
    });
    assert.equal(result.success, true);
    assert.equal(calls[0].flowName, 'saveCheckpointApproval');
    assert.equal(calls[0].payload.progressKey, '6B|SC-1|2');
    assert.equal(calls[0].payload.approverEmail, 'teacher@example.com');
    assert.equal(calls[0].payload.approvalStatus, 'approved');
    assert.equal(calls[1].flowName, 'getDashboardData');
});

test('checkpoint UI files hold no localStorage approval authority or prompt-based reviewer', () => {
    for (const file of ['../teacher/checkpoint-dashboard.js', '../teacher/checkpoint-approval.js']) {
        const source = fs.readFileSync(require.resolve(file), 'utf8');
        assert.doesNotMatch(source, /localStorage/, `${file} must not use localStorage`);
        assert.doesNotMatch(source, /\bprompt\(/, `${file} must not prompt for reviewer`);
    }
});
