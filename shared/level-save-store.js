/**
 * Per-level save identity + local storage.
 *
 * One independent game per Class|Student|Level. Every save is stored under a
 * namespaced key that includes the storage schema version, the normalized
 * class code, the normalized student code and the played level:
 *
 *   wa_gr_level_save_v1|<CLASS>|<STUDENT>|<LEVEL>
 *
 * The saved envelope records its owner and the level that was played. A save
 * is only ever loaded for the exact identity + level it was written for; it is
 * never relabelled to another level because of the page URL, a pending
 * request, or the roster CurrentLevel.
 *
 * Checkpoint/unlock evidence (quiz passes, teacher decisions) is shared across
 * a student's levels and lives in a per-student progression ledger
 * (wa_gr_progression_v1|<CLASS>|<STUDENT>), so resetting one level's economy
 * never removes access that was earned.
 *
 * The pre-existing single shared slot (`level2_autosave`) is treated as
 * legacy: it is backed up, migrated only to its verified owner and recorded
 * level, and never deleted or written again by this module.
 *
 * Nothing here talks to the network.
 */
(function initLevelSaveStore(globalObj) {
    const STORAGE_SCHEMA_VERSION = 1;
    const ENVELOPE_KIND = 'wa_gr_level_save';
    const SAVE_KEY_PREFIX = 'wa_gr_level_save_v1';
    const LEDGER_KEY_PREFIX = 'wa_gr_progression_v1';
    const ARCHIVE_KEY_PREFIX = 'wa_gr_level_archive_v1';
    const LEGACY_AUTOSAVE_KEY = 'level2_autosave';
    const LEGACY_BACKUP_KEY = 'wa_gr_legacy_autosave_backups_v1';
    const QUARANTINE_KEY = 'wa_gr_level_save_quarantine_v1';
    const MAX_LEGACY_BACKUPS = 5;
    const MAX_ARCHIVES_PER_LEVEL = 3;
    const MAX_QUARANTINE_ITEMS = 20;
    const MAX_QUIZ_ATTEMPTS = 50;
    const FALLBACK_SAVE_LEVELS = [2, 3, 4, 5];
    const CODE_PATTERN = /^[A-Z0-9](?:[A-Z0-9-]{0,38}[A-Z0-9])?$/;
    const CHECKPOINT_RANK = { quiz_available: 1, quiz_passed: 2 };
    const TEACHER_DECISIONS = new Set(['approved', 'retake_requested', 'rejected']);

    function getCapabilities() {
        const api = globalObj.WA_GOLD_RUSH_LEVEL_CAPABILITIES;
        if (api && typeof api.isSavePipelineLevel === 'function') return api;
        if (typeof require === 'function') {
            try { return require('./level-capabilities.js'); } catch (_) { return null; }
        }
        return null;
    }

    function getSaveLevels() {
        const caps = getCapabilities();
        return caps ? caps.getSavePipelineLevels() : FALLBACK_SAVE_LEVELS.slice();
    }

    /** Strict level parse: integers only, never coerced to a default. */
    function normalizeSaveLevel(value) {
        if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
        const text = String(value).trim();
        if (!/^\d+$/.test(text)) return null;
        const level = Number(text);
        return getSaveLevels().includes(level) ? level : null;
    }

    function normalizeCode(value) {
        if (typeof value !== 'string' && typeof value !== 'number') return '';
        const code = String(value).trim().toUpperCase();
        return CODE_PATTERN.test(code) ? code : '';
    }

    /** {classCode, studentCode} upper-cased, or null when either is invalid. */
    function normalizeIdentity(input) {
        if (!input || typeof input !== 'object') return null;
        const classCode = normalizeCode(input.classCode);
        const studentCode = normalizeCode(input.studentCode);
        if (!classCode || !studentCode) return null;
        return { classCode, studentCode };
    }

    /** Canonical ProgressKey: UPPER(ClassCode)|UPPER(StudentCode)|Level. */
    function buildProgressKey(identityInput, levelInput) {
        const identity = normalizeIdentity(identityInput);
        const level = normalizeSaveLevel(levelInput);
        if (!identity || level === null) return '';
        return `${identity.classCode}|${identity.studentCode}|${level}`;
    }

    function buildSaveKey(identityInput, levelInput) {
        const progressKey = buildProgressKey(identityInput, levelInput);
        return progressKey ? `${SAVE_KEY_PREFIX}|${progressKey}` : '';
    }

    function buildArchiveKey(identityInput, levelInput) {
        const progressKey = buildProgressKey(identityInput, levelInput);
        return progressKey ? `${ARCHIVE_KEY_PREFIX}|${progressKey}` : '';
    }

    function buildLedgerKey(identityInput) {
        const identity = normalizeIdentity(identityInput);
        return identity ? `${LEDGER_KEY_PREFIX}|${identity.classCode}|${identity.studentCode}` : '';
    }

    function clone(value) {
        return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    }

    function deepFreeze(value) {
        if (value && typeof value === 'object' && !Object.isFrozen(value)) {
            Object.freeze(value);
            Object.values(value).forEach(deepFreeze);
        }
        return value;
    }

    /** Detached, deeply frozen copy taken at capture time. */
    function freezeCopy(value) {
        return deepFreeze(clone(value));
    }

    /** Deterministic JSON with sorted object keys (used for hashing/equality). */
    function canonicalJson(value) {
        if (value === null || typeof value !== 'object') {
            return JSON.stringify(value === undefined ? null : value);
        }
        if (Array.isArray(value)) {
            return `[${value.map((item) => canonicalJson(item === undefined ? null : item)).join(',')}]`;
        }
        const keys = Object.keys(value).filter((key) => value[key] !== undefined).sort();
        return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
    }

    /**
     * cyrb53 — fast non-cryptographic 53-bit hash. Used only for local
     * de-duplication and as an advisory content fingerprint; it is not a
     * security control and the server must not trust it as proof of content.
     */
    function hashString(input) {
        const text = String(input);
        let h1 = 0xdeadbeef;
        let h2 = 0x41c6ce57;
        for (let i = 0; i < text.length; i += 1) {
            const ch = text.charCodeAt(i);
            h1 = Math.imul(h1 ^ ch, 2654435761);
            h2 = Math.imul(h2 ^ ch, 1597334677);
        }
        h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
        h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
        return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
    }

    function hashValue(value) {
        return `c53-${hashString(canonicalJson(value))}`;
    }

    function randomId(prefix) {
        const cryptoApi = globalObj.crypto;
        if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return `${prefix}-${cryptoApi.randomUUID()}`;
        if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') {
            return `${prefix}-${Array.from(cryptoApi.getRandomValues(new Uint32Array(4)), (n) => n.toString(16)).join('')}`;
        }
        return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
    }

    function nowIso(options) {
        return typeof options?.now === 'string' ? options.now : new Date().toISOString();
    }

    function resolveStorage(storage) {
        return storage || (typeof globalObj.localStorage !== 'undefined' ? globalObj.localStorage : null);
    }

    function readJson(storage, key) {
        const raw = storage.getItem(key);
        if (raw === null || raw === undefined) return { raw: null, value: null, error: null };
        try {
            return { raw, value: JSON.parse(raw), error: null };
        } catch (error) {
            return { raw, value: null, error: 'malformed_json' };
        }
    }

    function isPlainObject(value) {
        return !!value && typeof value === 'object' && !Array.isArray(value);
    }

    // ------------------------------------------------------------------
    // Snapshots + envelopes
    // ------------------------------------------------------------------

    /**
     * Validate the economy snapshot owned by one level. Returns a reason code
     * or '' when valid. Snapshots carry only the minimum identity needed to
     * prove ownership (no StudentName/StudentID/credentials).
     */
    function validateSnapshot(snapshot, expected = {}) {
        if (!isPlainObject(snapshot)) return 'snapshot_missing';
        if (snapshot.schemaVersion !== undefined && snapshot.schemaVersion !== 2) return 'snapshot_schema_unsupported';
        const level = normalizeSaveLevel(snapshot.level);
        if (level === null) return 'snapshot_level_invalid';
        if (expected.level !== undefined && level !== expected.level) return 'snapshot_level_mismatch';
        const owner = normalizeIdentity(snapshot.player || {});
        if (!owner) return 'snapshot_owner_invalid';
        if (expected.identity && (owner.classCode !== expected.identity.classCode
            || owner.studentCode !== expected.identity.studentCode)) {
            return 'snapshot_owner_mismatch';
        }
        if (!Number.isInteger(snapshot.round) || snapshot.round < 1) return 'snapshot_round_invalid';
        if (typeof snapshot.cash !== 'number' || !Number.isFinite(snapshot.cash)) return 'snapshot_cash_invalid';
        if (typeof snapshot.player.companyName !== 'string') return 'snapshot_company_invalid';
        if (!isPlainObject(snapshot.progression)) return 'snapshot_progression_invalid';
        if (snapshot.investmentProfile !== undefined && snapshot.investmentProfile !== null) {
            const profile = snapshot.investmentProfile;
            if (!isPlainObject(profile) || ['highRisk', 'lowRisk', 'profitChasing', 'assetBuilding', 'futureProofing']
                .some((key) => typeof profile[key] !== 'number' || !Number.isFinite(profile[key]) || profile[key] < 0)) {
                return 'snapshot_profile_invalid';
            }
        }
        if (!isPlainObject(snapshot.ownedMines)) return 'snapshot_mines_invalid';
        if (!Array.isArray(snapshot.machinery)) return 'snapshot_machinery_invalid';
        if (!Array.isArray(snapshot.roundHistory)) return 'snapshot_history_invalid';
        if (!isPlainObject(snapshot.investmentPlans)) return 'snapshot_plans_invalid';
        if (typeof snapshot.totalProfitLoss !== 'number' || !Number.isFinite(snapshot.totalProfitLoss)) {
            return 'snapshot_profit_invalid';
        }
        return '';
    }

    function validateEnvelope(envelope, expectedInput = {}) {
        if (!isPlainObject(envelope)) return { ok: false, reason: 'envelope_missing' };
        if (envelope.kind !== ENVELOPE_KIND) return { ok: false, reason: 'envelope_kind' };
        if (envelope.storageSchemaVersion !== STORAGE_SCHEMA_VERSION) {
            return { ok: false, reason: 'storage_schema_unsupported' };
        }
        const owner = normalizeIdentity(envelope.owner || {});
        if (!owner) return { ok: false, reason: 'owner_invalid' };
        const level = normalizeSaveLevel(envelope.level);
        if (level === null) return { ok: false, reason: 'level_invalid' };
        const expectedIdentity = expectedInput.identity ? normalizeIdentity(expectedInput.identity) : null;
        if (expectedInput.identity && !expectedIdentity) return { ok: false, reason: 'expected_identity_invalid' };
        if (expectedIdentity && (expectedIdentity.classCode !== owner.classCode
            || expectedIdentity.studentCode !== owner.studentCode)) {
            return { ok: false, reason: 'owner_mismatch' };
        }
        if (expectedInput.level !== undefined) {
            const expectedLevel = normalizeSaveLevel(expectedInput.level);
            if (expectedLevel === null) return { ok: false, reason: 'expected_level_invalid' };
            if (expectedLevel !== level) return { ok: false, reason: 'level_mismatch' };
        }
        if (envelope.progressKey !== buildProgressKey(owner, level)) return { ok: false, reason: 'progress_key_mismatch' };
        if (!Number.isInteger(envelope.generation) || envelope.generation < 1) return { ok: false, reason: 'generation_invalid' };
        if (typeof envelope.runId !== 'string' || !envelope.runId) return { ok: false, reason: 'run_id_invalid' };
        if (envelope.startingNetWorth !== null
            && !(typeof envelope.startingNetWorth === 'number' && Number.isFinite(envelope.startingNetWorth))) {
            return { ok: false, reason: 'starting_net_worth_invalid' };
        }
        const snapshotReason = validateSnapshot(envelope.snapshot, { level, identity: owner });
        if (snapshotReason) return { ok: false, reason: snapshotReason };
        const snapshotRun = envelope.snapshot.run;
        if (snapshotRun !== undefined && (!isPlainObject(snapshotRun)
            || snapshotRun.generation !== envelope.generation || snapshotRun.runId !== envelope.runId
            || (snapshotRun.startingNetWorth ?? null) !== envelope.startingNetWorth)) {
            return { ok: false, reason: 'snapshot_run_mismatch' };
        }
        return { ok: true, reason: '', identity: owner, level };
    }

    function createEnvelope(input = {}) {
        const identity = normalizeIdentity(input.identity);
        const level = normalizeSaveLevel(input.level);
        const createdAt = nowIso(input);
        const envelope = {
            kind: ENVELOPE_KIND,
            storageSchemaVersion: STORAGE_SCHEMA_VERSION,
            owner: identity,
            level,
            progressKey: buildProgressKey(identity, level),
            generation: input.generation,
            runId: input.runId,
            startingNetWorth: input.startingNetWorth === undefined ? null : input.startingNetWorth,
            createdAt: input.createdAt || createdAt,
            savedAt: createdAt,
            cloud: isPlainObject(input.cloud) ? clone(input.cloud) : { status: 'local_only', revision: null },
            snapshot: clone(input.snapshot)
        };
        if (input.migratedFrom) envelope.migratedFrom = clone(input.migratedFrom);
        return envelope;
    }

    function readLevelSave(storageInput, identityInput, levelInput) {
        const storage = resolveStorage(storageInput);
        const identity = normalizeIdentity(identityInput);
        const level = normalizeSaveLevel(levelInput);
        if (!identity) return { status: 'invalid', reason: 'identity_invalid', envelope: null };
        if (level === null) return { status: 'invalid', reason: 'level_invalid', envelope: null };
        if (!storage) return { status: 'unavailable', reason: 'storage_unavailable', envelope: null };
        const key = buildSaveKey(identity, level);
        let parsed;
        try {
            if (storage.getItem(`${key}|adoption`) !== null) {
                return { status: 'unavailable', reason: 'adoption_pending', envelope: null, key };
            }
            parsed = readJson(storage, key);
        } catch (error) {
            return { status: 'unavailable', reason: 'storage_read_failed', envelope: null };
        }
        if (parsed.raw === null) return { status: 'missing', reason: '', envelope: null, key };
        if (parsed.error) return { status: 'invalid', reason: parsed.error, envelope: null, key, raw: parsed.raw };
        const validation = validateEnvelope(parsed.value, { identity, level });
        if (!validation.ok) {
            return { status: 'invalid', reason: validation.reason, envelope: null, key, raw: parsed.raw };
        }
        return { status: 'found', reason: '', envelope: freezeCopy(parsed.value), key };
    }

    function writeLevelSave(storageInput, envelope, expected = {}) {
        const validation = validateEnvelope(envelope, expected);
        if (!validation.ok) return { ok: false, reason: validation.reason };
        const protection = getLevelWriteProtection(storageInput, validation.identity, validation.level);
        if (protection) return { ok: false, reason: protection };
        return persistLevelSave(storageInput, envelope, expected);
    }

    function persistLevelSave(storageInput, envelope, expected) {
        const storage = resolveStorage(storageInput);
        if (!storage) return { ok: false, reason: 'storage_unavailable' };
        const validation = validateEnvelope(envelope, expected);
        if (!validation.ok) return { ok: false, reason: validation.reason };
        const ledger = readLedger(storage, validation.identity);
        const run = ledger.levelRuns[String(validation.level)];
        // A save from an earlier run (pre-reset) must never resurrect that run.
        if (run && (envelope.generation !== run.generation || envelope.runId !== run.runId)) {
            return { ok: false, reason: 'stale_generation' };
        }
        try {
            storage.setItem(buildSaveKey(validation.identity, validation.level), JSON.stringify(envelope));
            return { ok: true, reason: '' };
        } catch (error) {
            return { ok: false, reason: 'storage_write_failed' };
        }
    }

    /** Copy an unreadable/mismatched slot aside before anything replaces it. */
    function quarantineRaw(storageInput, key, raw, reason, options = {}) {
        const storage = resolveStorage(storageInput);
        if (!storage || raw === null || raw === undefined) return false;
        try {
            const existing = readJson(storage, QUARANTINE_KEY).value;
            const items = Array.isArray(existing) ? existing : [];
            const hash = hashString(String(raw));
            if (items.some((item) => item?.key === key && item?.hash === hash)) return true;
            items.push({ key, hash, reason, quarantinedAt: nowIso(options), raw: String(raw) });
            storage.setItem(QUARANTINE_KEY, JSON.stringify(items.slice(-MAX_QUARANTINE_ITEMS)));
            return true;
        } catch (_) {
            return false;
        }
    }

    function updateCloudState(storageInput, identityInput, levelInput, update = {}) {
        const storage = resolveStorage(storageInput);
        const current = readLevelSave(storage, identityInput, levelInput);
        if (current.status !== 'found') return { ok: false, reason: current.reason || current.status };
        const envelope = clone(current.envelope);
        if (update.generation !== undefined && update.generation !== envelope.generation) {
            return { ok: false, reason: 'stale_generation' };
        }
        if (update.runId !== undefined && update.runId !== envelope.runId) {
            return { ok: false, reason: 'stale_generation' };
        }
        envelope.cloud = { ...(envelope.cloud || {}), ...clone(update.cloud || {}) };
        // This path changes only cloud metadata on the validated current
        // envelope; recording a conflict must not rewrite its economy/run.
        return persistLevelSave(storage, envelope, { identity: identityInput, level: levelInput });
    }

    // ------------------------------------------------------------------
    // Progression ledger (shared unlock evidence + run generations)
    // ------------------------------------------------------------------

    function emptyLedger(identity) {
        return {
            storageSchemaVersion: STORAGE_SCHEMA_VERSION,
            owner: identity,
            progressionStateByLevel: {},
            levelRuns: {},
            legacyMigration: null
        };
    }

    function readLedger(storageInput, identityInput) {
        const storage = resolveStorage(storageInput);
        const identity = normalizeIdentity(identityInput);
        if (!identity || !storage) return emptyLedger(identity);
        try {
            const value = readJson(storage, buildLedgerKey(identity)).value;
            const owner = normalizeIdentity(value?.owner || {});
            if (!isPlainObject(value) || value.storageSchemaVersion !== STORAGE_SCHEMA_VERSION || !owner
                || owner.classCode !== identity.classCode || owner.studentCode !== identity.studentCode) {
                return emptyLedger(identity);
            }
            return {
                storageSchemaVersion: STORAGE_SCHEMA_VERSION,
                owner: identity,
                progressionStateByLevel: isPlainObject(value.progressionStateByLevel) ? value.progressionStateByLevel : {},
                levelRuns: isPlainObject(value.levelRuns) ? value.levelRuns : {},
                legacyMigration: isPlainObject(value.legacyMigration) ? value.legacyMigration : null
            };
        } catch (_) {
            return emptyLedger(identity);
        }
    }

    function writeLedger(storageInput, ledger) {
        const storage = resolveStorage(storageInput);
        const identity = normalizeIdentity(ledger?.owner || {});
        if (!storage || !identity) return false;
        try {
            storage.setItem(buildLedgerKey(identity), JSON.stringify({ ...ledger, owner: identity, storageSchemaVersion: STORAGE_SCHEMA_VERSION }));
            return true;
        } catch (_) {
            return false;
        }
    }

    function checkpointRank(status) {
        if (!status) return 0;
        return CHECKPOINT_RANK[status] || 1;
    }

    function latestTimestamp(values) {
        return values
            .map((value) => (value ? Date.parse(value) : NaN))
            .filter(Number.isFinite)
            .reduce((max, value) => Math.max(max, value), -Infinity);
    }

    /**
     * Monotonic merge of checkpoint evidence for one level:
     * - checkpoint status never downgrades (quiz_passed beats quiz_available);
     * - quiz attempts are unioned;
     * - a teacher decision (approved / retake_requested / rejected) is kept
     *   unless the incoming state records a newer quiz pass than that decision.
     */
    function mergeProgressionEvidence(existingInput, incomingInput) {
        const existing = isPlainObject(existingInput) ? existingInput : {};
        const incoming = isPlainObject(incomingInput) ? incomingInput : {};
        const attempts = [];
        const seen = new Set();
        [...(Array.isArray(existing.quizAttempts) ? existing.quizAttempts : []),
            ...(Array.isArray(incoming.quizAttempts) ? incoming.quizAttempts : [])].forEach((attempt) => {
            if (!isPlainObject(attempt)) return;
            const id = `${attempt.timestamp || ''}|${attempt.score ?? ''}|${attempt.passed ? 1 : 0}`;
            if (seen.has(id)) return;
            seen.add(id);
            attempts.push(attempt);
        });
        attempts.sort((a, b) => String(a.timestamp || '').localeCompare(String(b.timestamp || '')));

        const existingRank = checkpointRank(existing.checkpointStatus);
        const incomingRank = checkpointRank(incoming.checkpointStatus);
        const winner = incomingRank > existingRank ? incoming : existing;
        const checkpointStatus = (incomingRank > existingRank ? incoming.checkpointStatus : existing.checkpointStatus)
            || incoming.checkpointStatus || null;

        const quizPassedAt = existing.quizPassedAt || incoming.quizPassedAt || null;
        let approval = {
            approvalStatus: existing.approvalStatus ?? null,
            approverName: existing.approverName ?? null,
            approvalTimestamp: existing.approvalTimestamp ?? null
        };
        const incomingApproval = {
            approvalStatus: incoming.approvalStatus ?? null,
            approverName: incoming.approverName ?? null,
            approvalTimestamp: incoming.approvalTimestamp ?? null
        };
        const existingIsTeacher = TEACHER_DECISIONS.has(String(existing.approvalStatus || ''));
        const incomingIsTeacher = TEACHER_DECISIONS.has(String(incoming.approvalStatus || ''));
        if (incomingIsTeacher) {
            if (!existingIsTeacher || latestTimestamp([incoming.approvalTimestamp]) >= latestTimestamp([existing.approvalTimestamp])) {
                approval = incomingApproval;
            }
        } else if (existingIsTeacher) {
            const decisionAt = latestTimestamp([existing.approvalTimestamp]);
            const incomingPassAt = latestTimestamp([
                incoming.quizPassedAt,
                ...(Array.isArray(incoming.quizAttempts) ? incoming.quizAttempts.filter((a) => a?.passed).map((a) => a.timestamp) : [])
            ]);
            if (incoming.approvalStatus === 'pending' && incomingPassAt > decisionAt) approval = incomingApproval;
        } else if (incoming.approvalStatus !== undefined && incomingRank >= existingRank) {
            approval = incomingApproval;
        }

        return {
            checkpointStatus,
            quizAttempts: attempts.slice(-MAX_QUIZ_ATTEMPTS),
            quizScore: winner.quizScore ?? existing.quizScore ?? incoming.quizScore ?? null,
            quizPassedAt: checkpointStatus === 'quiz_passed' ? quizPassedAt : (existing.quizPassedAt || null),
            ...approval
        };
    }

    function recordProgressionEvidence(storageInput, identityInput, levelInput, state) {
        const storage = resolveStorage(storageInput);
        const identity = normalizeIdentity(identityInput);
        const level = normalizeSaveLevel(levelInput);
        if (!storage || !identity || level === null || !isPlainObject(state)) return false;
        const ledger = readLedger(storage, identity);
        const key = String(level);
        ledger.progressionStateByLevel[key] = mergeProgressionEvidence(ledger.progressionStateByLevel[key], state);
        return writeLedger(storage, ledger);
    }

    function readProgressionEvidence(storageInput, identityInput, levelInput) {
        const level = normalizeSaveLevel(levelInput);
        if (level === null) return null;
        const ledger = readLedger(storageInput, identityInput);
        const state = ledger.progressionStateByLevel[String(level)];
        return isPlainObject(state) ? clone(state) : null;
    }

    /** Current run (generation + runId) for a level, created on first use. */
    function ensureLevelRun(storageInput, identityInput, levelInput, options = {}) {
        if (getLevelWriteProtection(storageInput, identityInput, levelInput)) return null;
        return ensureLevelRunUnchecked(storageInput, identityInput, levelInput, options);
    }

    function ensureLevelRunUnchecked(storageInput, identityInput, levelInput, options = {}) {
        const storage = resolveStorage(storageInput);
        const identity = normalizeIdentity(identityInput);
        const level = normalizeSaveLevel(levelInput);
        if (!storage || !identity || level === null) return null;
        const ledger = readLedger(storage, identity);
        const key = String(level);
        const existing = ledger.levelRuns[key];
        if (isPlainObject(existing) && Number.isInteger(existing.generation) && existing.generation >= 1 && existing.runId) {
            return { ...existing };
        }
        const run = { generation: 1, runId: randomId('run'), startedAt: nowIso(options) };
        ledger.levelRuns[key] = run;
        return writeLedger(storage, ledger) ? { ...run } : null;
    }

    /** Adopt the run identity of a found/restored envelope (e.g. migration). */
    function adoptLevelRun(storageInput, envelope) {
        const storage = resolveStorage(storageInput);
        const validation = validateEnvelope(envelope);
        if (!storage || !validation.ok) return false;
        if (getLevelWriteProtection(storage, validation.identity, validation.level)) return false;
        const ledger = readLedger(storage, validation.identity);
        const key = String(validation.level);
        const current = ledger.levelRuns[key];
        if (isPlainObject(current) && Number.isInteger(current.generation) && current.generation > envelope.generation) {
            return false;
        }
        ledger.levelRuns[key] = { generation: envelope.generation, runId: envelope.runId, startedAt: envelope.createdAt || null };
        return writeLedger(storage, ledger);
    }

    /**
     * localStorage has no multi-key transaction. Keep a journal and the source
     * archive until both the envelope and ledger are committed. Interrupted
     * adoption is write-protected and can be recovered without clearing storage.
     */
    function recoverCloudAdoption(storageInput, identityInput, levelInput) {
        const storage = resolveStorage(storageInput);
        const identity = normalizeIdentity(identityInput);
        const level = normalizeSaveLevel(levelInput);
        if (!storage || !identity || level === null) return { ok: false, reason: 'invalid_request' };
        const key = buildSaveKey(identity, level);
        const ledgerKey = buildLedgerKey(identity);
        const journalKey = `${key}|adoption`;
        try {
            const raw = storage.getItem(journalKey);
            if (raw === null) return { ok: true };
            const journal = JSON.parse(raw);
            if (!isPlainObject(journal) || journal.key !== key || journal.ledgerKey !== ledgerKey
                || ![journal.source, journal.sourceLedger].every((v) => v === null || typeof v === 'string')
                || typeof journal.target !== 'string' || typeof journal.targetLedger !== 'string') {
                return { ok: false, reason: 'adoption_journal_invalid' };
            }
            const slot = storage.getItem(key);
            const ledger = storage.getItem(ledgerKey);
            const committed = slot === journal.target && ledger === journal.targetLedger;
            if (!committed) {
                if (ledger !== journal.sourceLedger || (slot !== journal.source && slot !== journal.target)) {
                    return { ok: false, reason: 'adoption_concurrent_change' };
                }
                if (journal.source === null) storage.removeItem(key);
                else storage.setItem(key, journal.source);
            }
            if (storage.getItem(journalKey) !== raw) return { ok: false, reason: 'adoption_concurrent_change' };
            storage.removeItem(journalKey);
            return { ok: true, committed };
        } catch (_) {
            return { ok: false, reason: 'adoption_pending' };
        }
    }

    function adoptCloudEnvelope(storageInput, envelope) {
        const storage = resolveStorage(storageInput);
        const validation = validateEnvelope(envelope);
        if (!storage || !validation.ok) return { ok: false, reason: validation.reason || 'storage_unavailable' };
        const { identity, level } = validation;
        const recovered = recoverCloudAdoption(storage, identity, level);
        if (!recovered.ok) return recovered;
        const protection = getLevelWriteProtection(storage, identity, level);
        if (protection) return { ok: false, reason: protection };
        const key = buildSaveKey(identity, level);
        const ledgerKey = buildLedgerKey(identity);
        const journalKey = `${key}|adoption`;
        try {
            const source = storage.getItem(key);
            const sourceLedger = storage.getItem(ledgerKey);
            if (source !== null) {
                const local = JSON.parse(source);
                if (local.generation !== envelope.generation || local.runId !== envelope.runId
                    || local.cloud?.status !== 'synced'
                    || !Number.isInteger(local.cloud.revision)
                    || !Number.isInteger(envelope.cloud?.revision)
                    || envelope.cloud.revision <= local.cloud.revision) {
                    return { ok: false, reason: 'cloud_reconciliation_required' };
                }
            }
            if (sourceLedger !== null) {
                const parsedLedger = JSON.parse(sourceLedger);
                const owner = normalizeIdentity(parsedLedger?.owner);
                if (!isPlainObject(parsedLedger) || parsedLedger.storageSchemaVersion !== STORAGE_SCHEMA_VERSION
                    || !owner || owner.classCode !== identity.classCode || owner.studentCode !== identity.studentCode
                    || !isPlainObject(parsedLedger.levelRuns) || !isPlainObject(parsedLedger.progressionStateByLevel)) {
                    return { ok: false, reason: 'source_ledger_invalid' };
                }
            }
            const ledger = readLedger(storage, identity);
            const current = ledger.levelRuns[String(level)];
            if (current?.generation > envelope.generation) return { ok: false, reason: 'stale_generation' };
            ledger.levelRuns[String(level)] = {
                generation: envelope.generation, runId: envelope.runId, startedAt: envelope.createdAt
            };
            if (isPlainObject(envelope.snapshot.progression)) {
                ledger.progressionStateByLevel[String(level)] = mergeProgressionEvidence(
                    ledger.progressionStateByLevel[String(level)], envelope.snapshot.progression
                );
            }
            const archived = archiveLevelSave(storage, identity, level, { reason: 'replaced_by_cloud_restore' });
            if (!archived.ok) return archived;
            const target = JSON.stringify(envelope);
            const targetLedger = JSON.stringify(ledger);
            const journal = JSON.stringify({ key, ledgerKey, source, sourceLedger, target, targetLedger });
            if (storage.getItem(key) !== source || storage.getItem(ledgerKey) !== sourceLedger
                || storage.getItem(journalKey) !== null) return { ok: false, reason: 'adoption_concurrent_change' };
            storage.setItem(journalKey, journal);
            if (storage.getItem(key) !== source || storage.getItem(ledgerKey) !== sourceLedger) {
                return { ok: false, reason: 'adoption_concurrent_change' };
            }
            storage.setItem(key, target);
            if (storage.getItem(key) !== target || storage.getItem(ledgerKey) !== sourceLedger
                || storage.getItem(journalKey) !== journal) return { ok: false, reason: 'adoption_concurrent_change' };
            storage.setItem(ledgerKey, targetLedger);
            const finished = recoverCloudAdoption(storage, identity, level);
            return finished.ok && finished.committed ? { ok: true } : { ok: false, reason: finished.reason || 'adoption_pending' };
        } catch (_) {
            recoverCloudAdoption(storage, identity, level);
            return { ok: false, reason: 'adoption_write_failed' };
        }
    }

    // ------------------------------------------------------------------
    // Reset (one level only)
    // ------------------------------------------------------------------

    /**
     * Copy the current slot (raw text, unmodified) into this level's archive
     * before anything replaces it. Keeps the most recent archives only.
     */
    function archiveLevelSave(storageInput, identityInput, levelInput, options = {}) {
        const storage = resolveStorage(storageInput);
        const identity = normalizeIdentity(identityInput);
        const level = normalizeSaveLevel(levelInput);
        if (!storage || !identity || level === null) return { ok: false, reason: 'invalid_request' };
        let raw = null;
        try { raw = storage.getItem(buildSaveKey(identity, level)); } catch (_) { return { ok: false, reason: 'storage_read_failed' }; }
        if (raw === null) return { ok: true, reason: '', archived: false };
        try {
            const archiveKey = buildArchiveKey(identity, level);
            const existing = readJson(storage, archiveKey).value;
            const archives = Array.isArray(existing) ? existing : [];
            archives.push({ archivedAt: nowIso(options), reason: options.reason || 'archived', raw });
            storage.setItem(archiveKey, JSON.stringify(archives.slice(-MAX_ARCHIVES_PER_LEVEL)));
        } catch (_) {
            return { ok: false, reason: 'archive_failed' };
        }
        return { ok: true, reason: '', archived: true };
    }

    /**
     * Restart ONE level's economy on this device: archive the current save,
     * advance that level's run generation, and remove only that level's slot.
     * Other levels, checkpoint evidence and roster entitlements are untouched.
     * Fails closed (nothing removed) if the archive cannot be written.
     */
    function resetLevelSave(storageInput, identityInput, levelInput, options = {}) {
        const storage = resolveStorage(storageInput);
        const identity = normalizeIdentity(identityInput);
        const level = normalizeSaveLevel(levelInput);
        if (!storage || !identity || level === null) return { ok: false, reason: 'invalid_request' };
        const protection = getLevelWriteProtection(storage, identity, level);
        if (protection) return { ok: false, reason: protection };
        const key = buildSaveKey(identity, level);
        const existing = readLevelSave(storage, identity, level);
        if (getCapabilities()?.isFeatureEnabled('saveProtocolV2')
            || (existing.status === 'found' && Number.isInteger(existing.envelope.cloud?.revision))) {
            return { ok: false, reason: 'cloud_reset_unavailable' };
        }
        const archived = archiveLevelSave(storage, identity, level, { ...options, reason: options.reason || 'student_restart' });
        if (!archived.ok) return { ok: false, reason: archived.reason };
        const ledger = readLedger(storage, identity);
        const runKey = String(level);
        const previous = ledger.levelRuns[runKey];
        const previousGeneration = Number.isInteger(previous?.generation) ? previous.generation : 0;
        const run = { generation: previousGeneration + 1, runId: randomId('run'), startedAt: nowIso(options) };
        ledger.levelRuns[runKey] = run;
        if (!writeLedger(storage, ledger)) return { ok: false, reason: 'ledger_write_failed' };
        try { storage.removeItem(key); } catch (_) { return { ok: false, reason: 'storage_remove_failed' }; }
        return { ok: true, reason: '', archived: !!archived.archived, previousRun: previous || null, run };
    }

    // ------------------------------------------------------------------
    // Legacy `level2_autosave` migration (non-destructive, idempotent)
    // ------------------------------------------------------------------

    function backupLegacyRaw(storage, raw, options) {
        const hash = hashString(raw);
        const existing = readJson(storage, LEGACY_BACKUP_KEY).value;
        const backups = Array.isArray(existing) ? existing : [];
        if (backups.some((entry) => entry?.hash === hash)) return { ok: true, hash };
        backups.push({ hash, backedUpAt: nowIso(options), sourceKey: LEGACY_AUTOSAVE_KEY, raw });
        storage.setItem(LEGACY_BACKUP_KEY, JSON.stringify(backups.slice(-MAX_LEGACY_BACKUPS)));
        return { ok: true, hash };
    }

    function legacySnapshotFrom(gs, identity, level) {
        const numericRound = Number(gs.round);
        const numericCash = Number(gs.cash);
        const numericProfit = Number(gs.totalProfitLoss);
        return {
            level,
            round: Number.isInteger(numericRound) && numericRound >= 1 ? numericRound : 1,
            cash: Number.isFinite(numericCash) ? numericCash : 0,
            player: {
                classCode: identity.classCode,
                studentCode: identity.studentCode,
                leaderboardName: typeof gs.player?.leaderboardName === 'string' ? gs.player.leaderboardName : '',
                companyName: typeof gs.player?.companyName === 'string' ? gs.player.companyName : ''
            },
            ownedMines: isPlainObject(gs.ownedMines) ? clone(gs.ownedMines) : {},
            machinery: Array.isArray(gs.machinery) ? clone(gs.machinery) : [],
            roundHistory: Array.isArray(gs.roundHistory) ? clone(gs.roundHistory) : [],
            investmentPlans: isPlainObject(gs.investmentPlans) ? clone(gs.investmentPlans) : {},
            ...(gs.investmentProfile !== undefined ? { investmentProfile: clone(gs.investmentProfile) } : {}),
            progression: isPlainObject(gs.progressionStateByLevel?.[String(level)])
                ? clone(gs.progressionStateByLevel[String(level)]) : {},
            totalProfitLoss: Number.isFinite(numericProfit) ? numericProfit : 0
        };
    }

    /**
     * Migrate the legacy shared slot for the signed-in identity.
     *
     * - The raw legacy value is backed up first (idempotent by content hash);
     *   if the backup cannot be written nothing is migrated.
     * - Economy is migrated only when the record's owner studentCode AND
     *   classCode match the session and its recorded level is a supported
     *   save level; it goes ONLY to that recorded level. No saves are
     *   fabricated for other levels.
     * - An existing per-level slot is never overwritten.
     * - Malformed, unowned, other-student, class-mismatched or ambiguous
     *   records are left untouched (never deleted).
     * - Checkpoint evidence is merged into the ledger when the studentCode
     *   matches and the class matches or was not recorded (older saves).
     */
    function migrateLegacyAutosave(storageInput, identityInput, options = {}) {
        const storage = resolveStorage(storageInput);
        const identity = normalizeIdentity(identityInput);
        if (!storage || !identity) return { status: 'skipped', reason: 'invalid_request' };
        let raw;
        try { raw = storage.getItem(LEGACY_AUTOSAVE_KEY); } catch (_) { return { status: 'skipped', reason: 'storage_read_failed' }; }
        if (raw === null || raw === undefined) return { status: 'no_legacy', reason: '' };

        const ledger = readLedger(storage, identity);
        const hash = hashString(raw);
        if (ledger.legacyMigration?.hash === hash) {
            return { status: 'already_processed', reason: ledger.legacyMigration.reason || '', previous: clone(ledger.legacyMigration) };
        }
        try {
            backupLegacyRaw(storage, raw, options);
        } catch (_) {
            return { status: 'backup_failed', reason: 'backup_failed' };
        }

        const finish = (status, reason, level = null, extra = {}) => {
            const marker = { hash, status, reason, level, processedAt: nowIso(options) };
            const latest = readLedger(storage, identity);
            Object.entries(ledger.progressionStateByLevel).forEach(([key, state]) => {
                latest.progressionStateByLevel[key] = mergeProgressionEvidence(latest.progressionStateByLevel[key], state);
            });
            latest.legacyMigration = marker;
            if (!writeLedger(storage, latest)) return { status: 'skipped', reason: 'ledger_write_failed', level };
            return { status, reason, level, ...extra };
        };

        let data;
        try { data = JSON.parse(raw); } catch (_) { return finish('skipped', 'malformed'); }
        const gs = data?.gameState;
        if (!isPlainObject(gs)) return finish('skipped', 'malformed');
        const ownerCode = normalizeCode(gs.player?.studentCode);
        if (!ownerCode) return finish('skipped', 'unowned');
        if (ownerCode !== identity.studentCode) return finish('skipped', 'other_student');
        const ownerClass = normalizeCode(gs.player?.classCode);
        const level = normalizeSaveLevel(gs.assignedLevel);
        // Class transfer: ClassCode is part of the save key, so a record from
        // another class is never moved automatically (see docs).
        if (ownerClass && ownerClass !== identity.classCode) return finish('needs_review', 'class_mismatch', level);

        if (isPlainObject(gs.progressionStateByLevel)) {
            Object.entries(gs.progressionStateByLevel).forEach(([levelKey, state]) => {
                const evidenceLevel = normalizeSaveLevel(levelKey);
                if (evidenceLevel !== null && isPlainObject(state)) {
                    ledger.progressionStateByLevel[String(evidenceLevel)] = mergeProgressionEvidence(
                        ledger.progressionStateByLevel[String(evidenceLevel)], state
                    );
                }
            });
        }

        if (level === null) return finish('needs_review', 'unsupported_level');
        if (!isPlainObject(gs.progressionStateByLevel) && (gs.checkpointStatus || gs.approvalStatus)) {
            ledger.progressionStateByLevel[String(level)] = mergeProgressionEvidence(ledger.progressionStateByLevel[String(level)], {
                checkpointStatus: gs.checkpointStatus || null,
                quizAttempts: Array.isArray(gs.quizAttempts) ? gs.quizAttempts : [],
                approvalStatus: gs.approvalStatus || null,
                approverName: gs.approverName || null,
                approvalTimestamp: gs.approvalTimestamp || null
            });
        }
        if (!ownerClass) return finish('needs_review', 'missing_class', level);

        const target = readLevelSave(storage, identity, level);
        if (target.status === 'unavailable') return { status: 'skipped', reason: target.reason, level };
        if (target.status !== 'missing') {
            return target.status === 'found' && target.envelope.migratedFrom?.hash === hash
                ? finish('migrated', '', level)
                : finish('preserved_existing', `target_${target.status}`, level);
        }

        // Verified legacy ownership may resolve an earlier legacy review hold,
        // but cannot bypass an unrelated cloud conflict.
        const hold = getUploadHold(storage, identity, level);
        if (hold && !hold.startsWith('legacy_') && hold !== 'unverified_new_slot') {
            return { status: 'skipped', reason: hold, level };
        }
        const run = ensureLevelRunUnchecked(storage, identity, level, options);
        if (!run) return { status: 'skipped', reason: 'ledger_write_failed', level };
        const envelope = createEnvelope({
            identity,
            level,
            generation: run.generation,
            runId: run.runId,
            startingNetWorth: null,
            snapshot: legacySnapshotFrom(gs, identity, level),
            cloud: { status: 'unknown', revision: null },
            migratedFrom: { key: LEGACY_AUTOSAVE_KEY, hash, savedAt: typeof data.timestamp === 'string' ? data.timestamp : null },
            now: nowIso(options)
        });
        const written = persistLevelSave(storage, envelope, { identity, level });
        if (!written.ok) return { status: 'skipped', reason: written.reason, level };
        return finish('migrated', '', level);
    }

    /**
     * Reasons cloud uploads for this slot must be held (fail closed): a
     * legacy record for this signed-in student, recorded at this level on this
     * device, could not be verified and still needs teacher review.
     */
    function getUploadHold(storageInput, identityInput, levelInput) {
        const level = normalizeSaveLevel(levelInput);
        if (level === null) return 'level_invalid';
        const ledger = readLedger(storageInput, identityInput);
        const runHold = ledger.levelRuns[String(level)]?.cloudUploadHold;
        if (typeof runHold === 'string' && runHold) return runHold;
        const marker = ledger.legacyMigration;
        if (marker && marker.status === 'needs_review' && marker.reason !== 'class_mismatch' && marker.level === level) {
            return `legacy_${marker.reason || 'needs_review'}`;
        }
        return '';
    }

    function getLevelWriteProtection(storageInput, identityInput, levelInput) {
        const hold = getUploadHold(storageInput, identityInput, levelInput);
        if (hold && !['unverified_new_slot', 'cloud_state_unknown', 'cloud_restore_failed'].includes(hold)) return hold;
        const current = readLevelSave(storageInput, identityInput, levelInput);
        if (current.status !== 'found' && current.status !== 'missing') return current.reason || current.status;
        if (current.status === 'found') {
            const ledger = readLedger(storageInput, identityInput);
            const run = ledger.levelRuns[String(current.envelope.level)];
            if (run && (run.generation !== current.envelope.generation || run.runId !== current.envelope.runId)) {
                return 'stale_generation';
            }
            if (['conflict', 'hold', 'held', 'stale_generation'].includes(current.envelope.cloud?.status)) {
                return `cloud_${current.envelope.cloud.status}`;
            }
        }
        return '';
    }

    /** Lightweight descriptor for home-page level cards. */
    function describeLevelSave(storageInput, identityInput, levelInput) {
        const result = readLevelSave(storageInput, identityInput, levelInput);
        if (result.status === 'found') {
            return {
                status: 'resume',
                round: result.envelope.snapshot.round,
                savedAt: result.envelope.savedAt,
                cloudStatus: result.envelope.cloud?.status || 'local_only'
            };
        }
        if (result.status === 'missing') return { status: 'start' };
        return { status: result.status === 'unavailable' ? 'unavailable' : 'conflict', reason: result.reason };
    }

    const api = {
        STORAGE_SCHEMA_VERSION,
        ENVELOPE_KIND,
        SAVE_KEY_PREFIX,
        LEDGER_KEY_PREFIX,
        ARCHIVE_KEY_PREFIX,
        LEGACY_AUTOSAVE_KEY,
        LEGACY_BACKUP_KEY,
        QUARANTINE_KEY,
        normalizeSaveLevel,
        normalizeIdentity,
        archiveLevelSave,
        buildProgressKey,
        buildSaveKey,
        buildArchiveKey,
        buildLedgerKey,
        clone,
        deepFreeze,
        freezeCopy,
        canonicalJson,
        hashString,
        hashValue,
        randomId,
        validateSnapshot,
        validateEnvelope,
        createEnvelope,
        readLevelSave,
        writeLevelSave,
        quarantineRaw,
        updateCloudState,
        readLedger,
        writeLedger,
        mergeProgressionEvidence,
        recordProgressionEvidence,
        readProgressionEvidence,
        ensureLevelRun,
        adoptLevelRun,
        adoptCloudEnvelope,
        recoverCloudAdoption,
        resetLevelSave,
        migrateLegacyAutosave,
        getUploadHold,
        getLevelWriteProtection,
        describeLevelSave
    };

    globalObj.WA_GOLD_RUSH_LEVEL_SAVE_STORE = api;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})(typeof globalThis !== 'undefined' ? globalThis : window);
