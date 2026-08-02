/**
 * Teacher Dashboard - Student Management & Progress Tracking
 * Handles student data (v2 schema), level assignment, login credentials,
 * class statistics, and unified cross-level leaderboard.
 */

<<<<<<< HEAD
const STUDENTS_STORE_KEY  = 'wa_gold_rush_students_v2';
const TEACHER_LEGACY_KEY  = 'teacher_dashboard';
const MAX_USERNAME_LENGTH = 12;
=======
// =============================================================================
// ⚠️  TEMPORARY ALLOWLIST MODE — LOW SECURITY — TEMPORARY USE ONLY ⚠️
//
// Set TEMP_TEACHER_ALLOWLIST_MODE = true  → teachers in the allowlist below
//   (or in localStorage key "wa_gold_rush_teacher_allowlist") bypass M365 auth.
// Set TEMP_TEACHER_ALLOWLIST_MODE = false → only valid M365 teacher sessions
//   are accepted (normal production mode).
//
// HOW TO RE-ENABLE M365-ONLY AUTH (once Entra app registration is ready):
//   1. Set TEMP_TEACHER_ALLOWLIST_MODE = false in this file.
//   2. Deploy the change.
//   3. Teachers will sign in via Microsoft 365 on the home page as normal.
// =============================================================================

// ⚠️ LOW SECURITY / temporary use only — set to false once Entra is configured
const TEMP_TEACHER_ALLOWLIST_MODE = true;

// ---------------------------------------------------------------------------
// Static default allowlist — add teacher email/UPN strings here.
// Instructions for non-technical admins:
//   • Each entry must be the teacher's full UPN/email, e.g. "teacher@school.edu"
//   • Comparisons are case-insensitive and whitespace-trimmed.
//   • You can also set allowed emails at runtime via browser localStorage:
//       Key:   wa_gold_rush_teacher_allowlist
//       Value: comma- or newline-separated emails, e.g. "alice@school.edu,bob@school.edu"
//     Entries from localStorage are merged with the static list below.
// ---------------------------------------------------------------------------
const TEMP_TEACHER_ALLOWLIST_STATIC = [
    // Add teacher emails/UPNs below — one per line:
    // 'teacher@education.wa.edu.au',
    // 'anotherteacher@school.edu',
];
>>>>>>> origin/main

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

        // Auth/session constants aligned with index/dashboard pages
        this.M365_SESSION_KEY = 'wa_gold_rush_m365_session';
        this.STUDENT_SESSION_KEY = 'wa_gold_rush_student_session';
        this.TEACHER_DASHBOARD_KEY = 'teacher_dashboard';

        // localStorage key for runtime allowlist override/merge (comma or newline separated emails)
        this.TEACHER_ALLOWLIST_STORAGE_KEY = 'wa_gold_rush_teacher_allowlist';
    }

    /**
     * ===== AUTH HELPERS =====
     */
    getM365Session() {
        try {
            const session = JSON.parse(sessionStorage.getItem(this.M365_SESSION_KEY));
            return session && typeof session === 'object' ? session : null;
        } catch (error) {
            return null;
        }
    }

    getSignedInUpn() {
        const m365 = this.getM365Session();
        if (m365?.studentUpn) return String(m365.studentUpn).toLowerCase();

        // Compatibility fallback
        try {
            const legacy = JSON.parse(sessionStorage.getItem(this.STUDENT_SESSION_KEY));
            if (legacy?.studentUpn) return String(legacy.studentUpn).toLowerCase();
            if (legacy?.studentId && String(legacy.authProvider || '').toLowerCase() === 'm365') {
                return String(legacy.studentId).toLowerCase();
            }
        } catch (_) {}

        return null;
    }

    isLikelyTeacherUpn(upn) {
        if (!upn || typeof upn !== 'string') return false;
        // Staff accounts should be @education.wa.edu.au and not student subdomain
        return upn.endsWith('@education.wa.edu.au') && !upn.includes('@student.');
    }

    /**
     * Returns the merged teacher allowlist (static defaults + localStorage override/merge).
     * ⚠️ TEMPORARY ALLOWLIST MODE only — not used when TEMP_TEACHER_ALLOWLIST_MODE is false.
     *
     * To add teachers at runtime without editing code:
     *   Open browser DevTools → Application → Local Storage → set key
     *   "wa_gold_rush_teacher_allowlist" to comma- or newline-separated email list.
     */
    getTeacherAllowlist() {
        const list = new Set(
            TEMP_TEACHER_ALLOWLIST_STATIC.map(e => String(e || '').trim().toLowerCase()).filter(Boolean)
        );

        try {
            const raw = localStorage.getItem(this.TEACHER_ALLOWLIST_STORAGE_KEY);
            if (raw) {
                String(raw).split(/[\n,]+/).forEach(entry => {
                    const trimmed = entry.trim().toLowerCase();
                    if (trimmed) list.add(trimmed);
                });
            }
        } catch (_) {}

        return list;
    }

    /**
     * Returns true if the given UPN/email is in the teacher allowlist (case-insensitive).
     * ⚠️ TEMPORARY ALLOWLIST MODE only.
     */
    isInTeacherAllowlist(upn) {
        if (!upn || typeof upn !== 'string') return false;
        return this.getTeacherAllowlist().has(upn.trim().toLowerCase());
    }

    /**
     * Returns true if teacher access should be granted.
     *
     * Normal mode (TEMP_TEACHER_ALLOWLIST_MODE = false):
     *   Requires a valid M365 teacher session (existing behaviour).
     *
     * Temporary mode (TEMP_TEACHER_ALLOWLIST_MODE = true):  ⚠️ LOW SECURITY
     *   Also allows access when the signed-in identity (UPN read from session storage)
     *   is present in the teacher allowlist, OR when a UPN was entered manually and
     *   is in the allowlist (see dashboard.html prompt fallback).
     *   Falls back to normal M365 check so production accounts still work transparently.
     */
    hasTeacherSession(overrideUpn) {
        // Always try normal M365 path first — works regardless of mode
        const upn = overrideUpn || this.getSignedInUpn();
        if (this.isLikelyTeacherUpn(upn)) return true;

        // ⚠️ TEMPORARY ALLOWLIST MODE — LOW SECURITY
        if (TEMP_TEACHER_ALLOWLIST_MODE) {
            if (upn && this.isInTeacherAllowlist(upn)) return true;
        }

        return false;
    }

    /**
     * Returns true if temporary allowlist mode is currently active.
     * Useful for displaying appropriate UI messages.
     */
    isTempAllowlistMode() {
        return !!TEMP_TEACHER_ALLOWLIST_MODE;
    }

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
            if (char === '\n') {
                lineNumber += 1;
            }
        }

        row.push(field);
        const hasData = row.some(value => String(value || '').trim() !== '');
        if (hasData) {
            rows.push({ rowNumber: rowLineNumber, fields: row });
        }
        return rows;
    }

    // ─── Helpers ────────────────────────────────────────────────────────────────

    /**
     * Load game configuration
     */
    async loadConfig(configPath = '../shared/game-config.json') {
        try {
            const response = await fetch(configPath);
            this.gameConfig = await response.json();
            return true;
        } catch (error) {
            console.error('Failed to load game config:', error);
            return false;
        }
    }

    /**
     * Generate unique student ID
     */
    generateStudentId() {
        return 'STU' + Date.now() + Math.random().toString(36).slice(2, 11);
    }

    /**
     * Generate a username from a display name (lowercase, no spaces).
     * Appends a short suffix if the name is already taken.
     * @param {string} name
     * @param {string} [excludeId]  Student ID to exclude from collision check (for reset scenarios).
     * @returns {string}
     */
    generateUsername(name, excludeId) {
        const clean = (name || 'student')
            .toLowerCase()
            .replace(/[^a-z0-9]/g, '') || 'student';

        const base = clean.slice(0, MAX_USERNAME_LENGTH) || 'student';
        let candidate = base;
        let suffix = 1;

        while (this.students.some(s => s.username === candidate && s.id !== excludeId)) {
            const suf = String(suffix++);
            const headLen = Math.max(1, MAX_USERNAME_LENGTH - suf.length);
            candidate = base.slice(0, headLen) + suf;
        }

        return candidate;
    }

    /**
     * Generate a numeric PIN of the given length.
     * @param {number} [length=4]
     * @returns {string}
     */
    generatePin(length = 4) {
        const digits = '0123456789';
        let pin = '';
        for (let i = 0; i < length; i++) {
            pin += digits[Math.floor(Math.random() * digits.length)];
        }
        return pin;
    }

    // ─── Student CRUD ────────────────────────────────────────────────────────────

    /**
     * Add a new student with auto-generated credentials.
     * @param {object} studentData
     * @returns {object} The created student record
     */
    addStudent(studentData) {
        const now = new Date().toISOString();
        const autoId = this.generateStudentId();
        const rawDisplayId = (typeof studentData.displayId === 'string') ? studentData.displayId.trim() : '';
        const username = studentData.username || this.generateUsername(studentData.name);
        const pin      = studentData.pin      || this.generatePin(4);

        const student = {
            id:           autoId,
            displayId:    rawDisplayId || autoId,
            name:         studentData.name  || '',
            email:        studentData.email || '',
            username,
            pin,
            level:        Number(studentData.level) || 1,
            status:       studentData.status || 'active',
            notes:        studentData.notes  || '',
            assignedDate: now,
            createdAt:    now,
            updatedAt:    now,
            lastLoginAt:  null,
            gameState: {
                round: 1,
                cash: 200,
                netWorth: 300,
                ownedMines: 1,
                machinery: 0,
                totalProfitLoss: 0,
                lastPlayed: null
            }
        };

        this.students.push(student);
        this.saveToLocalStorage();
        return student;
    }

    /**
     * Edit an existing student's editable fields.
     * @param {string} studentId
     * @param {object} patch  Partial StudentAccount fields to update.
     * @returns {{ success: boolean, student?: object, error?: string }}
     */
    /**
     * Delete a student by ID.
     * @param {string} studentId
     * @returns {{ success: boolean, message?: string, error?: string }}
     */
    deleteStudent(studentId) {
        const index = this.students.findIndex(s => s.id === studentId);
        if (index !== -1) {
            const deleted = this.students.splice(index, 1)[0];
            this.saveToLocalStorage();
            return { success: true, message: `Deleted ${deleted.name}` };
        }
        return { success: false, error: 'Student not found' };
    }

    /**
     * Reset a student's login credentials (generates new username + pin).
     * @param {string} studentId
     * @returns {{ success: boolean, username?: string, pin?: string, error?: string }}
     */
    resetStudentLogin(studentId) {
        const student = this.students.find(s => s.id === studentId);
        if (!student) return { success: false, error: 'Student not found' };

        const newUsername = this.generateUsername(student.name, studentId);
        const newPin = this.generatePin(4);
        student.username   = newUsername;
        student.pin        = newPin;
        student.updatedAt  = new Date().toISOString();

        this.saveToLocalStorage();
        return { success: true, username: newUsername, pin: newPin };
    }

    /**
     * Return a summary of all student login credentials (for teacher view only).
     * @returns {Array<{ id, name, username, pin, level, status }>}
     */
    getAllStudentLogins() {
        return this.students
            .filter(s => s.status !== 'archived')
            .map(s => ({
                id:       s.id,
                name:     s.name,
                username: s.username,
                pin:      s.pin,
                level:    s.level,
                status:   s.status
            }));
    }

    // ─── Bulk Import ─────────────────────────────────────────────────────────────

    /**
     * Bulk import students from CSV or JSON.
     * @param {string} data
     * @param {'csv'|'json'} [format='csv']
     * @returns {{ added: object[], skipped: object[] }}
     */
    bulkImportStudents(data, format = 'csv') {
        let rawStudents = [];

        if (format === 'csv') {
            const rows = this.parseCsvRows(data);
            if (!rows.length) return { added: [], skipped: [] };

            const firstFields = rows[0].fields.map(s => String(s || '').trim());
            const firstLevelVal = firstFields.length >= 3 ? parseInt(firstFields[2], 10) : NaN;
            const firstLineIsHeader = isNaN(firstLevelVal) || firstLevelVal < 1 || firstLevelVal > 5;
            const dataRows = firstLineIsHeader ? rows.slice(1) : rows;

            dataRows.forEach((row) => {
                const originalRow = row.rowNumber;
                const fields = row.fields.map(s => String(s || '').trim());
                if (!fields.some(Boolean)) return;
                if (fields.length < 3) {
                    rawStudents.push({ _row: originalRow, _skipReason: 'fewer than 3 fields' });
                    return;
                }

                const [name, email, levelRaw] = fields;
                const parsedLevel = parseInt(levelRaw, 10);
                rawStudents.push({
                    _row: originalRow,
                    name,
                    email,
                    level: (parsedLevel >= 1 && parsedLevel <= 5) ? parsedLevel : 1
                });
            });
        } else if (format === 'json') {
            const parsed = JSON.parse(data);
            if (!Array.isArray(parsed)) {
                throw new TypeError('JSON must be an array of student objects, e.g. [{"name":"Alex","email":"","level":2}]');
            }

            rawStudents = parsed.map((item, idx) => {
                const parsedLevel = parseInt(item.level ?? item.Level ?? item.assignedLevel, 10);
                return {
                    _row: idx + 1,
                    name: (item.name ?? item.Name ?? item.studentName ?? item.student_name ?? '').toString().trim(),
                    email: (item.email ?? item.Email ?? '').toString().trim(),
                    level: (parsedLevel >= 1 && parsedLevel <= 5) ? parsedLevel : 1
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
            if (!studentData.name) {
                skipped.push({ row: studentData._row || '?', reason: 'Missing name' });
                return;
            }
            added.push(this.addStudent(studentData));
        });

        return { added, skipped };
    }

    // ─── Queries ─────────────────────────────────────────────────────────────────

    /**
     * Update student core fields
     */
    updateStudent(studentId, updates = {}) {
        const student = this.students.find(s => s.id === studentId);
        if (!student) {
            return { success: false, error: 'Student not found' };
        }

        if (typeof updates.displayId === 'string') {
            const nextDisplayId = updates.displayId.trim();
            if (nextDisplayId) student.displayId = nextDisplayId;
        }

        if (typeof updates.name === 'string') {
            const nextName = updates.name.trim();
            if (!nextName) return { success: false, error: 'Name cannot be empty' };
            student.name = nextName;
        }

        if (typeof updates.email === 'string') {
            student.email = updates.email.trim();
        }

        if (updates.level !== undefined) {
            const nextLevel = parseInt(updates.level, 10);
            student.level = (nextLevel >= 1 && nextLevel <= 5) ? nextLevel : student.level;
        }

        if (typeof updates.status === 'string') {
            student.status = updates.status;
        }

        if (typeof updates.notes === 'string') {
            student.notes = updates.notes;
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
            student.updatedAt = new Date().toISOString();
            this.saveToLocalStorage();
            return true;
        }
        return false;
    }

    /**
     * Get student by ID
     */
    getStudent(studentId) {
        return this.students.find(s => s.id === studentId);
    }

    /**
     * Get all students
     */
    getAllStudents() {
<<<<<<< HEAD
        return [...this.students].sort((a, b) => b.gameState.netWorth - a.gameState.netWorth);
=======
        return this.students
            .map((student, index) => ({ student, index }))
            .sort((a, b) => {
                const diff = this.toNumber(b.student?.gameState?.netWorth) - this.toNumber(a.student?.gameState?.netWorth);
                return diff !== 0 ? diff : a.index - b.index;
            })
            .map(entry => entry.student);
>>>>>>> origin/main
    }

    /**
     * Get students by level
     */
    getStudentsByLevel(level) {
        return this.students.filter(s => s.level === level);
    }

    /**
     * Calculate class statistics
     */
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

        const totalNetWorth = this.students.reduce((sum, s) => sum + this.toNumber(s?.gameState?.netWorth), 0);
        const totalRounds = this.students.reduce((sum, s) => sum + this.toNumber(s?.gameState?.round), 0);

<<<<<<< HEAD
        const sortedByNetWorth = [...this.students].sort((a, b) => b.gameState.netWorth - a.gameState.netWorth);
        const sortedByMines    = [...this.students].sort((a, b) => b.gameState.ownedMines - a.gameState.ownedMines);

        this.classStats = {
            totalStudents:    this.students.length,
            averageNetWorth:  totalNetWorth / this.students.length,
            highestNetWorth:  sortedByNetWorth[0]?.gameState.netWorth || 0,
            wealthiestStudent: sortedByNetWorth[0],
            mostMinesOwned:   sortedByMines[0]?.gameState.ownedMines || 0,
            topMineOwner:     sortedByMines[0],
            averageRound:     totalRounds / this.students.length
=======
        const sortedByNetWorth = [...this.students]
            .map((student, index) => ({ student, index }))
            .sort((a, b) => {
                const diff = this.toNumber(b.student?.gameState?.netWorth) - this.toNumber(a.student?.gameState?.netWorth);
                return diff !== 0 ? diff : a.index - b.index;
            })
            .map(entry => entry.student);
        const sortedByMines = [...this.students]
            .map((student, index) => ({ student, index }))
            .sort((a, b) => {
                const diff = this.toNumber(b.student?.gameState?.ownedMines) - this.toNumber(a.student?.gameState?.ownedMines);
                return diff !== 0 ? diff : a.index - b.index;
            })
            .map(entry => entry.student);

        this.classStats = {
            totalStudents: this.students.length,
            averageNetWorth: totalNetWorth / this.students.length,
            highestNetWorth: this.toNumber(sortedByNetWorth[0]?.gameState?.netWorth),
            wealthiestStudent: sortedByNetWorth[0],
            mostMinesOwned: this.toNumber(sortedByMines[0]?.gameState?.ownedMines),
            topMineOwner: sortedByMines[0],
            averageRound: totalRounds / this.students.length
>>>>>>> origin/main
        };

        return this.classStats;
    }

    /**
     * Get cross-level leaderboard from the unified class records store.
     * @param {{ mode?: string, level?: number, studentId?: string }} [filter]
     * @returns {object[]} Entries sorted by score descending.
     */
<<<<<<< HEAD
    getLeaderboard(filter) {
        // Use LeaderboardStore if available (shared utility loaded on the page)
        if (typeof LeaderboardStore !== 'undefined') {
            return LeaderboardStore.queryEntries(filter || {});
        }

        // Fallback: read raw array from localStorage
        try {
            const raw  = localStorage.getItem('wa_gold_rush_class_records');
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            const entries = Array.isArray(parsed)
                ? parsed
                : (Array.isArray(parsed?.entries) ? parsed.entries : []);

            let results = entries.filter(Boolean);
            if (filter?.mode)      results = results.filter(e => e.mode      === filter.mode);
            if (filter?.level)     results = results.filter(e => e.level     === filter.level);
            if (filter?.studentId) results = results.filter(e => e.studentId === filter.studentId);
            return results.sort((a, b) => (b.netWorth || b.score || 0) - (a.netWorth || a.score || 0));
        } catch (e) {
            return [];
        }
=======
    getLeaderboard() {
        return this.getAllStudents()
            .map((student, index) => ({
                rank: index + 1,
                ...student
            }));
>>>>>>> origin/main
    }

    /**
     * Upsert student progress from shared class gameplay record.
     * Accepts both legacy and v2 shaped records.
     */
    syncFromPlayerRecord(record) {
        const incomingDisplayId = String(record.studentId || '').trim();
        if (!incomingDisplayId) return null;

        let student = this.students.find(s =>
            String(s.displayId || s.id || '').trim().toLowerCase() === incomingDisplayId.toLowerCase()
        );

        if (!student) {
            return null;
        }

        student.name = record.studentName || student.name;
        student.updatedAt = new Date().toISOString();
        student.gameState = {
            ...student.gameState,
            round:              record.round              ?? record.roundsPlayed    ?? student.gameState.round,
            cash:               record.cash               ?? record.finalCash       ?? student.gameState.cash,
            netWorth:           record.netWorth           ?? record.score           ?? student.gameState.netWorth,
            ownedMines:         record.minesOwned         ?? record.minesOwned      ?? student.gameState.ownedMines,
            machinery:          record.machineryOwned     ?? record.machineryCount  ?? student.gameState.machinery,
            totalProfitLoss:    record.totalProfitLoss    ?? student.gameState.totalProfitLoss,
            averageRoundProfit: record.averageRoundProfit ?? student.gameState.averageRoundProfit,
            strategyLabel:      record.strategyLabel      ?? student.gameState.strategyLabel,
            companyName:        record.companyName        ?? student.gameState.companyName,
            lastPlayed:         record.updatedAt || record.timestamp || new Date().toISOString()
        };
        return student;
    }

    // ─── Export ──────────────────────────────────────────────────────────────────

    /**
     * Export class data as CSV
     */
    exportAsCSV() {
        const headers = ['Rank', 'Name', 'Email', 'Level', 'Net Worth', 'Cash', 'Mines', 'Machinery', 'Round', 'Total P/L'];
        const rows = this.getAllStudents().map((student, index) => [
            index + 1,
            student.name,
            student.email,
            student.level,
            this.toNumber(student.gameState?.netWorth).toFixed(2),
            this.toNumber(student.gameState?.cash).toFixed(2),
            this.toNumber(student.gameState?.ownedMines),
            this.toNumber(student.gameState?.machinery),
            this.toNumber(student.gameState?.round),
            this.toNumber(student.gameState?.totalProfitLoss).toFixed(2)
        ]);

        return [headers, ...rows]
            .map(row => row.map(cell => `"${cell}"`).join(','))
            .join('\n');
    }

    // ─── Persistence ─────────────────────────────────────────────────────────────

    /**
     * Save students to the v2 localStorage store.
     */
    saveToLocalStorage() {
        try {
            const store = {
                version:   2,
                students:  this.students,
                savedAt:   new Date().toISOString()
            };
<<<<<<< HEAD
            localStorage.setItem(STUDENTS_STORE_KEY, JSON.stringify(store));
=======
            localStorage.setItem(this.TEACHER_DASHBOARD_KEY, JSON.stringify(data));
>>>>>>> origin/main
            return true;
        } catch (error) {
            console.error('Failed to save to localStorage:', error);
            return false;
        }
    }

    /**
     * Load students.  Tries v2 store first; falls back to legacy key and
     * migrates the data into the v2 shape.
     */
    loadFromLocalStorage() {
        try {
<<<<<<< HEAD
            // Try v2 store
            const v2raw = localStorage.getItem(STUDENTS_STORE_KEY);
            if (v2raw) {
                const v2 = JSON.parse(v2raw);
                if (v2 && Array.isArray(v2.students)) {
                    this.students = v2.students;
                    return true;
                }
=======
            const data = JSON.parse(localStorage.getItem(this.TEACHER_DASHBOARD_KEY));
            if (data && data.students) {
                this.students = data.students;
                return true;
>>>>>>> origin/main
            }

            // Migrate from legacy key
            const legacyRaw = localStorage.getItem(TEACHER_LEGACY_KEY);
            if (legacyRaw) {
                const legacy = JSON.parse(legacyRaw);
                if (legacy && Array.isArray(legacy.students)) {
                    this.students = legacy.students.map(s => this._migrateStudent(s));
                    this.saveToLocalStorage();
                    return true;
                }
            }

            return false;
        } catch (error) {
            console.error('Failed to load from localStorage:', error);
            return false;
        }
    }

    /**
     * Migrate a legacy student record to v2 shape.
     * @private
     */
    _migrateStudent(s) {
        const now = new Date().toISOString();
        return {
            id:          s.id          || this.generateStudentId(),
            name:        s.name        || '',
            email:       s.email       || '',
            username:    s.username    || this.generateUsername(s.name || 'student'),
            pin:         s.pin         || this.generatePin(4),
            level:       Number(s.level) || 1,
            status:      s.status      || 'active',
            notes:       s.notes       || '',
            assignedDate: s.assignedDate || now,
            createdAt:   s.createdAt   || now,
            updatedAt:   s.updatedAt   || now,
            lastLoginAt: s.lastLoginAt || null,
            gameState: {
                round:              s.gameState?.round              || 1,
                cash:               s.gameState?.cash               || 200,
                netWorth:           s.gameState?.netWorth           || 300,
                ownedMines:         s.gameState?.ownedMines         || 1,
                machinery:          s.gameState?.machinery          || 0,
                totalProfitLoss:    s.gameState?.totalProfitLoss    || 0,
                averageRoundProfit: s.gameState?.averageRoundProfit || 0,
                strategyLabel:      s.gameState?.strategyLabel      || '',
                companyName:        s.gameState?.companyName        || '',
                lastPlayed:         s.gameState?.lastPlayed         || null
            }
        };
    }

    /**
     * Clear all data (students + both storage keys).
     */
    clearAll() {
        this.students = [];
        this.classStats = {
            totalStudents: 0,
            averageNetWorth: 0,
            highestNetWorth: 0,
            wealthiestStudent: null,
            mostMinesOwned: 0,
            topMineOwner: null,
            averageRound: 0
        };
<<<<<<< HEAD
        localStorage.removeItem(STUDENTS_STORE_KEY);
        localStorage.removeItem(TEACHER_LEGACY_KEY);
=======
        localStorage.removeItem(this.TEACHER_DASHBOARD_KEY);
>>>>>>> origin/main
    }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = TeacherDashboard;
}
