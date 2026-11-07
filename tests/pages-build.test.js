const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/build-and-deploy.yml'), 'utf8');
const buildBlocks = [...workflow.matchAll(/          python - <<'PY'\n([\s\S]*?)\n          PY/g)]
    .map((match) => match[1].replace(/^          /gm, ''));
const featureVariables = {
    saveProtocolV2: 'WA_GGR_SAVE_PROTOCOL_V2',
    fullCloudRestore: 'WA_GGR_FULL_CLOUD_RESTORE',
    serverLeaderboard: 'WA_GGR_SERVER_LEADERBOARD',
    levelResetFlow: 'WA_GGR_LEVEL_RESET_FLOW',
    competitionBaselines: 'WA_GGR_COMPETITION_BASELINES',
    competitionLeaderboardMetric: 'WA_GGR_COMPETITION_LEADERBOARD_METRIC',
    competitionSnapshots: 'WA_GGR_COMPETITION_SNAPSHOTS',
    level6Analytics: 'WA_GGR_LEVEL6_ANALYTICS',
    holdUnverifiedNewSlotUploads: 'WA_GGR_HOLD_UNVERIFIED_NEW_SLOT_UPLOADS'
};
const endpointVariables = {
    saveCheckpointApproval: 'WA_GGR_SAVE_CHECKPOINT_APPROVAL_URL',
    getStudentProgress: 'WA_GGR_GET_STUDENT_PROGRESS_URL',
    resetLevelProgress: 'WA_GGR_RESET_LEVEL_PROGRESS_URL',
    saveProgress: 'WA_GGR_SAVE_PROGRESS_URL'
};

test('Pages runtime inputs are explicitly allowlisted and main-only', () => {
    const capabilities = require('../shared/level-capabilities.js');
    assert.deepEqual(Object.keys(featureVariables).sort(), Object.keys(capabilities.DEFAULT_FLAGS).sort());
    for (const [kind, variables] of [
        ['secrets', ['WA_GGR_API_KEY', ...Object.values(endpointVariables)]],
        ['vars', Object.values(featureVariables)]
    ]) {
        for (const variable of variables) {
            assert.ok(workflow.includes(
                `${variable}: \${{ github.event_name != 'pull_request' && github.ref == 'refs/heads/main' && ${kind}.${variable} || '' }}`
            ), `Missing main-only guard for ${variable}`);
        }
    }
    assert.doesNotMatch(workflow, /pull_request_target|toJSON\(vars\)|toJSON\(secrets\)/);
});

test('Pages runtime overrides default off, parse strictly, and cannot escape PR validation', () => {
    const temporary = fs.mkdtempSync(path.join(__dirname, '.pages-config-test-'));
    const source = path.join(temporary, 'source');
    const buildDir = path.join(temporary, 'output');
    const env = {
        ...process.env,
        WA_GGR_API_KEY: 'test-only-not-a-key',
        WA_GGR_RUNTIME_CONFIG_VERSION: 'config-test-1',
        WA_GGR_PAGES_BUILD_DIR: buildDir,
        WA_GGR_VALIDATION_ONLY: 'false',
        RUNNER_TEMP: temporary
    };
    for (const variable of [...Object.values(featureVariables), ...Object.values(endpointVariables)]) {
        env[variable] = '';
    }
    const build = (existing = {}) => {
        const result = spawnSync('python', ['-c', buildBlocks[0]], {
            cwd: source, env, encoding: 'utf8'
        });
        assert.equal(result.status, 0, result.stderr || result.stdout);
        assert.equal(result.stdout, '', 'Build must not log credentials or endpoint inputs');
        const script = fs.readFileSync(path.join(buildDir, 'teacher/runtime-config.js'), 'utf8');
        const context = { WA_GOLD_RUSH_RUNTIME_CONFIG: existing };
        context.window = context;
        vm.createContext(context);
        vm.runInContext(script, context);
        for (const file of ['flow-endpoints.js', 'level-capabilities.js']) {
            vm.runInContext(fs.readFileSync(path.join(buildDir, 'shared', file), 'utf8'), context);
        }
        const config = JSON.parse(JSON.stringify(context.WA_GOLD_RUSH_RUNTIME_CONFIG));
        const capabilities = context.WA_GOLD_RUSH_LEVEL_CAPABILITIES;
        assert.deepEqual(JSON.parse(JSON.stringify(capabilities.getFeatureFlags())), config.featureFlags);
        assert.equal(capabilities.isFeatureEnabled('arbitraryFlag'), false);
        for (const [name, endpoint] of Object.entries(config.flowEndpoints)) {
            if (endpoint) assert.equal(context.WA_GOLD_RUSH_FLOW_ENDPOINTS[name], endpoint);
        }
        assert.equal(capabilities.isFlowCallable('getStudentProgress'),
            Boolean(config.flowEndpoints.getStudentProgress));
        assert.equal(capabilities.isFlowCallable('resetLevelProgress'),
            config.featureFlags.levelResetFlow && Boolean(config.flowEndpoints.resetLevelProgress));
        return config;
    };
    const offFlags = Object.fromEntries(Object.keys(featureVariables).map((name) => [name, false]));
    try {
        fs.mkdirSync(path.join(source, 'teacher'), { recursive: true });
        fs.mkdirSync(path.join(source, 'shared'), { recursive: true });
        for (const file of ['flow-endpoints.js', 'level-capabilities.js']) {
            fs.copyFileSync(path.join(root, 'shared', file), path.join(source, 'shared', file));
        }
        fs.writeFileSync(path.join(source, 'index.html'),
            '<script src="teacher/runtime-config.js?v=__WA_GGR_RUNTIME_CONFIG_VERSION__"></script>');
        let config = build({ featureFlags: { saveProtocolV2: true, arbitraryFlag: true } });
        assert.deepEqual(config.featureFlags, offFlags);
        assert.deepEqual(config.flowEndpoints, { saveCheckpointApproval: '' });

        for (const value of ['TRUE', ' true ', '1', 'yes', '{"saveProtocolV2":true}']) {
            for (const variable of Object.values(featureVariables)) env[variable] = value;
            assert.deepEqual(build().featureFlags, offFlags, `Unsafe flag coercion for ${value}`);
        }
        for (const [name, variable] of Object.entries(featureVariables)) {
            for (const other of Object.values(featureVariables)) env[other] = '';
            env[variable] = 'true';
            assert.deepEqual(build().featureFlags, { ...offFlags, [name]: true });
        }
        for (const [name, variable] of Object.entries(endpointVariables)) {
            env[variable] = ` https://example.invalid/${name}?sig=test-only-"quoted" `;
        }
        for (const variable of Object.values(featureVariables)) env[variable] = 'true';
        env.WA_GGR_UNKNOWN_FEATURE = 'true';
        config = build();
        assert.deepEqual(config.featureFlags,
            Object.fromEntries(Object.keys(featureVariables).map((name) => [name, true])));
        for (const [name, variable] of Object.entries(endpointVariables)) {
            assert.equal(config.flowEndpoints[name], env[variable].trim());
        }
        assert.equal(config.apiKey, env.WA_GGR_API_KEY);
        assert.equal(config.version, env.WA_GGR_RUNTIME_CONFIG_VERSION);
        assert.equal(config.buildTarget, 'github-pages');

        for (const mode of ['true', '', 'unexpected']) {
            env.WA_GGR_VALIDATION_ONLY = mode;
            config = build();
            assert.equal(config.apiKey, 'validation-only-not-a-key');
            assert.deepEqual(config.featureFlags, offFlags);
            assert.deepEqual(config.flowEndpoints, { saveCheckpointApproval: '' });
            const script = fs.readFileSync(path.join(buildDir, 'teacher/runtime-config.js'), 'utf8');
            for (const variable of ['WA_GGR_API_KEY', ...Object.values(endpointVariables)]) {
                assert.ok(!script.includes(env[variable].trim()), `Validation leaked ${variable}`);
            }
            const result = spawnSync('python', ['-c', buildBlocks[1]], {
                cwd: source, env, encoding: 'utf8'
            });
            assert.equal(result.status, 0, result.stderr || result.stdout);
        }
    } finally {
        fs.rmSync(temporary, { recursive: true, force: true });
    }
});

for (const output of ['pages-dist', 'custom-output', '../external-output']) {
    test(`Pages build isolates ${output} and validates exact runtime versions`, () => {
        assert.equal(buildBlocks.length, 2);
        const temporary = fs.mkdtempSync(path.join(__dirname, '.pages-build-test-'));
        const source = path.join(temporary, 'source');
        const buildDir = path.resolve(source, output);
        const htmlFiles = ['index.html', 'teacher/dashboard.html', 'levels/level-2-tycoon/index.html'];
        const env = {
            ...process.env,
            WA_GGR_API_KEY: 'test-only-not-a-key',
            WA_GGR_SAVE_CHECKPOINT_APPROVAL_URL: '',
            WA_GGR_GET_STUDENT_PROGRESS_URL: '',
            WA_GGR_RESET_LEVEL_PROGRESS_URL: '',
            WA_GGR_SAVE_PROGRESS_URL: '',
            WA_GGR_VALIDATION_ONLY: 'false',
            WA_GGR_RUNTIME_CONFIG_VERSION: '12345-2',
            WA_GGR_PAGES_BUILD_DIR: output,
            RUNNER_TEMP: temporary
        };
        for (const variable of Object.values(featureVariables)) env[variable] = '';
        const run = (block) => spawnSync('python', ['-c', block], {
            cwd: source, env, encoding: 'utf8'
        });
        const assertSuccess = (result) => assert.equal(result.status, 0, result.stderr || result.stdout);
        try {
            for (const file of [...htmlFiles, 'teacher/runtime-config.js']) {
                const destination = path.join(source, file);
                fs.mkdirSync(path.dirname(destination), { recursive: true });
                fs.copyFileSync(path.join(root, file), destination);
            }
            const staleOutput = path.join(source, 'pages-dist');
            fs.mkdirSync(staleOutput, { recursive: true });
            fs.writeFileSync(path.join(staleOutput, 'index.html'),
                '<script src="teacher/runtime-config.js?v=previous-build"></script>');
            fs.writeFileSync(path.join(staleOutput, 'stale-output.txt'), 'not source');
            fs.mkdirSync(buildDir, { recursive: true });
            fs.writeFileSync(path.join(buildDir, 'old-output.txt'), 'not source');

            for (const version of ['12345-2', '12345-3']) {
                env.WA_GGR_RUNTIME_CONFIG_VERSION = version;
                assertSuccess(run(buildBlocks[0]));
                assertSuccess(run(buildBlocks[1]));
                assert.ok(fs.existsSync(path.join(temporary, 'pages-artifact-verify.tar')));
                assert.ok(!fs.existsSync(path.join(buildDir, 'pages-dist')));
                assert.ok(!fs.existsSync(path.join(buildDir, 'custom-output')));
                assert.ok(!fs.existsSync(path.join(buildDir, 'old-output.txt')));
                assert.ok(!fs.existsSync(path.join(buildDir, 'stale-output.txt')));

                const context = { window: {} };
                vm.runInNewContext(fs.readFileSync(path.join(buildDir, 'teacher/runtime-config.js'), 'utf8'), context);
                const runtimeVersion = context.window.WA_GOLD_RUSH_RUNTIME_CONFIG.version;
                assert.equal(runtimeVersion, env.WA_GGR_RUNTIME_CONFIG_VERSION);
                for (const file of htmlFiles) {
                    const html = fs.readFileSync(path.join(buildDir, file), 'utf8');
                    assert.doesNotMatch(html, /__WA_GGR_RUNTIME_CONFIG_VERSION__/);
                    const references = [...html.matchAll(/runtime-config\.js\?v=([^"'<>\s]+)/g)];
                    assert.ok(references.length > 0, `Missing runtime config reference in ${file}`);
                    for (const reference of references) assert.equal(reference[1], runtimeVersion);
                }
            }

            const indexPath = path.join(buildDir, 'index.html');
            fs.writeFileSync(indexPath, fs.readFileSync(indexPath, 'utf8')
                .replaceAll(env.WA_GGR_RUNTIME_CONFIG_VERSION, 'previous-build'));
            const rejected = run(buildBlocks[1]);
            assert.notEqual(rejected.status, 0);
            assert.match(rejected.stderr, /Built HTML contains an unexpected runtime config version/);
        } finally {
            fs.rmSync(temporary, { recursive: true, force: true });
        }
    });
}
