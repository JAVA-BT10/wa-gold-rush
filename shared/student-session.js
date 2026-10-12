/**
 * Shared student-session contract.
 *
 * GGR_LoginStudent (roster lookup against GGR_Students) is the ONLY source of
 * student identity. A session is valid only when it was created from a
 * successful, complete GGR_LoginStudent response. Legacy, self-created, or
 * incomplete sessions are rejected everywhere (home page, Level 1, Levels 2–5,
 * quiz, save queue, and remote unlock).
 *
 * PINs and PIN hashes are never stored in the session.
 */
(function initStudentSession(globalObj) {
    const STORAGE_KEY = 'wa_gold_rush_student_session';
    const SOURCE = 'GGR_LoginStudent';
    const SCHEMA_VERSION = 2;
    const ROSTER_LEVELS = [1, 2, 3, 4, 5];
    // Levels whose progress is written through GGR_SaveProgress (Levels 2–5 game).
    const PROGRESS_LEVELS = [2, 3, 4, 5];
    const STUDENT_CODE_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38}[A-Za-z0-9])?$/;
    const CLASS_CODE_PATTERN = /^[A-Z0-9](?:[A-Z0-9-]{0,18}[A-Z0-9])?$/;
    const IDENTITY_FIELDS = ['studentCode', 'studentId', 'studentName', 'leaderboardName', 'classCode', 'assignedLevel'];

    function normalizeText(value, maxLength = 100) {
        if (typeof value !== 'string' && typeof value !== 'number') return '';
        const text = String(value).trim();
        return text.length <= maxLength ? text : '';
    }

    function normalizeStudentCode(value) {
        const code = normalizeText(value, 40);
        return STUDENT_CODE_PATTERN.test(code) ? code : '';
    }

    function normalizeClassCode(value) {
        const code = normalizeText(value, 20).toUpperCase();
        return CLASS_CODE_PATTERN.test(code) ? code : '';
    }

    /**
     * Returns a supported integer level or null. Never defaults: a blank,
     * fractional, or out-of-range level is rejected rather than coerced.
     */
    function normalizeLevel(value, allowedLevels = ROSTER_LEVELS) {
        if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
        const text = String(value).trim();
        if (!/^\d+$/.test(text)) return null;
        const level = Number(text);
        return allowedLevels.includes(level) ? level : null;
    }

    function normalizeProgressLevel(value) {
        return normalizeLevel(value, PROGRESS_LEVELS);
    }

    /**
     * Validate the roster identity fields returned by GGR_LoginStudent.
     * Every field is required; nothing is auto-filled from another field.
     */
    function validateIdentity(input = {}) {
        const source = input && typeof input === 'object' ? input : {};
        const identity = {
            studentCode: normalizeStudentCode(source.studentCode),
            studentId: normalizeText(source.studentId, 30),
            studentName: normalizeText(source.studentName, 100),
            leaderboardName: normalizeText(source.leaderboardName, 60),
            classCode: normalizeClassCode(source.classCode),
            assignedLevel: normalizeLevel(source.assignedLevel)
        };
        const errors = IDENTITY_FIELDS.filter((field) => identity[field] === '' || identity[field] === null);
        return { ok: errors.length === 0, identity, errors };
    }

    function isValidTimestamp(value) {
        const text = String(value || '').trim();
        return !!text && Number.isFinite(Date.parse(text));
    }

    /**
     * Build a session from a GGR_LoginStudent response. Requires ok:true and a
     * complete roster identity. Returns { ok, session, errors }.
     */
    function createSessionFromLogin(response = {}, options = {}) {
        if (!response || typeof response !== 'object' || response.ok !== true) {
            return { ok: false, session: null, errors: ['not_authenticated'] };
        }
        const validation = validateIdentity(response);
        if (!validation.ok) {
            return { ok: false, session: null, errors: validation.errors };
        }
        const authenticatedAt = isValidTimestamp(options.authenticatedAt)
            ? String(options.authenticatedAt).trim()
            : new Date().toISOString();
        return {
            ok: true,
            errors: [],
            session: {
                ok: true,
                source: SOURCE,
                schemaVersion: SCHEMA_VERSION,
                ...validation.identity,
                authenticatedAt
            }
        };
    }

    /**
     * Parse a stored session. Legacy (pre-roster), self-created, or incomplete
     * sessions return null.
     */
    function parseSession(raw) {
        let session = raw;
        if (typeof raw === 'string') {
            try {
                session = JSON.parse(raw);
            } catch (_) {
                return null;
            }
        }
        if (!session || typeof session !== 'object') return null;
        if (session.ok !== true || session.source !== SOURCE || Number(session.schemaVersion) !== SCHEMA_VERSION) {
            return null;
        }
        if (!isValidTimestamp(session.authenticatedAt)) return null;
        const validation = validateIdentity(session);
        if (!validation.ok) return null;
        return {
            ok: true,
            source: SOURCE,
            schemaVersion: SCHEMA_VERSION,
            ...validation.identity,
            authenticatedAt: String(session.authenticatedAt).trim()
        };
    }

    function resolveStorage(storage) {
        if (storage) return storage;
        try {
            return typeof localStorage !== 'undefined' ? localStorage : (globalObj.localStorage || null);
        } catch (_) {
            return null;
        }
    }

    function readSession(storage) {
        const store = resolveStorage(storage);
        if (!store) return null;
        try {
            return parseSession(store.getItem(STORAGE_KEY));
        } catch (_) {
            return null;
        }
    }

    /** True when something is stored under the session key but it is not a valid roster session. */
    function hasInvalidStoredSession(storage) {
        const store = resolveStorage(storage);
        if (!store) return false;
        try {
            const raw = store.getItem(STORAGE_KEY);
            return !!raw && !parseSession(raw);
        } catch (_) {
            return false;
        }
    }

    function writeSession(storage, session) {
        const store = resolveStorage(storage);
        const parsed = parseSession(session);
        if (!store || !parsed) return false;
        try {
            store.setItem(STORAGE_KEY, JSON.stringify(parsed));
            return true;
        } catch (_) {
            return false;
        }
    }

    function clearSession(storage) {
        const store = resolveStorage(storage);
        if (!store) return false;
        try {
            store.removeItem(STORAGE_KEY);
            return true;
        } catch (_) {
            return false;
        }
    }

    /** Case-insensitive match of a payload/record identity against the session. */
    function sessionMatches(session, identity = {}) {
        const parsed = parseSession(session);
        if (!parsed || !identity || typeof identity !== 'object') return false;
        const studentCode = String(identity.studentCode || '').trim().toUpperCase();
        const classCode = String(identity.classCode || '').trim().toUpperCase();
        return studentCode === parsed.studentCode.toUpperCase() && classCode === parsed.classCode;
    }

    function buildLoginUrl(loginPath, returnTo, baseHref) {
        const base = baseHref || returnTo || globalObj.location?.href || 'http://localhost/';
        const url = new URL(loginPath || 'index.html', base);
        url.searchParams.set('studentLogin', '1');
        if (returnTo) url.searchParams.set('returnTo', String(returnTo));
        return url.toString();
    }

    /**
     * Gameplay pages call this before anything else. Without a valid roster
     * session the student is sent to the home-page login, which returns them
     * to this page after GGR_LoginStudent succeeds.
     */
    function requireSessionOrRedirect(options = {}) {
        const storage = resolveStorage(options.storage);
        const session = readSession(storage);
        if (session) return session;
        if (hasInvalidStoredSession(storage)) clearSession(storage);
        const location = options.location || globalObj.location;
        if (location) {
            const target = buildLoginUrl(options.loginPath || '../../index.html', location.href, location.href);
            if (typeof location.replace === 'function') {
                location.replace(target);
            } else {
                location.href = target;
            }
        }
        return null;
    }

    const api = {
        STORAGE_KEY,
        SOURCE,
        SCHEMA_VERSION,
        ROSTER_LEVELS,
        PROGRESS_LEVELS,
        IDENTITY_FIELDS,
        normalizeStudentCode,
        normalizeClassCode,
        normalizeLevel,
        normalizeProgressLevel,
        validateIdentity,
        createSessionFromLogin,
        parseSession,
        readSession,
        hasInvalidStoredSession,
        writeSession,
        clearSession,
        sessionMatches,
        buildLoginUrl,
        requireSessionOrRedirect
    };

    globalObj.WA_GOLD_RUSH_STUDENT_SESSION = api;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})(typeof globalThis !== 'undefined' ? globalThis : window);
