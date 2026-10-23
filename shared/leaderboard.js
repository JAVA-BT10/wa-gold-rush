/**
 * Per-level leaderboard builder.
 *
 * Rankings come ONLY from saved per-level progress rows (one row per
 * Class|Student|Level in GGR_StudentProgress) joined to the roster by class +
 * student code. A student's roster Level / CurrentLevel / ProgressedLevel and
 * their latest cross-level summary are never used to place them on a board,
 * so a student keeps their Level 2 result while playing Level 5.
 *
 * Output is public-safe: rank, LeaderboardName (public nickname), class,
 * level and metric values only — never StudentName, StudentID, StudentCode,
 * PINs or hashes.
 *
 * Browser-side filtering here is presentation only. Class scoping must be
 * enforced server-side by the flow that returns the rows (GGR_GetDashboardData
 * today, the planned GGR_GetLeaderboard later).
 *
 * Metrics:
 *   netWorth – current net worth of this level's game (default)
 *   profit   – netWorth − StartingNetWorth of THIS run
 *   roi      – (netWorth − StartingNetWorth) / StartingNetWorth
 *   competitionProfit – netWorth − the matching competition baseline (gated)
 * Profit/ROI need a recorded, immutable StartingNetWorth for the run. A
 * missing baseline (e.g. a migrated legacy save) or a non-positive baseline
 * (ROI) makes the row explicitly "unrankable" for that metric — it is never
 * back-filled from netWorth or totalProfitLoss.
 *
 * Values are CURRENT standings, not all-time records. Historical bests or
 * frozen competition standings need separate durable storage (planned
 * GGR_CopyCompetitionSnapshot).
 */
(function initLeaderboard(globalObj) {
    const METRICS = Object.freeze({
        netWorth: Object.freeze({ key: 'netWorth', label: 'Net worth', requiresBaseline: false }),
        profit: Object.freeze({ key: 'profit', label: 'Profit (net worth − starting net worth)', requiresBaseline: true }),
        roi: Object.freeze({ key: 'roi', label: 'Return on investment (ROI)', requiresBaseline: true }),
        competitionProfit: Object.freeze({ key: 'competitionProfit', label: 'Competition profit (net worth − competition baseline)', requiresBaseline: true })
    });
    const HELD_STATUSES = new Set(['held', 'excluded', 'unverified', 'under_review', 'needs_review']);
    const CONFLICT_STATUSES = new Set(['conflict', 'conflicted', 'revision_conflict', 'generation_stale', 'stale_generation', 'unresolved']);
    const PLACEHOLDER_NAME = 'Unnamed player';

    function unwrap(value) {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            if ('Value' in value) return value.Value;
            if ('value' in value) return value.value;
        }
        return value;
    }

    function text(value) {
        const raw = unwrap(value);
        return raw === null || raw === undefined ? '' : String(raw).trim();
    }

    function finite(value) {
        const raw = unwrap(value);
        if (raw === null || raw === undefined || raw === '' || typeof raw === 'boolean') return null;
        const num = Number(raw);
        return Number.isFinite(num) ? num : null;
    }

    function parseJson(value) {
        if (value && typeof value === 'object') return value;
        if (typeof value !== 'string' || !value.trim()) return null;
        try { return JSON.parse(value); } catch (_) { return null; }
    }

    function normalizeLevel(value) {
        const level = finite(value);
        return Number.isInteger(level) && level >= 1 && level <= 6 ? level : null;
    }

    function rosterKey(classCode, studentCode) {
        return `${text(classCode).toUpperCase()}|${text(studentCode).toUpperCase()}`;
    }

    /** Public nickname only; never falls back to the student's real name. */
    function publicName(student, strictPrivacy = false) {
        const explicit = text(student.LeaderboardName ?? student.leaderboardName);
        const realName = text(student.StudentName ?? student.studentName);
        if (!explicit) return PLACEHOLDER_NAME;
        if (realName && explicit.toLowerCase() === realName.toLowerCase()
            && (strictPrivacy || !text(student.LeaderboardName))) {
            // Normalised rosters may have copied StudentName into
            // leaderboardName when LeaderboardName was blank.
            return PLACEHOLDER_NAME;
        }
        return explicit;
    }

    /** Immutable run baseline: explicit column first, then the saved run marker. */
    function readStartingNetWorth(row) {
        const direct = finite(row.startingNetWorth ?? row.StartingNetWorth);
        if (direct !== null) return direct;
        const markers = parseJson(row.progressionMarkersJson ?? row.ProgressionMarkersJson);
        const run = markers && typeof markers === 'object' ? markers.run : null;
        if (!run || typeof run !== 'object') return null;
        const rowGeneration = finite(row.runGeneration ?? row.RunGeneration);
        if (rowGeneration !== null && finite(run.generation) !== rowGeneration) return null;
        return finite(run.startingNetWorth);
    }

    function readLeaderboardStatuses(row, competitionMetric = false) {
        let leaderboardStatus = text(row.leaderboardStatus ?? row.LeaderboardStatus).toLowerCase();
        if (competitionMetric) leaderboardStatus = leaderboardStatus.replace(/[\s-]+/g, '_');
        const statuses = [leaderboardStatus];
        if (competitionMetric) {
            statuses.push(text(row.reviewStatus ?? row.ReviewStatus).toLowerCase().replace(/[\s-]+/g, '_'));
            statuses.push(text(row.saveStatus ?? row.SaveStatus).toLowerCase().replace(/[\s-]+/g, '_'));
            statuses.push(text(row.syncStatus ?? row.SyncStatus).toLowerCase().replace(/[\s-]+/g, '_'));
        }
        return statuses;
    }

    function computeMetric(metric, netWorth, startingNetWorth) {
        if (metric === 'netWorth') return { value: netWorth };
        if (startingNetWorth === null) return { value: null, unrankable: 'missing_baseline' };
        if (metric === 'profit') return { value: netWorth - startingNetWorth };
        if (startingNetWorth <= 0) return { value: null, unrankable: 'non_positive_baseline' };
        return { value: (netWorth - startingNetWorth) / startingNetWorth };
    }

    function getCompetitionBaselineApi() {
        return globalObj.WA_GOLD_RUSH_COMPETITION_BASELINES || null;
    }

    function competitionRowIssue(row, baseline) {
        if (baseline.status !== 'active') return 'baseline_not_active';
        const statuses = [
            row.saveStatus, row.SaveStatus, row.syncStatus, row.SyncStatus,
            row.conflictStatus, row.ConflictStatus,
            row.leaderboardStatus, row.LeaderboardStatus, row.reviewStatus, row.ReviewStatus
        ].map((status) => text(status).toLowerCase().replace(/[\s-]+/g, '_'));
        if (statuses.some((status) => CONFLICT_STATUSES.has(status))
            || row.conflict === true
            || row.revisionConflict === true
            || row.generationStale === true) {
            return 'save_conflict';
        }

        const baselineGeneration = finite(baseline.baselineGeneration);
        const currentGeneration = finite(row.runGeneration ?? row.RunGeneration ?? row.generation ?? row.Generation);
        if (baselineGeneration === null) return 'baseline_generation_missing';
        if (!Number.isInteger(currentGeneration)) return 'generation_unverified';
        if (currentGeneration !== baselineGeneration) return 'generation_changed';

        const baselineRevision = finite(baseline.baselineRevision);
        const currentRevision = finite(row.revision ?? row.Revision ?? row.saveRevision ?? row.SaveRevision);
        if (baselineRevision === null) return 'baseline_revision_missing';
        if (!Number.isInteger(currentRevision) || currentRevision < 0) return 'revision_unverified';
        if (currentRevision < baselineRevision) return 'revision_stale';
        return '';
    }

    function rankCompetitionByClass(ranked, limit) {
        const byClass = new Map();
        ranked.forEach((entry) => {
            const group = byClass.get(entry.classCode) || [];
            group.push(entry);
            byClass.set(entry.classCode, group);
        });
        const entries = [];
        Array.from(byClass.keys()).sort().forEach((classCode) => {
            const group = byClass.get(classCode);
            group.sort((a, b) => (b.value - a.value) || a.leaderboardName.localeCompare(b.leaderboardName));
            let previousValue = null;
            let previousRank = 0;
            group.slice(0, limit).forEach((entry, index) => {
                const rank = entry.value === previousValue ? previousRank : index + 1;
                previousValue = entry.value;
                previousRank = rank;
                entries.push(Object.freeze({ rank, ...entry }));
            });
        });
        return entries;
    }

    function count(map, key) {
        map[key] = (map[key] || 0) + 1;
    }

    /**
     * @param {object} input
     *   students: roster rows (normalised or raw GGR_Students shape)
     *   progress: per-level progress rows
     *   level: 1–6
     *   metric: 'netWorth' | 'profit' | 'roi' | 'competitionProfit'
     *   classCodes: optional presentation filter (NOT a security control)
     *   limit: default 20
     */
    function buildLevelLeaderboard(input = {}) {
        const level = normalizeLevel(input.level);
        const metric = Object.prototype.hasOwnProperty.call(METRICS, input.metric) ? input.metric : 'netWorth';
        const limit = Number.isInteger(input.limit) && input.limit > 0 ? input.limit : 20;
        const excluded = {};
        const unrankableReasons = {};
        const base = { level, metric, metricLabel: METRICS[metric].label, entries: [], top: null, excluded, unrankable: unrankableReasons, unrankableCount: 0 };
        if (level === null) return { ...base, reason: 'invalid_level' };
        if (metric === 'competitionProfit') {
            const capabilities = globalObj.WA_GOLD_RUSH_LEVEL_CAPABILITIES;
            if (!capabilities?.isFeatureEnabled?.('competitionLeaderboardMetric', globalObj)
                || !capabilities?.isFeatureEnabled?.('competitionBaselines', globalObj)) {
                return { ...base, reason: 'feature_disabled' };
            }
            if (!text(input.competitionId)) return { ...base, reason: 'competition_id_required' };
            if (!getCompetitionBaselineApi()) return { ...base, reason: 'baseline_model_unavailable' };
        }

        const classFilter = Array.isArray(input.classCodes) && input.classCodes.length
            ? new Set(input.classCodes.map((code) => text(code).toUpperCase()).filter(Boolean))
            : null;

        const roster = new Map();
        (Array.isArray(input.students) ? input.students : []).forEach((student) => {
            if (!student || typeof student !== 'object') return;
            const key = rosterKey(student.classCode ?? student.ClassCode, student.studentCode ?? student.StudentCode);
            if (key.startsWith('|') || key.endsWith('|')) return;
            if (!roster.has(key)) roster.set(key, student);
        });

        const byProgressKey = new Map();
        (Array.isArray(input.progress) ? input.progress : []).forEach((row) => {
            if (!row || typeof row !== 'object') return;
            if (normalizeLevel(row.level ?? row.Level) !== level) return;
            const studentCode = text(row.studentCode ?? row.StudentCode).toUpperCase();
            let classCode = text(row.classCode ?? row.ClassCode).toUpperCase();
            const progressKey = text(row.progressKey ?? row.ProgressKey).toUpperCase();
            if (!classCode && progressKey) {
                const parts = progressKey.split('|');
                if (parts.length === 3 && parts[1] === studentCode && Number(parts[2]) === level) classCode = parts[0];
            }
            if (!classCode || !studentCode) { count(excluded, 'class_or_student_missing'); return; }
            const expectedKey = `${classCode}|${studentCode}|${level}`;
            if (progressKey && progressKey !== expectedKey) { count(excluded, 'progress_key_mismatch'); return; }
            if (classFilter && !classFilter.has(classCode)) return;
            const student = roster.get(rosterKey(classCode, studentCode));
            if (!student) { count(excluded, 'not_on_authorized_roster'); return; }
            const existing = byProgressKey.get(expectedKey);
            if (existing) {
                count(excluded, 'duplicate_progress_row');
                if (metric === 'competitionProfit') {
                    existing.duplicate = true;
                    byProgressKey.set(expectedKey, existing);
                    return;
                }
                const tExisting = Date.parse(text(existing.row.updatedAt ?? existing.row.Modified)) || 0;
                const tRow = Date.parse(text(row.updatedAt ?? row.Modified)) || 0;
                if (tRow <= tExisting) return;
            }
            byProgressKey.set(expectedKey, { row, student, classCode });
        });

        const ranked = [];
        byProgressKey.forEach(({ row, student, classCode }) => {
            if (metric === 'competitionProfit' && byProgressKey.get(`${classCode}|${text(row.studentCode ?? row.StudentCode).toUpperCase()}|${level}`)?.duplicate) {
                count(unrankableReasons, 'duplicate_progress_row');
                return;
            }
            if (readLeaderboardStatuses(row, metric === 'competitionProfit')
                .some((status) => HELD_STATUSES.has(status))) {
                count(excluded, 'held_for_review');
                return;
            }
            const netWorth = finite(row.netWorth ?? row.NetWorth);
            if (netWorth === null) { count(excluded, 'missing_net_worth'); return; }
            const round = finite(row.round ?? row.Round ?? row.currentRound ?? row.CurrentRound);
            if (round === null || round <= 1) { count(excluded, 'not_yet_played'); return; }
            let startingNetWorth = readStartingNetWorth(row);
            let computed;
            if (metric === 'competitionProfit') {
                const baselineResult = getCompetitionBaselineApi().readCompetitionBaseline(input.competitionBaselines, {
                    competitionId: input.competitionId,
                    classCode,
                    level,
                    studentCode: row.studentCode ?? row.StudentCode
                });
                if (!baselineResult.ok) {
                    count(unrankableReasons, baselineResult.reason || 'invalid_baseline');
                    return;
                }
                if (!baselineResult.found) {
                    count(unrankableReasons, 'missing_baseline');
                    return;
                }
                const issue = competitionRowIssue(row, baselineResult.baseline);
                if (issue) {
                    count(unrankableReasons, issue);
                    return;
                }
                startingNetWorth = baselineResult.baseline.baselineNetWorth;
                computed = { value: netWorth - startingNetWorth };
            } else {
                computed = computeMetric(metric, netWorth, startingNetWorth);
            }
            if (computed.value === null || !Number.isFinite(computed.value)) {
                count(unrankableReasons, computed.unrankable || 'not_computable');
                return;
            }
            ranked.push({
                leaderboardName: publicName(student, metric === 'competitionProfit'),
                classCode,
                level,
                value: computed.value,
                netWorth,
                ...(metric === 'competitionProfit' ? {} : { startingNetWorth }),
                round,
                strategyLabel: text(row.strategyLabel ?? row.StrategyLabel),
                lastPlayed: text(row.updatedAt ?? row.LastPlayedUtc ?? row.Modified) || null
            });
        });

        ranked.sort((a, b) => (b.value - a.value) || a.leaderboardName.localeCompare(b.leaderboardName));
        let entries;
        if (metric === 'competitionProfit') {
            entries = rankCompetitionByClass(ranked, limit);
        } else {
            let previousValue = null;
            let previousRank = 0;
            entries = ranked.slice(0, limit).map((entry, index) => {
                const rank = entry.value === previousValue ? previousRank : index + 1;
                previousValue = entry.value;
                previousRank = rank;
                return Object.freeze({ rank, ...entry });
            });
        }
        const unrankableCount = Object.values(unrankableReasons).reduce((sum, n) => sum + n, 0);
        return { ...base, entries, top: entries[0] || null, unrankableCount, rankedCount: ranked.length };
    }

    const api = { METRICS, PLACEHOLDER_NAME, buildLevelLeaderboard, readStartingNetWorth };
    globalObj.WA_GOLD_RUSH_LEADERBOARD = api;
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})(typeof globalThis !== 'undefined' ? globalThis : window);
