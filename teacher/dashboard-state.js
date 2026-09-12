/**
 * Teacher Dashboard — Student Management & Progress Tracking
 *
 * Auth model: teacher access is controlled via a simple passcode/allowlist in
 * localStorage. Microsoft 365 / MSAL dependencies have been removed.
 * The passcode approach is a lightweight stand-in until a full SharePoint/
 * Power Automate teacher-auth flow is implemented.
 */

// ============================================================================
// Teacher access control
// ============================================================================

/**
 * Set TEACHER_PASSCODE_MODE = true to require a passcode before the dashboard
 * shows (recommended for classroom use).  Set to false to open the dashboard
 * for anyone with the URL (useful during initial setup / localhost dev).
 */
const TEACHER_PASSCODE_MODE = false;

/**
 * Passcode required when TEACHER_PASSCODE_MODE = true.
 * Change this to a value known only to teachers before deploying.
 * Alternatively store it in localStorage key "wa_gold_rush_teacher_passcode"
 * so it is set per-device without editing code.
 */
const TEACHER_PASSCODE_STATIC = '';

class TeacherDashboard {
    constructor() {
        this.students = [];
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
        this.PASSCODE_STORAGE_KEY      = 'wa_gold_rush_teacher_passcode';
        this.TEACHER_ALLOWLIST_STORAGE_KEY = 'wa_gold_rush_teacher_allowlist';
    }

    // =========================================================================
    // Auth helpers
    // =========================================================================

    /**
     * Returns true if the passcode provided matches the configured passcode.
     * When TEACHER_PASSCODE_MODE is false, always returns true.
     */
    checkPasscode(entered) {
        if (!TEACHER_PASSCODE_MODE) return true;
        const expected = (
            localStorage.getItem(this.PASSCODE_STORAGE_KEY) || TEACHER_PASSCODE_STATIC
        ).trim();
        if (!expected) return false; // passcode mode enabled but no passcode configured
        return String(entered || '').trim() === expected;
    }

    hasTeacherSession() {
        if (!TEACHER_PASSCODE_MODE) return true;
        // Check if dashboard has been unlocked this session
        try {
            return sessionStorage.getItem('wa_gr_teacher_unlocked') === '1';
        } catch (_) { return false; }
    }

    unlockSession() {
        try { sessionStorage.setItem('wa_gr_teacher_unlocked', '1'); } catch (_) {}
    }

    isTempAllowlistMode() {
        // Legacy compatibility — kept so dashboard.html references still work
        return false;
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

        const deletedTeacher = teacherList.splice(index, 1)[0];
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
            return normalized;
        } catch (_) { return []; }
    }

    _saveTeacherList(list) {
        try {
            localStorage.setItem('wa_gold_rush_teacher_list', JSON.stringify(list));
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

        // Legacy + new field updates
        if (typeof updates.displayId === 'string') {
            const v = updates.displayId.trim();
            if (v) { student.displayId = v; student.studentCode = v; }
        }
        if (typeof updates.studentCode === 'string') {
            const v = updates.studentCode.trim();
            if (!v) return this.failureResult('Student Code cannot be empty');
            student.studentCode = v;
        }
        if (typeof updates.leaderboardName === 'string') {
            const v = updates.leaderboardName.trim();
            if (!v) return this.failureResult('Leaderboard Name cannot be empty');
            student.leaderboardName = v;
        }
        if (typeof updates.name === 'string') {
            const v = updates.name.trim();
            if (!v) return this.failureResult('Name cannot be empty');
            student.name = v; student.studentName = v;
        }
        if (typeof updates.studentName === 'string') {
            const v = updates.studentName.trim();
            if (!v) return this.failureResult('Student Name cannot be empty');
            student.studentName = v; student.name = v;
        }
        if (typeof updates.email === 'string') {
            student.email = updates.email.trim();
            student.studentId = updates.email.trim();
        }
        if (typeof updates.studentId === 'string') {
            student.studentId = updates.studentId.trim();
            student.email = updates.studentId.trim();
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
            this.saveToLocalStorage();
            return { success: true, message: `Deleted ${deleted.name || deleted.studentName}` };
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
        const incomingDisplayId = String(record.studentId || record.studentCode || '').trim();
        if (!incomingDisplayId) return null;

        let student = this.students.find(s =>
            String(s.studentCode || s.displayId || s.id || '')
                .trim().toLowerCase() === incomingDisplayId.toLowerCase()
        );

        if (!student) return null;

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
            assignedLevel:       record.gameState?.assignedLevel       ?? record.level ?? student.gameState.assignedLevel,
            checkpointStatus:    record.gameState?.checkpointStatus    ?? student.gameState.checkpointStatus,
            approvalStatus:      record.gameState?.approvalStatus      ?? student.gameState.approvalStatus,
            approverName:        record.gameState?.approverName        ?? student.gameState.approverName,
            approvalTimestamp:   record.gameState?.approvalTimestamp   ?? student.gameState.approvalTimestamp,
            quizScore:           record.gameState?.quizScore           ?? student.gameState.quizScore,
            quizAttempts:        record.gameState?.quizAttempts        ?? student.gameState.quizAttempts,
            progressionStateByLevel: record.gameState?.progressionStateByLevel ?? student.gameState.progressionStateByLevel,
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
