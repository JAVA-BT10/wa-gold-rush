const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/build-and-deploy.yml'), 'utf8');
const buildBlocks = [...workflow.matchAll(/          python - <<'PY'\n([\s\S]*?)\n          PY/g)]
    .map((match) => match[1].replace(/^          /gm, ''));

test('PR builds and exact-revision deployments cannot bypass regression tests', () => {
    assert.match(workflow, /\non:\n  pull_request:\n/);
    assert.match(workflow, /group: pages-\$\{\{ github.ref \}\}/);
    assert.match(workflow, /- name: Run regression tests\n        run: node --test tests\/\*\.test\.js/);
    assert.doesNotMatch(workflow, /continue-on-error|if:\s*(?:\$\{\{\s*)?always\(\)/);
    assert.ok(workflow.indexOf('Verify Pages artifact contents') < workflow.indexOf('Run regression tests'));
    assert.ok(workflow.indexOf('Run regression tests') < workflow.indexOf('Upload Pages artifact'));
    const deployGuard = "if: github.event_name != 'pull_request' && github.ref == 'refs/heads/main'";
    assert.ok(workflow.includes(`- name: Upload Pages artifact\n        ${deployGuard}`));
    assert.ok(workflow.includes(`  deploy:\n    needs: build\n    ${deployGuard}`));
    assert.equal((workflow.match(/artifact_name: github-pages-\$\{\{ github.run_id \}\}-\$\{\{ github.run_attempt \}\}/g) || []).length, 1);
    assert.match(workflow, /name: github-pages-\$\{\{ github.run_id \}\}-\$\{\{ github.run_attempt \}\}/);
});

test('the actual Pages build verifies PR artifacts without secrets and rejects secretless deployment builds', () => {
    assert.equal(buildBlocks.length, 2);
    const temporary = fs.mkdtempSync(path.join(__dirname, '.pipeline-test-'));
    const env = {
        ...process.env,
        WA_GGR_API_KEY: '',
        WA_GGR_SAVE_CHECKPOINT_APPROVAL_URL: '',
        WA_GGR_RUNTIME_CONFIG_VERSION: 'validation-1',
        WA_GGR_PAGES_BUILD_DIR: path.join(temporary, 'pages'),
        RUNNER_TEMP: temporary
    };
    const run = (block, validationOnly) => spawnSync('python', ['-c', block], {
        cwd: root,
        env: { ...env, WA_GGR_VALIDATION_ONLY: String(validationOnly) },
        encoding: 'utf8'
    });
    try {
        const missingSecret = run(buildBlocks[0], false);
        assert.notEqual(missingSecret.status, 0);
        assert.match(missingSecret.stderr, /WA_GGR_API_KEY secret is required/);
        for (const block of buildBlocks) {
            const result = run(block, true);
            assert.equal(result.status, 0, result.stderr || result.stdout);
        }
        const config = fs.readFileSync(path.join(env.WA_GGR_PAGES_BUILD_DIR, 'teacher/runtime-config.js'), 'utf8');
        assert.match(config, /validation-only-not-a-key/);
        assert.match(config, /version: "validation-1"/);
        assert.ok(fs.existsSync(path.join(temporary, 'pages-artifact-verify.tar')));
    } finally {
        fs.rmSync(temporary, { recursive: true, force: true });
    }
});
