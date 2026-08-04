/**
 * Investment Profile — strategy classification and mini donut chart
 *
 * Strategy buckets:
 *   highRisk       — high-volatility or aggressive allocations
 *   lowRisk        — conservative / stable choices
 *   profitChasing  — frequent switching to recent top returns
 *   assetBuilding  — purchases/upgrades that grow long-term capacity
 *   futureProofing — reserves, cash buffers, balanced diversification
 *
 * Usage:
 *   InvestmentProfile.recordAction(studentCode, level, bucket, weight)
 *   InvestmentProfile.compute(studentCode, level)
 *   InvestmentProfile.renderChart(canvasElement, studentCode, level)
 */

const InvestmentProfile = (() => {
    // -------------------------------------------------------------------------
    // Constants
    // -------------------------------------------------------------------------
    const STORAGE_KEY = 'wa_gr_investment_profile';
    const BUCKETS = ['highRisk', 'lowRisk', 'profitChasing', 'assetBuilding', 'futureProofing'];
    const BUCKET_LABELS = {
        highRisk:       'High Risk',
        lowRisk:        'Low Risk',
        profitChasing:  'Profit Chasing',
        assetBuilding:  'Asset Building',
        futureProofing: 'Future Proofing'
    };
    const BUCKET_COLORS = {
        highRisk:       '#e53935',
        lowRisk:        '#43a047',
        profitChasing:  '#fb8c00',
        assetBuilding:  '#1e88e5',
        futureProofing: '#8e24aa'
    };
    // Weighting for success score: buckets that generally correlate with good outcomes
    const SUCCESS_WEIGHTS = {
        highRisk:       -0.3,
        lowRisk:         0.2,
        profitChasing:  -0.1,
        assetBuilding:   0.5,
        futureProofing:  0.4
    };
    const RATING_LABELS = [
        { min: 0.65, label: 'Gold Rush Legend',   emoji: '🏆' },
        { min: 0.50, label: 'Balanced Operator',  emoji: '⚖️'  },
        { min: 0.38, label: 'Strategic Builder',  emoji: '🏗️'  },
        { min: 0.25, label: 'Profit Chaser',      emoji: '📈'  },
        { min: 0.00, label: 'Risk Taker',          emoji: '🎲'  }
    ];

    // -------------------------------------------------------------------------
    // Storage helpers
    // -------------------------------------------------------------------------
    function _load() {
        try {
            return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
        } catch (_) {
            return {};
        }
    }

    function _save(data) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        } catch (_) {}
    }

    function _key(studentCode, level) {
        return `${String(studentCode || 'anon').trim()}__L${Number(level) || 0}`;
    }

    function _ensureEntry(data, key) {
        if (!data[key]) {
            data[key] = { highRisk: 0, lowRisk: 0, profitChasing: 0, assetBuilding: 0, futureProofing: 0 };
        }
        return data[key];
    }

    // -------------------------------------------------------------------------
    // Public API
    // -------------------------------------------------------------------------

    /**
     * Record an investment action for a student/level.
     * @param {string} studentCode
     * @param {number} level
     * @param {string} bucket   — one of BUCKETS
     * @param {number} [weight] — positive number, default 1
     */
    function recordAction(studentCode, level, bucket, weight) {
        if (!BUCKETS.includes(bucket)) return;
        const w = Math.max(0, Number(weight) || 1);
        const data = _load();
        const key = _key(studentCode, level);
        const entry = _ensureEntry(data, key);
        entry[bucket] = (entry[bucket] || 0) + w;
        _save(data);
    }

    /**
     * Compute the investment profile for a student/level.
     * Returns { percentages, successScore, ratingLabel, ratingEmoji, dominantBucket }
     */
    function compute(studentCode, level) {
        const data = _load();
        const key = _key(studentCode, level);
        const entry = data[key] || { highRisk: 0, lowRisk: 0, profitChasing: 0, assetBuilding: 0, futureProofing: 0 };

        const total = BUCKETS.reduce((s, b) => s + (entry[b] || 0), 0);

        const percentages = {};
        BUCKETS.forEach(b => {
            percentages[b] = total > 0 ? (entry[b] || 0) / total : 1 / BUCKETS.length;
        });

        // Weighted success score in [0, 1]
        let raw = BUCKETS.reduce((s, b) => s + percentages[b] * (SUCCESS_WEIGHTS[b] + 0.3), 0);
        const successScore = Math.min(1, Math.max(0, raw));

        const rating = RATING_LABELS.find(r => successScore >= r.min) || RATING_LABELS[RATING_LABELS.length - 1];

        let dominantBucket = BUCKETS[0];
        BUCKETS.forEach(b => {
            if (percentages[b] > percentages[dominantBucket]) dominantBucket = b;
        });

        return {
            percentages,
            successScore,
            ratingLabel: rating.label,
            ratingEmoji: rating.emoji,
            dominantBucket,
            dominantLabel: BUCKET_LABELS[dominantBucket],
            total
        };
    }

    /**
     * Get raw bucket totals for a student/level (for syncing to SharePoint).
     */
    function getBuckets(studentCode, level) {
        const data = _load();
        const key = _key(studentCode, level);
        return Object.assign({ highRisk: 0, lowRisk: 0, profitChasing: 0, assetBuilding: 0, futureProofing: 0 },
            data[key] || {});
    }

    /**
     * Merge incoming bucket data (e.g. from SharePoint sync).
     */
    function mergeBuckets(studentCode, level, incoming) {
        if (!incoming || typeof incoming !== 'object') return;
        const data = _load();
        const key = _key(studentCode, level);
        const entry = _ensureEntry(data, key);
        BUCKETS.forEach(b => {
            if (typeof incoming[b] === 'number' && incoming[b] > entry[b]) {
                entry[b] = incoming[b];
            }
        });
        _save(data);
    }

    /**
     * Render a mini donut chart into a <canvas> element.
     * @param {HTMLCanvasElement} canvas
     * @param {string} studentCode
     * @param {number} level
     * @param {object} [opts]  — optional: { size: 120 }
     */
    function renderChart(canvas, studentCode, level, opts) {
        if (!(canvas instanceof HTMLCanvasElement)) return;
        const size = (opts && opts.size) || 120;
        canvas.width = size;
        canvas.height = size;

        const profile = compute(studentCode, level);
        const ctx = canvas.getContext('2d');
        const cx = size / 2;
        const cy = size / 2;
        const outerR = size / 2 - 4;
        const innerR = outerR * 0.55;

        let angle = -Math.PI / 2;
        BUCKETS.forEach(b => {
            const slice = profile.percentages[b] * 2 * Math.PI;
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.arc(cx, cy, outerR, angle, angle + slice);
            ctx.closePath();
            ctx.fillStyle = BUCKET_COLORS[b];
            ctx.fill();
            angle += slice;
        });

        // Inner circle (donut hole)
        ctx.beginPath();
        ctx.arc(cx, cy, innerR, 0, 2 * Math.PI);
        ctx.fillStyle = '#ffffff';
        ctx.fill();

        // Centre emoji
        const fontSize = Math.round(size * 0.22);
        ctx.font = `${fontSize}px serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(profile.ratingEmoji, cx, cy);
    }

    /**
     * Build legend HTML string for a profile.
     */
    function legendHtml(studentCode, level) {
        const profile = compute(studentCode, level);
        const pct = profile.percentages;
        const parts = BUCKETS
            .slice()
            .sort((a, b) => pct[b] - pct[a])
            .map(b => {
                const p = Math.round(pct[b] * 100);
                const color = BUCKET_COLORS[b];
                return `<span style="display:inline-flex;align-items:center;gap:4px;margin:2px 6px 2px 0;">` +
                    `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${color};"></span>` +
                    `<span>${BUCKET_LABELS[b]} <strong>${p}%</strong></span></span>`;
            });
        return parts.join('');
    }

    return {
        BUCKETS,
        BUCKET_LABELS,
        BUCKET_COLORS,
        recordAction,
        compute,
        getBuckets,
        mergeBuckets,
        renderChart,
        legendHtml
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = InvestmentProfile;
}
