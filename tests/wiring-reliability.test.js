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

function getHomePageInlineScript(html) {
    const scriptMatches = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
    assert.ok(scriptMatches.length > 0, 'Expected inline scripts in index.html');
    const inlineScript = scriptMatches[scriptMatches.length - 1]?.[1] || '';
    assert.match(inlineScript, /function syncStudentPinMode/);
    assert.match(inlineScript, /handleStudentPinChange/);
    return inlineScript;
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

test('dashboard hydration loads students/teachers/progress from flow response', async () => {
    global.localStorage = createStorage({
        teacher_dashboard: JSON.stringify({
            students: [{
                id: 'seed-1',
                studentCode: 'SC-1',
                classCode: '6B',
                gameState: { lastPlayed: '2026-01-01T00:00:00.000Z' }
            }]
        }),
        wa_gold_rush_teacher_list: JSON.stringify([{
            id: 'local.teacher@example.com',
            email: 'local.teacher@example.com',
            name: 'Local Teacher',
            classCode: '6C',
            role: 'teacher'
        }])
    });
    global.sessionStorage = createStorage({
        wa_gold_rush_teacher_session: JSON.stringify({
            ok: true,
            teacherEmail: 'teacher@example.com',
            classCode: '6B',
            classCodes: ['6B']
        })
    });
    global.WA_GOLD_RUSH_DASHBOARD_CONFIG = {
        apiKey: 'key',
        flowEndpoints: {
            getDashboardData: 'https://example.com/get-dashboard-data'
        }
    };
    global.WA_GOLD_RUSH_POWER_AUTOMATE_CONFIG = { apiKey: 'key' };
    global.WA_GOLD_RUSH_POWER_AUTOMATE = {
        getApiKey: () => 'key',
        callFlow: async (_flowName, payload) => {
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
                        teacherEmail: 'teacher@example.com',
                        teacherName: 'Teacher One',
                        classCode: '6b',
                        role: 'teacher'
                    }],
                    Progress: [{
                        StudentCode: 'SC-1',
                        ClassCode: '6b',
                        CurrentRound: 4,
                        CurrentCash: 456.75,
                        NetWorth: 1234.5
                    }]
                }
            };
        }
    };

    const TeacherDashboard = require('../teacher/dashboard-state.js');
    const dashboard = new TeacherDashboard();
    const result = await dashboard.hydrateDashboardFromFlowWithFallback();

    assert.equal(result.success, true);
    assert.equal(result.source, 'flow');
    assert.equal(result.diagnostics.teacherSessionFound, true);
    assert.equal(result.diagnostics.apiKeyPresent, true);
    assert.equal(result.diagnostics.hasConfiguredFlowEndpoint, true);
    assert.equal(result.diagnostics.flowRequestAttempted, true);
    assert.equal(result.diagnostics.flowRequestSucceeded, true);
    assert.equal(result.diagnostics.studentsReturned, 1);
    assert.equal(result.diagnostics.fallbackTriggered, false);
    assert.equal(dashboard.students.length, 1);
    assert.equal(dashboard.students[0].studentCode, 'SC-1');
    assert.equal(dashboard.students[0].classCode, '6B');
    assert.equal(dashboard.students[0].gameState.round, 4);
    assert.equal(dashboard.students[0].gameState.cash, 456.75);
    assert.equal(dashboard.students[0].gameState.netWorth, 1234.5);
    assert.equal(dashboard.students[0].gameState.lastPlayed, '2026-01-01T00:00:00.000Z');
    assert.equal(dashboard.getTeacher('teacher@example.com')?.email, 'teacher@example.com');
    assert.equal(dashboard.getTeacher('local.teacher@example.com')?.email, 'local.teacher@example.com');
    const persistedProgress = JSON.parse(global.localStorage.getItem('wa_gold_rush_class_records'));
    assert.equal(persistedProgress[0].round, 4);
    assert.equal(persistedProgress[0].cash, 456.75);
});

test('dashboard hydration falls back before flow call when teacher session is missing', async () => {
    global.localStorage = createStorage({
        teacher_dashboard: JSON.stringify({ students: [] }),
        wa_gold_rush_teacher_list: JSON.stringify([])
    });
    global.sessionStorage = createStorage();
    global.WA_GOLD_RUSH_DASHBOARD_CONFIG = {
        apiKey: 'key',
        flowEndpoints: {
            getDashboardData: 'https://example.com/get-dashboard-data'
        }
    };
    global.WA_GOLD_RUSH_POWER_AUTOMATE_CONFIG = { apiKey: 'key' };
    global.WA_GOLD_RUSH_POWER_AUTOMATE = {
        getApiKey: () => 'key',
        callFlow: async () => {
            throw new Error('Flow should not be called when teacher session is missing');
        }
    };

    const TeacherDashboard = require('../teacher/dashboard-state.js');
    const dashboard = new TeacherDashboard();
    const result = await dashboard.hydrateDashboardFromFlowWithFallback();

    assert.equal(result.success, true);
    assert.equal(result.source, 'local');
    assert.equal(result.reason, 'missing_teacher_session');
    assert.equal(result.diagnostics.teacherSessionFound, false);
    assert.equal(result.diagnostics.teacherEmailPresent, false);
    assert.equal(result.diagnostics.flowRequestAttempted, false);
    assert.equal(result.diagnostics.flowResponseReceived, false);
    assert.equal(result.diagnostics.flowRequestSucceeded, false);
    assert.equal(result.diagnostics.fallbackTriggered, true);
    assert.equal(result.diagnostics.fallbackReason, 'missing_teacher_session');
});

test('dashboard hydration reports flow_unavailable when api key is missing', async () => {
    global.localStorage = createStorage({
        teacher_dashboard: JSON.stringify({ students: [] }),
        wa_gold_rush_teacher_list: JSON.stringify([])
    });
    global.sessionStorage = createStorage({
        wa_gold_rush_teacher_session: JSON.stringify({
            ok: true,
            teacherEmail: 'teacher@example.com',
            classCode: '6B',
            classCodes: ['6B']
        })
    });
    global.WA_GOLD_RUSH_DASHBOARD_CONFIG = {
        apiKey: '',
        flowEndpoints: {
            getDashboardData: 'https://example.com/get-dashboard-data'
        }
    };
    global.WA_GOLD_RUSH_POWER_AUTOMATE_CONFIG = { apiKey: '' };
    global.WA_GOLD_RUSH_POWER_AUTOMATE = {
        getApiKey: () => '',
        callFlow: async () => {
            throw new Error('Flow helper should not run without API key');
        }
    };

    const TeacherDashboard = require('../teacher/dashboard-state.js');
    const dashboard = new TeacherDashboard();
    const result = await dashboard.hydrateDashboardFromFlowWithFallback();

    assert.equal(result.success, true);
    assert.equal(result.source, 'local');
    assert.equal(result.reason, 'flow_unavailable');
    assert.equal(result.diagnostics.apiKeyPresent, false);
    assert.equal(result.diagnostics.flowRequestAttempted, false);
    assert.equal(result.diagnostics.fallbackTriggered, true);
    assert.equal(result.diagnostics.fallbackReason, 'flow_unavailable');
});

test('dashboard hydration falls back to local cache when flow fails or payload is invalid', async () => {
    const localStudents = [{
        id: 'local-1',
        studentCode: 'LOCAL-1',
        classCode: '6B',
        gameState: { round: 2, netWorth: 800 }
    }];
    global.localStorage = createStorage({
        teacher_dashboard: JSON.stringify({ students: localStudents }),
        wa_gold_rush_teacher_list: JSON.stringify([{ id: 'local.teacher@example.com', email: 'local.teacher@example.com', classCode: '6B', role: 'teacher' }])
    });
    global.sessionStorage = createStorage({
        wa_gold_rush_teacher_session: JSON.stringify({
            ok: true,
            teacherEmail: 'teacher@example.com',
            classCode: '6B',
            classCodes: ['6B']
        })
    });
    global.WA_GOLD_RUSH_DASHBOARD_CONFIG = {
        apiKey: 'key',
        flowEndpoints: {
            getDashboardData: 'https://example.com/get-dashboard-data'
        }
    };
    global.WA_GOLD_RUSH_POWER_AUTOMATE_CONFIG = { apiKey: 'key' };

    const TeacherDashboard = require('../teacher/dashboard-state.js');
    const dashboard = new TeacherDashboard();

    global.WA_GOLD_RUSH_POWER_AUTOMATE = {
        getApiKey: () => 'key',
        callFlow: async () => ({ success: false, error: 'Network down' })
    };
    const failedResult = await dashboard.hydrateDashboardFromFlowWithFallback();
    assert.equal(failedResult.success, true);
    assert.equal(failedResult.source, 'local');
    assert.equal(failedResult.diagnostics.flowRequestAttempted, true);
    assert.equal(failedResult.diagnostics.flowRequestSucceeded, false);
    assert.equal(failedResult.diagnostics.fallbackReason, 'flow_failed');
    assert.equal(dashboard.students[0].studentCode, 'LOCAL-1');

    global.WA_GOLD_RUSH_POWER_AUTOMATE = {
        getApiKey: () => 'key',
        callFlow: async () => ({
            success: true,
            status: 200,
            data: { ok: true, message: 'missing arrays' }
        })
    };
    const invalidResult = await dashboard.hydrateDashboardFromFlowWithFallback();
    assert.equal(invalidResult.success, true);
    assert.equal(invalidResult.source, 'local');
    assert.equal(invalidResult.diagnostics.flowRequestAttempted, true);
    assert.equal(invalidResult.diagnostics.flowRequestSucceeded, true);
    assert.equal(invalidResult.diagnostics.fallbackReason, 'invalid_flow_payload');
    assert.equal(dashboard.students[0].studentCode, 'LOCAL-1');
});

test('dashboard hydration reuses one in-flight flow request for overlapping calls', async () => {
    global.localStorage = createStorage({
        teacher_dashboard: JSON.stringify({ students: [] }),
        wa_gold_rush_teacher_list: JSON.stringify([])
    });
    global.sessionStorage = createStorage({
        wa_gold_rush_teacher_session: JSON.stringify({
            ok: true,
            teacherEmail: 'teacher@example.com',
            classCode: '6B',
            classCodes: ['6B']
        })
    });
    global.WA_GOLD_RUSH_DASHBOARD_CONFIG = {
        apiKey: 'key',
        flowEndpoints: {
            getDashboardData: 'https://example.com/get-dashboard-data'
        }
    };
    global.WA_GOLD_RUSH_POWER_AUTOMATE_CONFIG = { apiKey: 'key' };

    let flowCalls = 0;
    let resolveFlow;
    const flowResponse = new Promise((resolve) => {
        resolveFlow = resolve;
    });
    global.WA_GOLD_RUSH_POWER_AUTOMATE = {
        getApiKey: () => 'key',
        callFlow: async () => {
            flowCalls += 1;
            return flowResponse;
        }
    };

    const TeacherDashboard = require('../teacher/dashboard-state.js');
    const dashboard = new TeacherDashboard();
    const firstHydration = dashboard.hydrateDashboardFromFlowWithFallback();
    const secondHydration = dashboard.hydrateDashboardFromFlowWithFallback();

    assert.equal(flowCalls, 1);

    resolveFlow({
        success: true,
        status: 200,
        data: {
            ok: true,
            students: [],
            teachers: [],
            progress: []
        }
    });

    const [firstResult, secondResult] = await Promise.all([firstHydration, secondHydration]);
    assert.equal(firstResult.source, 'flow');
    assert.equal(secondResult.source, 'flow');
});

test('dashboard html lifecycle invokes hydration for startup, login, and refresh button', () => {
    const html = fs.readFileSync(require.resolve('../teacher/dashboard.html'), 'utf8');
    const runtimeConfigScriptIndex = html.indexOf('runtime-config.js?v=__WA_GGR_RUNTIME_CONFIG_VERSION__');
    const dashboardConfigScriptIndex = html.indexOf('dashboard-config.js');
    assert.ok(runtimeConfigScriptIndex >= 0);
    assert.ok(dashboardConfigScriptIndex > runtimeConfigScriptIndex);
    assert.ok(
        html.includes("withBusyButton('refreshBtn', 'Refreshing…', () => refreshDashboardFromBestSource({ showStatus: true }))")
    );
    assert.ok(html.includes('await initializeDashboard({ showHydrationStatus: true });'));
    assert.match(
        html,
        /async function refreshDashboardFromBestSource\(options = \{\}\)\s*\{[\s\S]*dashboard\.hydrateDashboardFromFlowWithFallback\(\)[\s\S]*refresh\(\)[\s\S]*refreshTeachers\(\)/
    );
    assert.ok(html.includes('id="hydrationDiagnosticsBanner"'));
    assert.ok(html.includes('id="diagTeacherSessionFound"'));
    assert.ok(html.includes('id="diagMetaSummary" role="status" aria-live="polite" aria-atomic="true"'));
    assert.ok(html.includes('renderHydrationDiagnostics(hydration);'));
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
