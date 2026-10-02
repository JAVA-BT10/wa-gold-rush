/**
 * Teacher Dashboard — Student Management & Progress Tracking
 *
 * Auth model: every teacher (including admins) is authenticated against the
 * published Power Automate teacher-login flow (GGR_Teachers list) and the
 * session is cached in sessionStorage for the current browser session only.
 *
 * Data model: Microsoft Lists → Power Automate → Teacher Dashboard.
 * Roster, teacher and progress data are hydrated only from GGR_GetDashboardData
 * and held in memory. Writes go through the upsert flows and are confirmed
 * before the dashboard re-hydrates. Browser storage is never treated as an
 * authoritative source for dashboard records.
 */

// ============================================================================
// Teacher access control
// ============================================================================

class TeacherDashboard {
    constructor() {
        this.students = [];
        this.teachers = [];
        this.gameConfig = null;
        this.classStats = {
            totalStudents: 0,
            averageNetWorth: 0,
            highestNetWorth: 0,
            wealthiestStudent: null,
            mostMinesOwned: 0,
            topMineOwner: null,
            averageRound: 0
        };

        this.TEACHER_DASHBOARD_KEY     = 'teacher_dashboard';
        this.TEACHER_SESSION_STORAGE_KEY = 'wa_gold_rush_teacher_session';
        // Flow-backed progress rows from GGR_GetDashboardData (in memory only).
        this.progress = [];
        this.lastHydration = null;
        this._hydrationListeners = [];
        this._dashboardHydrationInFlight = null;
        this._lastHydrationDiagnostics = {};
        this.dashboardDiagnosticsEnabled = globalThis.WA_GOLD_RUSH_DASHBOARD_DIAGNOSTICS === true;
    }

    // =========================================================================
    // Auth helpers
    // =========================================================================

    getFlowEndpoint(flowName) {
        const endpoints = globalThis.WA_GOLD_RUSH_DASHBOARD_CONFIG?.flowEndpoints
            || globalThis.WA_GOLD_RUSH_FLOW_ENDPOINTS;
        return String(endpoints?.[flowName] || '').trim();
    }

    redactEndpointForDiagnostics(endpoint) {
        const raw = String(endpoint || '').trim();
        if (!raw) return '';
        if (/REPLACE-WITH/i.test(raw)) return raw;
        try {
            const parsed = new URL(raw);
            return parsed.search
                ? `${parsed.origin}${parsed.pathname}?<redacted>`
                : `${parsed.origin}${parsed.pathname}`;
        } catch (_) {
            return raw.split('?')[0];
        }
    }

    maskEmailForDiagnostics(email) {
        const normalized = String(email || '').trim().toLowerCase();
        if (!normalized) return '';
        const [localPart = '', domain = ''] = normalized.split('@');
        if (!domain) return '***';
        const localPrefix = localPart ? `${localPart[0]}***` : '***';
        return `${localPrefix}@${domain}`;
    }

    getHydrationDiagnostics() {
        return { ...(this._lastHydrationDiagnostics || {}) };
    }

    setHydrationDiagnostics(updates = {}) {
        this._lastHydrationDiagnostics = {
            ...(this._lastHydrationDiagnostics || {}),
            ...updates,
            updatedAt: new Date().toISOString()
        };
        return this.getHydrationDiagnostics();
    }

    logHydrationDiagnostics(stage, diagnostics = {}) {
        if (!this.dashboardDiagnosticsEnabled) return;
        console.info(`[Dashboard Hydration] ${stage}`, diagnostics);
    }

    readDashboardApiKey() {
        const readApiKey = globalThis.WA_GOLD_RUSH_POWER_AUTOMATE?.getApiKey;
        return typeof readApiKey === 'function'
            ? String(readApiKey() || '').trim()
            : String(
                globalThis.WA_GOLD_RUSH_DASHBOARD_CONFIG?.apiKey
                || globalThis.WA_GOLD_RUSH_POWER_AUTOMATE_CONFIG?.apiKey
                || ''
            ).trim();
    }

    hasConfiguredFlowEndpoint(flowName) {
        const endpoint = this.getFlowEndpoint(flowName);
        return !!endpoint && !/REPLACE-WITH/i.test(endpoint);
    }

    buildFlowHeaders() {
        const buildHeaders = globalThis.WA_GOLD_RUSH_POWER_AUTOMATE?.buildHeaders;
        if (typeof buildHeaders === 'function') {
            return buildHeaders();
        }

        const headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        };
        const apiKey = String(globalThis.WA_GOLD_RUSH_DASHBOARD_CONFIG?.apiKey || '').trim();
        if (apiKey) headers['X-GGR-Key'] = apiKey;
        return headers;
    }

    async postFlowPayload(flowName, payload, options = {}) {
        const endpoint = this.getFlowEndpoint(flowName);
        if (!endpoint || /REPLACE-WITH/i.test(endpoint)) {
            const error = `Dashboard flow endpoint "${flowName}" is missing or not configured.`;
            console.warn(error);
            return { success: false, skipped: true, attempted: false, responseReceived: false, error };
        }

        const apiKey = this.readDashboardApiKey();
        if (!apiKey) {
            const error = 'Power Automate API key is required before authenticated dashboard flows can be sent.';
            console.warn(`[Dashboard] ${error}`);
            return { success: false, skipped: true, attempted: false, responseReceived: false, error };
        }

        const callFlow = globalThis.WA_GOLD_RUSH_POWER_AUTOMATE?.callFlow;
        if (typeof callFlow !== 'function') {
            return { success: false, attempted: false, responseReceived: false, error: 'Power Automate flow helper is unavailable.' };
        }

        const result = await callFlow(flowName, payload, {
            ...options,
            endpoints: {
                ...(options.endpoints || {}),
                [flowName]: endpoint
            },
            apiKey,
            requireApiKey: true,
            cache: 'no-store'
        });
        const attemptedResult = {
            ...result,
            attempted: true,
            responseReceived: typeof result?.status === 'number' && result.status >= 100 && result.status <= 599
        };
        if (!result.success) {
            console.warn(`Dashboard flow "${flowName}" failed.`, result.error || '');
            return attemptedResult;
        }
        if (result.data && Object.prototype.hasOwnProperty.call(result.data, 'ok') && result.data.ok === false) {
            return {
                success: false,
                attempted: true,
                responseReceived: true,
                status: result.status,
                data: result.data,
                error: String(result.data.message || result.data.error || 'Flow request was rejected.').trim()
            };
        }
        return attemptedResult;
    }

    buildStudentFlowPayload(student = {}) {
        const parsedLevel = parseInt(student.level ?? student.assignedLevel, 10);
        const teacherSession = this.getTeacherSession();
        return {
            studentCode: String(student.studentCode || student.displayId || '').trim(),
            studentId: String(student.studentId || student.email || '').trim(),
            studentName: String(student.studentName || student.name || '').trim(),
            leaderboardName: String(student.leaderboardName || student.name || '').trim(),
            classCode: String(student.classCode || '').trim(),
            Level: (parsedLevel >= 1 && parsedLevel <= 6) ? parsedLevel : 1,
            active: student.active !== false,
            teacherEmailPrimary: String(student.teacherEmailPrimary || teacherSession?.teacherEmail || '').trim().toLowerCase(),
            timestampUtc: new Date().toISOString()
        };
    }

    buildTeacherFlowPayload(teacher = {}) {
        const teacherEmail = String(teacher.email || teacher.teacherEmail || '').trim().toLowerCase();
        const teacherName = String(teacher.name || teacher.teacherName || '').trim();
        const role = String(teacher.role || 'teacher').trim().toLowerCase() || 'teacher';
        return {
            teacherEmail,
            teacherName,
            email: teacherEmail,
            name: teacherName,
            classCode: String(teacher.classCode || '').trim(),
            role
        };
    }

    async syncStudentToBackend(student, options = {}) {
        const payload = this.buildStudentFlowPayload(student);
        if (!payload.studentCode || !payload.leaderboardName || !payload.classCode) {
            return { success: false, skipped: true, error: 'Student payload is incomplete.' };
        }
        return this.postFlowPayload('upsertStudentProfile', payload, options);
    }

    async unlockStudentAccount(student = {}, options = {}) {
        const teacherSession = this.getTeacherSession();
        const studentCode = String(student.studentCode || student.displayId || '').trim();
        const classCode = String(student.classCode || '').trim().toUpperCase();
        if (!teacherSession?.teacherEmail) {
            return this.failureResult('Teacher session is required.');
        }
        if (!studentCode || !classCode) {
            return this.failureResult('Student code and class code are required.');
        }
        if (!this.canTeacherAccessClass(classCode)) {
            return this.failureResult('You are not authorized to unlock students in that class.');
        }
        const payload = {
            teacherEmail: String(teacherSession.teacherEmail || '').trim().toLowerCase(),
            studentCode,
            classCode,
            reason: String(options.reason || '').trim()
        };
        const result = await this.postFlowPayload('teacherUnlockStudent', payload, options);
        if (!result.success) {
            return this.failureResult(result.error || 'Unable to unlock this student.', { status: result.status });
        }
        return this.successResult({ response: result.data, status: result.status });
    }

    async deactivateStudentInBackend(student = {}, options = {}) {
        const payload = this.buildStudentFlowPayload({
            ...student,
            active: false
        });
        if (!payload.studentCode || !payload.classCode || !payload.leaderboardName) {
            return this.failureResult('Student payload is incomplete.');
        }
        if (!this.canTeacherAccessClass(payload.classCode)) {
            return this.failureResult('You are not authorized to deactivate that class record.');
        }
        const result = await this.postFlowPayload('upsertStudentProfile', payload, options);
        if (!result.success) {
            return this.failureResult(result.error || 'Unable to deactivate this student.', { status: result.status });
        }
        return this.successResult({ response: result.data, status: result.status });
    }

    extractDashboardHydrationPayload(payload = {}) {
        const isObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
        if (!isObject(payload)) return {};

        const dataPayload = isObject(payload.data) ? payload.data : payload;
        const bodyPayload = isObject(dataPayload.body) ? dataPayload.body : dataPayload;
        return bodyPayload;
    }

    normalizeStudentCodeKey(value) {
        return String(value || '').trim().toUpperCase();
    }

    normalizeDashboardStudentIdentity(record = {}) {
        // StudentCode is the canonical identity; StudentID is a fallback only.
        const studentCode = String(record?.studentCode || record?.StudentCode || record?.displayId || '').trim();
        const studentId = String(record?.studentId || record?.StudentID || record?.StudentId || record?.email || '').trim();
        return {
            studentCode,
            studentId,
            studentCodeKey: this.normalizeStudentCodeKey(studentCode),
            studentIdKey: studentId.toLowerCase(),
            identityKey: String(studentCode || studentId || '').trim().toLowerCase()
        };
    }

    readListValue(value) {
        if (value && typeof value === 'object' && !Array.isArray(value) && 'Value' in value) {
            return value.Value;
        }
        return value;
    }

    readListText(record, keys = []) {
        for (const key of keys) {
            const value = this.readListValue(record?.[key]);
            if (value !== undefined && value !== null && String(value).trim() !== '') {
                return String(value).trim();
            }
        }
        return '';
    }

    readDashboardArray(source = {}, keys = []) {
        for (const key of keys) {
            const value = source?.[key];
            if (Array.isArray(value)) return value;
            if (value && typeof value === 'object' && Array.isArray(value.value)) return value.value;
        }
        return null;
    }

    getDashboardArrayKeys() {
        return {
            students: ['students', 'Students', 'studentRoster', 'StudentRoster'],
            teachers: ['teachers', 'Teachers', 'teacherRoster', 'TeacherRoster'],
            progress: ['progress', 'Progress', 'studentProgress', 'StudentProgress']
        };
    }

    inspectDashboardHydrationPayload(payload = {}) {
        const source = this.extractDashboardHydrationPayload(payload);
        const keys = this.getDashboardArrayKeys();
        const present = {};
        const missingArrays = [];
        Object.keys(keys).forEach((name) => {
            present[name] = Array.isArray(this.readDashboardArray(source, keys[name]));
            if (!present[name]) missingArrays.push(name);
        });
        return {
            present,
            missingArrays,
            hasAnyArray: missingArrays.length < Object.keys(keys).length
        };
    }

    hasDashboardHydrationContract(payload = {}) {
        // Partial responses are accepted: any one of students/teachers/progress
        // is enough to hydrate. Missing arrays are treated as [] and reported.
        return this.inspectDashboardHydrationPayload(payload).hasAnyArray;
    }

    getProgressionSnapshotApi() {
        const globalApi = globalThis.WA_GOLD_RUSH_PROGRESS_SNAPSHOT;
        if (globalApi && typeof globalApi.extractCheckpointFields === 'function') return globalApi;
        if (typeof require === 'function') {
            try { return require('../shared/progression-snapshot.js'); } catch (_) { return null; }
        }
        return null;
    }

    extractCheckpointFields(record = {}, level) {
        const api = this.getProgressionSnapshotApi();
        if (api) return api.extractCheckpointFields(record, level);
        return {
            checkpointStatus: null,
            quizScore: null,
            quizPassedAt: null,
            quizAttempts: [],
            approvalStatus: null,
            approverName: null,
            approvalTimestamp: null,
            progressionStateByLevel: {}
        };
    }

    normalizeDashboardTeacher(teacher = {}) {
        const email = this.readListText(teacher, ['email', 'teacherEmail', 'TeacherEmail', 'Email']).toLowerCase();
        const name = this.readListText(teacher, ['name', 'teacherName', 'TeacherName', 'Title', 'DisplayName']);
        const classCode = this.readListText(teacher, ['classCode', 'ClassCode']).toUpperCase();
        const role = (this.readListText(teacher, ['role', 'Role']) || 'teacher').toLowerCase();
        const activeRaw = this.readListValue(teacher?.active ?? teacher?.Active ?? teacher?.IsActive);
        const active = !(activeRaw === false || /^(false|no|0|inactive)$/i.test(String(activeRaw ?? '').trim()));
        return {
            id: email,
            email,
            teacherEmail: email,
            name,
            teacherName: name,
            classCode,
            classCodes: classCode ? [classCode] : [],
            role,
            active
        };
    }

    normalizeDashboardStudent(student = {}) {
        const identity = this.normalizeDashboardStudentIdentity(student);
        const parsedLevel = parseInt(this.readListValue(student.level ?? student.Level ?? student.assignedLevel), 10);
        const activeRaw = this.readListValue(student?.active ?? student?.Active);
        return {
            ...student,
            studentCode: identity.studentCode,
            studentId: identity.studentId,
            studentCodeKey: identity.studentCodeKey,
            studentIdKey: identity.studentIdKey,
            leaderboardName: this.readListText(student, ['leaderboardName', 'LeaderboardName', 'studentName', 'StudentName', 'Title']),
            studentName: this.readListText(student, ['studentName', 'StudentName', 'name']),
            classCode: this.readListText(student, ['classCode', 'ClassCode']).toUpperCase(),
            level: (parsedLevel >= 1 && parsedLevel <= 6) ? parsedLevel : null,
            active: !(activeRaw === false || /^(false|no|0|inactive)$/i.test(String(activeRaw ?? '').trim()))
        };
    }

    normalizeDashboardProgress(record = {}) {
        const toFinite = (value) => {
            const unwrapped = this.readListValue(value);
            if (unwrapped === null || unwrapped === undefined || unwrapped === '') return undefined;
            const numeric = Number(unwrapped);
            return Number.isFinite(numeric) ? numeric : undefined;
        };
        const identity = this.normalizeDashboardStudentIdentity(record);
        const level = toFinite(record.level ?? record.Level ?? record.assignedLevel ?? record.AssignedLevel);
        const checkpoint = this.extractCheckpointFields(record, level);
        const optionalText = (keys) => this.readListText(record, keys) || undefined;
        return {
            ...record,
            ...checkpoint,
            studentCode: identity.studentCode,
            studentId: identity.studentId,
            studentCodeKey: identity.studentCodeKey,
            studentIdKey: identity.studentIdKey,
            classCode: String(
                this.readListText(record, ['classCode', 'ClassCode'])
                || record?.gameState?.classCode
                || ''
            ).trim().toUpperCase(),
            progressKey: optionalText(['progressKey', 'ProgressKey']),
            level,
            round: toFinite(record.round ?? record.Round ?? record.currentRound ?? record.CurrentRound),
            cash: toFinite(record.cash ?? record.Cash ?? record.currentCash ?? record.CurrentCash),
            netWorth: toFinite(record.netWorth ?? record.NetWorth),
            minesOwned: toFinite(record.minesOwned ?? record.MinesOwned ?? record.ownedMines ?? record.OwnedMines),
            machineryOwned: toFinite(record.machineryOwned ?? record.MachineryOwned ?? record.machinery ?? record.Machinery),
            totalProfitLoss: toFinite(record.totalProfitLoss ?? record.TotalProfitLoss),
            averageRoundProfit: toFinite(record.averageRoundProfit ?? record.AverageRoundProfit),
            strategyLabel: optionalText(['strategyLabel', 'StrategyLabel']),
            companyName: optionalText(['companyName', 'CompanyName']),
            investmentProfile: optionalText(['investmentProfile', 'InvestmentProfile']),
            updatedAt: optionalText([
                'updatedAt', 'UpdatedAt', 'lastPlayed', 'LastPlayed', 'LastPlayedUtc',
                'clientTimestampUtc', 'ClientTimestampUtc', 'Modified'
            ])
        };
    }

    normalizeDashboardHydrationPayload(payload = {}) {
        const source = this.extractDashboardHydrationPayload(payload);
        const keys = this.getDashboardArrayKeys();
        const inspection = this.inspectDashboardHydrationPayload(payload);
        const students = this.readDashboardArray(source, keys.students) || [];
        const teachers = this.readDashboardArray(source, keys.teachers) || [];
        const progress = this.readDashboardArray(source, keys.progress) || [];

        const teachersByEmail = new Map();
        teachers
            .filter(entry => entry && typeof entry === 'object')
            .map(entry => this.normalizeDashboardTeacher(entry))
            .forEach((teacher) => {
                if (!teacher.email) return;
                const existing = teachersByEmail.get(teacher.email);
                if (!existing) {
                    teachersByEmail.set(teacher.email, teacher);
                    return;
                }
                // One teacher may have several GGR_Teachers rows (one per class).
                const classCodes = Array.from(new Set([...existing.classCodes, ...teacher.classCodes]));
                teachersByEmail.set(teacher.email, {
                    ...existing,
                    name: existing.name || teacher.name,
                    teacherName: existing.teacherName || teacher.teacherName,
                    role: existing.role === 'admin' || teacher.role === 'admin' ? 'admin' : existing.role,
                    active: existing.active || teacher.active,
                    classCodes,
                    classCode: classCodes.join(', ')
                });
            });

        return {
            students: students
                .filter(entry => entry && typeof entry === 'object')
                .map(entry => this.normalizeDashboardStudent(entry)),
            teachers: Array.from(teachersByEmail.values()),
            progress: progress
                .filter(entry => entry && typeof entry === 'object')
                .map(entry => this.normalizeDashboardProgress(entry)),
            missingArrays: inspection.missingArrays
        };
    }

    selectLatestProgressRow(rows = []) {
        return [...rows].sort((a, b) => {
            const timeA = Date.parse(a.updatedAt || '') || 0;
            const timeB = Date.parse(b.updatedAt || '') || 0;
            if (timeA !== timeB) return timeB - timeA;
            return (Number(b.level) || 0) - (Number(a.level) || 0);
        })[0] || null;
    }

    buildCheckpointsByLevel(rows = []) {
        const checkpointsByLevel = {};
        [1, 2, 3, 4, 5, 6].forEach((level) => {
            const ordered = [
                ...rows.filter(row => Number(row.level) === level),
                ...rows.filter(row => Number(row.level) !== level)
            ];
            for (const row of ordered) {
                const fields = this.extractCheckpointFields(row, level);
                if (fields.checkpointStatus || fields.quizScore !== null || fields.quizAttempts.length) {
                    const { progressionStateByLevel, ...levelFields } = fields;
                    checkpointsByLevel[level] = { ...levelFields, level, sourceProgressKey: row.progressKey || '' };
                    break;
                }
            }
        });
        return checkpointsByLevel;
    }

    buildHydratedStudent(student, progressRows = []) {
        const studentCode = String(student.studentCode || '').trim();
        const latest = this.selectLatestProgressRow(progressRows);
        const level = student.level || Number(latest?.level) || 1;
        const checkpointsByLevel = this.buildCheckpointsByLevel(progressRows);
        const currentCheckpoint = checkpointsByLevel[Number(latest?.level) || level] || {};
        const pick = (value, fallback) => (value === undefined || value === null ? fallback : value);
        return {
            ...student,
            id: studentCode || student.studentId || this.generateStudentId(),
            displayId: studentCode,
            studentCode,
            name: student.studentName,
            email: student.studentId,
            level,
            progressRecords: progressRows,
            checkpointsByLevel,
            gameState: {
                round: pick(latest?.round, 1),
                cash: pick(latest?.cash, 200),
                netWorth: pick(latest?.netWorth, 300),
                ownedMines: pick(latest?.minesOwned, 1),
                machinery: pick(latest?.machineryOwned, 0),
                totalProfitLoss: pick(latest?.totalProfitLoss, 0),
                averageRoundProfit: latest?.averageRoundProfit,
                strategyLabel: latest?.strategyLabel,
                companyName: latest?.companyName,
                investmentProfile: latest?.investmentProfile,
                assignedLevel: pick(latest?.level, level),
                checkpointStatus: currentCheckpoint.checkpointStatus || null,
                quizScore: pick(currentCheckpoint.quizScore, null),
                quizPassedAt: currentCheckpoint.quizPassedAt || null,
                quizAttempts: currentCheckpoint.quizAttempts || [],
                approvalStatus: currentCheckpoint.approvalStatus || null,
                approverName: currentCheckpoint.approverName || null,
                approvalTimestamp: currentCheckpoint.approvalTimestamp || null,
                progressionStateByLevel: latest?.progressionStateByLevel || {},
                lastPlayed: latest?.updatedAt || null
            }
        };
    }

    hydrateDashboardFromNormalizedData(payload = {}, options = {}) {
        const normalized = this.normalizeDashboardHydrationPayload(payload);
        if (options.enabled !== true) {
            return this.successResult({
                skipped: true,
                reason: 'dashboard_hydration_adapter_disabled',
                data: normalized
            });
        }

        // Build in-memory state from the flow response only. No browser-storage
        // roster, teacher or progress data is merged in.
        const progressByCode = new Map();
        const progressById = new Map();
        normalized.progress.forEach((record) => {
            if (record.studentCodeKey) {
                if (!progressByCode.has(record.studentCodeKey)) progressByCode.set(record.studentCodeKey, []);
                progressByCode.get(record.studentCodeKey).push(record);
            } else if (record.studentIdKey) {
                if (!progressById.has(record.studentIdKey)) progressById.set(record.studentIdKey, []);
                progressById.get(record.studentIdKey).push(record);
            }
        });

        this.students = normalized.students.map((student) => {
            let rows = student.studentCodeKey ? (progressByCode.get(student.studentCodeKey) || []) : [];
            if (!rows.length && student.studentIdKey) {
                rows = progressById.get(student.studentIdKey) || [];
            }
            const classRows = student.classCode
                ? rows.filter(row => !row.classCode || row.classCode === student.classCode)
                : rows;
            return this.buildHydratedStudent(student, classRows.length ? classRows : rows);
        });
        this.teachers = normalized.teachers;
        this.progress = normalized.progress;
        this.calculateClassStats();

        return this.successResult({ data: normalized });
    }

    clearDashboardData() {
        this.students = [];
        this.teachers = [];
        this.progress = [];
        this.calculateClassStats();
    }

    onHydrated(listener) {
        if (typeof listener !== 'function') return () => {};
        this._hydrationListeners.push(listener);
        return () => {
            this._hydrationListeners = this._hydrationListeners.filter(entry => entry !== listener);
        };
    }

    _emitHydration(result) {
        this.lastHydration = result;
        this._hydrationListeners.forEach((listener) => {
            try {
                listener(result, this);
            } catch (error) {
                console.error('[Dashboard] Hydration listener failed:', error);
            }
        });
        return result;
    }

    getHydrationCounts() {
        return {
            students: this.students.length,
            teachers: this.teachers.length,
            progress: this.progress.length
        };
    }

    _hydrationFailure(reason, statusMessage, extra = {}) {
        // Fail closed: never leave stale roster data on screen after a failed read.
        this.clearDashboardData();
        const response = this.failureResult(extra.error || statusMessage, {
            source: 'flow',
            reason,
            retryable: true,
            statusTone: 'error',
            statusMessage,
            counts: this.getHydrationCounts(),
            missingArrays: extra.missingArrays || [],
            status: extra.status,
            diagnostics: this.setHydrationDiagnostics({
                hydrationFailed: true,
                failureReason: reason
            })
        });
        this.logHydrationDiagnostics('failed', response.diagnostics);
        return response;
    }

    async hydrateDashboardFromFlow(options = {}) {
        if (this._dashboardHydrationInFlight) {
            return this._dashboardHydrationInFlight;
        }

        const hydrationPromise = (async () => {
            const teacherSession = this.getTeacherSession();
            const teacherEmail = String(
                options.teacherEmail
                || teacherSession?.teacherEmail
                || ''
            ).trim().toLowerCase();
            const configuredEndpoint = this.getFlowEndpoint('getDashboardData');
            const resolveFlowEndpoint = globalThis.WA_GOLD_RUSH_POWER_AUTOMATE?.resolveFlowEndpoint;
            const runtimeEndpoint = typeof resolveFlowEndpoint === 'function'
                ? String(resolveFlowEndpoint('getDashboardData', { getDashboardData: configuredEndpoint }) || '').trim()
                : configuredEndpoint;
            const apiKey = this.readDashboardApiKey();
            const runtimeConfig = globalThis.WA_GOLD_RUSH_RUNTIME_CONFIG;
            const baseDiagnostics = this.setHydrationDiagnostics({
                startupReached: true,
                teacherSessionFound: !!teacherSession,
                teacherEmailMasked: this.maskEmailForDiagnostics(teacherEmail),
                teacherEmailPresent: !!teacherEmail,
                hasConfiguredFlowEndpoint: this.hasConfiguredFlowEndpoint('getDashboardData'),
                configuredGetDashboardDataUrl: this.redactEndpointForDiagnostics(configuredEndpoint),
                runtimeGetDashboardDataUrl: this.redactEndpointForDiagnostics(runtimeEndpoint),
                apiKeyPresent: !!apiKey,
                runtimeConfigLoaded: globalThis.WA_GOLD_RUSH_RUNTIME_CONFIG_SCRIPT_LOADED === true
                    || (!!runtimeConfig && typeof runtimeConfig === 'object'),
                runtimeConfigScriptLoaded: globalThis.WA_GOLD_RUSH_RUNTIME_CONFIG_SCRIPT_LOADED === true,
                flowRequestAttempted: false,
                flowResponseReceived: false,
                flowRequestSucceeded: false,
                hydrationFailed: false,
                failureReason: '',
                missingArrays: [],
                studentsReturned: null,
                teachersReturned: null,
                progressReturned: null
            });
            this.logHydrationDiagnostics('startup', baseDiagnostics);

            if (!teacherEmail) {
                return this._hydrationFailure(
                    'missing_teacher_session',
                    'Sign in to load dashboard data from Microsoft Lists.'
                );
            }

            const result = await this.postFlowPayload('getDashboardData', { teacherEmail }, options);
            this.setHydrationDiagnostics({
                flowRequestAttempted: result.attempted === true,
                flowResponseReceived: result.responseReceived === true,
                flowRequestSucceeded: result.success === true
            });
            this.logHydrationDiagnostics('flow-response', this.getHydrationDiagnostics());
            if (!result.success) {
                const reason = result.skipped ? 'flow_unavailable' : 'flow_failed';
                return this._hydrationFailure(
                    reason,
                    result.skipped
                        ? 'GGR_GetDashboardData is not configured, so no dashboard data can be loaded.'
                        : 'Could not load dashboard data from Microsoft Lists (GGR_GetDashboardData failed). No roster data is shown. Select Retry to try again.',
                    { error: result.error || '', status: result.status }
                );
            }

            const inspection = this.inspectDashboardHydrationPayload(result.data);
            if (!inspection.hasAnyArray) {
                return this._hydrationFailure(
                    'invalid_flow_payload',
                    'GGR_GetDashboardData responded without Students, Teachers or Progress arrays. No roster data is shown.',
                    { missingArrays: inspection.missingArrays, status: result.status }
                );
            }

            let hydrated = null;
            try {
                hydrated = this.hydrateDashboardFromNormalizedData(result.data, { enabled: true });
            } catch (error) {
                hydrated = this.failureResult(String(error?.message || 'Hydration failed.'));
            }
            if (!hydrated.success) {
                return this._hydrationFailure(
                    'hydrate_failed',
                    'Dashboard data from GGR_GetDashboardData could not be read. No roster data is shown.',
                    { error: hydrated.error, missingArrays: inspection.missingArrays, status: result.status }
                );
            }

            const counts = this.getHydrationCounts();
            const missingArrays = inspection.missingArrays;
            const summary = `Loaded from Microsoft Lists: ${counts.students} student${counts.students === 1 ? '' : 's'}, ${counts.teachers} teacher${counts.teachers === 1 ? '' : 's'}, ${counts.progress} progress record${counts.progress === 1 ? '' : 's'}.`;
            const response = this.successResult({
                source: 'flow',
                status: result.status,
                statusTone: missingArrays.length ? 'info' : 'success',
                statusMessage: missingArrays.length
                    ? `${summary} Flow response did not include: ${missingArrays.join(', ')}.`
                    : summary,
                counts,
                missingArrays,
                data: hydrated.data,
                diagnostics: this.setHydrationDiagnostics({
                    hydrationFailed: false,
                    failureReason: '',
                    missingArrays,
                    studentsReturned: counts.students,
                    teachersReturned: counts.teachers,
                    progressReturned: counts.progress
                })
            });
            this.logHydrationDiagnostics('completed', response.diagnostics);
            return response;
        })().then(result => this._emitHydration(result));

        this._dashboardHydrationInFlight = hydrationPromise;
        try {
            return await hydrationPromise;
        } finally {
            if (this._dashboardHydrationInFlight === hydrationPromise) {
                this._dashboardHydrationInFlight = null;
            }
        }
    }

    async rehydrateAfterWrite(options = {}) {
        // A read that started before the write may return pre-write data, so wait
        // for it and then read again from GGR_GetDashboardData.
        if (this._dashboardHydrationInFlight) {
            try { await this._dashboardHydrationInFlight; } catch (_) {}
        }
        const { teacherEmail, endpoints, fetch: customFetch } = options;
        return this.hydrateDashboardFromFlow({ teacherEmail, endpoints, fetch: customFetch });
    }

    async syncTeacherToBackend(teacher, options = {}) {
        const payload = this.buildTeacherFlowPayload(teacher);
        if (!payload.teacherEmail || !payload.teacherName) {
            return { success: false, skipped: true, error: 'Teacher payload is incomplete.' };
        }
        return this.postFlowPayload('upsertTeacher', payload, options);
    }

    async _postEachToFlow(flowName, payloads, options = {}) {
        const results = await Promise.all(payloads.map(payload =>
            this.postFlowPayload(flowName, payload, options)
                .catch(error => ({ success: false, error: String(error?.message || error || 'Flow request failed.') }))
        ));
        const succeeded = [];
        const failed = [];
        results.forEach((result, index) => {
            if (result?.success) succeeded.push(payloads[index]);
            else failed.push({ payload: payloads[index], error: result?.error || `${flowName} did not confirm the save.` });
        });
        return {
            success: failed.length === 0,
            count: payloads.length,
            succeeded,
            failed,
            fallback: flowName,
            error: failed.length ? `${failed.length} of ${payloads.length} record(s) were not saved: ${failed[0].error}` : ''
        };
    }

    async _postBulkToFlow(flowName, wrapperKey, payloads, options = {}) {
        const result = await this.postFlowPayload(flowName, { [wrapperKey]: payloads }, options);
        return {
            ...result,
            count: payloads.length,
            succeeded: result.success ? payloads : [],
            failed: result.success ? [] : payloads.map(payload => ({ payload, error: result.error || `${flowName} failed.` }))
        };
    }

    async syncStudentsToBackend(students = [], options = {}) {
        const payload = (Array.isArray(students) ? students : [])
            .map(student => this.buildStudentFlowPayload(student))
            .filter(student => student.studentCode && student.leaderboardName && student.classCode);
        if (!payload.length) {
            return { success: true, skipped: true, count: 0, succeeded: [], failed: [] };
        }

        if (this.hasConfiguredFlowEndpoint('bulkImportStudents')) {
            return this._postBulkToFlow('bulkImportStudents', 'students', payload, options);
        }

        return this._postEachToFlow('upsertStudentProfile', payload, options);
    }

    async syncTeachersToBackend(teachers = [], options = {}) {
        const payload = (Array.isArray(teachers) ? teachers : [])
            .map(teacher => this.buildTeacherFlowPayload(teacher))
            .filter(teacher => teacher.teacherEmail && teacher.teacherName);
        if (!payload.length) {
            return { success: true, skipped: true, count: 0, succeeded: [], failed: [] };
        }

        if (this.hasConfiguredFlowEndpoint('bulkImportTeachers')) {
            return this._postBulkToFlow('bulkImportTeachers', 'teachers', payload, options);
        }
        if (!this.hasConfiguredFlowEndpoint('upsertTeacher')) {
            console.warn('Dashboard teacher sync endpoints are not configured.');
            return {
                success: false,
                skipped: true,
                count: payload.length,
                succeeded: [],
                failed: payload.map(entry => ({ payload: entry, error: 'Teacher sync endpoints are not configured.' })),
                error: 'Teacher sync endpoints are not configured.'
            };
        }

        return this._postEachToFlow('upsertTeacher', payload, options);
    }

    normalizeClassCodeList(value) {
        if (Array.isArray(value)) {
            return value
                .map(entry => String(entry || '').trim().toUpperCase())
                .filter(Boolean);
        }

        return String(value || '')
            .split(/[,\n;]+/)
            .map(entry => entry.trim().toUpperCase())
            .filter(Boolean);
    }

    getTeacherSession() {
        try {
            const raw = sessionStorage.getItem(this.TEACHER_SESSION_STORAGE_KEY);
            if (!raw) return null;

            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object') return null;

            const teacherEmail = String(parsed.teacherEmail || '').trim().toLowerCase();
            const classCode = String(parsed.classCode || '').trim().toUpperCase();
            if (!parsed.ok || !teacherEmail || !classCode) return null;

            return {
                ok: true,
                teacherEmail,
                classCode,
                teacherName: String(parsed.teacherName || '').trim(),
                role: String(parsed.role || '').trim(),
                classCodes: this.normalizeClassCodeList(parsed.classCodes),
                authenticatedAt: String(parsed.authenticatedAt || '').trim()
            };
        } catch (_) {
            return null;
        }
    }

    hasTeacherSession() {
        return !!this.getTeacherSession();
    }

    saveTeacherSession(sessionData = {}) {
        const teacherEmail = String(sessionData.teacherEmail || '').trim().toLowerCase();
        const classCode = String(sessionData.classCode || '').trim().toUpperCase();
        if (!teacherEmail || !classCode) {
            return this.failureResult('Missing teacher session details.');
        }

        const session = {
            ok: true,
            teacherEmail,
            classCode,
            teacherName: String(sessionData.teacherName || '').trim(),
            role: String(sessionData.role || '').trim(),
            classCodes: this.normalizeClassCodeList(sessionData.classCodes),
            authenticatedAt: String(sessionData.authenticatedAt || new Date().toISOString()).trim()
        };

        try {
            sessionStorage.setItem(this.TEACHER_SESSION_STORAGE_KEY, JSON.stringify(session));
            return this.successResult({ session });
        } catch (_) {
            return this.failureResult('Unable to save the teacher session in this browser.');
        }
    }

    clearTeacherSession() {
        try {
            sessionStorage.removeItem(this.TEACHER_SESSION_STORAGE_KEY);
            return true;
        } catch (_) {
            return false;
        }
    }

    canTeacherAccessClass(classCode) {
        const session = this.getTeacherSession();
        if (!session) return false;
        if (session.role.toLowerCase() === 'admin') return true;

        const requestedClassCode = String(classCode || '').trim().toUpperCase();
        if (!requestedClassCode) return false;

        const allowedClassCodes = session.classCodes.length
            ? session.classCodes
            : [session.classCode];
        if (allowedClassCodes.includes('*')) return true;
        return allowedClassCodes.includes(requestedClassCode);
    }

    async authenticateTeacher(credentials = {}, options = {}) {
        const teacherEmail = String(credentials.teacherEmail || '').trim().toLowerCase();
        const classCode = String(credentials.classCode || '').trim();
        if (!teacherEmail || !classCode) {
            return this.failureResult('Teacher email and class code are required.');
        }

        // All teachers, including admins, authenticate against GGR_Teachers via
        // the loginTeacher flow. There is no client-side bypass.
        const result = await this.postFlowPayload('loginTeacher', { teacherEmail, classCode }, options);
        const payload = result.data;
        if (!result.success) {
            return this.failureResult(
                result.error || 'Could not reach teacher login. Check your connection and try again.'
            );
        }

        if (!payload || typeof payload !== 'object') {
            return this.failureResult('Teacher login returned an unreadable response. Please try again later.');
        }

        if (payload.ok !== true) {
            const denialMessage = String(
                payload?.error || payload?.message || ''
            ).trim();
            return this.failureResult(
                denialMessage || 'Teacher access denied. Check your email and class code and try again.'
            );
        }

        const normalizedClassCodes = this.normalizeClassCodeList(payload.classCodes ?? payload.ClassCodes);
        const primaryClassCode = this.normalizeClassCodeList([
            this.readListText(payload, ['classCode', 'ClassCode']) || normalizedClassCodes[0] || classCode
        ])[0] || '';

        const savedSession = this.saveTeacherSession({
            teacherEmail,
            classCode: primaryClassCode,
            teacherName: this.readListText(payload, ['teacherName', 'TeacherName']),
            role: this.readListText(payload, ['role', 'Role']).toLowerCase(),
            classCodes: normalizedClassCodes
        });

        if (!savedSession.success) {
            return savedSession;
        }

        return this.successResult({
            session: savedSession.session,
            response: payload
        });
    }

    // =========================================================================
    // Utility
    // =========================================================================

    toNumber(value, fallback = 0) {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : fallback;
    }

    successResult(data = {}) {
        return { success: true, ...data };
    }

    failureResult(error, data = {}) {
        return {
            success: false,
            error: String(error || 'Unable to complete this action.').trim() || 'Unable to complete this action.',
            ...data
        };
    }

    parseCsvRows(csvText) {
        const rows = [];
        const text = String(csvText || '');
        let row = [];
        let field = '';
        let inQuotes = false;
        let lineNumber = 1;
        let rowLineNumber = 1;

        for (let i = 0; i < text.length; i += 1) {
            const char = text[i];
            const nextChar = text[i + 1];

            if (char === '"') {
                if (inQuotes && nextChar === '"') {
                    field += '"';
                    i += 1;
                } else {
                    inQuotes = !inQuotes;
                }
                continue;
            }

            if (char === ',' && !inQuotes) {
                row.push(field);
                field = '';
                continue;
            }

            if ((char === '\n' || char === '\r') && !inQuotes) {
                row.push(field);
                rows.push({ rowNumber: rowLineNumber, fields: row });
                row = [];
                field = '';

                if (char === '\r' && nextChar === '\n') {
                    i += 1;
                }
                lineNumber += 1;
                rowLineNumber = lineNumber;
                continue;
            }

            field += char;
            if (char === '\n') lineNumber += 1;
        }

        row.push(field);
        const hasData = row.some(value => String(value || '').trim() !== '');
        if (hasData) rows.push({ rowNumber: rowLineNumber, fields: row });
        return rows;
    }

    normalizeTeacherImportRow(teacherData, options = {}) {
        const allowAdmin = options.allowAdmin !== false;
        const existingTeacher = options.allowPartialUpdates ? options.existingTeacher || null : null;
        const email = String(
            teacherData.teacherEmail || teacherData.TeacherEmail || teacherData.email || ''
        ).trim().toLowerCase();
        const teacherNameInput = String(
            teacherData.teacherName || teacherData.TeacherName || teacherData.name || ''
        ).trim();
        const classCodeInput = String(
            teacherData.classCode || teacherData.ClassCode || ''
        ).trim();
        const roleInput = String(
            teacherData.role || teacherData.Role || ''
        ).trim().toLowerCase();
        const teacherName = String(
            teacherNameInput || existingTeacher?.name || ''
        ).trim();
        const classCode = String(
            classCodeInput || existingTeacher?.classCode || ''
        ).trim();
        const role = String(
            roleInput || existingTeacher?.role || ''
        ).trim().toLowerCase();

        const ALLOWED_ROLES = new Set(['teacher', 'admin']);
        const EMAIL_RE = /^[^\s@]+@[^\s@.][^\s@]*\.[^\s@]+$/;

        if (!email) return { success: false, error: 'Missing TeacherEmail' };
        if (!EMAIL_RE.test(email)) return { success: false, error: `Invalid TeacherEmail: ${email}` };
        if (!teacherName) return { success: false, error: 'Missing TeacherName' };
        if (!role) return { success: false, error: 'Missing Role' };
        if (!ALLOWED_ROLES.has(role)) return { success: false, error: `Unknown role: ${role}` };
        if (role !== 'admin' && !classCode) {
            return { success: false, error: 'Missing ClassCode for teacher role' };
        }
        if (!allowAdmin && role === 'admin') {
            return { success: false, error: 'Admin rows must be imported via Teacher Import' };
        }

        return {
            success: true,
            teacher: { email, name: teacherName, classCode, role }
        };
    }

    /**
     * Validate teacher rows against the flow-hydrated teacher list.
     * Nothing is persisted here — callers must send the returned rows to
     * GGR_UpsertTeacher (see importTeachers / importRoster) and re-hydrate.
     */
    importTeacherRows(rawTeachers, options = {}) {
        if (!Array.isArray(rawTeachers) || !rawTeachers.length) {
            return { added: [], updated: [], skipped: [] };
        }

        const added = [];
        const updated = [];
        const skipped = [];

        rawTeachers.forEach((row) => {
            const email = String(row.teacherEmail || row.TeacherEmail || row.email || '').trim().toLowerCase();
            const existing = this.getTeacher(email);
            const normalized = this.normalizeTeacherImportRow(row, { ...options, existingTeacher: existing });
            if (!normalized.success) {
                skipped.push({ row: row._row || '?', reason: normalized.error });
                return;
            }

            const teacher = normalized.teacher;
            const entry = {
                id: teacher.email,
                email: teacher.email,
                name: teacher.name,
                classCode: teacher.classCode,
                role: teacher.role
            };
            if (existing) updated.push(entry);
            else added.push(entry);
        });

        return { added, updated, skipped };
    }

    // =========================================================================
    // Config
    // =========================================================================

    async loadConfig(configPath = '../shared/game-config.json') {
        try {
            const response = await fetch(configPath);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            this.gameConfig = await response.json();
            return true;
        } catch (error) {
            console.error('Failed to load game config:', error);
            return false;
        }
    }

    // =========================================================================
    // Student management
    // =========================================================================

    /**
     * Validate and build a student record (not persisted).
     * Supports the extended SharePoint-aligned field set:
     *   StudentCode, LeaderboardName, StudentID, StudentName, ClassCode
     */
    prepareStudentRecord(studentData = {}) {
        const autoId = this.generateStudentId();

        // Legacy compat: map name→studentName, email→studentId if new fields absent
        const studentName = String(
            studentData.studentName || studentData.name || ''
        ).trim();
        const studentCode = String(
            studentData.studentCode || studentData.displayId || autoId
        ).trim() || autoId;
        const leaderboardName = String(
            studentData.leaderboardName || studentName || studentCode
        ).trim();
        const studentId = String(
            studentData.studentId || studentData.email || ''
        ).trim();
        const classCode = String(studentData.classCode || '').trim().toUpperCase();
        const parsedLevel = parseInt(studentData.level, 10);
        const level = (parsedLevel >= 1 && parsedLevel <= 6) ? parsedLevel : 2;

        if (!studentCode) {
            return this.failureResult('Student Code is required.');
        }
        if (!leaderboardName) {
            return this.failureResult('Leaderboard Name is required.');
        }
        if (!classCode) {
            return this.failureResult('Class Code is required.');
        }

        const student = {
            id: studentCode,
            // Legacy fields kept for roster rendering compatibility
            displayId:      studentCode,
            name:           studentName,
            email:          studentId,
            // New SharePoint-aligned fields
            studentCode,
            leaderboardName,
            studentId,
            studentName,
            classCode,
            level,
            active: true
        };

        return this.successResult({ student });
    }

    /**
     * Add a student via GGR_UpsertStudentProfile. Success is only reported once
     * the flow confirms the write; the dashboard then re-hydrates from
     * GGR_GetDashboardData.
     */
    async addStudent(studentData = {}, options = {}) {
        const prepared = this.prepareStudentRecord(studentData);
        if (!prepared.success) return prepared;

        const student = prepared.student;
        const result = await this.syncStudentToBackend(student, options);
        if (!result.success) {
            return this.failureResult(
                result.error || 'GGR_UpsertStudentProfile did not confirm the save.',
                { student, status: result.status }
            );
        }

        const hydration = await this.rehydrateAfterWrite(options);
        return this.successResult({ student, created: true, confirmed: true, hydration });
    }

    generateStudentId() {
        return 'STU' + Date.now() + Math.random().toString(36).slice(2, 11);
    }

    /**
     * Bulk import students from CSV or JSON.
     *
     * CSV header (accepted):
     *   StudentCode,LeaderboardName,StudentID,StudentName,ClassCode,Level
     *   — or legacy —
     *   name,email,level
     *
     * Also accepts teacher rows in mixed roster imports and returns
     * { added, skipped, teachers } where teachers is { added, updated, skipped }.
     *
     * This only parses and validates rows. Use importRoster() to save them
     * through the flows and confirm the result.
     */
    bulkImportStudents(data, format = 'csv') {
        let rawStudents = [];
        let rawTeachers = [];

        if (format === 'csv') {
            const rows = this.parseCsvRows(data);
            if (!rows.length) {
                return { added: [], skipped: [], teachers: { added: [], updated: [], skipped: [] } };
            }

            const headerRow = rows[0].fields.map(s => String(s || '').trim().toLowerCase());
            const isNewFormat = headerRow.includes('studentcode') || headerRow.includes('leaderboardname');
            const hasTeacherColumns = headerRow.includes('teacheremail');
            const isHeader = isNaN(parseInt(headerRow[0], 10)) || isNewFormat || hasTeacherColumns;
            const dataRows = isHeader ? rows.slice(1) : rows;
            const idx = (fields, col) => {
                const i = headerRow.indexOf(col);
                return i >= 0 ? (fields[i] || '') : '';
            };

            dataRows.forEach((row) => {
                const originalRow = row.rowNumber;
                const f = row.fields.map(s => String(s || '').trim());
                if (!f.some(Boolean)) return;

                const hasTeacherData = hasTeacherColumns && idx(f, 'teacheremail');
                if (hasTeacherData) {
                    rawTeachers.push({
                        _row: originalRow,
                        teacherEmail: idx(f, 'teacheremail'),
                        teacherName: idx(f, 'teachername'),
                        classCode: idx(f, 'classcode'),
                        role: idx(f, 'role')
                    });
                    return;
                }

                if (isNewFormat) {
                    // New format: StudentCode,LeaderboardName,StudentID,StudentName,ClassCode,Level
                    rawStudents.push({
                        _row: originalRow,
                        studentCode:     idx(f, 'studentcode'),
                        leaderboardName: idx(f, 'leaderboardname'),
                        studentId:       idx(f, 'studentid'),
                        studentName:     idx(f, 'studentname'),
                        classCode:       idx(f, 'classcode'),
                        level:           parseInt(idx(f, 'level'), 10) || 1
                    });
                } else {
                    // Legacy format: name,email,level
                    if (f.length < 3) {
                        rawStudents.push({ _row: originalRow, _skipReason: 'fewer than 3 fields' });
                        return;
                    }
                    const [name, email, levelRaw] = f;
                    const parsedLevel = parseInt(levelRaw, 10);
                    rawStudents.push({
                        _row: originalRow,
                        name,
                        email,
                        level: (parsedLevel >= 1 && parsedLevel <= 6) ? parsedLevel : 1
                    });
                }
            });

        } else if (format === 'json') {
            const parsed = JSON.parse(data);
            const items = Array.isArray(parsed) ? parsed : [parsed];
            items.forEach((item, idx) => {
                if (!item || typeof item !== 'object' || Array.isArray(item)) {
                    rawStudents.push({ _row: idx + 1, _skipReason: 'Row must be an object' });
                    return;
                }
                const hasTeacherFields = (
                    Object.prototype.hasOwnProperty.call(item, 'teacherEmail') ||
                    Object.prototype.hasOwnProperty.call(item, 'TeacherEmail')
                );
                if (hasTeacherFields) {
                    rawTeachers.push({
                        _row: idx + 1,
                        teacherEmail: item.teacherEmail || item.TeacherEmail || '',
                        teacherName: item.teacherName || item.TeacherName || '',
                        classCode: item.classCode || item.ClassCode || '',
                        role: item.role || item.Role || ''
                    });
                    return;
                }

                const parsedLevel = parseInt(item.level ?? item.Level ?? item.assignedLevel, 10);
                rawStudents.push({
                    _row: idx + 1,
                    studentCode:     (item.studentCode     || item.StudentCode     || '').toString().trim(),
                    leaderboardName: (item.leaderboardName || item.LeaderboardName || '').toString().trim(),
                    studentId:       (item.studentId       || item.StudentID       || item.email || '').toString().trim(),
                    studentName:     (item.studentName     || item.StudentName     || item.name  || '').toString().trim(),
                    classCode:       (item.classCode       || item.ClassCode       || '').toString().trim(),
                    level: (parsedLevel >= 1 && parsedLevel <= 6) ? parsedLevel : 1
                });
            });
        } else {
            throw new TypeError('Unsupported import format. Use csv or json.');
        }

        const added = [];
        const skipped = [];

        rawStudents.forEach(studentData => {
            if (studentData._skipReason) {
                skipped.push({ row: studentData._row || '?', reason: studentData._skipReason });
                return;
            }
            const identityKey = studentData.studentCode || studentData.name || studentData.studentName;
            if (!identityKey) {
                skipped.push({ row: studentData._row || '?', reason: 'Missing StudentCode or name' });
                return;
            }
            const result = this.prepareStudentRecord(studentData);
            if (!result.success) {
                skipped.push({ row: studentData._row || '?', reason: result.error });
                return;
            }
            added.push(result.student);
        });

        const teachers = this.importTeacherRows(rawTeachers, { allowAdmin: false });
        return { added, skipped, teachers };
    }

    /**
     * Bulk import teachers from CSV.
     * CSV header: TeacherEmail,TeacherName,ClassCode,Role
     * Returns { added, updated, skipped }
     */
    bulkImportTeachers(data) {
        const rows = this.parseCsvRows(data);
        if (!rows.length) return { added: [], updated: [], skipped: [] };

        const headerRow = rows[0].fields.map(s => String(s || '').trim().toLowerCase());
        const isHeader = headerRow.includes('teacheremail') || isNaN(parseInt(headerRow[0], 10));
        const dataRows = isHeader ? rows.slice(1) : rows;

        const getField = (fields, colName) => {
            const i = headerRow.indexOf(colName);
            return i >= 0 ? String(fields[i] || '').trim() : '';
        };

        const rawTeachers = [];

        dataRows.forEach((row) => {
            const f = row.fields.map(s => String(s || '').trim());
            if (!f.some(Boolean)) return;

            rawTeachers.push({
                _row: row.rowNumber,
                teacherEmail: getField(f, 'teacheremail'),
                teacherName: getField(f, 'teachername'),
                classCode: getField(f, 'classcode'),
                role: getField(f, 'role')
            });
        });
        return this.importTeacherRows(rawTeachers, { allowAdmin: true, allowPartialUpdates: true });
    }

    _summarizeSyncResult(syncResult = {}) {
        return {
            success: syncResult.success !== false,
            savedCount: Array.isArray(syncResult.succeeded) ? syncResult.succeeded.length : 0,
            failed: Array.isArray(syncResult.failed) ? syncResult.failed : [],
            error: syncResult.error || ''
        };
    }

    /**
     * Parse a mixed student/teacher roster, save rows through the flows and
     * re-hydrate. Only rows the flows confirm are reported as saved.
     */
    async importRoster(data, format = 'csv', options = {}) {
        const prepared = this.bulkImportStudents(data, format);
        const teacherRows = [...prepared.teachers.added, ...prepared.teachers.updated];
        const studentSync = this._summarizeSyncResult(
            prepared.added.length ? await this.syncStudentsToBackend(prepared.added, options) : {}
        );
        const teacherSync = this._summarizeSyncResult(
            teacherRows.length ? await this.syncTeachersToBackend(teacherRows, options) : {}
        );
        const hydration = (studentSync.savedCount + teacherSync.savedCount) > 0
            ? await this.rehydrateAfterWrite(options)
            : null;
        return {
            success: studentSync.success && teacherSync.success,
            prepared,
            students: studentSync,
            teachers: teacherSync,
            hydration
        };
    }

    async importTeachers(data, options = {}) {
        const prepared = this.bulkImportTeachers(data);
        const rows = [...prepared.added, ...prepared.updated];
        const teacherSync = this._summarizeSyncResult(
            rows.length ? await this.syncTeachersToBackend(rows, options) : {}
        );
        const hydration = teacherSync.savedCount > 0 ? await this.rehydrateAfterWrite(options) : null;
        return {
            success: teacherSync.success,
            prepared,
            teachers: teacherSync,
            hydration
        };
    }

    async addTeacher(email, name, classCode, role = 'teacher', options = {}) {
        const existingTeacher = this.getTeacher(email);
        const normalized = this.normalizeTeacherImportRow(
            { teacherEmail: email, teacherName: name, classCode, role },
            { allowAdmin: true, allowPartialUpdates: true, existingTeacher }
        );

        if (!normalized.success) {
            return normalized;
        }

        const teacher = { id: normalized.teacher.email, ...normalized.teacher };
        const result = await this.syncTeacherToBackend(teacher, options);
        if (!result.success) {
            return this.failureResult(
                result.error || 'GGR_UpsertTeacher did not confirm the save.',
                { teacher, status: result.status }
            );
        }

        const hydration = await this.rehydrateAfterWrite(options);
        return this.successResult({ teacher, updated: !!existingTeacher, confirmed: true, hydration });
    }

    getAllTeachers() {
        return Array.isArray(this.teachers) ? [...this.teachers] : [];
    }

    getTeacher(id) {
        const lookupKey = String(id || '').trim();
        if (!lookupKey) return null;
        const emailLookupKey = lookupKey.toLowerCase();
        return this.getAllTeachers().find((teacher) => {
            const teacherId = String(teacher.id || '').trim();
            return (
                teacherId === lookupKey ||
                teacherId.toLowerCase() === emailLookupKey ||
                teacher.email === emailLookupKey
            );
        }) || null;
    }

    deleteTeacher() {
        // There is no backend delete flow for GGR_Teachers. Removing a teacher
        // locally would only hide them on this device, so it is not supported.
        return this.failureResult(
            'Teachers are managed in the GGR_Teachers Microsoft List. Set the teacher row to inactive (or remove it) in the list, then refresh the dashboard.'
        );
    }

    getTeacherList() {
        return this.getAllTeachers();
    }

    // =========================================================================
    // Student CRUD
    // =========================================================================

    /**
     * Update a student via GGR_UpsertStudentProfile. In-memory data is only
     * refreshed from GGR_GetDashboardData after the flow confirms the save.
     */
    async updateStudent(studentId, updates = {}, options = {}) {
        const original = this.students.find(s => s.id === studentId);
        if (!original) return { success: false, error: 'Student not found' };
        const student = JSON.parse(JSON.stringify(original));

        const hasCodeUpdate = typeof updates.displayId === 'string' || typeof updates.studentCode === 'string';
        const hasNameUpdate = typeof updates.name === 'string' || typeof updates.studentName === 'string';
        const hasStudentIdUpdate = typeof updates.email === 'string' || typeof updates.studentId === 'string';

        let nextStudentCode = String(student.studentCode || student.displayId || '').trim();
        let nextStudentName = String(student.studentName || student.name || '').trim();
        let nextStudentId = String(student.studentId || student.email || '').trim();
        const currentStudentName = nextStudentName;
        const currentLeaderboardName = String(student.leaderboardName || '').trim();

        if (typeof updates.displayId === 'string') {
            const value = updates.displayId.trim();
            if (!value) return this.failureResult('Student Code cannot be empty');
            nextStudentCode = value;
        }
        if (typeof updates.studentCode === 'string') {
            const value = updates.studentCode.trim();
            if (!value) return this.failureResult('Student Code cannot be empty');
            nextStudentCode = value;
        }
        if (typeof updates.name === 'string') {
            const value = updates.name.trim();
            if (!value && currentStudentName) return this.failureResult('Student Name cannot be empty');
            nextStudentName = value;
        }
        if (typeof updates.studentName === 'string') {
            const value = updates.studentName.trim();
            if (!value && currentStudentName) return this.failureResult('Student Name cannot be empty');
            nextStudentName = value;
        }
        if (typeof updates.email === 'string') {
            nextStudentId = updates.email.trim();
        }
        if (typeof updates.studentId === 'string') {
            nextStudentId = updates.studentId.trim();
        }

        if (hasCodeUpdate && this.normalizeStudentCodeKey(nextStudentCode) !== this.normalizeStudentCodeKey(original.studentCode || original.displayId)) {
            // StudentCode is the canonical key in GGR_Students and GGR_StudentProgress.
            return this.failureResult('Student Code is the canonical Microsoft Lists key and cannot be changed here. Deactivate this student and add a new record instead.');
        }
        if (typeof updates.leaderboardName === 'string') {
            const value = updates.leaderboardName.trim();
            if (!value && currentLeaderboardName) {
                return this.failureResult('Leaderboard Name cannot be empty');
            }
            student.leaderboardName = value;
        }
        if (hasNameUpdate) {
            student.studentName = nextStudentName;
            student.name = nextStudentName;
        }
        if (hasStudentIdUpdate) {
            student.studentId = nextStudentId;
            student.email = nextStudentId;
        }
        if (typeof updates.classCode === 'string') {
            student.classCode = updates.classCode.trim().toUpperCase();
        }
        if (updates.level !== undefined) {
            const v = parseInt(updates.level, 10);
            student.level = (v >= 1 && v <= 6) ? v : student.level;
        }

        if (typeof updates.classCode === 'string' && !student.classCode) {
            return this.failureResult('Class Code is required.');
        }

        const result = await this.syncStudentToBackend(student, options);
        if (!result.success) {
            return this.failureResult(
                result.error || 'GGR_UpsertStudentProfile did not confirm the update.',
                { student: original, status: result.status }
            );
        }

        const hydration = await this.rehydrateAfterWrite(options);
        return { success: true, student, confirmed: true, hydration };
    }

    updateStudentProgress(studentId, gameStateData) {
        const student = this.students.find(s => s.id === studentId);
        if (student) {
            student.gameState = {
                ...student.gameState,
                ...gameStateData,
                lastPlayed: new Date().toISOString()
            };
            return true;
        }
        return false;
    }

    getStudent(studentId) {
        return this.students.find(s => s.id === studentId);
    }

    getAllStudents() {
        return this.students
            .map((student, index) => ({ student, index }))
            .sort((a, b) => {
                const diff = this.toNumber(b.student?.gameState?.netWorth) -
                             this.toNumber(a.student?.gameState?.netWorth);
                return diff !== 0 ? diff : a.index - b.index;
            })
            .map(e => e.student);
    }

    getStudentsByLevel(level) {
        return this.students.filter(s => s.level === level);
    }

    deleteStudent(studentId) {
        const index = this.students.findIndex(s => s.id === studentId);
        if (index !== -1) {
            const deleted = this.students.splice(index, 1)[0];
            return { success: true, message: `Removed ${deleted.name || deleted.studentName || deleted.studentCode} from this view` };
        }
        return { success: false, error: 'Student not found' };
    }

    // =========================================================================
    // Leaderboard — per level (1–6)
    // =========================================================================

    /**
     * Get level-specific leaderboard.
     * Returns { level, top20, allTimeRecord }
     */
    getLevelLeaderboard(level) {
        const levelNum = Number(level) || 0;
        const relevant = this.students
            .map(s => ({
                leaderboardName: s.leaderboardName || s.studentCode || 'Unknown',
                studentCode:     s.studentCode     || s.displayId || '',
                classCode:       s.classCode       || '',
                netWorth:        this.toNumber(s.gameState?.netWorth),
                round:           this.toNumber(s.gameState?.round),
                strategyLabel:   s.gameState?.strategyLabel || '',
                lastPlayed:      s.gameState?.lastPlayed || null
            }));

        const sorted = [...relevant].sort((a, b) => b.netWorth - a.netWorth);
        const top20 = sorted.slice(0, 20).map((entry, i) => ({ rank: i + 1, ...entry }));
        const allTimeRecord = sorted[0] || null;

        return { level: levelNum, top20, allTimeRecord };
    }

    /**
     * Get leaderboards for all levels 1–6.
     */
    getAllLevelLeaderboards() {
        return [1, 2, 3, 4, 5, 6].map(l => this.getLevelLeaderboard(l));
    }

    // =========================================================================
    // Stats
    // =========================================================================

    calculateClassStats() {
        if (this.students.length === 0) {
            this.classStats = {
                totalStudents: 0,
                averageNetWorth: 0,
                highestNetWorth: 0,
                wealthiestStudent: null,
                mostMinesOwned: 0,
                topMineOwner: null,
                averageRound: 0
            };
            return this.classStats;
        }

        const totalNetWorth = this.students.reduce(
            (sum, s) => sum + this.toNumber(s?.gameState?.netWorth), 0);
        const totalRounds = this.students.reduce(
            (sum, s) => sum + this.toNumber(s?.gameState?.round), 0);

        const sortedByNetWorth = [...this.students]
            .map((s, i) => ({ s, i }))
            .sort((a, b) => {
                const d = this.toNumber(b.s?.gameState?.netWorth) - this.toNumber(a.s?.gameState?.netWorth);
                return d !== 0 ? d : a.i - b.i;
            })
            .map(e => e.s);

        const sortedByMines = [...this.students]
            .map((s, i) => ({ s, i }))
            .sort((a, b) => {
                const d = this.toNumber(b.s?.gameState?.ownedMines) - this.toNumber(a.s?.gameState?.ownedMines);
                return d !== 0 ? d : a.i - b.i;
            })
            .map(e => e.s);

        this.classStats = {
            totalStudents: this.students.length,
            averageNetWorth: totalNetWorth / this.students.length,
            highestNetWorth: this.toNumber(sortedByNetWorth[0]?.gameState?.netWorth),
            wealthiestStudent: sortedByNetWorth[0],
            mostMinesOwned: this.toNumber(sortedByMines[0]?.gameState?.ownedMines),
            topMineOwner: sortedByMines[0],
            averageRound: totalRounds / this.students.length
        };

        return this.classStats;
    }

    getLeaderboard() {
        return this.getAllStudents().map((student, index) => ({ rank: index + 1, ...student }));
    }

    // =========================================================================
    // Sync from game records
    // =========================================================================

    syncFromPlayerRecord(record) {
        // StudentCode is canonical; StudentID is only used when no StudentCode is present.
        const identity = this.normalizeDashboardStudentIdentity(record);
        if (!identity.studentCodeKey && !identity.studentIdKey) return null;

        let student = null;
        if (identity.studentCodeKey) {
            student = this.students.find(s =>
                this.normalizeStudentCodeKey(s.studentCode || s.displayId) === identity.studentCodeKey
            );
        } else {
            student = this.students.find(s =>
                String(s.studentId || s.email || '').trim().toLowerCase() === identity.studentIdKey
            );
        }

        if (!student) return null;

        if (record.studentName) student.studentName = record.studentName;
        if (record.leaderboardName) student.leaderboardName = record.leaderboardName;
        if (record.companyName) student.companyName = record.companyName;
        if (record.level != null) student.level = record.level;

        const previous = student.gameState || {};
        const checkpoint = this.extractCheckpointFields(record, record.level);
        const pick = (value, fallback) => (value === undefined || value === null ? fallback : value);
        student.gameState = {
            ...previous,
            round:               pick(record.round, previous.round),
            cash:                pick(record.cash, previous.cash),
            netWorth:            pick(record.netWorth, previous.netWorth),
            ownedMines:          pick(record.minesOwned, previous.ownedMines),
            machinery:           pick(record.machineryOwned, previous.machinery),
            totalProfitLoss:     pick(record.totalProfitLoss, previous.totalProfitLoss),
            averageRoundProfit:  pick(record.averageRoundProfit, previous.averageRoundProfit),
            strategyLabel:       pick(record.strategyLabel, previous.strategyLabel),
            companyName:         pick(record.companyName, previous.companyName),
            investmentProfile:   pick(record.investmentProfile, previous.investmentProfile),
            assignedLevel:       pick(record.gameState?.assignedLevel, pick(record.level, previous.assignedLevel)),
            checkpointStatus:    pick(checkpoint.checkpointStatus, previous.checkpointStatus),
            quizScore:           pick(checkpoint.quizScore, previous.quizScore),
            quizPassedAt:        pick(checkpoint.quizPassedAt, previous.quizPassedAt),
            approvalStatus:      pick(checkpoint.approvalStatus, previous.approvalStatus),
            approverName:        pick(checkpoint.approverName, previous.approverName),
            approvalTimestamp:   pick(checkpoint.approvalTimestamp, previous.approvalTimestamp),
            quizAttempts:        checkpoint.quizAttempts.length ? checkpoint.quizAttempts : previous.quizAttempts,
            progressionStateByLevel: Object.keys(checkpoint.progressionStateByLevel || {}).length
                ? checkpoint.progressionStateByLevel
                : previous.progressionStateByLevel,
            lastPlayed:          record.updatedAt || new Date().toISOString()
        };
        return student;
    }

    // =========================================================================
    // Export
    // =========================================================================

    exportAsCSV() {
        const headers = [
            'Rank', 'LeaderboardName', 'StudentCode', 'StudentName', 'StudentID',
            'ClassCode', 'Level', 'Net Worth', 'Cash', 'Mines', 'Machinery', 'Round', 'Total P/L'
        ];
        const rows = this.getLeaderboard().map(student => [
            student.rank,
            student.leaderboardName || student.name || '',
            student.studentCode     || student.displayId || '',
            student.studentName     || student.name || '',
            student.studentId       || student.email || '',
            student.classCode       || '',
            student.level,
            this.toNumber(student.gameState?.netWorth).toFixed(2),
            this.toNumber(student.gameState?.cash).toFixed(2),
            this.toNumber(student.gameState?.ownedMines),
            this.toNumber(student.gameState?.machinery),
            this.toNumber(student.gameState?.round),
            this.toNumber(student.gameState?.totalProfitLoss).toFixed(2)
        ]);

        return [headers, ...rows]
            .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
            .join('\n');
    }

    // =========================================================================
    // Persistence
    // =========================================================================

    // Student-device mirror only (used by the game page). The Teacher Dashboard
    // page never reads or writes these keys as roster data.
    saveToLocalStorage() {
        try {
            localStorage.setItem(this.TEACHER_DASHBOARD_KEY, JSON.stringify({
                timestamp: new Date().toISOString(),
                students: this.students
            }));
            return true;
        } catch (error) {
            console.error('Failed to save to localStorage:', error);
            return false;
        }
    }

    loadFromLocalStorage() {
        try {
            const data = JSON.parse(localStorage.getItem(this.TEACHER_DASHBOARD_KEY));
            if (data && Array.isArray(data.students)) {
                this.students = data.students;
                return true;
            }
            return false;
        } catch (error) {
            console.error('Failed to load from localStorage:', error);
            return false;
        }
    }

    clearAll() {
        this.students = [];
        this.classStats = {
            totalStudents: 0, averageNetWorth: 0, highestNetWorth: 0,
            wealthiestStudent: null, mostMinesOwned: 0, topMineOwner: null, averageRound: 0
        };
        localStorage.removeItem(this.TEACHER_DASHBOARD_KEY);
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = TeacherDashboard;
}
