(function initStudentAuthClient(globalObj) {
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

        const encoded = new TextEncoder().encode(normalized);
        const digest = await subtle.digest('SHA-256', encoded);
        return Array.from(new Uint8Array(digest))
            .map((byte) => byte.toString(16).padStart(2, '0'))
            .join('');
    }

    function normalizeStudentLoginResponse(data = {}) {
        return {
            ok: data.ok === true,
            studentCode: String(data.studentCode || '').trim(),
            leaderboardName: String(data.leaderboardName || '').trim(),
            studentId: String(data.studentId || '').trim(),
            studentName: String(data.studentName || '').trim(),
            classCode: String(data.classCode || '').trim().toUpperCase(),
            assignedLevel: Number(data.assignedLevel) || null,
            message: String(data.message || data.error || '').trim()
        };
    }

    async function loginStudent({ classCode, studentId, pin }, options = {}) {
        const callFlow = globalObj.WA_GOLD_RUSH_POWER_AUTOMATE?.callFlow;
        if (typeof callFlow !== 'function') {
            throw new Error('Power Automate flow helper is unavailable.');
        }

        const payload = {
            classCode: String(classCode || '').trim().toUpperCase(),
            studentId: String(studentId || '').trim(),
            pinHash: await hashPin(pin)
        };
        if (!payload.classCode || !payload.studentId || !payload.pinHash) {
            throw new Error('Class code, student ID, and PIN are required.');
        }

        const result = await callFlow('loginStudent', payload, {
            ...options,
            requireApiKey: true,
            cache: 'no-store'
        });
        const response = normalizeStudentLoginResponse(result.data || {});
        return {
            success: result.success && response.ok,
            status: result.status,
            response,
            error: result.error || response.message
        };
    }

    async function changeStudentPin({ classCode, studentId, oldPin, newPin }, options = {}) {
        const callFlow = globalObj.WA_GOLD_RUSH_POWER_AUTOMATE?.callFlow;
        if (typeof callFlow !== 'function') {
            throw new Error('Power Automate flow helper is unavailable.');
        }
        const payload = {
            classCode: String(classCode || '').trim().toUpperCase(),
            studentId: String(studentId || '').trim(),
            oldPinHash: await hashPin(oldPin),
            newPinHash: await hashPin(newPin)
        };
        if (!payload.classCode || !payload.studentId || !payload.oldPinHash || !payload.newPinHash) {
            throw new Error('Class code, student ID, old PIN, and new PIN are required.');
        }
        const result = await callFlow('changeStudentPin', payload, {
            ...options,
            requireApiKey: true,
            cache: 'no-store'
        });
        const responseOk = result.data?.ok === true || result.success === true;
        return {
            success: result.success && responseOk,
            status: result.status,
            response: result.data || null,
            error: result.error || String(result.data?.error || result.data?.message || '').trim()
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
