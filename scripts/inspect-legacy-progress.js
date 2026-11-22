#!/usr/bin/env node
'use strict';

const store = require('../shared/level-save-store.js');
const converter = require('../shared/progress-snapshot-converter.js');

const CONTRACT_VERSION = 'ggr.getStudentProgress.legacy-readonly.v1';
const MAX_INPUT_BYTES = 5 * 1024 * 1024;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const result = (status, reason) => ({ status, reason });

function inspect(input) {
    if (!object(input) || !object(input.request) || !object(input.response)) {
        return result('failed', 'invalid_input');
    }
    const request = input.request;
    const identity = store.normalizeIdentity(request);
    const level = Number.isInteger(request.level) ? store.normalizeSaveLevel(request.level) : null;
    if (!identity || level === null || request.contractVersion !== CONTRACT_VERSION
        || request.mode !== 'full_save'
        || request.progressKey !== store.buildProgressKey(identity, level)) {
        return result('failed', 'invalid_request');
    }
    const response = input.response;
    if (response.success !== true || !Number.isInteger(response.status)
        || response.status < 200 || response.status >= 300) {
        return result('failed', 'transport_failure');
    }
    const body = response.data;
    if (!object(body) || body.contractVersion !== CONTRACT_VERSION) {
        return result('failed', 'invalid_contract');
    }
    if (body.ok !== true) return result('failed', 'flow_failure');
    if (body.progressKey !== request.progressKey) return result('failed', 'progress_key_mismatch');
    if (body.found === false) return result('reported_missing', 'verify_lookup_and_permissions');
    if (body.found !== true) return result('failed', 'found_flag_invalid');
    if (typeof body.snapshot !== 'string') return result('failed', 'raw_snapshot_required');
    const converted = converter.convertLegacySnapshot(body.snapshot, { identity, level });
    if (!converted.ok) return result('incompatible', converted.reason);
    return result('compatible', 'operator_config_check_required');
}

if (require.main === module) {
    let raw = '';
    let bytes = 0;
    let tooLarge = false;
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => {
        bytes += Buffer.byteLength(chunk);
        if (bytes > MAX_INPUT_BYTES) {
            tooLarge = true;
            raw = '';
        } else if (!tooLarge) {
            raw += chunk;
        }
    });
    process.stdin.on('error', () => {
        console.error('Unable to read standard input.');
        process.exitCode = 1;
    });
    process.stdin.on('end', () => {
        let inspection;
        if (tooLarge) {
            inspection = result('failed', 'input_too_large');
        } else {
            let parsed;
            try {
                parsed = JSON.parse(raw);
            } catch (_) {
                inspection = result('failed', 'invalid_input_json');
            }
            if (!inspection) inspection = inspect(parsed);
        }
        console.log(JSON.stringify(inspection));
        if (inspection.status !== 'compatible') process.exitCode = 1;
    });
}

module.exports = { CONTRACT_VERSION, inspect };
