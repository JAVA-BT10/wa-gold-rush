/**
 * Teacher Dashboard — Student Management & Progress Tracking
 *
 * Auth model: teacher dashboard access is authenticated against the published
 * Power Automate teacher-login flow and cached in sessionStorage for the
 * current browser session.
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
        this.TEACHER_SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;
        this.PERMANENT_ADMIN_ENABLED = true;
        this.PERMANENT_ADMIN_ALLOWLIST = new Set(['ben.turner@education.wa.edu.au']);
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

    extractProgressionSnapshot(record = {}) {
        const raw = record?.gameState
            || record?.progressionSnapshot
            || record?.progressionMarkersJson
            || record?.ProgressionMarkersJson
            || record?.ProgressJson
            || '';
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
            return raw;
        }
        if (!raw || typeof raw !== 'string') {
            return null;
        }
        try {
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
        } catch (_) {
            return null;
        }
    }

    buildProgressFlowPayload(record = {}) {
        const snapshot = this.extractProgressionSnapshot(record) || {};
        const activeLevel = Number(snapshot.assignedLevel || record.level || snapshot.level) || 0;
        const activeState = snapshot.progressionStateByLevel?.[String(activeLevel)]
            || {};
        const latestQuizAttempt = Array.isArray(activeState.quizAttempts) && activeState.quizAttempts.length
            ? activeState.quizAttempts[activeState.quizAttempts.length - 1]
            : null;
        const checkpointStatus = activeState.checkpointStatus || snapshot.checkpointStatus || null;
        return {
            studentCode: String(record.studentCode || snapshot.player?.studentCode || '').trim(),
            classCode: String(record.classCode || snapshot.player?.classCode || snapshot.classCode || '').trim().toUpperCase(),
            level: activeLevel,
            currentRound: Number(record.round ?? snapshot.round ?? 1) || 1,
            currentCash: Number(record.cash ?? snapshot.cash ?? 0),
            currentAssets: Number(record.currentAssets ?? 0),
            netWorth: Number(record.netWorth ?? snapshot.netWorth ?? 0),
            score: Number(record.score ?? record.netWorth ?? snapshot.netWorth ?? 0),
            progressionMarkersJson: JSON.stringify(snapshot || {}),
            badgesJson: JSON.stringify(record.badges || []),
            achievementsCount: Array.isArray(activeState.quizAttempts) ? activeState.quizAttempts.length : 0,
            sessionStatus: String(record.sessionStatus || 'teacher_review').trim(),
            needsSupport: checkpointStatus === 'quiz_available' && latestQuizAttempt?.passed === false,
            supportReason: checkpointStatus === 'quiz_available' && latestQuizAttempt?.passed === false
                ? 'checkpoint_quiz_retry'
                : ''
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

    async syncProgressRecordToBackend(record, options = {}) {
        const payload = this.buildProgressFlowPayload(record);
        if (!payload.studentCode || !payload.classCode || !payload.level) {
            return this.failureResult('Progress payload is incomplete.');
        }
        const result = await this.postFlowPayload('saveProgress', payload, options);
        if (!result.success) {
            return this.failureResult(result.error || 'Unable to sync progress.', { status: result.status });
        }
        return this.successResult({ response: result.data, status: result.status });
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

    normalizeDashboardStudentIdentity(record = {}) {
        const studentCode = String(record?.studentCode || record?.StudentCode || record?.displayId || '').trim();
        const studentId = String(record?.studentId || record?.StudentID || record?.email || '').trim();
        const identity = String(studentCode || studentId || '').trim();
        return {
            studentCode: studentCode || studentId,
            studentId,
            identityKey: identity.toLowerCase()
        };
    }

    hasDashboardHydrationContract(payload = {}) {
        const source = this.extractDashboardHydrationPayload(payload);
        // Expected flow payload contract: arrays for students/teachers/progress.
        // PascalCase keys are accepted for SharePoint/Flow compatibility.
        const hasStudents = Array.isArray(source.students) || Array.isArray(source.Students);
        const hasTeachers = Array.isArray(source.teachers) || Array.isArray(source.Teachers);
        const hasProgress = Array.isArray(source.progress) || Array.isArray(source.Progress);
        return hasStudents && hasTeachers && hasProgress;
    }

    normalizeDashboardHydrationPayload(payload = {}) {
        const source = this.extractDashboardHydrationPayload(payload);
        const asArray = (value) => Array.isArray(value) ? value : [];
        const students = source.students ?? source.Students ?? source.studentRoster ?? source.StudentRoster;
        const teachers = source.teachers ?? source.Teachers ?? source.teacherRoster ?? source.TeacherRoster;
        const progress = source.progress ?? source.Progress ?? source.studentProgress ?? source.StudentProgress;
        return {
            students: asArray(students).map((student) => {
                const identity = this.normalizeDashboardStudentIdentity(student);
                return {
                    ...student,
                    studentCode: identity.studentCode,
                    studentId: identity.studentId || String(student?.studentId || student?.StudentID || student?.email || '').trim(),
                    classCode: String(student?.classCode || student?.ClassCode || '').trim().toUpperCase()
                };
            }),
            teachers: asArray(teachers).map((teacher) => ({
                ...teacher,
                email: String(teacher?.email || teacher?.teacherEmail || '').trim().toLowerCase(),
                classCode: String(teacher?.classCode || teacher?.ClassCode || '').trim().toUpperCase()
            })),
            progress: asArray(progress).map((entry) => {
                const identity = this.normalizeDashboardStudentIdentity(entry);
                const progressionSnapshot = this.extractProgressionSnapshot(entry);
                return {
                    ...entry,
                    studentCode: identity.studentCode,
                    studentId: identity.studentId || String(entry?.studentId || entry?.StudentID || '').trim(),
                    classCode: String(
                        entry?.classCode
                        || entry?.ClassCode
                        || entry?.gameState?.classCode
                        || ''
                    ).trim().toUpperCase(),
                    progressionSnapshot
                };
            })
        };
    }

    hydrateDashboardFromNormalizedData(payload = {}, options = {}) {
        if (options.enabled !== true) {
            return this.successResult({
                skipped: true,
                reason: 'dashboard_hydration_adapter_disabled',
                data: this.normalizeDashboardHydrationPayload(payload)
            });
        }
        const normalized = this.normalizeDashboardHydrationPayload(payload);
        const hydratedStudents = normalized.students.map((student) => {
            const identity = this.normalizeDashboardStudentIdentity(student);
            const studentCode = String(identity.studentCode || student.displayId || '').trim();
            const existing = this.students.find((entry) =>
                this.normalizeDashboardStudentIdentity(entry).identityKey === identity.identityKey
            );
            const parsedLevel = parseInt(student.level ?? student.Level ?? student.assignedLevel, 10);
            const level = (parsedLevel >= 1 && parsedLevel <= 6)
                ? parsedLevel
                : (existing?.level || 1);
            const now = new Date().toISOString();
            return {
                ...existing,
                ...student,
                id: String(existing?.id || student.id || this.generateStudentId()).trim(),
                displayId: studentCode || String(existing?.displayId || '').trim(),
                studentCode,
                leaderboardName: String(
                    student.leaderboardName || student.LeaderboardName || student.studentName || student.StudentName || existing?.leaderboardName || ''
                ).trim(),
                studentName: String(student.studentName || student.StudentName || student.name || existing?.studentName || '').trim(),
                name: String(student.studentName || student.StudentName || student.name || existing?.name || '').trim(),
                studentId: String(student.studentId || student.StudentID || student.email || existing?.studentId || '').trim(),
                email: String(student.studentId || student.StudentID || student.email || existing?.email || '').trim(),
                classCode: String(student.classCode || student.ClassCode || existing?.classCode || '').trim().toUpperCase(),
                level,
                assignedDate: existing?.assignedDate || student.assignedDate || now,
                createdAt: existing?.createdAt || student.createdAt || now,
                gameState: {
                    round: 1,
                    cash: 200,
                    netWorth: 300,
                    ownedMines: 1,
                    machinery: 0,
                    totalProfitLoss: 0,
                    lastPlayed: null,
                    ...(existing?.gameState || {})
                }
            };
        });

        this.students = hydratedStudents;
        const mappedProgressRecords = normalized.progress
            .map((record) => {
                const toFinite = (value) => {
                    const numeric = Number(value);
                    return Number.isFinite(numeric) ? numeric : undefined;
                };
                const identity = this.normalizeDashboardStudentIdentity(record);
                const normalizedStudentCode = String(identity.studentCode || '').trim();
                const existingStudent = this.students.find((entry) =>
                    this.normalizeDashboardStudentIdentity(entry).identityKey === identity.identityKey
                );
                return {
                    ...record,
                    studentCode: normalizedStudentCode,
                    studentId: String(identity.studentId || record.studentId || record.StudentID || '').trim(),
                    classCode: String(record.classCode || record.ClassCode || '').trim().toUpperCase(),
                    level: toFinite(record.level ?? record.Level ?? record.assignedLevel ?? record.AssignedLevel),
                    round: toFinite(record.round ?? record.Round ?? record.currentRound ?? record.CurrentRound),
                    cash: toFinite(record.cash ?? record.Cash ?? record.currentCash ?? record.CurrentCash),
                    netWorth: toFinite(record.netWorth ?? record.NetWorth),
                    minesOwned: toFinite(record.minesOwned ?? record.MinesOwned ?? record.ownedMines ?? record.OwnedMines),
                    machineryOwned: toFinite(record.machineryOwned ?? record.MachineryOwned ?? record.machinery ?? record.Machinery),
                    totalProfitLoss: toFinite(record.totalProfitLoss ?? record.TotalProfitLoss),
                    averageRoundProfit: toFinite(record.averageRoundProfit ?? record.AverageRoundProfit),
                    strategyLabel: String(record.strategyLabel || record.StrategyLabel || '').trim() || undefined,
                    companyName: String(record.companyName || record.CompanyName || '').trim() || undefined,
                    investmentProfile: String(record.investmentProfile || record.InvestmentProfile || '').trim() || undefined,
                    gameState: record.progressionSnapshot || this.extractProgressionSnapshot(record) || undefined,
                    updatedAt: (
                        record.updatedAt
                        || record.UpdatedAt
                        || record.progressionSnapshot?.savedAt
                        || record.lastPlayed
                        || record.LastPlayed
                        || existingStudent?.gameState?.lastPlayed
                        || undefined
                    )
                };
            })
        mappedProgressRecords.forEach(record => this.syncFromPlayerRecord(record));

        const existingTeachers = this._loadTeacherList();
        const teachersByEmail = new Map();
        existingTeachers.forEach((teacher) => {
            const email = String(teacher?.email || teacher?.id || '').trim().toLowerCase();
            if (!email) return;
            teachersByEmail.set(email, {
                ...teacher,
                id: String(teacher?.id || email).trim() || email,
                email
            });
        });
        normalized.teachers.forEach((teacher) => {
            const email = String(teacher?.email || teacher?.teacherEmail || '').trim().toLowerCase();
            if (!email) return;
            const existing = teachersByEmail.get(email) || {};
            teachersByEmail.set(email, {
                ...existing,
                ...teacher,
                id: String(existing.id || teacher.id || email).trim() || email,
                email,
                classCode: String(teacher.classCode || teacher.ClassCode || existing.classCode || '').trim().toUpperCase(),
                role: String(teacher.role || existing.role || 'teacher').trim().toLowerCase() || 'teacher'
            });
        });
        const mergedTeachers = Array.from(teachersByEmail.values());
        this.teachers = mergedTeachers;

        if (options.persist !== false) {
            this.saveToLocalStorage();
            this._saveTeacherList(mergedTeachers);
            try {
                localStorage.setItem('wa_gold_rush_class_records', JSON.stringify(mappedProgressRecords));
            } catch (_) {}
        }

        return this.successResult({
            data: {
                ...normalized,
                progress: mappedProgressRecords
            }
        });
    }

    async hydrateDashboardFromFlowWithFallback(options = {}) {
        if (this._dashboardHydrationInFlight) {
            return this._dashboardHydrationInFlight;
        }

        const hydrationPromise = (async () => {
            this.loadFromLocalStorage();
            const cachedTeachers = this._loadTeacherList();
            this.teachers = Array.isArray(cachedTeachers) ? [...cachedTeachers] : [];
            const cachedStudentsSnapshot = JSON.parse(JSON.stringify(this.students || []));
            const cachedTeachersSnapshot = JSON.parse(JSON.stringify(this.teachers || []));
            let cachedRecordsRaw = null;
            try {
                cachedRecordsRaw = localStorage.getItem('wa_gold_rush_class_records');
            } catch (_) {}

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
                fallbackTriggered: false,
                fallbackReason: '',
                studentsReturned: null
            });
            this.logHydrationDiagnostics('startup', baseDiagnostics);

            if (!teacherEmail) {
                const response = this.successResult({
                    source: 'local',
                    fallback: true,
                    reason: 'missing_teacher_session',
                    statusTone: 'info',
                    statusMessage: 'Using cached dashboard data.',
                    diagnostics: this.setHydrationDiagnostics({
                        fallbackTriggered: true,
                        fallbackReason: 'missing_teacher_session'
                    })
                });
                this.logHydrationDiagnostics('fallback', response.diagnostics);
                return response;
            }

            const result = await this.postFlowPayload('getDashboardData', { teacherEmail }, options);
            this.setHydrationDiagnostics({
                flowRequestAttempted: result.attempted === true,
                flowResponseReceived: result.responseReceived === true,
                flowRequestSucceeded: result.success === true
            });
            this.logHydrationDiagnostics('flow-response', this.getHydrationDiagnostics());
            if (!result.success) {
                const response = this.successResult({
                    source: 'local',
                    fallback: true,
                    reason: result.skipped ? 'flow_unavailable' : 'flow_failed',
                    statusTone: 'info',
                    statusMessage: 'Using cached dashboard data.',
                    error: result.error || '',
                    diagnostics: this.setHydrationDiagnostics({
                        fallbackTriggered: true,
                        fallbackReason: result.skipped ? 'flow_unavailable' : 'flow_failed'
                    })
                });
                this.logHydrationDiagnostics('fallback', response.diagnostics);
                return response;
            }

            if (!this.hasDashboardHydrationContract(result.data)) {
                const response = this.successResult({
                    source: 'local',
                    fallback: true,
                    reason: 'invalid_flow_payload',
                    statusTone: 'info',
                    statusMessage: 'Using cached dashboard data.',
                    diagnostics: this.setHydrationDiagnostics({
                        fallbackTriggered: true,
                        fallbackReason: 'invalid_flow_payload'
                    })
                });
                this.logHydrationDiagnostics('fallback', response.diagnostics);
                return response;
            }

            let hydrated = null;
            try {
                hydrated = this.hydrateDashboardFromNormalizedData(result.data, { enabled: true, persist: true });
            } catch (_) {
                hydrated = this.failureResult('Hydration failed.');
            }
            if (!hydrated.success) {
                this.students = cachedStudentsSnapshot;
                this.teachers = cachedTeachersSnapshot;
                this.saveToLocalStorage();
                this._saveTeacherList(cachedTeachersSnapshot);
                try {
                    if (cachedRecordsRaw == null) {
                        localStorage.removeItem('wa_gold_rush_class_records');
                    } else {
                        localStorage.setItem('wa_gold_rush_class_records', cachedRecordsRaw);
                    }
                } catch (_) {}
                const response = this.successResult({
                    source: 'local',
                    fallback: true,
                    reason: 'hydrate_failed',
                    statusTone: 'info',
                    statusMessage: 'Using cached dashboard data.',
                    diagnostics: this.setHydrationDiagnostics({
                        fallbackTriggered: true,
                        fallbackReason: 'hydrate_failed'
                    })
                });
                this.logHydrationDiagnostics('fallback', response.diagnostics);
                return response;
            }

            const response = this.successResult({
                source: 'flow',
                fallback: false,
                status: result.status,
                statusTone: 'success',
                statusMessage: 'Dashboard synced from SharePoint.',
                data: hydrated.data,
                diagnostics: this.setHydrationDiagnostics({
                    fallbackTriggered: false,
                    fallbackReason: '',
                    studentsReturned: Array.isArray(hydrated?.data?.students) ? hydrated.data.students.length : this.students.length
                })
            });
            this.logHydrationDiagnostics('completed', response.diagnostics);
            return response;
        })();

        this._dashboardHydrationInFlight = hydrationPromise;
        try {
            return await hydrationPromise;
        } finally {
            if (this._dashboardHydrationInFlight === hydrationPromise) {
                this._dashboardHydrationInFlight = null;
            }
        }
    }

    async syncTeacherToBackend(teacher, options = {}) {
        const payload = this.buildTeacherFlowPayload(teacher);
        if (!payload.teacherEmail || !payload.teacherName) {
            return { success: false, skipped: true, error: 'Teacher payload is incomplete.' };
        }
        return this.postFlowPayload('upsertTeacher', payload, options);
    }

    async syncStudentsToBackend(students = [], options = {}) {
        const payload = (Array.isArray(students) ? students : [])
            .map(student => this.buildStudentFlowPayload(student))
            .filter(student => student.studentCode && student.leaderboardName && student.classCode);
        if (!payload.length) {
            return { success: true, skipped: true, count: 0 };
        }

        if (this.hasConfiguredFlowEndpoint('bulkImportStudents')) {
            return this.postFlowPayload('bulkImportStudents', { students: payload }, options);
        }

        await Promise.all(payload.map(student => this.postFlowPayload('upsertStudentProfile', student, options)));
        return { success: true, count: payload.length, fallback: 'upsertStudentProfile' };
    }

    async syncTeachersToBackend(teachers = [], options = {}) {
        const payload = (Array.isArray(teachers) ? teachers : [])
            .map(teacher => this.buildTeacherFlowPayload(teacher))
            .filter(teacher => teacher.teacherEmail && teacher.teacherName);
        if (!payload.length) {
            return { success: true, skipped: true, count: 0 };
        }

        if (this.hasConfiguredFlowEndpoint('bulkImportTeachers')) {
            return this.postFlowPayload('bulkImportTeachers', { teachers: payload }, options);
        }
        if (!this.hasConfiguredFlowEndpoint('upsertTeacher')) {
            console.warn('Dashboard teacher sync endpoints are not configured.');
            return { success: false, skipped: true, error: 'Teacher sync endpoints are not configured.' };
        }

        await Promise.all(payload.map(teacher => this.postFlowPayload('upsertTeacher', teacher, options)));
        return { success: true, count: payload.length, fallback: 'upsertTeacher' };
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

    isTeacherAdmin() {
        const session = this.getTeacherSession();
        return String(session?.role || '').trim().toLowerCase() === 'admin';
    }

    isPermanentlyAuthorizedAdmin(email) {
        const normalized = String(email || '').trim().toLowerCase();
        return this.PERMANENT_ADMIN_ENABLED && this.PERMANENT_ADMIN_ALLOWLIST.has(normalized);
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

    isTeacherSessionStale(session = this.getTeacherSession()) {
        const authenticatedAt = Date.parse(String(session?.authenticatedAt || '').trim());
        if (!Number.isFinite(authenticatedAt)) return true;
        return (Date.now() - authenticatedAt) > this.TEACHER_SESSION_MAX_AGE_MS;
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

    canManageTeacherRecord(teacher = {}) {
        if (this.isTeacherAdmin()) return true;
        const role = String(teacher?.role || 'teacher').trim().toLowerCase() || 'teacher';
        if (role === 'admin') return false;
        return this.canTeacherAccessClass(teacher?.classCode);
    }

    async authenticateTeacher(credentials = {}, options = {}) {
        const teacherEmail = String(credentials.teacherEmail || '').trim().toLowerCase();
        const classCode = String(credentials.classCode || '').trim();
        if (!teacherEmail || !classCode) {
            return this.failureResult('Teacher email and class code are required.');
        }

        if (this.isPermanentlyAuthorizedAdmin(teacherEmail)) {
            const savedSession = this.saveTeacherSession({
                teacherEmail,
                classCode: String(classCode || '').trim().toUpperCase() || 'ADMIN',
                teacherName: 'Game Admin',
                role: 'admin',
                classCodes: ['*']
            });
            if (!savedSession.success) {
                return savedSession;
            }

            return this.successResult({
                session: savedSession.session,
                response: { ok: true, mode: 'permanent_admin_bypass' }
            });
        }

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

        const normalizedClassCodes = this.normalizeClassCodeList(payload.classCodes);
        const primaryClassCode = this.normalizeClassCodeList([
            payload.classCode || normalizedClassCodes[0] || classCode
        ])[0] || '';

        const savedSession = this.saveTeacherSession({
            teacherEmail,
            classCode: primaryClassCode,
            teacherName: payload.teacherName,
            role: payload.role,
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

    async revalidateTeacherSession(options = {}) {
        const session = this.getTeacherSession();
        if (!session) {
            return this.failureResult('Teacher session not found.');
        }
        if (!options.force && !this.isTeacherSessionStale(session)) {
            return this.successResult({ session, skipped: true });
        }
        if (this.isPermanentlyAuthorizedAdmin(session.teacherEmail)) {
            return this.successResult({ session, skipped: true });
        }
        if (!this.hasConfiguredFlowEndpoint('loginTeacher') || !this.readDashboardApiKey()) {
            return this.successResult({ session, skipped: true });
        }
        return this.authenticateTeacher({
            teacherEmail: session.teacherEmail,
            classCode: session.classCode
        }, options);
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

    importTeacherRows(rawTeachers, options = {}) {
        if (!Array.isArray(rawTeachers) || !rawTeachers.length) {
            return { added: [], updated: [], skipped: [] };
        }

        const currentList = this._loadTeacherList();
        const added = [];
        const updated = [];
        const skipped = [];

        rawTeachers.forEach((row) => {
            const existing = currentList.find(t => t.email === String(row.teacherEmail || row.TeacherEmail || row.email || '').trim().toLowerCase());
            const normalized = this.normalizeTeacherImportRow(row, { ...options, existingTeacher: existing });
            if (!normalized.success) {
                skipped.push({ row: row._row || '?', reason: normalized.error });
                return;
            }

            const teacher = normalized.teacher;
            if (!this.canManageTeacherRecord(teacher)) {
                skipped.push({ row: row._row || '?', reason: 'You are not authorized to manage that teacher record.' });
                return;
            }
            if (existing) {
                existing.name = teacher.name;
                existing.classCode = teacher.classCode;
                existing.role = teacher.role;
                existing.updatedAt = new Date().toISOString();
                updated.push(existing);
            } else {
                const entry = {
                    id: teacher.email,
                    email: teacher.email,
                    name: teacher.name,
                    classCode: teacher.classCode,
                    role: teacher.role,
                    addedAt: new Date().toISOString()
                };
                currentList.push(entry);
                added.push(entry);
            }
        });

        this._saveTeacherList(currentList);
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

    findStudentIdentityConflict(candidate = {}, excludedStudentId = '') {
        const candidateCode = String(candidate.studentCode || candidate.displayId || '').trim().toLowerCase();
        const candidateStudentId = String(candidate.studentId || candidate.email || '').trim().toLowerCase();
        const excludedId = String(excludedStudentId || '').trim();
        return this.students.find((student) => {
            if (excludedId && String(student.id || '').trim() === excludedId) {
                return false;
            }
            const studentCode = String(student.studentCode || student.displayId || '').trim().toLowerCase();
            const studentId = String(student.studentId || student.email || '').trim().toLowerCase();
            if (candidateCode && studentCode && candidateCode === studentCode) return true;
            if (candidateStudentId && studentId && candidateStudentId === studentId) return true;
            return false;
        }) || null;
    }

    /**
     * Add a new student.
     * Supports the extended SharePoint-aligned field set:
     *   StudentCode, LeaderboardName, StudentID, StudentName, ClassCode
     */
    addStudent(studentData = {}) {
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
        const classCode = String(studentData.classCode || '').trim();
        const parsedLevel = parseInt(studentData.level, 10);
        const level = (parsedLevel >= 1 && parsedLevel <= 6) ? parsedLevel : 2;

        if (!studentCode) {
            return this.failureResult('Student Code is required.');
        }
        if (!leaderboardName) {
            return this.failureResult('Leaderboard Name is required.');
        }
        const conflict = this.findStudentIdentityConflict({ studentCode, studentId });
        if (conflict) {
            return this.failureResult('A student with that Student Code or Student ID already exists.');
        }

        const student = {
            id: autoId,
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
            assignedDate: new Date().toISOString(),
            gameState: {
                round: 1,
                cash: 200,
                netWorth: 300,
                ownedMines: 1,
                machinery: 0,
                totalProfitLoss: 0,
                lastPlayed: null
            },
            createdAt: new Date().toISOString(),
            notes: ''
        };

        this.students.push(student);
        this.saveToLocalStorage();
        return this.successResult({ student, created: true });
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
            const result = this.addStudent(studentData);
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

    addTeacher(email, name, classCode, role = 'teacher') {
        const teacherList = this._loadTeacherList();
        const existingTeacher = teacherList.find(teacher => teacher.email === String(email || '').trim().toLowerCase());
        const normalized = this.normalizeTeacherImportRow(
            { teacherEmail: email, teacherName: name, classCode, role },
            { allowAdmin: true, allowPartialUpdates: true, existingTeacher }
        );

        if (!normalized.success) {
            return normalized;
        }

        const teacher = normalized.teacher;
        if (!this.canManageTeacherRecord(teacher)) {
            return this.failureResult('You are not authorized to manage that teacher record.');
        }
        if (existingTeacher) {
            existingTeacher.name = teacher.name;
            existingTeacher.classCode = teacher.classCode;
            existingTeacher.role = teacher.role;
            existingTeacher.updatedAt = new Date().toISOString();
            this._saveTeacherList(teacherList);
            return { success: true, teacher: existingTeacher, updated: true };
        }

        const entry = {
            id: teacher.email,
            email: teacher.email,
            name: teacher.name,
            classCode: teacher.classCode,
            role: teacher.role,
            addedAt: new Date().toISOString()
        };
        teacherList.push(entry);
        this._saveTeacherList(teacherList);
        return { success: true, teacher: entry, updated: false };
    }

    getAllTeachers() {
        if (Array.isArray(this.teachers) && this.teachers.length) {
            return [...this.teachers];
        }
        return this._loadTeacherList();
    }

    getTeacher(id) {
        const lookupKey = String(id || '').trim();
        if (!lookupKey) return null;
        const emailLookupKey = lookupKey.toLowerCase();
        return this._loadTeacherList().find((teacher) => {
            const teacherId = String(teacher.id || '').trim();
            return (
                teacherId === lookupKey ||
                teacherId.toLowerCase() === emailLookupKey ||
                teacher.email === emailLookupKey
            );
        }) || null;
    }

    deleteTeacher(id) {
        const lookupKey = String(id || '').trim();
        if (!lookupKey) return { success: false, error: 'Teacher not found' };
        const emailLookupKey = lookupKey.toLowerCase();

        const teacherList = this._loadTeacherList();
        const index = teacherList.findIndex((teacher) => {
            const teacherId = String(teacher.id || '').trim();
            return (
                teacherId === lookupKey ||
                teacherId.toLowerCase() === emailLookupKey ||
                teacher.email === emailLookupKey
            );
        });
        if (index === -1) return { success: false, error: 'Teacher not found' };

        const deletedTeacher = teacherList[index];
        const normalizedTeacher = {
            ...deletedTeacher,
            classCode: String(deletedTeacher?.classCode || deletedTeacher?.ClassCode || '').trim().toUpperCase(),
            role: String(deletedTeacher?.role || deletedTeacher?.Role || 'teacher').trim().toLowerCase() || 'teacher',
            email: String(deletedTeacher?.email || deletedTeacher?.teacherEmail || '').trim().toLowerCase()
        };
        if (!this.canManageTeacherRecord(normalizedTeacher)) {
            return { success: false, error: 'You are not authorized to delete that teacher record.' };
        }
        teacherList.splice(index, 1);
        this._saveTeacherList(teacherList);
        return { success: true, teacher: deletedTeacher };
    }

    _loadTeacherList() {
        try {
            const raw = localStorage.getItem('wa_gold_rush_teacher_list');
            const arr = JSON.parse(raw);
            if (!Array.isArray(arr)) return [];

            let changed = false;
            const normalized = arr
                .filter(item => item && typeof item === 'object')
                .map((teacher) => {
                    const legacyId = String(teacher.id || '').trim();
                    const email = String(teacher.email || legacyId || '').trim().toLowerCase();
                    const normalizedTeacher = {
                        ...teacher,
                        id: legacyId || email,
                        email,
                        name: String(teacher.name || '').trim(),
                        classCode: String(teacher.classCode || '').trim(),
                        role: String(teacher.role || 'teacher').trim().toLowerCase() || 'teacher'
                    };

                    if (
                        normalizedTeacher.id !== teacher.id ||
                        normalizedTeacher.email !== teacher.email ||
                        normalizedTeacher.name !== teacher.name ||
                        normalizedTeacher.classCode !== teacher.classCode ||
                        normalizedTeacher.role !== teacher.role
                    ) {
                        changed = true;
                    }

                    return normalizedTeacher;
                });

            if (normalized.length !== arr.length) {
                changed = true;
            }
            if (changed) {
                this._saveTeacherList(normalized);
            }
            this.teachers = normalized;
            return normalized;
        } catch (_) { return []; }
    }

    _saveTeacherList(list) {
        const safeList = Array.isArray(list) ? list : [];
        this.teachers = [...safeList];
        try {
            localStorage.setItem('wa_gold_rush_teacher_list', JSON.stringify(safeList));
        } catch (_) {}
    }

    getTeacherList() {
        return this._loadTeacherList();
    }

    // =========================================================================
    // Student CRUD
    // =========================================================================

    updateStudent(studentId, updates = {}) {
        const student = this.students.find(s => s.id === studentId);
        if (!student) return { success: false, error: 'Student not found' };

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
        const conflict = this.findStudentIdentityConflict({
            studentCode: nextStudentCode,
            studentId: nextStudentId
        }, studentId);
        if (conflict) {
            return this.failureResult('A student with that Student Code or Student ID already exists.');
        }

        if (hasCodeUpdate) {
            const previousStudentCode = String(student.studentCode || '').trim();
            const previousDisplayId = String(student.displayId || '').trim();
            student.studentCode = nextStudentCode;
            if (!previousDisplayId || previousDisplayId === previousStudentCode) {
                student.displayId = nextStudentCode;
            }
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
            student.classCode = updates.classCode.trim();
        }
        if (updates.level !== undefined) {
            const v = parseInt(updates.level, 10);
            student.level = (v >= 1 && v <= 6) ? v : student.level;
        }

        student.updatedAt = new Date().toISOString();
        this.saveToLocalStorage();
        return { success: true, student };
    }

    updateStudentProgress(studentId, gameStateData) {
        const student = this.students.find(s => s.id === studentId);
        if (student) {
            student.gameState = {
                ...student.gameState,
                ...gameStateData,
                lastPlayed: new Date().toISOString()
            };
            this.saveToLocalStorage();
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
            this.removeStudentArtifacts(deleted);
            this.saveToLocalStorage();
            return { success: true, student: deleted, message: `Deleted ${deleted.name || deleted.studentName}` };
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
            .filter(s => (Number(s.level) || 0) === levelNum)
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
        const incomingStudentCode = String(record.studentCode || '').trim().toLowerCase();
        const incomingStudentId = String(record.studentId || '').trim().toLowerCase();
        if (!incomingStudentCode && !incomingStudentId) return null;

        let student = null;
        if (incomingStudentCode) {
            student = this.students.find(s =>
                String(s.studentCode || s.displayId || s.id || '')
                    .trim().toLowerCase() === incomingStudentCode
            ) || null;
        }
        if (!student && incomingStudentId) {
            student = this.students.find(s =>
                String(s.studentId || s.email || '')
                    .trim().toLowerCase() === incomingStudentId
            ) || null;
        }

        if (!student) return null;

        const snapshot = this.extractProgressionSnapshot(record) || record.gameState || {};

        if (record.studentName) student.studentName = record.studentName;
        if (record.leaderboardName) student.leaderboardName = record.leaderboardName;
        if (record.companyName) student.companyName = record.companyName;
        if (record.level != null) student.level = record.level;

        student.gameState = {
            ...student.gameState,
            round:               record.round               ?? student.gameState.round,
            cash:                record.cash                ?? student.gameState.cash,
            netWorth:            record.netWorth            ?? student.gameState.netWorth,
            ownedMines:          record.minesOwned          ?? student.gameState.ownedMines,
            machinery:           record.machineryOwned      ?? student.gameState.machinery,
            totalProfitLoss:     record.totalProfitLoss     ?? student.gameState.totalProfitLoss,
            averageRoundProfit:  record.averageRoundProfit  ?? student.gameState.averageRoundProfit,
            strategyLabel:       record.strategyLabel       ?? student.gameState.strategyLabel,
            companyName:         record.companyName         ?? student.gameState.companyName,
            investmentProfile:   record.investmentProfile   ?? student.gameState.investmentProfile,
            assignedLevel:       snapshot.assignedLevel       ?? record.level ?? student.gameState.assignedLevel,
            checkpointStatus:    snapshot.checkpointStatus    ?? student.gameState.checkpointStatus,
            approvalStatus:      snapshot.approvalStatus      ?? student.gameState.approvalStatus,
            approverName:        snapshot.approverName        ?? student.gameState.approverName,
            approvalTimestamp:   snapshot.approvalTimestamp   ?? student.gameState.approvalTimestamp,
            quizScore:           snapshot.quizScore           ?? student.gameState.quizScore,
            quizAttempts:        snapshot.quizAttempts        ?? student.gameState.quizAttempts,
            progressionStateByLevel: snapshot.progressionStateByLevel ?? student.gameState.progressionStateByLevel,
            lastPlayed:          record.updatedAt || snapshot.savedAt || new Date().toISOString()
        };
        return student;
    }

    removeStudentArtifacts(student = {}) {
        const matches = (value) => {
            const candidate = String(value || '').trim().toLowerCase();
            if (!candidate) return false;
            const studentCode = String(student.studentCode || student.displayId || '').trim().toLowerCase();
            const studentId = String(student.studentId || student.email || '').trim().toLowerCase();
            return candidate === studentCode || candidate === studentId;
        };

        try {
            const records = JSON.parse(localStorage.getItem('wa_gold_rush_class_records'));
            if (Array.isArray(records)) {
                localStorage.setItem('wa_gold_rush_class_records', JSON.stringify(records.filter((record) => !matches(record.studentCode) && !matches(record.studentId))));
            }
        } catch (_) {}

        try {
            const raw = JSON.parse(localStorage.getItem('wa_gr_checkpoint_approvals'));
            if (raw && typeof raw === 'object') {
                Object.keys(raw).forEach((levelKey) => {
                    if (raw[levelKey] && typeof raw[levelKey] === 'object') {
                        Object.keys(raw[levelKey]).forEach((studentKey) => {
                            if (matches(studentKey)) delete raw[levelKey][studentKey];
                        });
                    }
                });
                localStorage.setItem('wa_gr_checkpoint_approvals', JSON.stringify(raw));
            }
        } catch (_) {}

        [1, 2, 3, 4, 5, 6].forEach((level) => {
            try {
                localStorage.removeItem(`wa_gr_progression_quiz_${student.studentCode || student.displayId}_level_${level}`);
            } catch (_) {}
        });

        ['level2_autosave', 'level1_autosave', 'level3_autosave', 'level4_autosave', 'level5_autosave'].forEach((key) => {
            try {
                const raw = JSON.parse(localStorage.getItem(key));
                const autosaveCode = raw?.gameState?.player?.studentCode || raw?.gameState?.player?.studentId || '';
                if (matches(autosaveCode)) {
                    localStorage.removeItem(key);
                }
            } catch (_) {}
        });
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
