const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/build-and-deploy.yml'), 'utf8');
const buildBlocks = [...workflow.matchAll(/          python - <<'PY'\n([\s\S]*?)\n          PY/g)]
    .map((match) => match[1].replace(/^          /gm, ''));

for (const output of ['pages-dist', 'custom-output', '../external-output']) {
    test(`Pages build isolates ${output} and validates exact runtime versions`, () => {
        assert.equal(buildBlocks.length, 2);
        const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-gr-pages-build-'));
        const source = path.join(temporary, 'source');
        const buildDir = path.resolve(source, output);
        const htmlFiles = ['index.html', 'teacher/dashboard.html', 'levels/level-2-tycoon/index.html'];
        const env = {
            ...process.env,
            WA_GGR_API_KEY: 'test-only-not-a-key',
            WA_GGR_SAVE_CHECKPOINT_APPROVAL_URL: '',
            WA_GGR_VALIDATION_ONLY: 'false',
            WA_GGR_RUNTIME_CONFIG_VERSION: '12345-2',
            WA_GGR_PAGES_BUILD_DIR: output,
            RUNNER_TEMP: temporary
        };
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
