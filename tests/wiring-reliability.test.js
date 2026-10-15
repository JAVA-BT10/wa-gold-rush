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

const STUDENT_SESSION_KEY = 'wa_gold_rush_student_session';

function buildRosterSession(overrides = {}) {
    return {
        ok: true,
        source: 'GGR_LoginStudent',
        schemaVersion: 2,
        studentCode: 'SC-1',
        studentId: '123456',
        studentName: 'Alex Smith',
        leaderboardName: 'Gold Miner',
        classCode: '6B',
        assignedLevel: 2,
        authenticatedAt: '2026-01-01T00:00:00.000Z',
        ...overrides
    };
}

function createSessionStorage(initial = {}, sessionOverrides = {}) {
    return createStorage({
        [STUDENT_SESSION_KEY]: JSON.stringify(buildRosterSession(sessionOverrides)),
        ...initial
    });
}

function loadStudentSession() {
    delete require.cache[require.resolve('../shared/student-session.js')];
    return require('../shared/student-session.js');
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

function renderDeployedPagesArtifacts({ dashboardTemplate, homeTemplate, levelTemplate, apiKey, approvalUrl, version }) {
    const normalizedApiKey = String(apiKey || '').trim();
    const normalizedApprovalUrl = String(approvalUrl || '').trim();
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
            `    flowEndpoints: ${JSON.stringify({ saveCheckpointApproval: normalizedApprovalUrl })},`,
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

test('approval endpoint resolves runtime and dashboard overrides without placeholder masking', () => {
    const registry = fs.readFileSync(require.resolve('../shared/flow-endpoints.js'), 'utf8');
    const config = fs.readFileSync(require.resolve('../teacher/dashboard-config.js'), 'utf8');
    for (const [runtimeUrl, sharedUrl, dashboardUrl, expected] of [
        ['https://example.com/runtime-approval', '', 'https://REPLACE-WITH-APPROVAL', 'https://example.com/runtime-approval'],
        ['', 'https://example.com/shared-approval', 'https://REPLACE-WITH-APPROVAL', 'https://example.com/shared-approval'],
        ['https://example.com/runtime-approval', '', 'https://example.com/override', 'https://example.com/override'],
        ['https://example.com/runtime-approval', 'https://REPLACE-WITH-SHARED', 'https://REPLACE-WITH-APPROVAL', 'https://example.com/runtime-approval'],
        ['https://REPLACE-WITH-RUNTIME', 'https://example.com/shared-approval', 'https://REPLACE-WITH-APPROVAL', 'https://example.com/shared-approval'],
        ['', '', '', 'https://REPLACE-WITH-GGR_SaveCheckpointApproval-URL']
    ]) {
        const context = {
            WA_GOLD_RUSH_RUNTIME_CONFIG: { flowEndpoints: { saveCheckpointApproval: runtimeUrl } },
            WA_GOLD_RUSH_FLOW_ENDPOINTS: { saveCheckpointApproval: sharedUrl },
            WA_GOLD_RUSH_DASHBOARD_CONFIG: { apiKey: 'test-key', flowEndpoints: { saveCheckpointApproval: dashboardUrl } },
            setTimeout() {}
        };
        context.window = context;
        vm.runInNewContext(registry, context);
        vm.runInNewContext(config, context);
        assert.equal(context.WA_GOLD_RUSH_DASHBOARD_CONFIG.flowEndpoints.saveCheckpointApproval, expected);
        const TeacherDashboard = require('../teacher/dashboard-state.js');
        global.WA_GOLD_RUSH_DASHBOARD_CONFIG = context.WA_GOLD_RUSH_DASHBOARD_CONFIG;
        assert.equal(new TeacherDashboard().hasConfiguredFlowEndpoint('saveCheckpointApproval'), !/REPLACE-WITH/.test(expected));
    }

    const runtimeFallbackContext = {
        WA_GOLD_RUSH_RUNTIME_CONFIG: { flowEndpoints: { saveCheckpointApproval: 'https://example.com/runtime-approval' } },
        WA_GOLD_RUSH_FLOW_ENDPOINTS: { saveCheckpointApproval: 'https://REPLACE-WITH-SHARED' },
        WA_GOLD_RUSH_DASHBOARD_CONFIG: { apiKey: 'test-key', flowEndpoints: { saveCheckpointApproval: 'https://REPLACE-WITH-APPROVAL' } },
        setTimeout() {}
    };
    runtimeFallbackContext.window = runtimeFallbackContext;
    vm.runInNewContext(config, runtimeFallbackContext);
    assert.equal(
        runtimeFallbackContext.WA_GOLD_RUSH_DASHBOARD_CONFIG.flowEndpoints.saveCheckpointApproval,
        'https://example.com/runtime-approval'
    );
});

test('pages deploy workflow keeps secret injection and rendered runtime artifacts usable', () => {
    const workflow = fs.readFileSync(require.resolve('../.github/workflows/build-and-deploy.yml'), 'utf8');
    assert.ok(workflow.includes('WA_GGR_API_KEY: ${{ secrets.WA_GGR_API_KEY }}'));
    assert.ok(workflow.includes('WA_GGR_SAVE_CHECKPOINT_APPROVAL_URL: ${{ secrets.WA_GGR_SAVE_CHECKPOINT_APPROVAL_URL }}'));
    assert.ok(workflow.includes('approval_url = os.environ.get("WA_GGR_SAVE_CHECKPOINT_APPROVAL_URL", "").strip()'));
    assert.ok(workflow.includes('flow_endpoints = {"saveCheckpointApproval": approval_url}'));
    assert.ok(workflow.includes('flowEndpoints: {json.dumps(flow_endpoints)}'));
    const runtimeConfigSource = fs.readFileSync(require.resolve('../teacher/runtime-config.js'), 'utf8');
    assert.doesNotMatch(runtimeConfigSource, /saveCheckpointApproval|[?&]sig=/i);
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
        approvalUrl: 'https://example.com/save-approval',
        version: '123-1'
    });
    const context = {
        WA_GOLD_RUSH_RUNTIME_CONFIG: { existing: true },
        WA_GOLD_RUSH_DASHBOARD_CONFIG: {
            flowEndpoints: { saveCheckpointApproval: 'https://REPLACE-WITH-APPROVAL' }
        },
        setTimeout() {}
    };
    context.window = context;
    vm.runInNewContext(rendered.runtimeConfigScript, context);

    assert.equal(context.WA_GOLD_RUSH_RUNTIME_CONFIG.apiKey, 'runtime-key');
    assert.equal(context.WA_GOLD_RUSH_RUNTIME_CONFIG.version, '123-1');
    assert.equal(context.WA_GOLD_RUSH_RUNTIME_CONFIG.buildTarget, 'github-pages');
    assert.equal(context.WA_GOLD_RUSH_RUNTIME_CONFIG.existing, true);
    assert.equal(
        context.WA_GOLD_RUSH_RUNTIME_CONFIG.flowEndpoints.saveCheckpointApproval,
        'https://example.com/save-approval'
    );
    assert.equal(context.WA_GOLD_RUSH_POWER_AUTOMATE_CONFIG.apiKey, 'runtime-key');
    assert.equal(context.WA_GOLD_RUSH_RUNTIME_CONFIG_SCRIPT_LOADED, true);
    vm.runInNewContext(fs.readFileSync(require.resolve('../shared/flow-endpoints.js'), 'utf8'), context);
    vm.runInNewContext(fs.readFileSync(require.resolve('../teacher/dashboard-config.js'), 'utf8'), context);
    assert.equal(context.WA_GOLD_RUSH_FLOW_ENDPOINTS.saveCheckpointApproval, 'https://example.com/save-approval');
    assert.equal(context.WA_GOLD_RUSH_DASHBOARD_CONFIG.flowEndpoints.saveCheckpointApproval, 'https://example.com/save-approval');
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
            data: { ok: true, ...payload, leaderboardName: 'Gold Miner', studentCode: 'SC-1', studentName: 'Alex Smith', assignedLevel: 2 }
        })
    };
    const auth = loadStudentAuth();
    const result = await auth.loginStudent({ classCode: '6b', studentId: '123456', pin: '1234' });
    assert.equal(result.success, true);
    assert.equal(result.response.classCode, '6B');
    assert.equal(result.response.studentCode, 'SC-1');
    assert.equal(result.response.assignedLevel, 2);
    assert.equal(result.response.identityValid, true);
    assert.equal('pinHash' in result.response, false);
});

test('callFlow renders nested and unreadable gateway errors without object coercion', async () => {
    const helpers = require('../shared/power-automate-headers.js');
    for (const [body, expected] of [
        [JSON.stringify({ error: { code: 'BadGateway', message: 'The PIN service is unavailable.' } }), 'The PIN service is unavailable.'],
        [JSON.stringify({ error: { code: 'BadGateway' } }), 'HTTP 502'],
        [JSON.stringify({ message: { value: 'Ask your teacher for help.' } }), 'Ask your teacher for help.'],
        ['Bad Gateway', 'Bad Gateway'],
        ['[object Object]', 'HTTP 502'],
        ['', 'HTTP 502']
    ]) {
        const result = await helpers.callFlow('https://example.com/pin', {}, {
            includeApiKey: false,
            fetch: async () => ({ ok: false, status: 502, text: async () => body })
        });
        assert.equal(result.success, false);
        assert.equal(result.error, expected);
    }
    const cyclic = {};
    cyclic.error = cyclic;
    assert.equal(helpers.getErrorMessage(cyclic, 'Fallback'), 'Fallback');
});

test('student PIN changes require explicit confirmation and render application errors', async () => {
    for (const [data, expected] of [
        [{ ok: false, error: { message: 'Setup is not allowed.' } }, 'Setup is not allowed.'],
        [{ ok: false, error: { code: 'Denied' } }, 'PIN update was not confirmed. Ask your teacher for help before trying again.'],
        [{}, 'PIN update was not confirmed. Ask your teacher for help before trying again.'],
        [null, 'PIN update was not confirmed. Ask your teacher for help before trying again.'],
        [{ ok: 'true' }, 'PIN update was not confirmed. Ask your teacher for help before trying again.']
    ]) {
        global.WA_GOLD_RUSH_POWER_AUTOMATE = {
            callFlow: async () => ({ success: true, status: 200, data })
        };
        const result = await loadStudentAuth().changeStudentPin({
            classCode: '6B', studentId: '123456', newPin: '5837', firstTimeSetup: true
        });
        assert.equal(result.success, false);
        assert.equal(result.error, expected);
    }
});

test('PIN creation guidance is accessible, illustrative only, and does not promise reset access', () => {
    const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
    for (const id of ['newPinInput', 'confirmNewPinInput']) {
        const input = html.match(new RegExp(`<input id="${id}"[^>]*>`))[0];
        assert.match(input, /aria-describedby="[^"]*studentPinCreationHint/);
        assert.match(input, /autocomplete="new-password"/);
        assert.doesNotMatch(input, /\bvalue=|\bpattern=|\bminlength=/);
    }
    assert.match(html, /Example only: 482619 \(not a default\)/);
    assert.match(html, /no specific length is required by this form/);
    assert.match(html, /id="studentPinStatus"[^>]*role="status"[^>]*aria-live="polite"/);
    assert.doesNotMatch(html, /first time or a teacher reset your PIN/);
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
        oldPin: '1111',
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

test('student PIN hashing preserves leading zeroes and existing trim/format semantics', async () => {
    const calls = [];
    global.WA_GOLD_RUSH_POWER_AUTOMATE = {
        callFlow: async (flowName, payload) => {
            calls.push({ flowName, payload });
            return { success: true, data: { ok: true, ...payload, studentCode: 'SC-1', studentName: 'Alex Smith', leaderboardName: 'Gold Miner', assignedLevel: 2 } };
        }
    };
    const auth = loadStudentAuth();
    const expectedHash = require('node:crypto').createHash('sha256').update('004826').digest('hex');
    await auth.changeStudentPin({ classCode: '6B', studentId: '123456', newPin: ' 004826 ', firstTimeSetup: true });
    await auth.loginStudent({ classCode: '6B', studentId: '123456', pin: '004826' });
    assert.equal(calls[0].flowName, 'changeStudentPin');
    assert.deepEqual(calls[0].payload, { classCode: '6B', studentId: '123456', newPinHash: expectedHash, firstTimeSetup: true });
    assert.equal(calls[1].flowName, 'loginStudent');
    assert.deepEqual(calls[1].payload, { classCode: '6B', studentId: '123456', pinHash: expectedHash });
    assert.notEqual(await auth.hashPin('4826'), expectedHash);
    for (const pin of ['7', 'aB-9', '123456789012']) {
        assert.equal(await auth.hashPin(` ${pin} `), require('node:crypto').createHash('sha256').update(pin).digest('hex'));
    }
    await assert.rejects(() => auth.hashPin('   '), /PIN is required/);
});

test('home page PIN guidance is visible, accessible, and never prefills or imposes a new format', () => {
    const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
    assert.match(html, /<summary>Set or Change Student PIN<\/summary>/);
    for (const inputId of ['newPinInput', 'confirmNewPinInput']) {
        const input = html.match(new RegExp(`<input\\b[^>]*id="${inputId}"[^>]*>`))?.[0];
        assert.ok(input);
        assert.match(input, /type="password"/);
        assert.match(input, /maxlength="12"/);
        assert.match(input, /inputmode="numeric"/);
        assert.match(input, /autocomplete="new-password"/);
        assert.match(input, /aria-describedby="[^"]*studentPinCreationHint/);
        assert.doesNotMatch(input, /\b(?:value|placeholder|pattern|minlength)\s*=/);
    }
    assert.match(html, /Choose your own private PIN and enter it again in Confirm New PIN/);
    assert.match(html, /Example only: 482619 \(not a default\)/);
    assert.match(html, /up to 12 characters; no specific length is required by this form/);
    assert.match(html, /id="firstTimePinSetupInput"[^>]*aria-describedby="studentPinSetupInstructions"/);
    assert.match(html, /Select the first-time option below; an old PIN is not required/);
    assert.match(html, /Wait for backend confirmation of success, then use your new PIN with your Class Code and Student ID to log in above/);
    assert.match(html, /id="studentPinStatus"[^>]*role="status"[^>]*aria-live="polite"/);
});

test('home page PIN validation still trims, requires confirmation, and rejects unchanged ordinary PINs', async () => {
    const harness = buildHomePageFunctionHarness();
    const fields = harness.elements;
    fields.pinClassCodeInput.value = '6B';
    fields.pinStudentIdInput.value = '123456';
    fields.oldPinInput.value = '004826';
    for (const firstTimeSetup of [false, true]) {
        fields.firstTimePinSetupInput.checked = firstTimeSetup;
        for (const [newPin, confirmation, error] of [
            ['   ', '004826', /required/],
            ['004826', '   ', /required/],
            ['004826', '4826', /must match/],
            ...(!firstTimeSetup ? [[' 004826 ', '004826', /different from old PIN/]] : [])
        ]) {
            fields.newPinInput.value = newPin;
            fields.confirmNewPinInput.value = confirmation;
            await harness.handleStudentPinChange({ preventDefault() {} });
            assert.match(fields.studentPinStatus.textContent, error);
            assert.equal(harness.getCapturedPayload(), null);
        }
    }
    fields.newPinInput.value = ' 004826 ';
    fields.confirmNewPinInput.value = '004826';
    await harness.handleStudentPinChange({ preventDefault() {} });
    assert.equal(harness.getCapturedPayload().newPin, '004826');
    assert.equal(harness.getCapturedPayload().firstTimeSetup, true);
});

test('home page first-time PIN setup waits for backend confirmation before reporting success', async () => {
    const harness = buildHomePageFunctionHarness();
    let confirmBackend;
    harness.setChangeStudentPinImpl(() => new Promise((resolve) => { confirmBackend = resolve; }));
    harness.elements.firstTimePinSetupInput.checked = true;
    harness.syncStudentPinMode();
    harness.elements.pinClassCodeInput.value = '6B';
    harness.elements.pinStudentIdInput.value = '123456';
    harness.elements.newPinInput.value = '004826';
    harness.elements.confirmNewPinInput.value = '004826';
    const pending = harness.handleStudentPinChange({ preventDefault() {} });
    assert.equal(harness.elements.studentPinStatus.textContent, 'Setting PIN…');
    assert.equal(harness.elements.newPinInput.value, '004826');
    confirmBackend({ success: true });
    await pending;
    assert.equal(harness.elements.studentPinStatus.textContent, 'PIN set successfully. Sign in above with your new PIN to play.');
    assert.equal(harness.elements.newPinInput.value, '');
    assert.equal(harness.elements.confirmNewPinInput.value, '');
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
    assert.equal(harness.elements.studentPinStatus.textContent, 'PIN set successfully. Sign in above with your new PIN to play.');
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
    assert.equal(harness.elements.studentPinStatus.textContent, 'PIN updated successfully. Sign in above with your new PIN.');
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

test('home page PIN status falls back safely for unexpected error objects', async () => {
    const harness = buildHomePageFunctionHarness();
    harness.setChangeStudentPinImpl(async () => ({ success: false, error: { code: 'BadGateway' } }));
    harness.elements.firstTimePinSetupInput.checked = true;
    harness.elements.pinClassCodeInput.value = '6B';
    harness.elements.pinStudentIdInput.value = '123456';
    harness.elements.newPinInput.value = '5837';
    harness.elements.confirmNewPinInput.value = '5837';
    await harness.handleStudentPinChange({ preventDefault() {} });
    assert.equal(harness.elements.studentPinStatus.textContent, 'PIN update failed.');
});

test('sharepoint sync loads cleanly, exposes progress sync helpers, and canonicalizes rebuilt payload keys', () => {
    global.localStorage = createStorage();
    const sync = loadSharePointSync();

    assert.equal(typeof sync.syncProgress, 'function');
    assert.equal(typeof sync.buildCanonicalProgressKey, 'function');

    const firstPayload = sync.buildProgressPayload({
        studentCode: 'hg-nb5-018',
        classCode: 'nb5',
        level: ' 2 ',
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
        level: '2'
    }), 'NB5|HG-NB5-018|2');
    // Fractional / blank / unsupported levels and blank identity never produce a key.
    assert.equal(sync.buildCanonicalProgressKey({ classCode: 'nb5', studentCode: 'hg-nb5-018', level: '2.9' }), '');
    assert.equal(sync.buildCanonicalProgressKey({ classCode: 'nb5', studentCode: 'hg-nb5-018', level: '' }), '');
    assert.equal(sync.buildCanonicalProgressKey({ classCode: 'nb5', studentCode: 'hg-nb5-018', level: 1 }), '');
    assert.equal(sync.buildCanonicalProgressKey({ classCode: '', studentCode: 'hg-nb5-018', level: 2 }), '');
    assert.equal(sync.buildCanonicalProgressKey({ classCode: 'nb5', studentCode: '', level: 2 }), '');
    assert.equal(firstPayload.progressKey, 'NB5|HG-NB5-018|2');
    assert.equal(rebuiltPayload.progressKey, 'NB5|HG-NB5-018|2');
    assert.equal(rebuiltPayload.saveRequestId, firstPayload.saveRequestId);
    assert.equal(rebuiltPayload.clientTimestampUtc, firstPayload.clientTimestampUtc);
    assert.equal(typeof rebuiltPayload.clientVersion, 'string');
    assert.notEqual(rebuiltPayload.clientVersion, '');
});

test('sharepoint sync keeps telemetry when retrying legacy queue items and quarantines unrepairable ones', async () => {
    global.localStorage = createSessionStorage({
        wa_gr_sync_queue: JSON.stringify([
            {
                // Legacy PascalCase item with a complete identity: mapped, not altered.
                type: 'progress',
                payload: {
                    StudentCode: 'SC-1',
                    ClassCode: '6b',
                    Level: 2,
                    Score: 999,
                    NetWorth: 999,
                    Round: 7,
                    ProgressJson: '{"legacy":true}'
                },
                attempts: 0
            },
            {
                // Legacy item with no ClassCode: must NOT be repaired into "|SC-1|3".
                type: 'progress',
                payload: {
                    StudentCode: 'SC-1',
                    Level: 3,
                    Score: 5
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
    assert.equal(posted[0].classCode, '6B');
    assert.equal(posted[0].level, 2);
    assert.equal(posted[0].currentCash, 0);
    assert.equal(posted[0].currentAssets, 0);
    assert.equal(posted[0].netWorth, 999);
    assert.equal(posted[0].score, 999);
    assert.equal(posted[0].progressKey, '6B|SC-1|2');
    assert.ok(posted[0].saveRequestId);
    assert.ok(posted[0].clientTimestampUtc);
    assert.ok(posted[0].clientVersion);
    assert.equal(posted.some(item => item.progressKey === '|SC-1|3' || item.classCode === ''), false);
    assert.equal(sync.queueLength(), 0);
    const quarantine = sync.getQuarantine();
    assert.equal(quarantine.length, 1);
    assert.match(quarantine[0].reason, /invalid_identity:.*classCode/);
    assert.equal(quarantine[0].payload.level, 3);
});

test('sharepoint sync treats timed-out saves as verification pending and keeps a retry item', async () => {
    global.localStorage = createSessionStorage();
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
    global.localStorage = createSessionStorage();
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

test('Lists ClassCodes hydrate and display only authorized teachers while authenticated admins see all', async () => {
    const rows = [
        { Title: 'One', TeacherEmail: 'one@example.com', TeacherName: 'Teacher One', Role: { Value: 'teacher' }, Active: true, AllowedDashboardAccess: true, ClassCodes: '6b; 6c', DomainValidated: true, LastUpdatedUtc: '2026-10-01T00:00:00Z' },
        { Title: 'Two', TeacherEmail: 'two@example.com', TeacherName: 'Teacher Two', Role: 'teacher', Active: true, AllowedDashboardAccess: true, ClassCodes: ['7A'], DomainValidated: true, LastUpdatedUtc: '2026-10-01T00:00:00Z' },
        { Title: 'Admin', TeacherEmail: 'admin@example.com', TeacherName: 'Admin', Role: { Value: 'admin' }, Active: true, AllowedDashboardAccess: true, ClassCodes: '', DomainValidated: true, LastUpdatedUtc: '2026-10-01T00:00:00Z' }
    ];
    const dashboard = setupTeacherDashboardGlobals({
        endpoints: { loginTeacher: 'https://example.com/login' },
        callFlow: async (name) => ({
            success: true, status: 200,
            data: name === 'loginTeacher'
                ? { ok: true, TeacherName: 'Creator', Role: { Value: 'ADMIN' }, ClassCodes: ['6B'] }
                : { ok: true, Teachers: { value: rows } }
        })
    });
    assert.equal((await dashboard.hydrateDashboardFromFlow()).success, true);
    assert.deepEqual(dashboard.getTeacher('one@example.com').classCodes, ['6B', '6C']);
    assert.equal(dashboard.getTeacher('one@example.com').classCode, '6B, 6C');
    assert.deepEqual(dashboard.normalizeDashboardTeacher({ ClassCodes: [{ Value: '6b' }, { Value: '6c' }] }).classCodes, ['6B', '6C']);
    assert.deepEqual(dashboard.normalizeDashboardTeacher({ ClassCodes: { Value: '6b,6c' } }).classCodes, ['6B', '6C']);
    const html = fs.readFileSync(require.resolve('../teacher/dashboard.html'), 'utf8');
    const displayFunction = html.slice(html.indexOf('function getAuthorizedTeachers()'), html.indexOf('function withAuthorizedStudents('));
    const context = { dashboard };
    vm.runInNewContext(`${displayFunction}\nthis.visibleTeachers = getAuthorizedTeachers;`, context);
    assert.deepEqual(context.visibleTeachers().map(row => row.email), ['one@example.com']);
    assert.equal(dashboard.canTeacherAccessClass('6B'), true);
    assert.equal(dashboard.canTeacherAccessClass('7A'), false);
    assert.equal(dashboard.canTeacherAccessClass(''), false);
    const login = await dashboard.authenticateTeacher({ teacherEmail: 'admin@example.com', classCode: '6B' });
    assert.equal(login.success, true);
    assert.equal(dashboard.getTeacherSession().role, 'admin');
    await dashboard.hydrateDashboardFromFlow();
    assert.equal(dashboard.getTeacherSession().role, 'admin');
    assert.equal(dashboard.canTeacherAccessClass('7A'), true);
    assert.equal(context.visibleTeachers().length, 3);
    dashboard.clearTeacherSession();
    assert.equal(dashboard.canTeacherAccessClass('6B'), false);
    assert.equal(context.visibleTeachers().length, 0);
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
        read('../shared/student-session.js'),
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
        'this.resolveCurrentLevelAccess = resolveCurrentLevelAccess;',
        'this.applyCompetitionSessionToIdentity = applyCompetitionSessionToIdentity;',
        'this.playRound = playRound;',
        'this.showProgressionQuiz = showProgressionQuiz;',
        'this.saveCompanyName = saveCompanyName;'
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
    context.applyCompetitionSessionToIdentity(false);
    return { context, gameState, getElement, storage };
}

test('student checkpoint progression: goal opens quiz, pass persists quiz_passed, continue opens next level', async () => {
    const storage = createSessionStorage();
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
    const snapshotApi = require('../shared/progression-snapshot.js');
    // A legacy / self-created session (no GGR_LoginStudent source) never unlocks.
    const legacyStorage = createStorage({
        wa_gold_rush_student_session: JSON.stringify({ studentCode: 'sc-1', classCode: '6b' })
    });
    const legacyResult = await LevelAccessGuard.hydrateRemoteProgression(2, {
        storage: legacyStorage,
        globalObj: {
            WA_GOLD_RUSH_PROGRESS_SNAPSHOT: snapshotApi,
            WA_GOLD_RUSH_POWER_AUTOMATE: {
                resolveFlowEndpoint: () => 'https://example.com/get-progress',
                isPlaceholderEndpoint: () => false,
                callFlow: async () => { throw new Error('must not call the flow without a roster session'); }
            }
        }
    });
    assert.equal(legacyResult.unlocked, false);
    assert.equal(legacyResult.reason, 'missing_student_session');

    const storage = createSessionStorage({}, { studentCode: 'sc-1', classCode: '6b' });

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

// ---------------------------------------------------------------------------
// Roster-backed student identity (GGR_LoginStudent is the sole identity source)
// ---------------------------------------------------------------------------

function buildHomeLoginHarness({ storage = createStorage(), loginImpl, search = '' } = {}) {
    const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
    const elements = {};
    const element = (id, extra = {}) => {
        elements[id] = {
            id,
            value: '',
            textContent: '',
            innerHTML: '',
            hidden: false,
            disabled: false,
            style: {},
            appendChild() {},
            focus() {},
            ...extra
        };
        return elements[id];
    };
    [
        'studentClassCodeInput', 'studentIdInput', 'studentPinInput', 'studentLoginBtn', 'studentLoginStatus',
        'studentLoginForm', 'studentActiveSession', 'studentSessionSummary', 'studentContinueBtn', 'studentLoginHint',
        'studentIdentityCode', 'studentIdentityLeaderboardName', 'studentIdentityName', 'studentIdentityClassCode',
        'studentIdentityAssignedLevel', 'main-content'
    ].forEach((id) => element(id));
    const loginCalls = [];
    const window = {
        location: {
            href: `https://example.com/index.html${search}`,
            search,
            pathname: '/index.html',
            origin: 'https://example.com'
        },
        history: { replaceState() {} },
        WA_GOLD_RUSH_STUDENT_SESSION: loadStudentSession(),
        WA_GOLD_RUSH_STUDENT_AUTH: {
            async loginStudent(payload) {
                loginCalls.push(payload);
                return loginImpl(payload);
            }
        }
    };
    const context = {
        console,
        document: {
            baseURI: 'https://example.com/index.html',
            addEventListener() {},
            getElementById: (id) => elements[id] || null,
            createElement: () => ({ appendChild() {}, set innerHTML(_) {} })
        },
        localStorage: storage,
        sessionStorage: createStorage(),
        URL,
        URLSearchParams,
        alert() {},
        window
    };
    vm.runInNewContext(
        [
            getHomePageInlineScript(html),
            'this.handleStudentLogin = handleStudentLogin;',
            'this.getStudentSession = getStudentSession;',
            'this.toggleStudentAuthUI = toggleStudentAuthUI;',
            'this.isLevelAccessible = isLevelAccessible;',
            'this.LEVELS = LEVELS;'
        ].join('\n'),
        context
    );
    return { context, elements, storage, loginCalls, window };
}

function rosterLoginResponse(overrides = {}) {
    return {
        success: true,
        status: 200,
        response: {
            ok: true,
            studentCode: 'HG-NB5-018',
            studentId: '123456',
            studentName: 'Alex Smith',
            leaderboardName: 'Golddigger',
            classCode: 'NB5',
            assignedLevel: 2,
            ...overrides
        },
        error: ''
    };
}

test('student session contract rejects incomplete, malformed, and self-created identities', () => {
    const api = loadStudentSession();
    const complete = { ok: true, studentCode: 'HG-NB5-018', studentId: '123456', studentName: 'Alex', leaderboardName: 'Golddigger', classCode: 'nb5', assignedLevel: '3' };
    const created = api.createSessionFromLogin(complete);
    assert.equal(created.ok, true);
    assert.equal(created.session.source, 'GGR_LoginStudent');
    assert.equal(created.session.classCode, 'NB5');
    assert.equal(created.session.assignedLevel, 3);

    assert.equal(api.createSessionFromLogin({ ...complete, ok: false }).ok, false);
    for (const field of api.IDENTITY_FIELDS) {
        const result = api.createSessionFromLogin({ ...complete, [field]: '' });
        assert.equal(result.ok, false, `blank ${field} must be rejected`);
        assert.ok(result.errors.includes(field));
    }
    assert.equal(api.createSessionFromLogin({ ...complete, studentCode: 'Alex Smith' }).ok, false);
    assert.equal(api.createSessionFromLogin({ ...complete, studentCode: 'HG|NB5' }).ok, false);
    assert.equal(api.createSessionFromLogin({ ...complete, classCode: '6B|X' }).ok, false);
    for (const level of [0, 6, 2.5, 'abc', null]) {
        assert.equal(api.createSessionFromLogin({ ...complete, assignedLevel: level }).ok, false, `level ${level}`);
    }

    // Legacy home-page session shape (self-created, no flow source) is rejected.
    assert.equal(api.parseSession({ ok: true, studentCode: 'HG-NB5-018', leaderboardName: 'x', classCode: 'NB5', authenticatedAt: '2026-01-01T00:00:00Z' }), null);
    assert.equal(api.parseSession(JSON.stringify({ ...created.session, studentId: '' })), null);

    // PINs / hashes are never persisted.
    const storage = createStorage();
    assert.equal(api.writeSession(storage, { ...created.session, pin: '1234', pinHash: 'abc' }), true);
    const stored = JSON.parse(storage.getItem(STUDENT_SESSION_KEY));
    assert.equal('pin' in stored, false);
    assert.equal('pinHash' in stored, false);
    assert.equal(api.readSession(storage).studentCode, 'HG-NB5-018');
});

test('student auth login fails when the roster response is incomplete, malformed, or mismatched', async () => {
    const respond = (data) => {
        global.WA_GOLD_RUSH_POWER_AUTOMATE = {
            callFlow: async () => ({ success: true, status: 200, data })
        };
        return loadStudentAuth();
    };
    const complete = { ok: true, studentCode: 'SC-1', studentId: '123456', studentName: 'Alex', leaderboardName: 'Gold', classCode: '6B', assignedLevel: 2 };

    let result = await respond({ ...complete, leaderboardName: '' }).loginStudent({ classCode: '6b', studentId: '123456', pin: '1234' });
    assert.equal(result.success, false);
    assert.match(result.error, /incomplete.*leaderboardName/);

    result = await respond({ ...complete, studentCode: 'not a code' }).loginStudent({ classCode: '6b', studentId: '123456', pin: '1234' });
    assert.equal(result.success, false);

    result = await respond({ ...complete, assignedLevel: undefined }).loginStudent({ classCode: '6b', studentId: '123456', pin: '1234' });
    assert.equal(result.success, false);

    result = await respond({ ...complete, studentId: '999999' }).loginStudent({ classCode: '6b', studentId: '123456', pin: '1234' });
    assert.equal(result.success, false);
    assert.match(result.error, /does not match/);

    result = await respond({ ok: false, message: 'Invalid PIN' }).loginStudent({ classCode: '6b', studentId: '123456', pin: '1234' });
    assert.equal(result.success, false);
    assert.equal(result.error, 'Invalid PIN');

    await assert.rejects(() => respond(complete).loginStudent({ classCode: '6b', studentId: '', pin: '1234' }), /required/);
});

test('fresh-browser home login calls loginStudent and creates a roster session only on success', async () => {
    const harness = buildHomeLoginHarness({ loginImpl: async () => rosterLoginResponse() });
    assert.equal(harness.context.getStudentSession(), null);
    assert.equal(harness.context.LEVELS.some(level => harness.context.isLevelAccessible(level)), false);

    harness.elements.studentClassCodeInput.value = 'nb5';
    harness.elements.studentIdInput.value = '123456';
    harness.elements.studentPinInput.value = '9876';
    await harness.context.handleStudentLogin({ preventDefault() {} });

    assert.equal(JSON.stringify(harness.loginCalls), JSON.stringify([{ classCode: 'NB5', studentId: '123456', pin: '9876' }]));
    const raw = harness.storage.getItem(STUDENT_SESSION_KEY);
    const stored = JSON.parse(raw);
    assert.equal(stored.source, 'GGR_LoginStudent');
    assert.equal(stored.studentCode, 'HG-NB5-018');
    assert.equal(stored.leaderboardName, 'Golddigger');
    assert.equal(stored.assignedLevel, 2);
    assert.doesNotMatch(raw, /9876|"pin/i);
    assert.equal(harness.elements.studentPinInput.value, '');
    // Identity is shown read-only (text, not inputs) after login.
    assert.equal(harness.elements.studentLoginForm.hidden, true);
    assert.equal(harness.elements.studentIdentityCode.textContent, 'HG-NB5-018');
    assert.equal(harness.elements.studentIdentityClassCode.textContent, 'NB5');
    assert.equal(harness.context.isLevelAccessible(harness.context.LEVELS[0]), true);
});

test('home login does not create a session when the flow fails or returns an incomplete roster record', async () => {
    const failed = buildHomeLoginHarness({ loginImpl: async () => ({ success: false, error: 'Invalid PIN', response: { ok: false } }) });
    failed.elements.studentClassCodeInput.value = 'NB5';
    failed.elements.studentIdInput.value = '123456';
    failed.elements.studentPinInput.value = '9999';
    await failed.context.handleStudentLogin({ preventDefault() {} });
    assert.equal(failed.storage.getItem(STUDENT_SESSION_KEY), null);
    assert.equal(failed.elements.studentLoginStatus.textContent, 'Invalid PIN');
    assert.equal(failed.elements.studentPinInput.value, '');

    // Even if a client reports success, an incomplete roster identity is rejected.
    const incomplete = buildHomeLoginHarness({ loginImpl: async () => rosterLoginResponse({ classCode: '' }) });
    incomplete.elements.studentClassCodeInput.value = 'NB5';
    incomplete.elements.studentIdInput.value = '123456';
    incomplete.elements.studentPinInput.value = '1234';
    await incomplete.context.handleStudentLogin({ preventDefault() {} });
    assert.equal(incomplete.storage.getItem(STUDENT_SESSION_KEY), null);
    assert.match(incomplete.elements.studentLoginStatus.textContent, /incomplete.*classCode/);

    const missingFields = buildHomeLoginHarness({ loginImpl: async () => rosterLoginResponse() });
    await missingFields.context.handleStudentLogin({ preventDefault() {} });
    assert.equal(missingFields.loginCalls.length, 0);
    assert.equal(missingFields.storage.getItem(STUDENT_SESSION_KEY), null);
});

test('home page rejects legacy self-created sessions and has no local session creation bypass', () => {
    const legacy = buildHomeLoginHarness({
        storage: createStorage({
            [STUDENT_SESSION_KEY]: JSON.stringify({ ok: true, studentCode: 'HG-NB5-018', leaderboardName: 'x', authenticatedAt: '2026-01-01T00:00:00Z' })
        }),
        loginImpl: async () => rosterLoginResponse()
    });
    assert.equal(legacy.context.getStudentSession(), null);
    legacy.context.toggleStudentAuthUI();
    assert.equal(legacy.storage.getItem(STUDENT_SESSION_KEY), null);
    assert.match(legacy.elements.studentLoginStatus.textContent, /sign in again/);

    const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
    assert.doesNotMatch(html, /buildStudentSessionFromForm|enableFlowStudentLogin|FLOW_STUDENT_LOGIN_FEATURE_FLAG/);
    assert.doesNotMatch(html, /setStorageValue\(localStorage,\s*STUDENT_SESSION_KEY/);
    assert.doesNotMatch(html, /id="studentCodeInput"|id="leaderboardNameInput"|id="studentNameInput"/);
    assert.match(html, /WA_GOLD_RUSH_STUDENT_AUTH[\s\S]*loginStudent\(\{ classCode, studentId, pin \}\)/);
    assert.match(html, /createSessionFromLogin\(result\.response\)/);
    assert.ok(html.indexOf('shared/student-session.js') < html.indexOf('shared/student-auth-client.js'));
});

test('gameplay, quiz, and saves are blocked without an authenticated roster session', () => {
    const storage = createStorage({
        // Legacy self-created session: must not count as authenticated.
        [STUDENT_SESSION_KEY]: JSON.stringify({ ok: true, studentCode: 'SC-1', leaderboardName: 'Me', classCode: '6B' })
    });
    const { context, gameState, getElement } = buildStudentGameHarness({ level: 2, storage });
    assert.equal(gameState.player.studentCode, '');

    const roundBefore = gameState.round;
    gameState.investmentPlans = { southern_cross: { safe: 10, medium: 0, deep: 0 } };
    context.playRound();
    assert.equal(gameState.round, roundBefore);
    assert.match(context.location.href, /index\.html\?studentLogin=1&returnTo=/);

    context.location.href = 'https://example.com/levels/level-2-tycoon/index.html?level=2';
    gameState.cash = 999999;
    context.checkProgressionGoal();
    context.showProgressionQuiz();
    assert.equal(getElement('checkpointQuizModal').classList.contains('active'), false);
    assert.notEqual(gameState.checkpointStatus, 'quiz_available');

    context.displayQuizResults({ passed: true, score: 5, totalQuestions: 5, results: [] }, {});
    assert.equal(storage.getItem('level2_autosave'), null);
    assert.equal(context.__syncCalls, undefined);

    global.localStorage = storage;
    assert.equal(new context.LevelAccessGuardClass(2).isLevelAccessible(), false);

    const levelOne = fs.readFileSync(require.resolve('../levels/level-1-basic/index.html'), 'utf8');
    assert.ok(levelOne.includes('<script src="../../shared/student-session.js"></script>'));
    const levelOneScript = fs.readFileSync(require.resolve('../levels/level-1-basic/script.js'), 'utf8');
    assert.match(levelOneScript, /requireSessionOrRedirect/);
    const levelTwo = fs.readFileSync(require.resolve('../levels/level-2-tycoon/index.html'), 'utf8');
    assert.ok(levelTwo.indexOf('shared/student-session.js') < levelTwo.indexOf('script.js"'));
});

test('student cannot edit authoritative identity in-game; identity comes only from the session', () => {
    const storage = createSessionStorage({
        // Stale teacher cache must not override roster identity.
        teacher_dashboard: JSON.stringify({ students: [{ studentCode: 'SC-1', leaderboardName: 'Hacked', classCode: 'ZZ' }] })
    });
    const { context, gameState, getElement } = buildStudentGameHarness({ level: 2, storage });
    assert.equal(gameState.player.studentCode, 'SC-1');
    assert.equal(gameState.player.leaderboardName, 'Gold Miner');
    assert.equal(gameState.player.classCode, '6B');

    getElement('studentCodeInput').value = 'SOMEONE-ELSE';
    getElement('leaderboardNameInput').value = 'Hacker';
    getElement('companyNameInput').value = 'Perth Prospectors';
    vm.runInContext('updateAllUI = function () {};', context);
    context.saveCompanyName(false);
    assert.equal(gameState.player.studentCode, 'SC-1');
    assert.equal(gameState.player.leaderboardName, 'Gold Miner');
    assert.equal(gameState.player.companyName, 'Perth Prospectors');
    assert.equal(JSON.parse(storage.getItem('level2_autosave')).gameState.player.studentCode, 'SC-1');

    const levelHtml = fs.readFileSync(require.resolve('../levels/level-2-tycoon/index.html'), 'utf8');
    for (const id of ['studentCodeInput', 'leaderboardNameInput', 'studentIdInput', 'studentNameInput']) {
        assert.match(levelHtml, new RegExp(`id="${id}"[^>]*readonly`), `${id} must be read-only`);
    }
    assert.doesNotMatch(levelHtml, /id="companyNameInput"[^>]*readonly/);
    const script = fs.readFileSync(require.resolve('../levels/level-2-tycoon/script.js'), 'utf8');
    assert.doesNotMatch(script, /gameState\.player\.studentCode\s*=\s*studentCodeEl/);
    assert.doesNotMatch(script, /getMatchedStudentFromSession/);
});

test('level unlock ignores another student\'s autosave on a shared device', () => {
    const { LevelAccessGuard } = require('../levels/level-2-tycoon/level-access-guard.js');
    const autosave = JSON.stringify({
        gameState: {
            player: { studentCode: 'SC-OTHER' },
            progressionStateByLevel: { 2: { checkpointStatus: 'quiz_passed' } }
        }
    });
    assert.equal(LevelAccessGuard.isCheckpointPassed(2, createSessionStorage({ level2_autosave: autosave })), false);
    assert.equal(LevelAccessGuard.isCheckpointPassed(2, createSessionStorage({ level2_autosave: autosave }, { studentCode: 'sc-other' })), true);
    assert.equal(LevelAccessGuard.isCheckpointPassed(2, createStorage({ level2_autosave: autosave })), false);
});

function setupSaveProgressFlow(responses = []) {
    global.WA_GOLD_RUSH_FLOW_ENDPOINTS = { saveProgress: 'https://example.com/save' };
    const posted = [];
    global.WA_GOLD_RUSH_POWER_AUTOMATE = {
        callFlow: async (_flowName, payload) => {
            posted.push(payload);
            return responses.length ? responses.shift() : { success: true, status: 200, data: { ok: true } };
        },
        resolveFlowEndpoint: (key) => global.WA_GOLD_RUSH_FLOW_ENDPOINTS[key] || ''
    };
    return posted;
}

test('SaveProgress rejects blank ClassCode, blank Level, missing StudentCode, and non-session identity', async () => {
    global.localStorage = createSessionStorage();
    const posted = setupSaveProgressFlow();
    const sync = loadSharePointSync();
    const base = { studentCode: 'SC-1', classCode: '6B', level: 2, currentRound: 2 };

    for (const [override, field] of [
        [{ classCode: '' }, 'classCode'],
        [{ level: '' }, 'level'],
        [{ level: undefined }, 'level'],
        [{ level: 1 }, 'level'],
        [{ studentCode: '' }, 'studentCode'],
        [{ studentCode: 'bad code' }, 'studentCode']
    ]) {
        const payload = sync.buildProgressPayload({ ...base, ...override });
        assert.equal(payload.progressKey, '', `${field} must not produce a ProgressKey`);
        assert.ok(sync.validateProgressPayload(payload).errors.includes(field));
        const result = await sync.syncProgress({ ...base, ...override });
        assert.equal(result.ok, false);
        assert.equal(result.rejected, true);
        assert.equal(result.queued, false);
        assert.ok(result.errors.includes(field));
    }
    assert.equal(sync.buildProgressPayload({ ...base, level: undefined }).level, null);

    const mismatch = await sync.syncProgress({ ...base, studentCode: 'SC-2' });
    assert.equal(mismatch.reason, 'identity_mismatch');

    global.localStorage = createStorage();
    const anonymous = await sync.syncProgress(base);
    assert.equal(anonymous.reason, 'not_authenticated');

    assert.equal(posted.length, 0);
    assert.equal(sync.queueLength(), 0);
});

test('SaveProgress treats ok:false as a permanent failure, retries network errors, and keeps canonical ProgressKey', async () => {
    global.localStorage = createSessionStorage();
    const posted = setupSaveProgressFlow([
        { success: true, status: 200, data: { ok: false, message: 'Duplicate conflict requires manual resolution' } },
        { success: false, status: 503, error: 'Service unavailable' }
    ]);
    const sync = loadSharePointSync();

    const rejected = await sync.syncProgress({ studentCode: 'sc-1', classCode: '6b', level: 2 });
    assert.equal(rejected.ok, false);
    assert.equal(rejected.rejected, true);
    assert.equal(rejected.queued, false);
    assert.equal(rejected.progressKey, '6B|SC-1|2');
    assert.equal(sync.queueLength(), 0);
    assert.equal(sync.quarantineLength(), 1);
    assert.match(sync.getQuarantine()[0].reason, /Duplicate conflict/);
    assert.equal(sync.getCloudSaveStatus(), 'cloud save rejected');

    const retryable = await sync.syncProgress({ studentCode: 'SC-1', classCode: '6B', level: 3 });
    assert.equal(retryable.queued, true);
    assert.equal(sync.queueLength(), 1);
    assert.deepEqual(posted.map(p => p.progressKey), ['6B|SC-1|2', '6B|SC-1|3']);

    // Retries are held (not sent) while a different student is signed in.
    global.localStorage.setItem(STUDENT_SESSION_KEY, JSON.stringify(buildRosterSession({ studentCode: 'SC-2' })));
    await sync.retryQueue();
    assert.equal(posted.length, 2);
    assert.equal(sync.queueLength(), 1);

    global.localStorage.setItem(STUDENT_SESSION_KEY, JSON.stringify(buildRosterSession()));
    await sync.retryQueue();
    assert.equal(posted.length, 3);
    assert.equal(posted[2].saveRequestId, retryable.saveRequestId);
    assert.equal(posted[2].progressKey, '6B|SC-1|3');
    assert.equal(sync.queueLength(), 0);
});

test('Level 2-5 save payload uses session identity, current gameplay level, and separate roster assigned level', async () => {
    const storage = createSessionStorage({}, { assignedLevel: 4 });
    global.localStorage = storage;
    const sync = loadSharePointSync();
    const scheduled = [];
    const { context, gameState } = buildStudentGameHarness({
        level: 3,
        storage,
        extraGlobals: { SharePointSync: sync }
    });
    // Replace the stubbed syncPlayerRecord with the real one for this test.
    const script = fs.readFileSync(require.resolve('../levels/level-2-tycoon/script.js'), 'utf8');
    const realSync = script.slice(script.indexOf('function syncPlayerRecord() {'), script.indexOf('function syncTeacherDashboardRecord(record) {'));
    vm.runInContext(`${realSync}\nthis.realSyncPlayerRecord = syncPlayerRecord;\ngetProgressSaveScheduler = () => ({ schedule: (p) => { this.__scheduled.push(p); } });`, Object.assign(context, { __scheduled: scheduled }));
    gameState.player.companyName = 'Co';
    context.realSyncPlayerRecord();
    assert.equal(scheduled.length, 1);
    assert.equal(scheduled[0].studentCode, 'SC-1');
    assert.equal(scheduled[0].classCode, '6B');
    assert.equal(scheduled[0].level, 3);
    assert.equal(scheduled[0].rosterAssignedLevel, 4);
    assert.equal(scheduled[0].progressKey, '6B|SC-1|3');
    const markers = JSON.parse(scheduled[0].progressionMarkersJson);
    assert.equal(markers.currentLevel, 3);
    assert.equal(markers.rosterAssignedLevel, 4);
    assert.equal(markers.player.leaderboardName, 'Gold Miner');
});
