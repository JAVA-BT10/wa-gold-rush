/**
 * Teacher Dashboard - Student Management & Progress Tracking
 * Handles student data, level assignment, and class statistics
 */

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

    hasTeacherSession() {
        const upn = this.getSignedInUpn();
        return this.isLikelyTeacherUpn(upn);
    }

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
     * Add a new student
     */
    addStudent(studentData) {
        const autoId = this.generateStudentId();
        const rawDisplayId = (typeof studentData.displayId === 'string') ? studentData.displayId.trim() : '';
        const student = {
            id: autoId,
            displayId: rawDisplayId || autoId,
            name: studentData.name,
            email: studentData.email || '',
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

    /**
     * Generate unique student ID
     */
    generateStudentId() {
        return 'STU' + Date.now() + Math.random().toString(36).slice(2, 11);
    }

    /**
     * Bulk import students from CSV or JSON.
     * Returns { added: [...], skipped: [...] }
     */
    bulkImportStudents(data, format = 'csv') {
        let rawStudents = [];

        if (format === 'csv') {
            const lines = data.trim().split('\n');
            if (!lines.length) return { added: [], skipped: [] };

            const firstFields = lines[0].split(',').map(s => s.trim());
            const firstLevelVal = firstFields.length >= 3 ? parseInt(firstFields[2], 10) : NaN;
            const firstLineIsHeader = isNaN(firstLevelVal) || firstLevelVal < 1 || firstLevelVal > 5;
            const dataLines = firstLineIsHeader ? lines.slice(1) : lines;
            const headerOffset = firstLineIsHeader ? 1 : 0;

            dataLines.forEach((line, idx) => {
                const originalRow = idx + 1 + headerOffset;
                if (line.trim() === '') return;

                const fields = line.split(',').map(s => s.trim());
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
        return this.students.sort((a, b) => b.gameState.netWorth - a.gameState.netWorth);
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

        const totalNetWorth = this.students.reduce((sum, s) => sum + s.gameState.netWorth, 0);
        const totalRounds = this.students.reduce((sum, s) => sum + s.gameState.round, 0);

        const sortedByNetWorth = [...this.students].sort((a, b) => b.gameState.netWorth - a.gameState.netWorth);
        const sortedByMines = [...this.students].sort((a, b) => b.gameState.ownedMines - a.gameState.ownedMines);

        this.classStats = {
            totalStudents: this.students.length,
            averageNetWorth: totalNetWorth / this.students.length,
            highestNetWorth: sortedByNetWorth[0]?.gameState.netWorth || 0,
            wealthiestStudent: sortedByNetWorth[0],
            mostMinesOwned: sortedByMines[0]?.gameState.ownedMines || 0,
            topMineOwner: sortedByMines[0],
            averageRound: totalRounds / this.students.length
        };

        return this.classStats;
    }

    /**
     * Get leaderboard (sorted by net worth)
     */
    getLeaderboard() {
        return [...this.students]
            .sort((a, b) => b.gameState.netWorth - a.gameState.netWorth)
            .map((student, index) => ({
                rank: index + 1,
                ...student
            }));
    }

    /**
     * Upsert student progress from shared class gameplay record
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
        student.gameState = {
            ...student.gameState,
            round: record.round ?? student.gameState.round,
            cash: record.cash ?? student.gameState.cash,
            netWorth: record.netWorth ?? student.gameState.netWorth,
            ownedMines: record.minesOwned ?? student.gameState.ownedMines,
            machinery: record.machineryOwned ?? student.gameState.machinery,
            totalProfitLoss: record.totalProfitLoss ?? student.gameState.totalProfitLoss,
            averageRoundProfit: record.averageRoundProfit ?? student.gameState.averageRoundProfit,
            strategyLabel: record.strategyLabel ?? student.gameState.strategyLabel,
            companyName: record.companyName ?? student.gameState.companyName,
            lastPlayed: record.updatedAt || new Date().toISOString()
        };
        return student;
    }

    /**
     * Delete student
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
     * Export class data as CSV
     */
    exportAsCSV() {
        const headers = ['Rank', 'Name', 'Email', 'Level', 'Net Worth', 'Cash', 'Mines', 'Machinery', 'Round', 'Total P/L'];
        const rows = this.getLeaderboard().map(student => [
            student.rank,
            student.name,
            student.email,
            student.level,
            student.gameState.netWorth.toFixed(2),
            student.gameState.cash.toFixed(2),
            student.gameState.ownedMines,
            student.gameState.machinery,
            student.gameState.round,
            student.gameState.totalProfitLoss.toFixed(2)
        ]);

        const csv = [headers, ...rows]
            .map(row => row.map(cell => `"${cell}"`).join(','))
            .join('\n');

        return csv;
    }

    /**
     * Save to localStorage
     */
    saveToLocalStorage() {
        try {
            const data = {
                timestamp: new Date().toISOString(),
                students: this.students
            };
            localStorage.setItem(this.TEACHER_DASHBOARD_KEY, JSON.stringify(data));
            return true;
        } catch (error) {
            console.error('Failed to save to localStorage:', error);
            return false;
        }
    }

    /**
     * Load from localStorage
     */
    loadFromLocalStorage() {
        try {
            const data = JSON.parse(localStorage.getItem(this.TEACHER_DASHBOARD_KEY));
            if (data && data.students) {
                this.students = data.students;
                return true;
            }
            return false;
        } catch (error) {
            console.error('Failed to load from localStorage:', error);
            return false;
        }
    }

    /**
     * Clear all data
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
        localStorage.removeItem(this.TEACHER_DASHBOARD_KEY);
    }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = TeacherDashboard;
}
