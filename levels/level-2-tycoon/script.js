/**
 * Level 2: Mining Tycoon - Main Game Logic
 * Levels 2–5 progression condensed into one playable mode.
 */

// Legacy device-wide records (one per device, not per level). No longer
// written; kept untouched for compatibility. See DEVICE_LEVEL_BOARD_KEY.
const CLASS_RECORDS_KEY = 'wa_gold_rush_class_records';
// Device-only per-level board: one public row per Class|Student|Level.
const DEVICE_LEVEL_BOARD_KEY = 'wa_gr_device_level_board_v1';
const PAUSE_STATE_KEY = 'wa_gold_rush_pause_state';
const STRICT_MODE_KEY = 'wa_gold_rush_strict_mode';
const TEACHER_DASHBOARD_KEY = 'teacher_dashboard';
const STUDENT_SESSION_KEY = 'wa_gold_rush_student_session';
const STUDENT_LOGIN_PATH = '../../index.html';
const DEFAULT_COMPANY_NAME = 'Untitled Mining Co.';
const RANDOM_EVENT_MIN_LEVEL = 4;
const RANDOM_EVENT_ROLL_INTERVAL = 10;
const PROGRESSION_SNAPSHOT_SCHEMA_VERSION = 2;

let gameState = null;
let currentMineForInvestment = null;
let pendingPurchase = null;
let cloudSaveStatusListenerBound = false;
let progressSaveScheduler = null;
// Why cloud uploads for this level are held on this device ('' = not held).
let cloudUploadHold = '';
let levelLoadState = { status: 'loading', reason: '' };

function createProgressSaveScheduler(options = {}) {
    const activeSaves = new Map();
    const pendingSaves = new Map();
    const resolveProgressKey = typeof options.resolveProgressKey === 'function'
        ? options.resolveProgressKey
        : ((payload) => String(payload?.progressKey || '').trim());
    const dispatchSave = typeof options.dispatchSave === 'function'
        ? options.dispatchSave
        : (() => Promise.resolve({ skipped: true }));

    function scheduleNext(progressKey) {
        const nextPayload = pendingSaves.get(progressKey);
        if (!nextPayload) return;
        pendingSaves.delete(progressKey);
        startSave(nextPayload);
    }

    function startSave(payload) {
        const progressKey = resolveProgressKey(payload);
        if (!progressKey) {
            return Promise.resolve(dispatchSave(payload));
        }
        const savePromise = Promise.resolve(dispatchSave(payload))
            .catch((error) => {
                console.warn('[Level2] Progress save dispatch error', {
                    progressKey,
                    error: error?.message || error
                });
                return { ok: false, error: error?.message || String(error || 'Progress save dispatch failed.') };
            })
            .finally(() => {
                activeSaves.delete(progressKey);
                scheduleNext(progressKey);
            });
        activeSaves.set(progressKey, {
            payload,
            promise: savePromise
        });
        return savePromise;
    }

    return {
        /** Drop a not-yet-started save for a key (e.g. after a level restart). */
        discardPending(progressKey) {
            pendingSaves.delete(String(progressKey || '').trim());
        },
        schedule(payload) {
            const progressKey = resolveProgressKey(payload);
            if (!progressKey) {
                return Promise.resolve(dispatchSave(payload));
            }
            const activeSave = activeSaves.get(progressKey);
            if (activeSave) {
                pendingSaves.set(progressKey, payload);
                return activeSave.promise;
            }
            return startSave(payload);
        },
        async whenIdle() {
            while (activeSaves.size) {
                await Promise.all(Array.from(activeSaves.values(), (entry) => entry.promise));
            }
        }
    };
}

function getStudentSessionApi() {
    const api = globalThis.WA_GOLD_RUSH_STUDENT_SESSION;
    return api && typeof api.readSession === 'function' ? api : null;
}

/** The roster-verified (GGR_LoginStudent) session, or null. */
function getAuthenticatedStudentSession() {
    const api = getStudentSessionApi();
    return api ? api.readSession(localStorage) : null;
}

function redirectToStudentLogin() {
    const api = getStudentSessionApi();
    if (api) {
        api.requireSessionOrRedirect({ loginPath: STUDENT_LOGIN_PATH });
        return;
    }
    window.location.href = buildStudentLoginUrl();
}

/**
 * Gate for every gameplay/progression action (roll, quiz open/submit, level
 * advance, save dispatch). Requires an authenticated session whose identity is
 * the identity currently applied to the game. Otherwise the student is sent
 * back to the roster login and the action does not run.
 */
function requireAuthenticatedStudent() {
    const session = getAuthenticatedStudentSession();
    const playerCode = String(gameState?.player?.studentCode || '').trim().toUpperCase();
    const playerClass = String(gameState?.player?.classCode || '').trim().toUpperCase();
    if (!session || playerCode !== session.studentCode.toUpperCase() || playerClass !== session.classCode) {
        redirectToStudentLogin();
        return null;
    }
    return session;
}

function getLevelSaveStore() {
    const store = globalThis.WA_GOLD_RUSH_LEVEL_SAVE_STORE;
    return store && typeof store.readLevelSave === 'function' ? store : null;
}

function getLevelCapabilitiesApi() {
    const api = globalThis.WA_GOLD_RUSH_LEVEL_CAPABILITIES;
    return api && typeof api.isPlayableLevel === 'function' ? api : null;
}

function getSaveProtocolApi() {
    const api = globalThis.WA_GOLD_RUSH_SAVE_PROTOCOL;
    return api && typeof api.isEnabled === 'function' ? api : null;
}

/**
 * Level requested by the page URL (the per-request selected game level).
 * Missing ?level= is the Level 2 entry point; an invalid or unsupported
 * value returns null and is never coerced to another level's save.
 */
function getAssignedLevelFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('level');
    if (raw === null) return 2;
    const text = String(raw).trim();
    if (!/^\d+$/.test(text)) return null;
    const level = Number(text);
    return [2, 3, 4, 5].includes(level) ? level : null;
}

const LEVEL_LOAD_MESSAGES = {
    loading: 'Loading your saved game for this level…',
    resumed: 'Resumed your saved game for this level (saved on this device).',
    started: 'New game for this level, started from this level\'s starting settings.',
    recovered: 'A saved game for this level could not be read. It was kept aside for your teacher and a new game was started.',
    unavailable: 'Saving is unavailable on this device. Progress will not be kept.',
    conflict: 'This level\'s saved game changed somewhere else. Reload the page before continuing.',
    cloud_conflict: 'Your cloud save for this level differs from this device. Playing from this device; cloud saving is paused until your teacher helps reconcile them.',
    local_only: 'Playing from this device. The cloud save could not be checked, so progress is not yet synced.',
    restored: 'Restored your saved game for this level from the cloud.',
    error: 'The game could not load your saved progress. Please reload the page.'
};

function updateLevelSaveStatusLabel() {
    const el = document.getElementById('levelSaveStatus');
    if (!el) return;
    const base = LEVEL_LOAD_MESSAGES[levelLoadState.status] || LEVEL_LOAD_MESSAGES.error;
    const hold = cloudUploadHold
        ? ' Cloud saving for this level is paused on this device until your teacher reviews an earlier save.'
        : '';
    el.textContent = `${base}${hold}`;
}

function setLevelLoadState(status, reason = '') {
    levelLoadState = { status, reason };
    updateLevelSaveStatusLabel();
}

function protectCloudSave(reason, session, level) {
    if (!cloudUploadHold || cloudUploadHold === 'unverified_new_slot') {
        cloudUploadHold = reason;
    }
    gameState.saveLocked = true;
    const store = getLevelSaveStore();
    const ledger = store?.readLedger(localStorage, session);
    const run = ledger?.levelRuns?.[String(level)];
    if (run && (!run.cloudUploadHold || run.cloudUploadHold === 'unverified_new_slot')) {
        run.cloudUploadHold = cloudUploadHold;
        store.writeLedger(localStorage, ledger);
    }
}

/**
 * Optional full cloud restore (feature flag `fullCloudRestore`, OFF by
 * default). Runs after the local slot is loaded and before any upload. It
 * never overwrites unsent local changes and never treats an unknown cloud
 * answer (error/timeout/legacy response) as "no cloud save".
 */
async function maybeRestoreLevelFromCloud(session, level) {
    const restore = globalThis.WA_GOLD_RUSH_CLOUD_RESTORE;
    const store = getLevelSaveStore();
    if (!restore || !store || !restore.isEnabled() || gameState.saveLocked) return null;
    const cloud = await restore.fetchLevelSave({ session, level });
    const local = store.readLevelSave(localStorage, session, level);
    const decision = restore.reconcile(local, cloud);
    const protocolOn = !!getSaveProtocolApi()?.isEnabled();
    let safeReconcile = ['resume_local', 'start_new', 'upload_local_create'].includes(decision.action);
    if (decision.action === 'adopt_cloud') {
        const adopted = restore.adoptCloudSave(localStorage, cloud);
        if (adopted.ok && gameState.loadFromLocalStorage().success) {
            safeReconcile = true;
            setLevelLoadState('restored');
        } else {
            protectCloudSave('cloud_restore_failed', session, level);
            setLevelLoadState('error', adopted.reason || 'restore_failed');
        }
    } else if (decision.action === 'conflict') {
        protectCloudSave('cloud_conflict', session, level);
        setLevelLoadState('cloud_conflict', decision.reason);
    } else if (decision.action === 'resume_local_unsynced' || decision.action === 'start_local_unsynced') {
        // Without server compare-and-swap, an upload could overwrite cloud
        // progress this device has not seen: hold until the next load.
        if (!protocolOn) protectCloudSave('cloud_state_unknown', session, level);
        setLevelLoadState('local_only', decision.reason);
    }
    if (safeReconcile && cloudUploadHold === 'unverified_new_slot') {
        const ledger = store.readLedger(localStorage, session);
        const run = ledger.levelRuns?.[String(level)];
        if (run?.cloudUploadHold === 'unverified_new_slot') {
            delete run.cloudUploadHold;
            if (!store.writeLedger(localStorage, ledger)) return decision;
        }
        cloudUploadHold = store.getUploadHold(localStorage, session, level) || '';
        updateLevelSaveStatusLabel();
    }
    return decision;
}

/**
 * Load the exact Class|Student|Level save for the signed-in student and the
 * requested level. Must run after access is resolved and before any cloud
 * sync. Never relabels another level's economy and never uploads at startup.
 *
 * - found   → resume that level's game
 * - missing → first visit: start from that level's configured defaults
 * - invalid → preserve the slot and lock writes until it is resolved
 * The legacy shared slot is migrated (non-destructively) first.
 */
function loadLevelGameForSession(session, level) {
    const store = getLevelSaveStore();
    gameState.assignedLevel = level;
    gameState.applyLevelConfigAdapter?.();
    applyCompetitionSessionToIdentity(false);
    cloudUploadHold = '';
    if (!store) {
        gameState.saveLocked = true;
        gameState.reset();
        setLevelLoadState('unavailable', 'save_store_unavailable');
        return levelLoadState;
    }
    let migration = null;
    try {
        migration = store.migrateLegacyAutosave(localStorage, session);
    } catch (error) {
        migration = { status: 'skipped', reason: 'migration_failed' };
    }
    const loaded = gameState.loadFromLocalStorage();
    if (loaded.success) {
        setLevelLoadState('resumed', loaded.migratedFrom ? 'migrated_legacy' : '');
    } else if (loaded.status === 'missing') {
        if (!gameState.beginLevelRun()) {
            cloudUploadHold = store.getUploadHold(localStorage, session, level) || '';
            gameState.saveLocked = true;
            setLevelLoadState('error', 'run_start_failed');
            return levelLoadState;
        }
        setLevelLoadState('started');
    } else {
        gameState.saveLocked = true;
        gameState.reset();
        setLevelLoadState(loaded.status === 'unavailable' ? 'unavailable' : 'error', loaded.reason);
        return levelLoadState;
    }
    cloudUploadHold = store.getUploadHold(localStorage, session, level) || '';
    if (!cloudUploadHold && levelLoadState.status !== 'resumed'
        && getLevelCapabilitiesApi()?.isFeatureEnabled?.('holdUnverifiedNewSlotUploads')) {
        cloudUploadHold = 'unverified_new_slot';
    }
    levelLoadState.migration = migration;
    updateLevelSaveStatusLabel();
    return levelLoadState;
}

function getAssignedLevelLabel(level) {
    const labels = {
        2: 'Level 2 Goldfields Venture Mode',
        3: 'Level 3 WA Goldfields Mode',
        4: 'Level 4 Advanced Operations Mode',
        5: 'Level 5 Classroom Challenge Mode'
    };
    return labels[level] || 'Level unavailable';
}

function updateAssignedLevelBadge() {
    const badge = document.querySelector('.level-badge');
    if (!badge) return;
    badge.textContent = getAssignedLevelLabel(gameState?.assignedLevel || 2);
}

function getAllowedMineUpgradeIds(level = gameState?.assignedLevel || 2) {
    return gameState?.getAllowedMineUpgradeIds(level) || [];
}

function getAllowedMachineryIds(level = gameState?.assignedLevel || 2) {
    return gameState?.getAllowedMachineryIds(level) || [];
}

function isMineUpgradeAllowed(upgradeId, level = gameState?.assignedLevel || 2) {
    return gameState?.isMineUpgradeAllowed(upgradeId, level) || false;
}

function isMachineryAllowed(machineryId, level = gameState?.assignedLevel || 2) {
    return gameState?.isMachineryAllowed(machineryId, level) || false;
}

function shouldRollRandomEvent() {
    const assignedLevel = gameState?.assignedLevel || 2;
    if (assignedLevel < RANDOM_EVENT_MIN_LEVEL) {
        return false;
    }

    return gameState.round % RANDOM_EVENT_ROLL_INTERVAL === 0;
}

function enforceCurrentLevelAccess() {
    if (typeof LevelAccessGuard === 'undefined') return true;
    const guard = new LevelAccessGuard(getAssignedLevelFromUrl());
    if (!guard.isLevelAccessible()) {
        guard.enforceAccess();
        return false;
    }
    return true;
}

/**
 * Async variant used at page start: if the level is locked on this device,
 * try the cross-device progress flow (when configured) so a quiz passed on
 * another device unlocks here too. Must run before loadFromLocalStorage so the
 * game state picks up any mirrored checkpoint.
 */
async function resolveCurrentLevelAccess() {
    if (typeof LevelAccessGuard === 'undefined') return true;
    const guard = new LevelAccessGuard(getAssignedLevelFromUrl());
    try {
        if (typeof guard.resolveAccess === 'function' && await guard.resolveAccess()) return true;
    } catch (error) {
        console.warn('[Level2] Remote progression check failed', error?.message || error);
    }
    return enforceCurrentLevelAccess();
}

function buildLevelUrl(level) {
    const url = new URL(window.location.href);
    url.searchParams.set('level', String(level));
    url.hash = '';
    return url.toString();
}

function resolveConfigPath() {
    const currentPath = window.location.pathname || '';
    if (currentPath.includes('/blob/') || currentPath.includes('/tree/')) {
        return null;
    }
    return '../../shared/game-config.json';
}

document.addEventListener('DOMContentLoaded', async function() {
    // Direct navigation cannot bypass the roster-backed student login.
    if (!getStudentSessionApi()) {
        alert('Student sign-in is unavailable. Please return to the Home page.');
        return;
    }
    const session = getStudentSessionApi().requireSessionOrRedirect({ loginPath: STUDENT_LOGIN_PATH });
    if (!session) return;

    gameState = new GameState();
    const requestedLevel = getAssignedLevelFromUrl();
    if (requestedLevel === null) {
        // Unknown/unsupported level link (including planned Level 6): never
        // fall back to another level's game.
        alert('That level is not available. Returning to the Home page.');
        window.location.href = '../../index.html?error=level_locked';
        return;
    }
    gameState.assignedLevel = requestedLevel;
    setLevelLoadState('loading');

    const configPath = resolveConfigPath();
    if (!configPath) {
        alert('This game cannot run from a GitHub file preview. Please use GitHub Pages or a local web server.');
        return;
    }

    const configLoaded = await gameState.loadConfig(configPath);
    if (!configLoaded) {
        alert(`Failed to load game configuration from ${configPath}. Please use GitHub Pages or a local web server and try again.`);
        return;
    }

    if (!(await resolveCurrentLevelAccess())) return;

    try {
        // Only this student's save for THIS level is ever loaded; there is no
        // startup cloud upload (a fresh default game must never overwrite
        // unresolved cloud progress).
        loadLevelGameForSession(session, requestedLevel);
        try {
            await maybeRestoreLevelFromCloud(session, requestedLevel);
        } catch (restoreError) {
            console.warn('[Level2] Cloud restore skipped', restoreError?.message || restoreError);
        }
        if (!enforceCurrentLevelAccess()) return;
        ensureInvestmentPlansForOwnedMines();
        hydrateIdentityInputs();
        setupEventListeners();
        updatePauseStateFromStorage();
        updateAssignedLevelBadge();
        updateAllUI();
        if (typeof SharePointSync !== 'undefined') {
            updateCloudSaveStatusLabel(SharePointSync.getCloudSaveStatus?.() || 'idle');
            if (!cloudSaveStatusListenerBound) {
                window.addEventListener('wa-gr-cloud-save-status', (event) => {
                    updateCloudSaveStatusLabel(event?.detail?.status || 'idle');
                });
                cloudSaveStatusListenerBound = true;
            }
        }
        updateInvestmentProfilePanel();
    } catch (err) {
        console.error('Level 2 init error:', err);
        // Show defaults but never persist them over an unreadable save.
        try {
            gameState.saveLocked = true;
            gameState.reset();
            gameState.assignedLevel = requestedLevel;
            gameState.applyLevelConfigAdapter?.();
            setLevelLoadState('error', 'init_failed');
            if (!enforceCurrentLevelAccess()) return;
            ensureInvestmentPlansForOwnedMines();
            applyCompetitionSessionToIdentity(false);
            hydrateIdentityInputs();
            setupEventListeners();
            updatePauseStateFromStorage();
            updateAssignedLevelBadge();
            updateAllUI();
        } catch (recoveryErr) {
            console.error('Level 2 recovery failed:', recoveryErr);
            const minesContainer = document.getElementById('mines-container');
            if (minesContainer) {
                minesContainer.innerHTML = '<p class="empty-state">Game failed to initialize. Please refresh the page.</p>';
            }
        }
    }
});

function setupEventListeners() {
    const rollBtn = document.getElementById('rollButton');
    const saveBtn = document.getElementById('saveButton');
    const loadBtn = document.getElementById('loadButton');
    const resetBtn = document.getElementById('resetButton');
    const saveMinePlanBtn = document.getElementById('saveMinePlanButton');
    const saveIdentityBtn = document.getElementById('saveIdentityButton');
    const logoutBtn = document.getElementById('competitionLogoutButton');
    const confirmPurchaseBtn = document.getElementById('confirmPurchase');
    const cancelPurchaseBtn = document.getElementById('cancelPurchase');

    if (rollBtn) rollBtn.addEventListener('click', playRound);
    if (saveBtn) saveBtn.addEventListener('click', saveGame);
    if (loadBtn) loadBtn.addEventListener('click', loadGame);
    if (resetBtn) resetBtn.addEventListener('click', resetGame);
    if (saveMinePlanBtn) saveMinePlanBtn.addEventListener('click', saveMinePlan);
    if (saveIdentityBtn) saveIdentityBtn.addEventListener('click', saveCompanyName);
    if (logoutBtn) logoutBtn.addEventListener('click', logoutCompetitionSession);

    document.querySelectorAll('.modal-close').forEach(btn => {
        btn.addEventListener('click', closeAllModals);
    });
    if (confirmPurchaseBtn) confirmPurchaseBtn.addEventListener('click', confirmPurchase);
    if (cancelPurchaseBtn) cancelPurchaseBtn.addEventListener('click', closeAllModals);

    window.addEventListener('click', function(event) {
        if (event.target.classList.contains('modal')) {
            closeAllModals();
        }
    });

    window.addEventListener('storage', function(event) {
        if (event.key === PAUSE_STATE_KEY) {
            updatePauseStateFromStorage();
        }
        if (event.key === STUDENT_SESSION_KEY) {
            handleStudentSessionChange();
            return;
        }
        if (handleLevelSaveStorageChange(event.key)) {
            return;
        }
        if ((event.key === STRICT_MODE_KEY) || (event.key === TEACHER_DASHBOARD_KEY) || (event.key === DEVICE_LEVEL_BOARD_KEY)) {
            applyCompetitionSessionToIdentity(false);
            updateCompetitionStatus();
            renderLeaderboard();
        }
    });
}

/**
 * Another tab changed this student's save for THIS level, or restarted it:
 * stop writing (no last-writer-wins overwrite) and ask for a reload.
 * Returns true when the key was handled.
 */
function handleLevelSaveStorageChange(key) {
    const store = getLevelSaveStore();
    const identity = gameState?.getSaveIdentity?.();
    if (!store || !identity || !key) return false;
    if (key === store.buildLedgerKey(identity)) {
        const run = store.readLedger(localStorage, identity).levelRuns?.[String(gameState.assignedLevel)];
        if (run && gameState.activeRun && (run.generation !== gameState.activeRun.generation || run.runId !== gameState.activeRun.runId)) {
            gameState.saveLocked = true;
            setLevelLoadState('conflict', 'restarted_elsewhere');
        }
        return true;
    }
    if (key === store.buildSaveKey(identity, gameState.assignedLevel)) {
        gameState.saveLocked = true;
        setLevelLoadState('conflict', 'changed_elsewhere');
        return true;
    }
    return false;
}

function ensureInvestmentPlansForOwnedMines() {
    gameState.getOwnedMines().forEach(mine => {
        if (!gameState.investmentPlans[mine.id]) {
            gameState.investmentPlans[mine.id] = { safe: 0, medium: 0, deep: 0 };
        }
    });
}

function renderMines() {
    const container = document.getElementById('mines-container');
    if (!container) return;
    const ownedMines = gameState.getOwnedMines();
    container.innerHTML = '';

    ownedMines.forEach(mine => {
        const card = document.createElement('div');
        card.className = 'mine-card owned';
        const upgrades = mine.upgrades.length > 0 ? `✨ ${mine.upgrades.length} upgrade(s)` : '';
        const planned = gameState.investmentPlans[mine.id] || {};
        const plannedTotal = Object.values(planned).reduce((sum, value) => sum + (Number(value) || 0), 0);

        card.innerHTML = `
            <div class="mine-card-icon">${mine.icon}</div>
            <div class="mine-card-title">${mine.name}</div>
            <div class="mine-card-info">Max: $${mine.maxInvestmentPerRound}/round</div>
            <div class="mine-card-info">Value: $${mine.baseValue}</div>
            <div class="mine-card-info">Planned this round: $${plannedTotal}</div>
            ${upgrades ? `<div class="mine-card-upgrades">${upgrades}</div>` : ''}
            <div class="mine-card-status status-owned">✓ Owned</div>
        `;
        card.addEventListener('click', () => openMineModal(mine));
        container.appendChild(card);
    });
}

function renderMineShop() {
    const shop = document.getElementById('mine-shop');
    if (!shop) return;
    const availableMines = gameState.getAvailableMinesForPurchase();
    const mineLimitReached = gameState.getOwnedMines().length >= gameState.getMaxActiveMines();
    shop.innerHTML = '';

    if (availableMines.length === 0) {
        shop.innerHTML = '<p class="empty-state">All currently unlocked mines are owned.</p>';
        return;
    }

    if (mineLimitReached) {
        shop.innerHTML = `<p class="empty-state">You already own the maximum number of mines for Level ${gameState.assignedLevel}. Keep growing with upgrades and other assets until the next level unlocks more capacity.</p>`;
        return;
    }

    availableMines.forEach(mine => {
        const canAfford = gameState.cash >= mine.cost;
        const item = document.createElement('div');
        item.className = `shop-item ${!canAfford ? 'unavailable' : ''}`;
        item.innerHTML = `
            <div class="shop-icon">${mine.icon}</div>
            <div class="shop-name">${mine.name}</div>
            <div class="shop-cost">$${mine.cost}</div>
            <div style="font-size:11px;color:#666;margin-bottom:6px;">Max invest: $${mine.maxInvestmentPerRound}</div>
            <button class="shop-btn" ${!canAfford ? 'disabled' : ''}>Buy</button>
        `;
        item.querySelector('.shop-btn').addEventListener('click', () => {
            openPurchaseModal('mine', mine.id, mine.name, mine.cost);
        });
        shop.appendChild(item);
    });
}

function renderMachinery() {
    const container = document.getElementById('machinery-list');
    if (!container) return;
    if (!Array.isArray(gameState.machinery) || gameState.machinery.length === 0) {
        container.innerHTML = '<p class="empty-state">No machinery owned yet.</p>';
        return;
    }
    container.innerHTML = '';
    gameState.machinery.forEach((item, index) => {
        const config = gameState.gameConfig.machinery[item.id];
        if (!config) return; // skip if config for this machinery no longer exists
        const resaleValue = Math.floor(item.purchasePrice * config.resaleValue);
        const element = document.createElement('div');
        element.className = 'machinery-item';
        element.innerHTML = `
            <div>
                <div class="machinery-item-name">${config.icon} ${config.name}</div>
                <div style="font-size: 11px; color: #666;">Resale: $${resaleValue}</div>
            </div>
            <div style="display:flex;gap:8px;align-items:center;">
                <div class="machinery-item-bonus">+${Math.round(config.profitBonus * 100)}%</div>
                <button class="machinery-item-sell" data-index="${index}">Sell</button>
            </div>
        `;
        element.querySelector('.machinery-item-sell').addEventListener('click', (e) => {
            sellMachinery(parseInt(e.target.dataset.index, 10));
        });
        container.appendChild(element);
    });
}

function renderMachineryShop() {
    const shop = document.getElementById('machinery-shop');
    if (!shop) return;
    const machineryList = Object.entries(gameState.gameConfig.machinery)
        .filter(([id]) => isMachineryAllowed(id));
    shop.innerHTML = '';
    if (!machineryList.length) {
        shop.innerHTML = '<p class="empty-state">No machinery available at this assigned level.</p>';
        return;
    }
    machineryList.forEach(([id, machinery]) => {
        const ownedCount = Array.isArray(gameState.machinery) ? gameState.machinery.filter(m => m.id === id).length : 0;
        const canPurchase = ownedCount < machinery.purchaseLimit && gameState.cash >= machinery.cost;
        const item = document.createElement('div');
        item.className = `shop-item ${!canPurchase ? 'unavailable' : ''}`;
        item.innerHTML = `
            <div class="shop-icon">${machinery.icon}</div>
            <div class="shop-name">${machinery.name}</div>
            <div class="shop-cost">$${machinery.cost}</div>
            <div style="font-size: 11px; color: #666; margin-bottom: 6px;">
                +${Math.round(machinery.profitBonus * 100)}% profit
            </div>
            <button class="shop-btn" ${!canPurchase ? 'disabled' : ''}>${ownedCount}/${machinery.purchaseLimit}</button>
        `;
        item.querySelector('.shop-btn').addEventListener('click', () => {
            if (canPurchase) openPurchaseModal('machinery', id, machinery.name, machinery.cost);
        });
        shop.appendChild(item);
    });
}

function renderStats() {
    const netWorth = gameState.getNetWorth();
    const mineValue = gameState.getMineValue();
    const machineryValue = gameState.getMachineryValue();

    const cashEl = document.getElementById('cash');
    const netWorthEl = document.getElementById('netWorth');
    const minesOwnedEl = document.getElementById('minesOwned');
    const machineryCountEl = document.getElementById('machineryCount');
    const roundEl = document.getElementById('round');
    const summaryCashEl = document.getElementById('summary-cash');
    const summaryMinesEl = document.getElementById('summary-mines');
    const summaryMachineryEl = document.getElementById('summary-machinery');
    const summaryNetWorthEl = document.getElementById('summary-networth');
    const summaryTotalEl = document.getElementById('summary-total');

    if (cashEl) cashEl.textContent = `$${gameState.cash.toFixed(2)}`;
    if (netWorthEl) netWorthEl.textContent = `$${netWorth.toFixed(2)}`;
    if (minesOwnedEl) minesOwnedEl.textContent = gameState.getOwnedMines().length;
    if (machineryCountEl) machineryCountEl.textContent = Array.isArray(gameState.machinery) ? gameState.machinery.length : 0;
    if (roundEl) roundEl.textContent = gameState.round;

    if (summaryCashEl) summaryCashEl.textContent = `$${gameState.cash.toFixed(2)}`;
    if (summaryMinesEl) summaryMinesEl.textContent = `$${mineValue.toFixed(2)}`;
    if (summaryMachineryEl) summaryMachineryEl.textContent = `$${machineryValue.toFixed(2)}`;
    if (summaryNetWorthEl) summaryNetWorthEl.textContent = `$${netWorth.toFixed(2)}`;
    if (summaryTotalEl) summaryTotalEl.textContent = `$${(typeof gameState.totalProfitLoss === 'number' ? gameState.totalProfitLoss : 0).toFixed(2)}`;
}

function renderFeaturesAndCosts() {
    const cfg = gameState.gameConfig;
    const mines = Object.values(cfg.mines).map(m => `${m.name} $${m.cost} (max $${m.maxInvestmentPerRound})`).join('</li><li>');
    const upgrades = Object.entries(cfg.mineUpgrades)
        .filter(([id]) => isMineUpgradeAllowed(id))
        .map(([, u]) => `${u.name} $${u.cost}`)
        .join('</li><li>');
    const machinery = Object.entries(cfg.machinery)
        .filter(([id]) => isMachineryAllowed(id))
        .map(([, m]) => `${m.name} $${m.cost} (+${Math.round(m.profitBonus * 100)}%)`)
        .join('</li><li>');
    const events = (gameState.assignedLevel >= RANDOM_EVENT_MIN_LEVEL)
        ? Object.values(cfg.randomEvents)
            .sort((a, b) => a.diceValue - b.diceValue)
            .map(e => `${e.diceValue}: ${e.description}`)
            .join(', ')
        : 'Locked until Level 4';
    const featuresCostsEl = document.getElementById('features-costs');
    if (!featuresCostsEl) return;
    featuresCostsEl.innerHTML = `
        <ul>
            <li><strong>Mines:</strong> ${mines}</li>
            <li><strong>Upgrades:</strong> ${upgrades || 'No mine upgrades at this level'}</li>
            <li><strong>Machinery:</strong> ${machinery || 'No machinery available at this level'}</li>
            <li><strong>Random Events:</strong> ${events}</li>
            <li><strong>Net Worth:</strong> Cash + Mine Value + Machinery Resale Value</li>
        </ul>
    `;
}

function renderLeaderboard() {
    const competition = getCompetitionContext();
    const isCompetitionLocked = !competition.canUseCompetitionFeatures;
    const lockMessage = document.getElementById('competition-lock-message');
    const leaderboardSummary = document.getElementById('leaderboard-summary');
    const leaderboardList = document.getElementById('leaderboard-list');

    if (isCompetitionLocked) {
        if (lockMessage) {
            lockMessage.textContent = 'Sign in from the Home page with your Class Code, Student ID and PIN to play and save progress.';
            lockMessage.classList.remove('hidden');
        }
        if (leaderboardSummary) leaderboardSummary.textContent = 'Competition leaderboard is locked until you log in from Home.';
        if (leaderboardList) leaderboardList.innerHTML = '<p class="empty-state">Competition login required.</p>';
        return;
    }

    if (lockMessage) {
        lockMessage.classList.add('hidden');
        lockMessage.textContent = '';
    }
    // Device-only board for the level being played: rows saved on THIS
    // device for this class and level. It is not a cross-device class board.
    const records = getDeviceLevelRecords(competition.session?.classCode, gameState?.assignedLevel);
    const leaderboard = [...records].sort((a, b) => b.netWorth - a.netWorth).slice(0, 10);
    const wealthiest = leaderboard[0];
    const avgWealth = records.length ? records.reduce((s, r) => s + r.netWorth, 0) / records.length : 0;
    const mostMines = [...records].sort((a, b) => b.minesOwned - a.minesOwned)[0];
    const profitable = [...records].sort((a, b) => b.averageRoundProfit - a.averageRoundProfit)[0];

    if (leaderboardSummary) {
        leaderboardSummary.innerHTML = `
            <em>Level ${escapeHtml(gameState?.assignedLevel)} games saved on this device only.</em><br>
            Wealthiest: ${wealthiest ? `${escapeHtml(wealthiest.leaderboardName || wealthiest.companyName)} ($${wealthiest.netWorth.toFixed(2)})` : 'N/A'}<br>
            Most mines: ${mostMines ? `${escapeHtml(mostMines.leaderboardName || mostMines.companyName)} (${mostMines.minesOwned})` : 'N/A'}<br>
            Most profitable strategy: ${profitable ? `${escapeHtml(profitable.leaderboardName || profitable.companyName)} (${escapeHtml(profitable.strategyLabel || 'Balanced')})` : 'N/A'}<br>
            Average wealth (this device): $${avgWealth.toFixed(2)}
        `;
    }

    if (!leaderboardList) return;
    if (!leaderboard.length) {
        leaderboardList.innerHTML = '<p class="empty-state">No games for this level saved on this device yet.</p>';
        return;
    }
    leaderboardList.innerHTML = leaderboard.map((record, index) => `
        <div class="leaderboard-item">
            <span>${index + 1}. ${escapeHtml(record.leaderboardName || record.companyName)}</span>
            <span>$${record.netWorth.toFixed(2)}</span>
        </div>
    `).join('');
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function getCurrentProgressionGoal() {
    const levelKey = String(gameState?.assignedLevel || 2);
    return gameState?.gameConfig?.progressionCheckpoint?.levels?.[levelKey] ?? null;
}

/**
 * Next level a passed checkpoint leads to, capped to levels that are
 * implemented and deployed (Level 5 → planned Level 6 returns null).
 */
function getNextAssignedLevel() {
    const currentLevel = Number(gameState?.assignedLevel || 2);
    const caps = getLevelCapabilitiesApi();
    if (caps) return caps.getNextPlayableLevel(currentLevel);
    return currentLevel < 5 ? currentLevel + 1 : null;
}

function getQuizStudentCode() {
    return getAuthenticatedStudentSession()?.studentCode || '';
}

function updateCheckpointQuizCopy(quiz) {
    const currentLevel = Number(gameState?.assignedLevel || 2);
    const nextLevel = getNextAssignedLevel();
    const goal = getCurrentProgressionGoal();
    const titleEl = document.getElementById('checkpointQuizTitle');
    const promptEl = document.getElementById('checkpointQuizPrompt');
    const continueBtn = document.getElementById('quizContinueButton');

    if (titleEl) {
        titleEl.textContent = `🎓 ${quiz?.name || `Level ${currentLevel} Progression Checkpoint`}`;
    }

    if (promptEl) {
        promptEl.textContent = nextLevel
            ? `You've reached the Level ${currentLevel} goal of $${goal}. Answer 5 questions to progress to Level ${nextLevel}.`
            : `You've reached the Level ${currentLevel} goal of $${goal}. Answer 5 questions to complete the final progression checkpoint.`;
    }

    if (continueBtn) {
        continueBtn.textContent = nextLevel ? `Continue to Level ${nextLevel}` : 'Continue Playing';
    }
}

function checkProgressionGoal() {
    if (!getAuthenticatedStudentSession()) return;
    const goal = getCurrentProgressionGoal();
    if (!goal || gameState.getNetWorth() < goal || gameState.checkpointStatus === 'quiz_passed') {
        return;
    }

    if (gameState.checkpointStatus !== 'quiz_available') {
        gameState.checkpointStatus = 'quiz_available';
        gameState.saveToLocalStorage();
    }

    const modal = document.getElementById('checkpointQuizModal');
    if (!modal?.classList.contains('active')) {
        showProgressionQuiz();
    }
}

function showProgressionQuiz() {
    if (!requireAuthenticatedStudent()) return;
    if (typeof ProgressionQuiz === 'undefined') {
        console.warn('ProgressionQuiz not loaded');
        return;
    }

    const levelKey = String(gameState.assignedLevel || 2);
    const quiz = ProgressionQuiz.loadQuiz(levelKey);

    if (!quiz?.questions?.length) {
        console.warn('No quiz available for level', levelKey);
        return;
    }

    const modal = document.getElementById('checkpointQuizModal');
    const container = document.getElementById('quizContainer');
    const resultsContainer = document.getElementById('quizResultsContainer');
    const submitDiv = document.getElementById('quizSubmitButton');
    if (!modal || !container) return;

    updateCheckpointQuizCopy(quiz);

    container.style.display = 'block';
    container.innerHTML = '';
    if (resultsContainer) resultsContainer.style.display = 'none';
    if (submitDiv) submitDiv.style.display = 'block';

    quiz.questions.forEach((q, idx) => {
        const qDiv = document.createElement('div');
        qDiv.style.cssText = 'margin: 20px 0; padding: 15px; background: #f9f9f9; border-radius: 8px;';
        const optionsHtml = Array.isArray(q.options)
            ? q.options.map(opt => `
                <label style="display: block; margin: 8px 0; cursor: pointer;">
                    <input type="radio" name="q${q.id}" value="${escapeHtml(opt.text || opt)}" required>
                    ${escapeHtml(opt.text || opt)}
                </label>
            `).join('')
            : '';

        qDiv.innerHTML = `
            <p><strong>Q${idx + 1}: ${escapeHtml(q.question)}</strong></p>
            ${optionsHtml}
        `;
        container.appendChild(qDiv);
    });

    const submitBtn = document.getElementById('submitQuizButton');
    if (submitBtn) {
        submitBtn.onclick = () => submitQuiz(quiz);
    }

    modal.classList.add('active');
}

function submitQuiz(quiz) {
    if (!requireAuthenticatedStudent()) return;
    const answers = {};
    let missingAnswers = 0;

    quiz.questions.forEach(q => {
        const selected = document.querySelector(`input[name="q${q.id}"]:checked`);
        answers[q.id] = selected ? selected.value : '';
        if (!selected) {
            missingAnswers += 1;
        }
    });

    if (missingAnswers > 0) {
        alert(`Please answer all 5 questions before submitting. ${missingAnswers} question(s) still need an answer.`);
        return;
    }

    const levelKey = String(gameState.assignedLevel || 2);
    const result = ProgressionQuiz.submitQuiz(levelKey, answers, getQuizStudentCode());
    if (!result?.success) {
        alert(result?.error || 'Unable to submit quiz right now.');
        return;
    }
    displayQuizResults(result, quiz);
}

function displayQuizResults(result, quiz) {
    if (!requireAuthenticatedStudent()) return;
    const container = document.getElementById('quizContainer');
    const resultsContainer = document.getElementById('quizResultsContainer');
    const submitDiv = document.getElementById('quizSubmitButton');
    const retakeBtn = document.getElementById('quizRetakeButton');
    const continueBtn = document.getElementById('quizContinueButton');
    const resultTitle = document.getElementById('quizResultTitle');
    const scoreDisplay = document.getElementById('quizScoreDisplay');
    const answerReview = document.getElementById('quizAnswerReview');

    if (container) container.style.display = 'none';
    if (submitDiv) submitDiv.style.display = 'none';
    if (resultsContainer) resultsContainer.style.display = 'block';

    const passed = !!result.passed;
    if (resultTitle) {
        resultTitle.textContent = passed ? '🎉 Quiz Passed!' : '❌ Quiz Failed';
    }
    if (scoreDisplay) {
        scoreDisplay.textContent = `${result.score} / ${result.totalQuestions}`;
        scoreDisplay.style.color = passed ? '#4caf50' : '#f44336';
    }

    if (answerReview && Array.isArray(result.results)) {
        answerReview.innerHTML = result.results.map(r => `
            <div style="margin: 10px 0; padding: 10px; background: ${r.correct ? '#e8f5e9' : '#ffebee'}; border-radius: 4px; border-left: 4px solid ${r.correct ? '#4caf50' : '#f44336'};">
                <p style="margin: 0 0 5px 0;"><strong>${r.correct ? '✅' : '❌'} ${escapeHtml(r.question)}</strong></p>
                <p style="margin: 0 0 5px 0; font-size: 12px; color: #666;">Your answer: ${escapeHtml(r.studentAnswer)}</p>
                <p style="margin: 0 0 5px 0; font-size: 12px; color: #4caf50;"><strong>Correct:</strong> ${escapeHtml(r.correctAnswer)}</p>
                <p style="margin: 0; font-size: 12px; color: #555; font-style: italic;">${escapeHtml(r.explanation)}</p>
            </div>
        `).join('');
    }

    gameState.recordQuizAttempt?.(result);

    if (passed) {
        gameState.updateProgressionState?.({
            checkpointStatus: 'quiz_passed',
            approvalStatus: 'pending',
            approverName: null,
            approvalTimestamp: null
        });
        gameState.saveToLocalStorage();
        syncPlayerRecord();
        if (retakeBtn) retakeBtn.style.display = 'none';
        if (continueBtn) {
            const nextLevel = getNextAssignedLevel();
            continueBtn.style.display = 'block';
            continueBtn.disabled = false;
            continueBtn.textContent = nextLevel ? `Continue to Level ${nextLevel} →` : 'Continue Playing';
            continueBtn.onclick = () => continueAfterPassedQuiz(continueBtn, nextLevel);
        }
    } else {
        gameState.updateProgressionState?.({
            checkpointStatus: 'quiz_available',
            approvalStatus: null,
            approverName: null,
            approvalTimestamp: null
        });
        gameState.saveToLocalStorage();
        syncPlayerRecord();
        if (retakeBtn) {
            retakeBtn.style.display = 'block';
            retakeBtn.onclick = () => {
                showProgressionQuiz();
            };
        }
        if (continueBtn) continueBtn.style.display = 'none';
    }
}

/**
 * After a passed checkpoint quiz: wait (briefly) for the cloud progress save so
 * the quiz_passed checkpoint reaches GGR_StudentProgress, then open the next
 * level. The local autosave already holds quiz_passed, which the access guard reads.
 */
async function continueAfterPassedQuiz(button, nextLevel) {
    if (!requireAuthenticatedStudent()) return;
    if (!nextLevel) {
        closeAllModals();
        return;
    }
    if (button) {
        button.disabled = true;
        button.textContent = 'Saving progress…';
    }
    gameState.saveToLocalStorage();
    let saveTimer = null;
    try {
        await Promise.race([
            getProgressSaveScheduler().whenIdle(),
            new Promise((resolve) => { saveTimer = setTimeout(resolve, 5000); })
        ]);
    } catch (_) {
        // Cloud save failures are queued for retry by SharePointSync.
    } finally {
        if (saveTimer) clearTimeout(saveTimer);
    }
    closeAllModals();
    window.location.href = buildLevelUrl(nextLevel);
}

function updateAllUI() {
    updateAssignedLevelBadge();
    updateCompetitionStatus();
    ensureInvestmentPlansForOwnedMines();
    renderMines();
    renderMineShop();
    renderMachinery();
    renderMachineryShop();
    renderStats();
    renderFeaturesAndCosts();
    renderLeaderboard();
    checkProgressionGoal();
}

function openMineModal(mine) {
    currentMineForInvestment = mine;
    const mineTitleEl = document.getElementById('modalMineTitle');
    const mineDescEl = document.getElementById('modalMineDesc');
    const mineMaxEl = document.getElementById('modalMaxInvestment');
    if (mineTitleEl) mineTitleEl.textContent = mine.name;
    if (mineDescEl) mineDescEl.textContent = mine.description;
    if (mineMaxEl) mineMaxEl.textContent = `Max Investment: $${mine.maxInvestmentPerRound}/round`;

    const upgradesContainer = document.getElementById('modalUpgrades');
    const availableUpgrades = Object.entries(gameState.gameConfig.mineUpgrades)
        .filter(([id]) => !mine.upgrades.includes(id) && isMineUpgradeAllowed(id));
    if (upgradesContainer) {
        if (!availableUpgrades.length) {
            upgradesContainer.innerHTML = '<p class="empty-state">No mine upgrades available at this level, or all unlocked upgrades applied.</p>';
        } else {
            upgradesContainer.innerHTML = availableUpgrades.map(([id, upgrade]) => {
                const canAfford = gameState.cash >= upgrade.cost;
                return `
                    <div class="upgrade-item">
                        <div>
                            <div class="upgrade-name">${upgrade.icon} ${upgrade.name}</div>
                            <div style="font-size:11px;color:#666;">${upgrade.description}</div>
                        </div>
                        <div style="display:flex;gap:8px;">
                            <span class="upgrade-cost">$${upgrade.cost}</span>
                            <button class="shop-btn" ${!canAfford ? 'disabled' : ''} data-upgrade-id="${id}">Apply</button>
                        </div>
                    </div>
                `;
            }).join('');

            upgradesContainer.querySelectorAll('[data-upgrade-id]').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    applyUpgrade(mine.id, e.target.dataset.upgradeId);
                });
            });
        }
    }

    const currentPlan = gameState.investmentPlans[mine.id] || { safe: 0, medium: 0, deep: 0 };
    const modalInvestmentsEl = document.getElementById('modalInvestments');
    if (modalInvestmentsEl) {
        modalInvestmentsEl.innerHTML = Object.entries(gameState.gameConfig.digTypes).map(([digType, dig]) => `
            <div class="investment-input-group">
                <label for="inv-${digType}">${dig.icon} ${dig.name}</label>
                <input type="number" id="inv-${digType}" min="0" step="1" value="${currentPlan[digType] || 0}">
            </div>
        `).join('');
    }

    const mineModal = document.getElementById('mineModal');
    if (mineModal) mineModal.classList.add('active');
}

function openPurchaseModal(type, itemId, itemName, cost) {
    pendingPurchase = { type, itemId, itemName, cost };
    const titleEl = document.getElementById('purchaseTitle');
    const descEl = document.getElementById('purchaseDesc');
    const priceEl = document.getElementById('purchasePrice');
    const confirmBtn = document.getElementById('confirmPurchase');
    const purchaseModal = document.getElementById('purchaseModal');
    if (titleEl) titleEl.textContent = `Purchase ${itemName}`;
    if (descEl) descEl.textContent = `Are you sure you want to purchase ${itemName}?`;
    if (priceEl) priceEl.textContent = `Cost: $${cost}`;
    if (confirmBtn) confirmBtn.disabled = gameState.cash < cost;
    if (purchaseModal) purchaseModal.classList.add('active');
}

function closeAllModals() {
    document.querySelectorAll('.modal').forEach(modal => modal.classList.remove('active'));
    pendingPurchase = null;
}

function saveMinePlan() {
    if (!currentMineForInvestment) return;
    const plan = {};
    let total = 0;
    for (const digType of Object.keys(gameState.gameConfig.digTypes)) {
        const inputEl = document.getElementById(`inv-${digType}`);
        const amount = Math.max(0, parseInt(inputEl?.value, 10) || 0);
        plan[digType] = amount;
        total += amount;
    }
    if (total > currentMineForInvestment.maxInvestmentPerRound) {
        alert(`Max investment for ${currentMineForInvestment.name}: $${currentMineForInvestment.maxInvestmentPerRound}`);
        return;
    }
    gameState.investmentPlans[currentMineForInvestment.id] = plan;
    gameState.currentRunActivity = true;
    gameState.saveToLocalStorage();
    closeAllModals();
    updateAllUI();
}

function confirmPurchase() {
    if (!pendingPurchase) return;
    const result = pendingPurchase.type === 'mine'
        ? gameState.purchaseMine(pendingPurchase.itemId)
        : gameState.purchaseMachinery(pendingPurchase.itemId);

    if (!result.success) {
        alert(`Error: ${result.error}`);
        return;
    }

    // Record asset-building action for investment profile
    gameState.recordInvestmentAction('assetBuilding', 1);

    gameState.saveToLocalStorage();
    updateAllUI();
    closeAllModals();
    syncPlayerRecord();
}

function applyUpgrade(mineId, upgradeId) {
    const result = gameState.upgradeMine(mineId, upgradeId);
    if (!result.success) {
        alert(`Error: ${result.error}`);
        return;
    }
    // Upgrading a mine = future-proofing investment
    gameState.recordInvestmentAction('futureProofing', 1);
    gameState.saveToLocalStorage();
    updateAllUI();
    const updatedMine = gameState.getOwnedMines().find(m => m.id === mineId);
    if (updatedMine) openMineModal(updatedMine);
    syncPlayerRecord();
}

function sellMachinery(index) {
    if (!confirm('Are you sure you want to sell this machinery?')) return;
    const result = gameState.sellMachinery(index);
    if (!result.success) {
        alert(`Error: ${result.error}`);
        return;
    }
    gameState.saveToLocalStorage();
    updateAllUI();
    syncPlayerRecord();
}

function rollRoundEvent() {
    if (!(gameState?.canRollRandomEvents?.(gameState.assignedLevel))) {
        return { roll: null, event: null };
    }
    const roll = Math.floor(Math.random() * 6) + 1;
    const event = Object.values(gameState.gameConfig.randomEvents).find(e => e.diceValue === roll);
    return { roll, event };
}

function getRoundEffects(event) {
    const effects = { profitMultiplier: 1, forcedDigType: null, cashPenalty: 0, message: '' };
    if (!event) return effects;

    effects.message = `${event.icon} Event (${event.diceValue}): ${event.description}`;
    if (event.effect === 'deduct_cash') {
        const deduction = Math.min(gameState.cash, event.cost || 0);
        gameState.cash -= deduction;
        effects.cashPenalty = -deduction;
    } else if (event.effect === 'halve_profits') {
        effects.profitMultiplier = 0.5;
    } else if (event.effect === 'double_profits') {
        effects.profitMultiplier = 2;
    } else if (event.effect === 'bonus_profit') {
        effects.profitMultiplier = 1 + (event.bonusPercentage || 0);
    } else if (event.effect === 'automatic_success') {
        const selected = prompt('Rich Vein Found! Choose automatic success dig type: safe, medium, or deep', 'deep');
        if (selected && ['safe', 'medium', 'deep'].includes(selected.toLowerCase().trim())) {
            effects.forcedDigType = selected.toLowerCase().trim();
        }
    }
    return effects;
}

function playRound() {
    if (!requireAuthenticatedStudent()) return;
    if (isTeacherPaused()) {
        alert('Game is currently paused by the teacher.');
        return;
    }

    const plannedByMine = gameState.getOwnedMines()
        .map(mine => ({ mine, plan: gameState.investmentPlans[mine.id] || { safe: 0, medium: 0, deep: 0 } }))
        .filter(entry => Object.values(entry.plan).some(value => (Number(value) || 0) > 0));

    if (!plannedByMine.length) {
        alert('Set at least one mine investment plan before rolling.');
        return;
    }

    const totalAtRisk = plannedByMine.reduce(
        (sum, entry) => sum + Object.values(entry.plan).reduce((accumulator, v) => accumulator + (Number(v) || 0), 0),
        0
    );
    if (totalAtRisk > gameState.cash) {
        alert(`Insufficient cash for all planned investments. At-risk total: $${totalAtRisk}`);
        return;
    }

    const { event } = shouldRollRandomEvent() ? rollRoundEvent() : { event: null };
    const roundEffects = getRoundEffects(event);

    const die1 = Math.floor(Math.random() * 6) + 1;
    const die2 = Math.floor(Math.random() * 6) + 1;
    const diceTotal = die1 + die2;
    displayDiceRoll(die1, die2, diceTotal);

    const results = [];
    let roundProfit = 0;

    plannedByMine.forEach(({ mine, plan }) => {
        Object.entries(plan).forEach(([digType, amount]) => {
            const numericAmount = Number(amount) || 0;
            if (numericAmount <= 0) return;
            const dig = gameState.gameConfig.digTypes[digType];
            const diceSuccess = diceTotal >= dig.successRange.min && diceTotal <= dig.successRange.max;
            const isSuccess = roundEffects.forcedDigType === digType ? true : diceSuccess;
            const finalProfit = gameState.calculateOutcome(
                numericAmount,
                digType,
                mine.id,
                isSuccess,
                roundEffects
            );
            results.push({
                mineName: mine.name,
                digKey: digType,
                digType: dig.name,
                icon: dig.icon,
                amount: numericAmount,
                profit: finalProfit,
                success: isSuccess
            });
            roundProfit += finalProfit;

            // Record investment action for Investment Profile tracking
            if (gameState.player?.studentCode) {
                let bucket = 'lowRisk';
                if (digType === 'deep')   bucket = 'highRisk';
                else if (digType === 'medium') bucket = 'profitChasing';
                else if (digType === 'safe')   bucket = 'lowRisk';
                gameState.recordInvestmentAction(bucket, numericAmount);
            }
        });
    });

    gameState.cash += roundProfit;
    const totalRoundChange = roundProfit + roundEffects.cashPenalty; // for display only
    if (typeof gameState.totalProfitLoss !== 'number') {
        gameState.totalProfitLoss = 0;
    }
    gameState.totalProfitLoss += roundProfit; // cashPenalty already deducted from cash directly
    if (!Array.isArray(gameState.roundHistory)) {
        gameState.roundHistory = [];
    }
    gameState.roundHistory.push({
        round: gameState.round,
        event: event ? event.id : null,
        totalProfit: totalRoundChange,
        cashAfter: gameState.cash,
        netWorth: gameState.getNetWorth(),
        results
    });
    gameState.round += 1;

    gameState.getOwnedMines().forEach(mine => {
        gameState.investmentPlans[mine.id] = { safe: 0, medium: 0, deep: 0 };
    });

    displayResults(results, totalRoundChange, roundEffects.message);
    gameState.saveToLocalStorage();
    updateAllUI();
    syncPlayerRecord();
    updateInvestmentProfilePanel();
}

function displayDiceRoll(die1, die2, total) {
    const diceDisplay = document.getElementById('dice-display');
    if (!diceDisplay) return;
    diceDisplay.innerHTML = `
        🎲 Dice 1: <strong>${die1}</strong><br>
        🎲 Dice 2: <strong>${die2}</strong><br>
        ➕ Total: <strong>${total}</strong>
    `;
}

function displayResults(results, totalProfit, eventMessage) {
    const container = document.getElementById('results-container');
    if (!container) return;
    let html = eventMessage ? `<div class="result-card">${eventMessage}</div>` : '';
    results.forEach(result => {
        const safePrincipalReturned = result.digKey === 'safe' && !result.success;
        const statusClass = result.success ? '' : (safePrincipalReturned ? '' : 'loss');
        const status = result.success ? '✅ SUCCESS' : (safePrincipalReturned ? '➖ RETURNED' : '❌ FAILED');
        html += `
            <div class="result-card ${statusClass}">
                <strong>${result.mineName}</strong> • ${result.icon} ${result.digType} ${status}<br>
                Investment: $${result.amount.toFixed(2)}<br>
                ${safePrincipalReturned ? `Principal Returned: $${result.amount.toFixed(2)}<br>` : ''}
                Profit: ${result.profit >= 0 ? '+' : ''}$${result.profit.toFixed(2)}
            </div>
        `;
    });
    html += `
        <div class="result-card" style="background:#e8f5e9;border-left-color:#4caf50;margin-top:10px;">
            <strong>Round Profit/Loss: ${totalProfit >= 0 ? '+' : ''}$${totalProfit.toFixed(2)}</strong>
        </div>
    `;
    container.innerHTML = html;
}

/**
 * Only the company name is editable in-game. Student identity is roster-backed
 * (GGR_LoginStudent) and cannot be changed here.
 */
function saveCompanyName(showAlert = true) {
    if (!requireAuthenticatedStudent()) return;
    const companyNameEl  = document.getElementById('companyNameInput');
    gameState.player.companyName     = (companyNameEl ? companyNameEl.value.trim() : '') || DEFAULT_COMPANY_NAME;
    gameState.saveToLocalStorage();
    updateAllUI();
    syncPlayerRecord();
    if (showAlert === true || (showAlert && typeof showAlert === 'object')) {
        alert('Company name saved.');
    }
}

function hydrateIdentityInputs() {
    const suggested = gameState.gameConfig.company?.suggestedNames || [];
    if (!gameState.player.companyName || gameState.player.companyName === DEFAULT_COMPANY_NAME) {
        gameState.player.companyName = suggested[0] || DEFAULT_COMPANY_NAME;
    }
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
    set('studentCodeInput',     gameState.player.studentCode);
    set('leaderboardNameInput', gameState.player.leaderboardName);
    set('studentIdInput',       gameState.player.studentId);
    set('studentNameInput',     gameState.player.studentName);
    set('companyNameInput',     gameState.player.companyName);
}

function parseJsonStorage(storageType, key) {
    try {
        const raw = storageType.getItem(key);
        if (!raw) return null;
        return JSON.parse(raw);
    } catch (error) {
        return null;
    }
}

/**
 * Returns the roster-verified session (created only from a successful
 * GGR_LoginStudent response), or null. Legacy/self-created sessions are null.
 */
function getSignedInStudentSession() {
    return getAuthenticatedStudentSession();
}

function isStrictModeEnabled() {
    return !!parseJsonStorage(localStorage, STRICT_MODE_KEY)?.enabled;
}

function getCompetitionContext() {
    const session = getSignedInStudentSession();
    const isLoggedIn = !!session;
    return {
        strictModeEnabled: isStrictModeEnabled(),
        session,
        isLoggedIn,
        canUseCompetitionFeatures: isLoggedIn
    };
}

/**
 * Identity comes only from the authenticated session — never from form
 * inputs, the teacher dashboard cache, or other browser state.
 */
function applyCompetitionSessionToIdentity(updateInputs = true) {
    const competition = getCompetitionContext();
    const session = competition.session;
    gameState.player.studentCode     = session?.studentCode     || '';
    gameState.player.leaderboardName = session?.leaderboardName || '';
    gameState.player.studentId       = session?.studentId       || '';
    gameState.player.studentName     = session?.studentName     || '';
    gameState.player.classCode       = session?.classCode       || '';
    if (updateInputs) {
        hydrateIdentityInputs();
    }
    return competition;
}

/**
 * Another tab signed in/out or switched student: never keep playing under a
 * different identity. Reload so the login gate and autosave ownership re-run.
 */
function handleStudentSessionChange() {
    const session = getAuthenticatedStudentSession();
    const playerCode = String(gameState?.player?.studentCode || '').trim().toUpperCase();
    const playerClass = String(gameState?.player?.classCode || '').trim().toUpperCase();
    if (!session || session.studentCode.toUpperCase() !== playerCode
        || String(session.classCode || '').trim().toUpperCase() !== playerClass) {
        if (session && typeof window.location.reload === 'function') {
            window.location.reload();
            return;
        }
        redirectToStudentLogin();
        return;
    }
    applyCompetitionSessionToIdentity(true);
    updateCompetitionStatus();
    renderLeaderboard();
}

function updateCloudSaveStatusLabel(status) {
    const statusEl = document.getElementById('cloudSaveStatus');
    if (!statusEl) return;
    statusEl.textContent = `Cloud save status: ${String(status || 'idle')}`;
}

function getProgressSaveScheduler() {
    if (!progressSaveScheduler) {
        progressSaveScheduler = createProgressSaveScheduler({
            resolveProgressKey(payload) {
                return String(payload?.progressKey || '').trim();
            },
            dispatchSave(payload) {
                if (typeof SharePointSync === 'undefined' || typeof SharePointSync.syncProgress !== 'function') {
                    return Promise.resolve({ skipped: true });
                }
                return SharePointSync.syncProgress(payload);
            }
        });
    }
    return progressSaveScheduler;
}

function updateCompetitionStatus() {
    const competition = applyCompetitionSessionToIdentity(false);
    const statusEl = document.getElementById('competition-status');
    updateStudentLoginCta(competition);
    if (!statusEl) return;
    if (competition.isLoggedIn) {
        statusEl.textContent = `Signed in as ${competition.session.leaderboardName} (${competition.session.studentCode}, class ${competition.session.classCode})`;
        updateInvestmentProfilePanel();
        return;
    }

    statusEl.textContent = 'Not signed in — sign in from the Home page to play.';
}

function buildStudentLoginUrl() {
    const url = new URL(STUDENT_LOGIN_PATH, window.location.href);
    url.searchParams.set('studentLogin', '1');
    url.searchParams.set('returnTo', window.location.href);
    return url.toString();
}

function updateStudentLoginCta(competition = getCompetitionContext()) {
    const loginCta = document.getElementById('studentLoginCta');
    const loginHint = document.getElementById('studentLoginHint');
    if (!loginCta) return;
    loginCta.href = buildStudentLoginUrl();
    if (competition.isLoggedIn) {
        loginCta.hidden = true;
        if (loginHint) {
            loginHint.textContent = 'Your identity comes from your class roster and cannot be edited here. Only the company name can be changed.';
        }
        return;
    }
    loginCta.hidden = false;
    if (loginHint) {
        loginHint.textContent = 'Sign in from the Home page with your Class Code, Student ID and PIN to play.';
    }
}

function logoutCompetitionSession() {
    // The autosave keeps its owner so the same student can resume after
    // signing in again; it is never loaded for a different student.
    const api = getStudentSessionApi();
    if (api) api.clearSession(localStorage);
    else localStorage.removeItem(STUDENT_SESSION_KEY);
    window.location.href = buildStudentLoginUrl();
}

function getDeviceBoardRecords() {
    try {
        const records = JSON.parse(localStorage.getItem(DEVICE_LEVEL_BOARD_KEY));
        return Array.isArray(records) ? records.filter((record) => record && typeof record === 'object') : [];
    } catch (error) {
        return [];
    }
}

function getDeviceLevelRecords(classCode, level) {
    const classKey = String(classCode || '').trim().toUpperCase();
    return getDeviceBoardRecords().filter((record) => record.classCode === classKey
        && Number(record.level) === Number(level)
        && Number.isFinite(Number(record.netWorth)))
        .map((record) => ({ ...record, netWorth: Number(record.netWorth), minesOwned: Number(record.minesOwned) || 0, averageRoundProfit: Number(record.averageRoundProfit) || 0 }));
}

/**
 * One public row per Class|Student|Level on this device. Only public fields
 * are kept (no StudentName/StudentID) because devices are shared.
 */
function upsertDeviceLevelRecord(record) {
    const records = getDeviceBoardRecords().filter((existing) => existing.progressKey !== record.progressKey);
    records.push(record);
    try {
        localStorage.setItem(DEVICE_LEVEL_BOARD_KEY, JSON.stringify(records.slice(-200)));
    } catch (_) {}
}

function removeDeviceLevelRecord(progressKey) {
    const records = getDeviceBoardRecords();
    const filtered = records.filter((record) => record.progressKey !== progressKey);
    if (filtered.length === records.length) return;
    try {
        localStorage.setItem(DEVICE_LEVEL_BOARD_KEY, JSON.stringify(filtered));
    } catch (_) {}
}

/**
 * A level game that has not been played yet (round 1, no history, no quiz
 * attempt). Its defaults are never uploaded: they could overwrite real
 * cloud progress whose state this device does not know.
 */
function isPristineLevelGame() {
    const history = Array.isArray(gameState?.roundHistory) ? gameState.roundHistory : [];
    const attempts = gameState?.getProgressionState?.(gameState.assignedLevel)?.quizAttempts;
    if (gameState?.currentRunActivity === true || Number(gameState?.round) > 1 || history.length) return false;
    if (Number(gameState?.cash) !== gameState?.getPlayableStartingCash?.()
        || Number(gameState?.totalProfitLoss || 0) !== 0
        || gameState?.machinery?.length) return false;
    const mines = Object.entries(gameState?.ownedMines || {}).filter(([, mine]) => mine?.owned);
    if (mines.length !== 1 || mines[0][0] !== 'southern_cross' || mines[0][1].upgrades?.length) return false;
    if (Object.values(gameState?.investmentPlans || {}).some((plan) =>
        Object.values(plan || {}).some((amount) => Number(amount) !== 0))) return false;
    // Historical checkpoint evidence is shared across runs. Older snapshots
    // without the optional activity signal can use dated current-run attempts.
    const createdAt = Date.parse(gameState?.runCreatedAt);
    return gameState?.currentRunActivity === false || !Number.isFinite(createdAt)
        || !(Array.isArray(attempts) && attempts.some((attempt) => Date.parse(attempt?.timestamp) >= createdAt));
}

function calculateStrategyLabel() {
    const totals = { safe: 0, medium: 0, deep: 0 };
    (Array.isArray(gameState.roundHistory) ? gameState.roundHistory : []).forEach(round => {
        (round.results || []).forEach(result => {
            if (result.digKey && result.digKey in totals) {
                totals[result.digKey] += result.amount || 0;
            }
        });
    });
    const max = Math.max(totals.safe, totals.medium, totals.deep);
    if (max === 0) return 'No strategy yet';
    if (max === totals.safe) return 'Safe-focused';
    if (max === totals.medium) return 'Balanced-medium';
    return 'High-risk deep';
}

function syncPlayerRecord() {
    // Saves are only built from the authenticated roster session identity.
    const session = requireAuthenticatedStudent();
    if (!session) return;
    if (gameState.saveLocked || isPristineLevelGame()) return;

    const totalRounds = Math.max(1, gameState.round - 1);

    const studentCode     = session.studentCode;
    const leaderboardName = session.leaderboardName;
    const studentId       = session.studentId;
    const studentName     = session.studentName;
    const classCode       = session.classCode;

    // Investment profile snapshot
    let investmentProfile = null;
    if (typeof InvestmentProfile !== 'undefined') {
        investmentProfile = InvestmentProfile.getBuckets(studentCode, gameState.assignedLevel);
    }

    const progressionState = gameState.getProgressionState?.(gameState.assignedLevel) || {};
    const progressionStateByLevel = JSON.parse(JSON.stringify(gameState.progressionStateByLevel || {}));
    const ownedMinesSnapshot = JSON.parse(JSON.stringify(gameState.ownedMines || {}));
    const machinerySnapshot = JSON.parse(JSON.stringify(gameState.machinery || []));
    const roundHistorySnapshot = JSON.parse(JSON.stringify(gameState.roundHistory || []));
    const investmentPlansSnapshot = JSON.parse(JSON.stringify(gameState.investmentPlans || {}));
    const latestQuizAttempt = Array.isArray(progressionState.quizAttempts) && progressionState.quizAttempts.length
        ? progressionState.quizAttempts[progressionState.quizAttempts.length - 1]
        : null;
    const checkpointStatus = progressionState.checkpointStatus || null;
    const quizScore = progressionState.quizScore ?? latestQuizAttempt?.score ?? null;
    const quizPassedAt = progressionState.quizPassedAt
        || (checkpointStatus === 'quiz_passed' ? latestQuizAttempt?.timestamp || null : null);
    const buildProgressionSnapshot = globalThis.WA_GOLD_RUSH_PROGRESS_SNAPSHOT?.build;
    const progressionSnapshotInput = {
        schemaVersion: PROGRESSION_SNAPSHOT_SCHEMA_VERSION,
        savedAt: new Date().toISOString(),
        assignedLevel: gameState.assignedLevel,
        round: gameState.round,
        cash: gameState.cash,
        netWorth: gameState.getNetWorth(),
        currentLevel: gameState.assignedLevel,
        rosterAssignedLevel: session.assignedLevel,
        player: {
            studentCode,
            leaderboardName,
            studentId,
            studentName,
            classCode
        },
        companyName: gameState.player.companyName || DEFAULT_COMPANY_NAME,
        ownedMines: ownedMinesSnapshot,
        machinery: machinerySnapshot,
        roundHistory: roundHistorySnapshot,
        totalProfitLoss: gameState.totalProfitLoss,
        investmentPlans: investmentPlansSnapshot,
        investmentProfile,
        strategyLabel: calculateStrategyLabel(),
        checkpointStatus,
        quizScore,
        quizPassedAt,
        quizAttempts: Array.isArray(progressionState.quizAttempts) ? progressionState.quizAttempts : [],
        approvalStatus: progressionState.approvalStatus || null,
        approverName: progressionState.approverName || null,
        approvalTimestamp: progressionState.approvalTimestamp || null,
        progressionStateByLevel,
        run: {
            generation: gameState.activeRun?.generation,
            runId: gameState.activeRun?.runId,
            startingNetWorth: gameState.startingNetWorth,
            storageSchemaVersion: getLevelSaveStore()?.STORAGE_SCHEMA_VERSION
        }
    };
    const progressionSnapshot = typeof buildProgressionSnapshot === 'function'
        ? buildProgressionSnapshot(progressionSnapshotInput)
        : progressionSnapshotInput;

    const progressKey = getLevelSaveStore()?.buildProgressKey({ classCode, studentCode }, gameState.assignedLevel) || '';
    if (progressKey) {
        upsertDeviceLevelRecord({
            progressKey,
            classCode,
            level: gameState.assignedLevel,
            leaderboardName,
            companyName: gameState.player.companyName || DEFAULT_COMPANY_NAME,
            round: gameState.round,
            netWorth: gameState.getNetWorth(),
            minesOwned: gameState.getOwnedMines().length,
            averageRoundProfit: gameState.totalProfitLoss / totalRounds,
            strategyLabel: calculateStrategyLabel(),
            updatedAt: new Date().toISOString()
        });
    }

    // Cloud uploads for this level are held while an earlier device save
    // still needs review (fail closed).
    if (cloudUploadHold) {
        updateCloudSaveStatusLabel('paused for teacher review');
        return;
    }

    // Non-blocking SharePoint sync
    if (typeof SharePointSync !== 'undefined') {
        const netWorth = Number(gameState.getNetWorth());
        const currentCash = Number(gameState.cash);
        const currentAssets = Number((gameState.getMineValue() + gameState.getMachineryValue()).toFixed(2));
        const needsSupport = checkpointStatus === 'quiz_available' && latestQuizAttempt?.passed === false;
        if (typeof SharePointSync.buildProgressPayload !== 'function') return;
        // level = the level being played (from the page URL); rosterAssignedLevel
        // = the GGR_Students assignment. They are deliberately kept separate.
        const protocol = getSaveProtocolApi();
        const v2Fields = buildProgressSyncOptions(protocol);
        if (!v2Fields) {
            updateCloudSaveStatusLabel('paused for teacher review');
            return;
        }
        const progressPayload = SharePointSync.buildProgressPayload({
            ...v2Fields,
            studentCode,
            classCode,
            level: gameState.assignedLevel,
            rosterAssignedLevel: session.assignedLevel,
            currentRound: gameState.round,
            currentCash,
            currentAssets,
            netWorth,
            score: netWorth,
            progressionMarkersJson: JSON.stringify(progressionSnapshot),
            badgesJson: JSON.stringify([]),
            achievementsCount: Array.isArray(progressionState.quizAttempts) ? progressionState.quizAttempts.length : 0,
            sessionStatus: 'authenticated',
            needsSupport,
            supportReason: needsSupport ? 'checkpoint_quiz_retry' : ''
        });
        // Captured now and frozen: later gameplay, URL changes or a pending
        // request can never relabel or mutate this save.
        getProgressSaveScheduler().schedule(Object.freeze(progressPayload));
    }
}

function buildProgressSyncOptions(protocol = getSaveProtocolApi()) {
    if (!protocol?.isEnabled()) return {};
    const run = gameState?.activeRun;
    const store = getLevelSaveStore();
    if (!Number.isInteger(run?.generation) || run.generation < 1
        || typeof run.runId !== 'string' || !run.runId.trim()
        || !Number.isFinite(gameState.startingNetWorth)
        || protocol.PROTOCOL_VERSION !== 2
        || store?.STORAGE_SCHEMA_VERSION !== 1) return null;
    return {
        protocolVersion: protocol.PROTOCOL_VERSION,
        runGeneration: run.generation,
        runId: run.runId,
        startingNetWorth: gameState.startingNetWorth,
        storageSchemaVersion: store.STORAGE_SCHEMA_VERSION
    };
}

function updateInvestmentProfilePanel() {
    const section = document.getElementById('investmentProfileSection');
    const canvas  = document.getElementById('investmentProfileChart');
    const details = document.getElementById('investmentProfileDetails');
    if (!section || !canvas || !details) return;
    if (typeof InvestmentProfile === 'undefined') return;

    const code = gameState?.player?.studentCode || '';
    if (!code) { section.style.display = 'none'; return; }

    section.style.display = '';
    const level = gameState?.assignedLevel || 2;
    InvestmentProfile.renderChart(canvas, code, level, { size: 100 });
    const profile = InvestmentProfile.compute(code, level);
    const pct = n => Math.round(n * 100);
    details.innerHTML = `<strong>${profile.ratingEmoji} ${escapeHtml(profile.ratingLabel)}</strong><br>
        ${InvestmentProfile.legendHtml(code, level)}<br>
        <span style="font-size:11px;color:#888;">${profile.total === 0 ? 'Play a round to build your profile.' :
        'Dominant: ' + escapeHtml(profile.dominantLabel) + ' (' + pct(profile.percentages[profile.dominantBucket]) + '%)'}</span>`;
}

function isTeacherPaused() {
    try {
        const pauseState = JSON.parse(localStorage.getItem(PAUSE_STATE_KEY));
        return !!pauseState?.paused;
    } catch (error) {
        return false;
    }
}

function updatePauseStateFromStorage() {
    const paused = isTeacherPaused();
    const rollBtn = document.getElementById('rollButton');
    const banner = document.getElementById('pause-banner');
    if (rollBtn) rollBtn.disabled = paused;
    if (banner) banner.classList.toggle('hidden', !paused);
}

function saveGame() {
    if (!requireAuthenticatedStudent()) return;
    saveCompanyName(false);
    const result = gameState.saveToLocalStorage();
    alert(result ? '✅ Game saved on this device for this level.' : '❌ Error saving game.');
}

/**
 * Reload THIS level's own save from this device. It never loads another
 * level's game and never changes the level being played.
 */
function loadGame() {
    const session = requireAuthenticatedStudent();
    if (!session) return;
    if (!confirm(`Reload your saved Level ${gameState.assignedLevel} game from this device? Unsaved changes will be lost.`)) return;
    const store = getLevelSaveStore();
    const found = store ? store.readLevelSave(localStorage, session, gameState.assignedLevel) : { status: 'unavailable' };
    if (found.status !== 'found') {
        alert(`❌ No saved Level ${gameState.assignedLevel} game found for your account on this device.`);
        return;
    }
    const result = gameState.loadFromLocalStorage();
    if (!result.success) {
        alert('❌ The saved game could not be loaded.');
        return;
    }
    setLevelLoadState('resumed');
    if (!enforceCurrentLevelAccess()) return;
    ensureInvestmentPlansForOwnedMines();
    applyCompetitionSessionToIdentity(false);
    hydrateIdentityInputs();
    updateAssignedLevelBadge();
    updateAllUI();
    closeAllModals();
    alert('✅ Game loaded successfully!');
}

/**
 * Restart ONLY the level being played. Other levels' games, checkpoint
 * evidence and earned access are kept. The previous game is archived on this
 * device and any queued cloud saves for it are withdrawn so they can never be
 * replayed over the new game.
 */
function resetGame() {
    const session = requireAuthenticatedStudent();
    if (!session) return;
    const level = gameState.assignedLevel;
    if (gameState.getRunProtectionReason()
        || (cloudUploadHold && cloudUploadHold !== 'unverified_new_slot')) {
        alert('❌ This save is protected. Reload or ask your teacher to resolve it before restarting.');
        return;
    }
    if (!confirm(`Restart Level ${level}? Your Level ${level} game will start again from the beginning. Your other levels and unlocked levels are kept.`)) return;
    const result = gameState.restartLevelRun({ reason: 'student_restart' });
    if (!result.ok) {
        alert('❌ Could not restart this level safely (the previous game could not be archived). Nothing was changed.');
        return;
    }
    const progressKey = getLevelSaveStore()?.buildProgressKey(session, level) || '';
    if (progressKey) {
        getProgressSaveScheduler().discardPending?.(progressKey);
        if (typeof SharePointSync !== 'undefined' && typeof SharePointSync.discardQueuedForProgressKey === 'function') {
            SharePointSync.discardQueuedForProgressKey(progressKey, 'superseded_by_reset');
        }
        removeDeviceLevelRecord(progressKey);
    }
    if (typeof InvestmentProfile !== 'undefined' && typeof InvestmentProfile.resetLevel === 'function') {
        InvestmentProfile.resetLevel(session.studentCode, level);
    }
    gameState.applyLevelConfigAdapter?.();
    applyCompetitionSessionToIdentity(false);
    hydrateIdentityInputs();
    gameState.saveToLocalStorage();
    setLevelLoadState('started', 'restarted');
    updateAssignedLevelBadge();
    updateAllUI();
    closeAllModals();
    alert(`✅ Level ${level} restarted.`);
}
