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
    addStudent(studentData) {
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
            level: studentData.level || 1,
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
        return student;
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
     * Returns { added, skipped }
     */
    bulkImportStudents(data, format = 'csv') {
        let rawStudents = [];

        if (format === 'csv') {
            const rows = this.parseCsvRows(data);
            if (!rows.length) return { added: [], skipped: [] };

            const headerRow = rows[0].fields.map(s => String(s || '').trim().toLowerCase());
            const isNewFormat = headerRow.includes('studentcode') || headerRow.includes('leaderboardname');
            const isHeader = isNaN(parseInt(headerRow[0], 10)) || isNewFormat;
            const dataRows = isHeader ? rows.slice(1) : rows;

            dataRows.forEach((row) => {
                const originalRow = row.rowNumber;
                const f = row.fields.map(s => String(s || '').trim());
                if (!f.some(Boolean)) return;

                if (isNewFormat) {
                    // New format: StudentCode,LeaderboardName,StudentID,StudentName,ClassCode,Level
                    const idx = (col) => {
                        const i = headerRow.indexOf(col);
                        return i >= 0 ? (f[i] || '') : '';
                    };
                    rawStudents.push({
                        _row: originalRow,
                        studentCode:     idx('studentcode'),
                        leaderboardName: idx('leaderboardname'),
                        studentId:       idx('studentid'),
                        studentName:     idx('studentname'),
                        classCode:       idx('classcode'),
                        level:           parseInt(idx('level'), 10) || 1
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
            if (!Array.isArray(parsed)) {
                throw new TypeError('JSON must be an array of student objects.');
            }
            rawStudents = parsed.map((item, idx) => {
                const parsedLevel = parseInt(item.level ?? item.Level ?? item.assignedLevel, 10);
                return {
                    _row: idx + 1,
                    studentCode:     (item.studentCode     || item.StudentCode     || '').toString().trim(),
                    leaderboardName: (item.leaderboardName || item.LeaderboardName || '').toString().trim(),
                    studentId:       (item.studentId       || item.StudentID       || item.email || '').toString().trim(),
                    studentName:     (item.studentName     || item.StudentName     || item.name  || '').toString().trim(),
                    classCode:       (item.classCode       || item.ClassCode       || '').toString().trim(),
                    level: (parsedLevel >= 1 && parsedLevel <= 6) ? parsedLevel : 1
                };
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
            added.push(this.addStudent(studentData));
        });

        return { added, skipped };
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

        const ALLOWED_ROLES = new Set(['teacher', 'admin', '']);
        const EMAIL_RE = /^[^\s@]+@[^\s@.][^\s@]*\.[^\s@]+$/;

        const added = [];
        const updated = [];
        const skipped = [];

        const getField = (fields, colName) => {
            const i = headerRow.indexOf(colName);
            return i >= 0 ? String(fields[i] || '').trim() : '';
        };

        const currentList = this._loadTeacherList();

        dataRows.forEach((row) => {
            const f = row.fields.map(s => String(s || '').trim());
            if (!f.some(Boolean)) return;

            const email     = getField(f, 'teacheremail').toLowerCase();
            const name      = getField(f, 'teachername');
            const classCode = getField(f, 'classcode');
            const role      = getField(f, 'role').toLowerCase();

            if (!email) {
                skipped.push({ row: row.rowNumber, reason: 'Missing TeacherEmail' });
                return;
            }
            if (!EMAIL_RE.test(email)) {
                skipped.push({ row: row.rowNumber, reason: `Invalid email: ${email}` });
                return;
            }
            if (!ALLOWED_ROLES.has(role)) {
                skipped.push({ row: row.rowNumber, reason: `Unknown role: ${role}` });
                return;
            }

            const existing = currentList.find(t => t.email === email);
            if (existing) {
                if (name)      existing.name      = name;
                if (classCode) existing.classCode = classCode;
                if (role)      existing.role      = role;
                existing.updatedAt = new Date().toISOString();
                updated.push(existing);
            } else {
                const entry = {
                    email,
                    name:      name || '',
                    classCode: classCode || '',
                    role:      role || 'teacher',
                    addedAt:   new Date().toISOString()
                };
                currentList.push(entry);
                added.push(entry);
            }
        });

        this._saveTeacherList(currentList);
        return { added, updated, skipped };
    }

    _loadTeacherList() {
        try {
            const raw = localStorage.getItem('wa_gold_rush_teacher_list');
            const arr = JSON.parse(raw);
            return Array.isArray(arr) ? arr : [];
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
            if (v) { student.studentCode = v; student.displayId = v; }
        }
        if (typeof updates.leaderboardName === 'string') {
            student.leaderboardName = updates.leaderboardName.trim();
        }
        if (typeof updates.name === 'string') {
            const v = updates.name.trim();
            if (!v) return { success: false, error: 'Name cannot be empty' };
            student.name = v; student.studentName = v;
        }
        if (typeof updates.studentName === 'string') {
            const v = updates.studentName.trim();
            if (!v) return { success: false, error: 'StudentName cannot be empty' };
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
            .filter(s => s.level === levelNum && s.gameState)
            .map(s => ({
                leaderboardName: s.leaderboardName || s.name || s.studentCode || 'Unknown',
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
