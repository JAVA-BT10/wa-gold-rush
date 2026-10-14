(function initStudentAuthClient(globalObj) {
    function getErrorMessage(value, fallback = '') {
        const helper = globalObj.WA_GOLD_RUSH_POWER_AUTOMATE?.getErrorMessage
            || (typeof require === 'function' ? require('./power-automate-headers.js').getErrorMessage : null);
        return helper ? helper(value, fallback) : fallback;
    }

    async function hashPin(pin) {
        const normalized = String(pin || '').trim();
        if (!normalized) {
            throw new Error('PIN is required.');
        }

        let subtle = globalObj.crypto?.subtle;
        if (!subtle && typeof require === 'function') {
            try {
                subtle = require('crypto').webcrypto.subtle;
            } catch (_) {}
        }
        if (!subtle) {
            throw new Error('Secure PIN hashing is unavailable in this environment.');
        }

        const TextEncoderImpl = globalObj.TextEncoder || (typeof TextEncoder !== 'undefined' ? TextEncoder : null);
        if (!TextEncoderImpl) {
            throw new Error('TextEncoder is unavailable in this environment.');
        }
        const encoded = new TextEncoderImpl().encode(normalized);
        const digest = await subtle.digest('SHA-256', encoded);
        return Array.from(new Uint8Array(digest))
            .map((byte) => byte.toString(16).padStart(2, '0'))
            .join('');
    }

    function resolveSessionApi() {
        const api = globalObj.WA_GOLD_RUSH_STUDENT_SESSION;
        if (api && typeof api.validateIdentity === 'function') return api;
        if (typeof require === 'function') {
            try { return require('./student-session.js'); } catch (_) { return null; }
        }
        return null;
    }

    /**
     * Normalise a GGR_LoginStudent response. Identity fields are never
     * auto-filled from one another (e.g. leaderboardName is not defaulted to
     * studentCode); an incomplete or malformed roster record is reported via
     * identityValid=false / identityErrors.
     */
    function normalizeStudentLoginResponse(data = {}) {
        const source = data && typeof data === 'object' ? data : {};
        const sessionApi = resolveSessionApi();
        const validation = sessionApi
            ? sessionApi.validateIdentity(source)
            : { ok: false, identity: {}, errors: ['session_contract_unavailable'] };
        const assignedLevel = sessionApi ? sessionApi.normalizeLevel(source.assignedLevel) : null;
        return {
            ok: source.ok === true,
            studentCode: String(source.studentCode || '').trim(),
            leaderboardName: String(source.leaderboardName || '').trim(),
            studentId: String(source.studentId || '').trim(),
            studentName: String(source.studentName || '').trim(),
            classCode: String(source.classCode || '').trim().toUpperCase(),
            assignedLevel,
            identityValid: validation.ok,
            identityErrors: validation.errors,
            message: String(source.message || source.error || '').trim()
        };
    }

    /**
     * Authenticate against GGR_Students via GGR_LoginStudent. success is true
     * only when the flow returns ok:true AND a complete roster identity that
     * matches the class code / student ID the student entered.
     */
    async function loginStudent({ classCode, studentId, pin }, options = {}) {
        const callFlow = globalObj.WA_GOLD_RUSH_POWER_AUTOMATE?.callFlow;
        if (typeof callFlow !== 'function') {
            throw new Error('Power Automate flow helper is unavailable.');
        }

        const normalizedClassCode = String(classCode || '').trim().toUpperCase();
        const normalizedStudentId = String(studentId || '').trim();
        if (!normalizedClassCode || !normalizedStudentId || !String(pin || '').trim()) {
            throw new Error('Class code, student ID, and PIN are required.');
        }
        const payload = {
            classCode: normalizedClassCode,
            studentId: normalizedStudentId,
            pinHash: await hashPin(pin)
        };

        const result = await callFlow('loginStudent', payload, {
            ...options,
            requireApiKey: true,
            cache: 'no-store'
        });
        const response = normalizeStudentLoginResponse(result.data || {});
        const authenticated = result.success === true && response.ok;
        const matchesRequest = response.classCode === payload.classCode
            && response.studentId.toUpperCase() === payload.studentId.toUpperCase();
        let error = '';
        if (!authenticated) {
            error = response.message || result.error || 'Sign-in failed. Check your class code, student ID, and PIN.';
        } else if (!response.identityValid) {
            error = `Your class roster record is incomplete (${response.identityErrors.join(', ')}). Ask your teacher to check your entry in GGR_Students.`;
        } else if (!matchesRequest) {
            error = 'The roster record returned does not match the class code and student ID entered. Ask your teacher for help.';
        }
        return {
            success: authenticated && response.identityValid && matchesRequest,
            status: result.status,
            response,
            error
        };
    }

    async function changeStudentPin({ classCode, studentId, oldPin, newPin, firstTimeSetup = false }, options = {}) {
        const callFlow = globalObj.WA_GOLD_RUSH_POWER_AUTOMATE?.callFlow;
        if (typeof callFlow !== 'function') {
            throw new Error('Power Automate flow helper is unavailable.');
        }
        const normalizedClassCode = String(classCode || '').trim().toUpperCase();
        const normalizedStudentId = String(studentId || '').trim();
        const normalizedOldPin = String(oldPin || '').trim();
        const payload = {
            classCode: normalizedClassCode,
            studentId: normalizedStudentId,
            newPinHash: await hashPin(newPin)
        };
        if (!normalizedClassCode || !normalizedStudentId || !payload.newPinHash) {
            throw new Error('Class code, student ID, and new PIN are required.');
        }
        if (!firstTimeSetup) {
            if (!normalizedOldPin) {
                throw new Error('Class code, student ID, old PIN, and new PIN are required.');
            }
            payload.oldPinHash = await hashPin(normalizedOldPin);
        } else {
            payload.firstTimeSetup = true;
        }
        const result = await callFlow('changeStudentPin', payload, {
            ...options,
            requireApiKey: true,
            cache: 'no-store'
        });
        const success = result.success === true && result.data?.ok === true;
        return {
            success,
            status: result.status,
            response: result.data || null,
            error: success ? '' : getErrorMessage(result.error)
                || getErrorMessage(result.data, 'PIN update was not confirmed. Ask your teacher for help before trying again.')
        };
    }

    globalObj.WA_GOLD_RUSH_STUDENT_AUTH = globalObj.WA_GOLD_RUSH_STUDENT_AUTH || {};
    globalObj.WA_GOLD_RUSH_STUDENT_AUTH.hashPin = hashPin;
    globalObj.WA_GOLD_RUSH_STUDENT_AUTH.loginStudent = loginStudent;
    globalObj.WA_GOLD_RUSH_STUDENT_AUTH.changeStudentPin = changeStudentPin;
    globalObj.WA_GOLD_RUSH_STUDENT_AUTH.normalizeStudentLoginResponse = normalizeStudentLoginResponse;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            hashPin,
            loginStudent,
            changeStudentPin,
            normalizeStudentLoginResponse
        };
    }
})(typeof globalThis !== 'undefined' ? globalThis : window);
