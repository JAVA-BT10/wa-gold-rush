/**
 * Shared Leaderboard Store Utilities
 * Manages the unified `wa_gold_rush_class_records` localStorage store.
 *
 * Storage schema (v2):
 * {
 *   version: 2,
 *   entries: [
 *     {
 *       entryId, studentId, studentName, username,
 *       level, mode, score, netWorth, finalCash,
 *       roundsPlayed, minesOwned, machineryCount,
 *       companyName, source, timestamp
 *     }
 *   ]
 * }
 */

(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = factory();
    } else {
        root.LeaderboardStore = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {

    const CLASS_RECORDS_KEY = 'wa_gold_rush_class_records';
    const STORE_VERSION = 2;

    /**
     * Generate a simple unique ID.
     * @returns {string}
     */
    function _uid() {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
        return 'entry_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
    }

    /**
     * Normalise a raw entry (from old or new format) into the v2 shape.
     * Returns null if the entry is completely unusable.
     * @param {any} raw
     * @returns {object|null}
     */
    function normaliseEntry(raw) {
        if (!raw || typeof raw !== 'object') return null;

        // Determine source/mode from legacy fields if not present
        const numericLevel = Number(raw.level);
        const source = raw.source || (numericLevel === 1 ? 'level1' : 'level2');
        const mode   = raw.mode   || (source === 'level1' ? 'level1-basic' : 'goldfields-venture');
        const level  = Number(raw.level || (source === 'level1' ? 1 : 2));
        // score: prefer explicit score, else netWorth, else finalCash, else 0
        const netWorth  = Number(raw.netWorth  ?? raw.score ?? 0);
        const finalCash = Number(raw.finalCash ?? raw.cash  ?? 0);
        const score     = Number(raw.score     ?? netWorth);

        return {
            entryId:       String(raw.entryId   || _uid()),
            studentId:     String(raw.studentId || raw.playerKey || ''),
            studentName:   String(raw.studentName || 'Unknown'),
            username:      String(raw.username    || ''),
            level,
            mode,
            score,
            netWorth,
            finalCash,
            roundsPlayed:   Number(raw.roundsPlayed  ?? raw.round  ?? 0),
            minesOwned:     Number(raw.minesOwned    ?? 0),
            machineryCount: Number(raw.machineryCount ?? raw.machineryOwned ?? 0),
            companyName:   String(raw.companyName   || ''),
            source,
            timestamp:     String(raw.timestamp    || raw.updatedAt || new Date().toISOString())
        };
    }

    /**
     * Load and return the full leaderboard store.
     * Handles legacy plain-array format by wrapping it in v2 envelope.
     * @returns {{ version: number, entries: object[] }}
     */
    function loadLeaderboardStore() {
        try {
            const raw = localStorage.getItem(CLASS_RECORDS_KEY);
            if (!raw) return { version: STORE_VERSION, entries: [] };

            const parsed = JSON.parse(raw);

            // Legacy: plain array
            if (Array.isArray(parsed)) {
                const entries = parsed.map(normaliseEntry).filter(Boolean);
                return { version: STORE_VERSION, entries };
            }

            // v2+ envelope
            if (parsed && Array.isArray(parsed.entries)) {
                const entries = parsed.entries.map(normaliseEntry).filter(Boolean);
                return { version: STORE_VERSION, entries };
            }

            return { version: STORE_VERSION, entries: [] };
        } catch (e) {
            console.warn('[LeaderboardStore] Failed to load store:', e);
            return { version: STORE_VERSION, entries: [] };
        }
    }

    /**
     * Persist the full store back to localStorage.
     * @param {{ version: number, entries: object[] }} store
     */
    function saveLeaderboardStore(store) {
        try {
            localStorage.setItem(CLASS_RECORDS_KEY, JSON.stringify(store));
        } catch (e) {
            console.warn('[LeaderboardStore] Failed to save store:', e);
        }
    }

    /**
     * Append or upsert a single entry.
     * Upsert key: (studentId + source + level).  Only one live entry per
     * student/level combination is kept; a new game-end entry for the same
     * student replaces the old one.
     * @param {object} entryData  Raw or normalised entry fields.
     */
    function appendEntry(entryData) {
        const entry = normaliseEntry(entryData);
        if (!entry) return;

        const store = loadLeaderboardStore();

        // Upsert: replace existing entry for same student + source + level
        if (entry.studentId) {
            const idx = store.entries.findIndex(
                e => e.studentId === entry.studentId &&
                     e.source    === entry.source    &&
                     e.level     === entry.level
            );
            if (idx >= 0) {
                store.entries[idx] = entry;
            } else {
                store.entries.push(entry);
            }
        } else {
            store.entries.push(entry);
        }

        saveLeaderboardStore(store);
    }

    /**
     * Query entries with optional filters.
     * @param {{ mode?: string, level?: number, studentId?: string, source?: string }} [filter]
     * @returns {object[]} Sorted by score descending.
     */
    function queryEntries(filter) {
        const store = loadLeaderboardStore();
        let entries = store.entries;

        if (filter) {
            if (filter.mode)      entries = entries.filter(e => e.mode      === filter.mode);
            if (filter.level)     entries = entries.filter(e => e.level     === filter.level);
            if (filter.source)    entries = entries.filter(e => e.source    === filter.source);
            if (filter.studentId) entries = entries.filter(e => e.studentId === filter.studentId);
        }

        return [...entries].sort((a, b) => b.score - a.score);
    }

    /**
     * List all entries for a specific student.
     * @param {string} studentId
     * @returns {object[]}
     */
    function listByStudent(studentId) {
        return queryEntries({ studentId });
    }

    return {
        CLASS_RECORDS_KEY,
        normaliseEntry,
        loadLeaderboardStore,
        saveLeaderboardStore,
        appendEntry,
        queryEntries,
        listByStudent
    };
}));
