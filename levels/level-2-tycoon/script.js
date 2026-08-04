/**
 * Level 2: Mining Tycoon - Main Game Logic
 * Levels 2–5 progression condensed into one playable mode.
 */

const CLASS_RECORDS_KEY = 'wa_gold_rush_class_records';
const PAUSE_STATE_KEY = 'wa_gold_rush_pause_state';
const PLAYER_KEY_STORAGE = 'wa_gold_rush_player_key';
const STRICT_MODE_KEY = 'wa_gold_rush_strict_mode';
const TEACHER_DASHBOARD_KEY = 'teacher_dashboard';
const STUDENT_SESSION_KEY = 'wa_gold_rush_student_session';
const DEFAULT_COMPANY_NAME = 'Untitled Mining Co.';
const RANDOM_EVENT_MIN_LEVEL = 4;
const RANDOM_EVENT_ROLL_INTERVAL = 10;

let gameState = null;
let currentMineForInvestment = null;
let pendingPurchase = null;

function getAssignedLevelFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const level = Number(params.get('level'));
    return [2, 3, 4, 5].includes(level) ? level : 2;
}

function getAssignedLevelLabel(level) {
    const labels = {
        2: 'Level 2 Goldfields Venture Mode',
        3: 'Level 3 WA Goldfields Mode',
        4: 'Level 4 Advanced Operations Mode',
        5: 'Level 5 Classroom Challenge Mode'
    };
    return labels[level] || 'Level 2 Goldfields Venture Mode';
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

function resolveConfigPath() {
    const currentPath = window.location.pathname || '';
    if (currentPath.includes('/blob/') || currentPath.includes('/tree/')) {
        return null;
    }
    return '../../shared/game-config.json';
}

document.addEventListener('DOMContentLoaded', async function() {
    gameState = new GameState();
    gameState.assignedLevel = getAssignedLevelFromUrl();

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

    try {
        gameState.loadFromLocalStorage();
        gameState.assignedLevel = getAssignedLevelFromUrl();
        ensureInvestmentPlansForOwnedMines();
        hydrateIdentityInputs();
        applyCompetitionSessionToIdentity();
        setupEventListeners();
        updatePauseStateFromStorage();
        updateAssignedLevelBadge();
        updateAllUI();
        syncPlayerRecord();
        updateInvestmentProfilePanel();
    } catch (err) {
        console.error('Level 2 init error:', err);
        // Attempt to recover by resetting to a clean state and re-running setup
        try {
            gameState.reset();
            gameState.assignedLevel = getAssignedLevelFromUrl();
            ensureInvestmentPlansForOwnedMines();
            hydrateIdentityInputs();
            setupEventListeners();
            updatePauseStateFromStorage();
            updateAssignedLevelBadge();
            updateAllUI();
        } catch (recoveryErr) {
            console.error('Level 2 recovery failed:', recoveryErr);
            const minesContainer = document.getElementById('mines-container');
            if (minesContainer) {
                minesContainer.innerHTML = '<p class="empty-state">Game failed to initialize. Please refresh the page or click "New Game".</p>';
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
    if (saveIdentityBtn) saveIdentityBtn.addEventListener('click', saveIdentity);
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
        if ((event.key === STRICT_MODE_KEY) || (event.key === TEACHER_DASHBOARD_KEY) || (event.key === CLASS_RECORDS_KEY)) {
            applyCompetitionSessionToIdentity(false);
            updateCompetitionStatus();
            renderLeaderboard();
        }
    });
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
    shop.innerHTML = '';

    if (availableMines.length === 0) {
        shop.innerHTML = '<p class="empty-state">All currently unlocked mines are owned.</p>';
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
            lockMessage.textContent = 'Login required for competition features in Strict Classroom Mode. You can continue playing and saving your progress without competition features.';
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
    const records = getClassRecords();
    const leaderboard = [...records].sort((a, b) => b.netWorth - a.netWorth).slice(0, 10);
    const wealthiest = leaderboard[0];
    const avgWealth = records.length ? records.reduce((s, r) => s + r.netWorth, 0) / records.length : 0;
    const mostMines = [...records].sort((a, b) => b.minesOwned - a.minesOwned)[0];
    const profitable = [...records].sort((a, b) => b.averageRoundProfit - a.averageRoundProfit)[0];

    if (leaderboardSummary) {
        leaderboardSummary.innerHTML = `
            Wealthiest: ${wealthiest ? `${escapeHtml(wealthiest.companyName)} ($${wealthiest.netWorth.toFixed(2)})` : 'N/A'}<br>
            Most mines: ${mostMines ? `${escapeHtml(mostMines.companyName)} (${mostMines.minesOwned})` : 'N/A'}<br>
            Most profitable strategy: ${profitable ? `${escapeHtml(profitable.companyName)} (${escapeHtml(profitable.strategyLabel || 'Balanced')})` : 'N/A'}<br>
            Average class wealth: $${avgWealth.toFixed(2)}
        `;
    }

    if (!leaderboardList) return;
    if (!leaderboard.length) {
        leaderboardList.innerHTML = '<p class="empty-state">No classroom records yet.</p>';
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
        const statusClass = result.success ? '' : 'loss';
        const status = result.success ? '✅ SUCCESS' : '❌ FAILED';
        html += `
            <div class="result-card ${statusClass}">
                <strong>${result.mineName}</strong> • ${result.icon} ${result.digType} ${status}<br>
                Investment: $${result.amount.toFixed(2)}<br>
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

function saveIdentity(showAlert = true) {
    const studentCodeEl  = document.getElementById('studentCodeInput');
    const lbNameEl       = document.getElementById('leaderboardNameInput');
    const studentIdEl    = document.getElementById('studentIdInput');
    const studentNameEl  = document.getElementById('studentNameInput');
    const companyNameEl  = document.getElementById('companyNameInput');
    gameState.player.studentCode     = studentCodeEl  ? studentCodeEl.value.trim()  : gameState.player.studentCode;
    gameState.player.leaderboardName = lbNameEl       ? lbNameEl.value.trim()       : gameState.player.leaderboardName;
    gameState.player.studentId       = studentIdEl    ? studentIdEl.value.trim()    : gameState.player.studentId;
    gameState.player.studentName     = studentNameEl  ? studentNameEl.value.trim()  : gameState.player.studentName;
    gameState.player.companyName     = (companyNameEl ? companyNameEl.value.trim() : '') || DEFAULT_COMPANY_NAME;
    gameState.saveToLocalStorage();
    updateAllUI();
    syncPlayerRecord();
    if (showAlert) {
        alert('Identity saved.');
    }
}

function hydrateIdentityInputs() {
    const suggested = gameState.gameConfig.company?.suggestedNames || [];
    if (!gameState.player.companyName || gameState.player.companyName === DEFAULT_COMPANY_NAME) {
        gameState.player.companyName = suggested[0] || DEFAULT_COMPANY_NAME;
    }
    const studentCodeEl  = document.getElementById('studentCodeInput');
    const lbNameEl       = document.getElementById('leaderboardNameInput');
    const studentIdEl    = document.getElementById('studentIdInput');
    const studentNameEl  = document.getElementById('studentNameInput');
    const companyNameEl  = document.getElementById('companyNameInput');
    if (studentCodeEl)  studentCodeEl.value  = gameState.player.studentCode     || '';
    if (lbNameEl)       lbNameEl.value       = gameState.player.leaderboardName || '';
    if (studentIdEl)    studentIdEl.value    = gameState.player.studentId       || '';
    if (studentNameEl)  studentNameEl.value  = gameState.player.studentName     || '';
    if (companyNameEl)  companyNameEl.value  = gameState.player.companyName     || '';
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

function getTeacherStudents() {
    const data = parseJsonStorage(localStorage, TEACHER_DASHBOARD_KEY);
    return Array.isArray(data?.students) ? data.students : [];
}

function getStoredStudentSession() {
    const session = parseJsonStorage(localStorage, STUDENT_SESSION_KEY);
    return session && typeof session === 'object' ? session : null;
}

/**
 * Returns a normalised session object if a student is logged in via StudentCode,
 * or null if not logged in.
 */
function getSignedInStudentSession() {
    try {
        const session = getStoredStudentSession();
        if (!session) return null;
        const code = String(session.studentCode || '').trim();
        if (!code) return null;
        return {
            studentCode:     code,
            leaderboardName: String(session.leaderboardName || code).trim(),
            studentId:       String(session.studentId || '').trim(),
            studentName:     String(session.studentName || '').trim(),
            classCode:       String(session.classCode || '').trim()
        };
    } catch (_) {
        return null;
    }
}

function getMatchedStudentFromSession(session) {
    if (!session) return null;
    const sessionCode = String(session.studentCode || session.studentId || '').trim().toLowerCase();
    if (!sessionCode) return null;
    return getTeacherStudents().find(student =>
        String(student?.studentCode || student?.displayId || student?.id || '')
            .trim().toLowerCase() === sessionCode
    ) || null;
}

function isStrictModeEnabled() {
    return !!parseJsonStorage(localStorage, STRICT_MODE_KEY)?.enabled;
}

function getCompetitionContext() {
    const strictModeEnabled = isStrictModeEnabled();
    const session = getSignedInStudentSession();
    const matchedStudent = getMatchedStudentFromSession(session);
    const isLoggedIn = !!session;
    return {
        strictModeEnabled,
        session,
        matchedStudent,
        isLoggedIn,
        canUseCompetitionFeatures: !strictModeEnabled || isLoggedIn
    };
}

function applyCompetitionSessionToIdentity(updateInputs = true) {
    const competition = getCompetitionContext();
    if (!competition.isLoggedIn) return competition;
    const session = competition.session;
    const matched = competition.matchedStudent;
    gameState.player.studentCode     = matched?.studentCode || matched?.displayId || session.studentCode || '';
    gameState.player.leaderboardName = matched?.leaderboardName || session.leaderboardName || session.studentCode || '';
    gameState.player.studentId       = matched?.studentId       || session.studentId  || '';
    gameState.player.studentName     = matched?.studentName     || session.studentName || '';
    if (updateInputs) {
        const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
        set('studentCodeInput',      gameState.player.studentCode);
        set('leaderboardNameInput',  gameState.player.leaderboardName);
        set('studentIdInput',        gameState.player.studentId);
        set('studentNameInput',      gameState.player.studentName);
    }
    return competition;
}

function updateCompetitionStatus() {
    const competition = applyCompetitionSessionToIdentity(false);
    const statusEl = document.getElementById('competition-status');
    if (!statusEl) return;
    if (competition.isLoggedIn) {
        const lbName = competition.session.leaderboardName || competition.session.studentCode;
        statusEl.textContent = `Competition Status: Logged in as ${lbName} (${competition.session.studentCode})`;
        updateInvestmentProfilePanel();
        return;
    }
    statusEl.textContent = competition.strictModeEnabled
        ? 'Competition Status: Free-play mode (login required for competition features)'
        : 'Competition Status: Free-play mode';
}

function logoutCompetitionSession() {
    localStorage.removeItem(STUDENT_SESSION_KEY);
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
    set('studentCodeInput',     '');
    set('leaderboardNameInput', '');
    set('studentIdInput',       '');
    set('studentNameInput',     '');
    gameState.player.studentCode     = '';
    gameState.player.leaderboardName = '';
    gameState.player.studentId       = '';
    gameState.player.studentName     = '';
    gameState.saveToLocalStorage();
    updateAllUI();
}

function getOrCreatePlayerKey() {
    let key = localStorage.getItem(PLAYER_KEY_STORAGE);
    if (!key) {
        key = (typeof crypto !== 'undefined' && crypto.randomUUID)
            ? crypto.randomUUID()
            : `player_${Date.now()}_${(() => {
                if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
                    return Array.from(crypto.getRandomValues(new Uint32Array(2))).join('_');
                }
                return `${Math.random().toString(36).slice(2, 12)}_${Math.random().toString(36).slice(2, 12)}`;
            })()}`;
        localStorage.setItem(PLAYER_KEY_STORAGE, key);
    }
    return key;
}

function getClassRecords() {
    try {
        const records = JSON.parse(localStorage.getItem(CLASS_RECORDS_KEY));
        return Array.isArray(records) ? records : [];
    } catch (error) {
        return [];
    }
}

function saveClassRecords(records) {
    localStorage.setItem(CLASS_RECORDS_KEY, JSON.stringify(records));
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
    const competition = getCompetitionContext();
    if (!competition.canUseCompetitionFeatures) {
        const lockMessage = document.getElementById('competition-lock-message');
        if (lockMessage) {
            lockMessage.textContent = 'Login required to publish leaderboard/class records while Strict Classroom Mode is on. You can continue playing and saving locally.';
            lockMessage.classList.remove('hidden');
        }
        return;
    }

    const playerCode = competition.isLoggedIn
        ? (competition.session.studentCode || gameState.player.studentCode)
        : gameState.player.studentCode;

    // Don't publish anonymous records
    if (!playerCode) return;

    const playerKey = getOrCreatePlayerKey();
    const records = getClassRecords();
    const totalRounds = Math.max(1, gameState.round - 1);

    const studentCode     = playerCode;
    const leaderboardName = competition.isLoggedIn
        ? (competition.session.leaderboardName || competition.session.studentCode || gameState.player.leaderboardName || playerCode)
        : (gameState.player.leaderboardName || playerCode);
    const studentId   = competition.isLoggedIn
        ? (competition.session.studentId   || gameState.player.studentId)
        : gameState.player.studentId;
    const studentName = competition.isLoggedIn
        ? (competition.session.studentName || gameState.player.studentName)
        : (gameState.player.studentName || '');

    // Investment profile snapshot
    let investmentProfile = null;
    if (typeof InvestmentProfile !== 'undefined') {
        investmentProfile = InvestmentProfile.getBuckets(studentCode, gameState.assignedLevel);
    }

    const record = {
        playerKey,
        studentCode,
        leaderboardName,
        studentId,
        studentName,
        level: gameState.assignedLevel,
        round: gameState.round,
        cash: gameState.cash,
        netWorth: gameState.getNetWorth(),
        minesOwned: gameState.getOwnedMines().length,
        machineryOwned: Array.isArray(gameState.machinery) ? gameState.machinery.length : 0,
        totalProfitLoss: gameState.totalProfitLoss,
        averageRoundProfit: gameState.totalProfitLoss / totalRounds,
        strategyLabel: calculateStrategyLabel(),
        investmentProfile,
        updatedAt: new Date().toISOString()
    };

    const index = records.findIndex(r => r.playerKey === playerKey);
    if (index >= 0) records[index] = record;
    else records.push(record);
    saveClassRecords(records);
    syncTeacherDashboardRecord(record);

    // Non-blocking SharePoint sync
    if (typeof SharePointSync !== 'undefined') {
        SharePointSync.syncProgress({
            studentCode,
            level: gameState.assignedLevel,
            score: gameState.getNetWorth(),
            netWorth: gameState.getNetWorth(),
            round: gameState.round,
            minesOwned: gameState.getOwnedMines().length,
            strategyLabel: calculateStrategyLabel(),
            investmentProfile
        });
    }
}

function syncTeacherDashboardRecord(record) {
    if (typeof TeacherDashboard === 'undefined') return;
    const dashboard = new TeacherDashboard();
    dashboard.loadFromLocalStorage();
    const updated = dashboard.syncFromPlayerRecord(record);
    if (updated) {
        dashboard.saveToLocalStorage();
    }
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
    saveIdentity(false);
    const result = gameState.saveToLocalStorage();
    alert(result.success ? '✅ Game saved successfully!' : `❌ Error saving game: ${result.error}`);
}

function loadGame() {
    if (!confirm('Load saved game? This will overwrite current progress.')) return;
    const result = gameState.loadFromLocalStorage();
    if (!result.success) {
        alert('❌ No save data found');
        return;
    }
    const savedLevel = gameState.assignedLevel;
    const urlLevel = getAssignedLevelFromUrl();
    if (savedLevel !== urlLevel && !confirm(
        `This save was created on Level ${savedLevel}, but you are playing Level ${urlLevel}. Continue with Level ${urlLevel}?`
    )) {
        // Keep the saved level — already restored by loadFromLocalStorage
    } else {
        gameState.assignedLevel = urlLevel;
    }
    ensureInvestmentPlansForOwnedMines();
    hydrateIdentityInputs();
    updateAssignedLevelBadge();
    updateAllUI();
    closeAllModals();
    syncPlayerRecord();
    alert('✅ Game loaded successfully!');
}

function removePlayerRecord(playerKey) {
    const records = getClassRecords();
    const filtered = records.filter(r => r.playerKey !== playerKey);
    saveClassRecords(filtered);
}

function resetGame() {
    if (!confirm('Start a new game? All progress will be lost.')) return;
    const playerKey = getOrCreatePlayerKey();
    gameState.reset();
    gameState.assignedLevel = getAssignedLevelFromUrl();
    localStorage.removeItem('level2_autosave');
    removePlayerRecord(playerKey);
    hydrateIdentityInputs();
    updateAssignedLevelBadge();
    updateAllUI();
    closeAllModals();
    syncPlayerRecord();
    alert('✅ New game started!');
}
