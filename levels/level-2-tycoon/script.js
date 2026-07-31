/**
 * Level 2: Mining Tycoon - Main Game Logic
 * Levels 2–5 progression condensed into one playable mode.
 */

const CLASS_RECORDS_KEY  = 'wa_gold_rush_class_records';
const PAUSE_STATE_KEY    = 'wa_gold_rush_pause_state';
const PLAYER_KEY_STORAGE = 'wa_gold_rush_player_key';
const DEFAULT_COMPANY_NAME = 'Untitled Mining Co.';
const RANDOM_EVENT_MIN_LEVEL = 4;
const RANDOM_EVENT_ROLL_INTERVAL = 10;
const MINE_UPGRADE_ORDER = ['silver', 'gold', 'platinum'];
const MACHINERY_ORDER = ['excavator', 'drilling_rig', 'super_drill'];

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
    if (level <= 2) return [];
    if (level === 3) return MINE_UPGRADE_ORDER.slice(0, 1);
    if (level === 4) return MINE_UPGRADE_ORDER.slice(0, 2);
    return [...MINE_UPGRADE_ORDER];
}

function getAllowedMachineryIds(level = gameState?.assignedLevel || 2) {
    if (level <= 2) return MACHINERY_ORDER.slice(0, 1);
    if (level === 3) return MACHINERY_ORDER.slice(0, 2);
    return [...MACHINERY_ORDER];
}

function isMineUpgradeAllowed(upgradeId, level = gameState?.assignedLevel || 2) {
    return getAllowedMineUpgradeIds(level).includes(upgradeId);
}

function isMachineryAllowed(machineryId, level = gameState?.assignedLevel || 2) {
    return getAllowedMachineryIds(level).includes(machineryId);
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
    gameState.isMineUpgradeAllowed = (upgradeId, level = gameState.assignedLevel) => isMineUpgradeAllowed(upgradeId, level);
    gameState.isMachineryAllowed = (machineryId, level = gameState.assignedLevel) => isMachineryAllowed(machineryId, level);
    gameState.canRollRandomEvents = (level = gameState.assignedLevel) => level >= RANDOM_EVENT_MIN_LEVEL;

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

    gameState.loadFromLocalStorage();
    gameState.assignedLevel = getAssignedLevelFromUrl();
    ensureInvestmentPlansForOwnedMines();
    hydrateIdentityInputs();
    setupEventListeners();
    updatePauseStateFromStorage();
    updateAssignedLevelBadge();
    updateAllUI();
    syncPlayerRecord();
});

function setupEventListeners() {
    document.getElementById('rollButton').addEventListener('click', playRound);
    document.getElementById('saveButton').addEventListener('click', saveGame);
    document.getElementById('loadButton').addEventListener('click', loadGame);
    document.getElementById('resetButton').addEventListener('click', resetGame);
    document.getElementById('saveMinePlanButton').addEventListener('click', saveMinePlan);
    document.getElementById('saveIdentityButton').addEventListener('click', saveIdentity);

    document.querySelectorAll('.modal-close').forEach(btn => {
        btn.addEventListener('click', closeAllModals);
    });
    document.getElementById('confirmPurchase').addEventListener('click', confirmPurchase);
    document.getElementById('cancelPurchase').addEventListener('click', closeAllModals);

    window.addEventListener('click', function(event) {
        if (event.target.classList.contains('modal')) {
            closeAllModals();
        }
    });

    window.addEventListener('storage', function(event) {
        if (event.key === PAUSE_STATE_KEY) {
            updatePauseStateFromStorage();
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
    if (gameState.machinery.length === 0) {
        container.innerHTML = '<p class="empty-state">No machinery owned yet.</p>';
        return;
    }
    container.innerHTML = '';
    gameState.machinery.forEach((item, index) => {
        const config = gameState.gameConfig.machinery[item.id];
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
    const machineryList = Object.entries(gameState.gameConfig.machinery)
        .filter(([id]) => isMachineryAllowed(id));
    shop.innerHTML = '';
    if (!machineryList.length) {
        shop.innerHTML = '<p class="empty-state">No machinery available at this assigned level.</p>';
        return;
    }
    machineryList.forEach(([id, machinery]) => {
        const ownedCount = gameState.machinery.filter(m => m.id === id).length;
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

    document.getElementById('cash').textContent = `$${gameState.cash.toFixed(2)}`;
    document.getElementById('netWorth').textContent = `$${netWorth.toFixed(2)}`;
    document.getElementById('minesOwned').textContent = gameState.getOwnedMines().length;
    document.getElementById('machineryCount').textContent = gameState.machinery.length;
    document.getElementById('round').textContent = gameState.round;

    document.getElementById('summary-cash').textContent = `$${gameState.cash.toFixed(2)}`;
    document.getElementById('summary-mines').textContent = `$${mineValue.toFixed(2)}`;
    document.getElementById('summary-machinery').textContent = `$${machineryValue.toFixed(2)}`;
    document.getElementById('summary-networth').textContent = `$${netWorth.toFixed(2)}`;
    document.getElementById('summary-total').textContent = `$${gameState.totalProfitLoss.toFixed(2)}`;
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
    document.getElementById('features-costs').innerHTML = `
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
    const records = getClassRecords();
    const leaderboard = [...records].sort((a, b) => b.netWorth - a.netWorth).slice(0, 10);
    const wealthiest = leaderboard[0];
    const avgWealth = records.length ? records.reduce((s, r) => s + r.netWorth, 0) / records.length : 0;
    const mostMines = [...records].sort((a, b) => b.minesOwned - a.minesOwned)[0];
    const profitable = [...records].sort((a, b) => b.averageRoundProfit - a.averageRoundProfit)[0];

    document.getElementById('leaderboard-summary').innerHTML = `
        Wealthiest: ${wealthiest ? `${wealthiest.companyName} ($${wealthiest.netWorth.toFixed(2)})` : 'N/A'}<br>
        Most mines: ${mostMines ? `${mostMines.companyName} (${mostMines.minesOwned})` : 'N/A'}<br>
        Most profitable strategy: ${profitable ? `${profitable.companyName} (${profitable.strategyLabel || 'Balanced'})` : 'N/A'}<br>
        Average class wealth: $${avgWealth.toFixed(2)}
    `;

    const list = document.getElementById('leaderboard-list');
    if (!leaderboard.length) {
        list.innerHTML = '<p class="empty-state">No classroom records yet.</p>';
        return;
    }
    list.innerHTML = leaderboard.map((record, index) => `
        <div class="leaderboard-item">
            <span>${index + 1}. ${record.companyName}</span>
            <span>$${record.netWorth.toFixed(2)}</span>
        </div>
    `).join('');
}

function updateAllUI() {
    updateAssignedLevelBadge();
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
    document.getElementById('modalMineTitle').textContent = mine.name;
    document.getElementById('modalMineDesc').textContent = mine.description;
    document.getElementById('modalMaxInvestment').textContent = `Max Investment: $${mine.maxInvestmentPerRound}/round`;

    const upgradesContainer = document.getElementById('modalUpgrades');
    const availableUpgrades = Object.entries(gameState.gameConfig.mineUpgrades)
        .filter(([id]) => !mine.upgrades.includes(id) && isMineUpgradeAllowed(id));
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

    const currentPlan = gameState.investmentPlans[mine.id] || { safe: 0, medium: 0, deep: 0 };
    document.getElementById('modalInvestments').innerHTML = Object.entries(gameState.gameConfig.digTypes).map(([digType, dig]) => `
        <div class="investment-input-group">
            <label for="inv-${digType}">${dig.icon} ${dig.name}</label>
            <input type="number" id="inv-${digType}" min="0" step="1" value="${currentPlan[digType] || 0}">
        </div>
    `).join('');

    document.getElementById('mineModal').classList.add('active');
}

function openPurchaseModal(type, itemId, itemName, cost) {
    pendingPurchase = { type, itemId, itemName, cost };
    document.getElementById('purchaseTitle').textContent = `Purchase ${itemName}`;
    document.getElementById('purchaseDesc').textContent = `Are you sure you want to purchase ${itemName}?`;
    document.getElementById('purchasePrice').textContent = `Cost: $${cost}`;
    document.getElementById('confirmPurchase').disabled = gameState.cash < cost;
    document.getElementById('purchaseModal').classList.add('active');
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
        });
    });

    gameState.cash += roundProfit;
    const totalRoundChange = roundProfit + roundEffects.cashPenalty;
    gameState.totalProfitLoss += totalRoundChange;
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
}

function displayDiceRoll(die1, die2, total) {
    document.getElementById('dice-display').innerHTML = `
        🎲 Dice 1: <strong>${die1}</strong><br>
        🎲 Dice 2: <strong>${die2}</strong><br>
        ➕ Total: <strong>${total}</strong>
    `;
}

function displayResults(results, totalProfit, eventMessage) {
    const container = document.getElementById('results-container');
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
    gameState.player.studentId   = document.getElementById('studentIdInput').value.trim();
    gameState.player.studentName = document.getElementById('studentNameInput').value.trim();
    gameState.player.companyName = document.getElementById('companyNameInput').value.trim() || DEFAULT_COMPANY_NAME;
    gameState.saveToLocalStorage();
    updateAllUI();
    updateIdentityBanner();
    syncPlayerRecord();
    if (showAlert) {
        alert('Identity saved.');
    }
}

function hydrateIdentityInputs() {
    const suggested = gameState.gameConfig.company?.suggestedNames || [];

    // Prefer student session from shared key (set by teacher when assigning login)
    const session = getPlayerSession();
    if (session && session.studentId && !gameState.player.studentId) {
        gameState.player.studentId   = session.studentId;
        gameState.player.studentName = session.studentName || gameState.player.studentName;
        gameState.player.companyName = session.companyName || gameState.player.companyName;
    }

    if (!gameState.player.companyName || gameState.player.companyName === DEFAULT_COMPANY_NAME) {
        gameState.player.companyName = suggested[0] || DEFAULT_COMPANY_NAME;
    }
    document.getElementById('studentIdInput').value   = gameState.player.studentId   || '';
    document.getElementById('studentNameInput').value = gameState.player.studentName || '';
    document.getElementById('companyNameInput').value = gameState.player.companyName || '';

    // Show identity bar if session exists
    updateIdentityBanner();
}

function updateIdentityBanner() {
    const banner = document.getElementById('student-identity-banner');
    if (!banner) return;
    const name = gameState.player.studentName || '';
    const level = gameState.assignedLevel || 2;
    if (name) {
        banner.textContent = `👤 ${name} — Level ${level} Goldfields Venture`;
        banner.classList.remove('hidden');
    } else {
        banner.classList.add('hidden');
    }
}

function getOrCreatePlayerKey() {
    // If a full session object exists (set by teacher dashboard or login), return the studentId.
    // Otherwise fall back to a plain UUID stored at the same key.
    try {
        const raw = localStorage.getItem(PLAYER_KEY_STORAGE);
        if (!raw) {
            // Create a new anonymous session key
            const key = (typeof crypto !== 'undefined' && crypto.randomUUID)
                ? crypto.randomUUID()
                : `player_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
            localStorage.setItem(PLAYER_KEY_STORAGE, key);
            return key;
        }
        // Try to parse as JSON session object
        try {
            const session = JSON.parse(raw);
            if (session && typeof session === 'object' && session.studentId) {
                return session.studentId;
            }
        } catch (e) { /* not JSON — treat as plain key */ }
        return raw;
    } catch (e) {
        return 'anonymous';
    }
}

function getPlayerSession() {
    try {
        const raw = localStorage.getItem(PLAYER_KEY_STORAGE);
        if (!raw) return null;
        try {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') return parsed;
        } catch (e) { /* plain string */ }
        return null;
    } catch (e) {
        return null;
    }
}

function getClassRecords() {
    if (typeof LeaderboardStore !== 'undefined') {
        return LeaderboardStore.loadLeaderboardStore().entries;
    }
    try {
        const records = JSON.parse(localStorage.getItem(CLASS_RECORDS_KEY));
        return Array.isArray(records) ? records : [];
    } catch (error) {
        return [];
    }
}

function saveClassRecords(records) {
    if (typeof LeaderboardStore !== 'undefined') {
        LeaderboardStore.saveLeaderboardStore({ version: 2, entries: records });
        return;
    }
    localStorage.setItem(CLASS_RECORDS_KEY, JSON.stringify(records));
}

function calculateStrategyLabel() {
    const totals = { safe: 0, medium: 0, deep: 0 };
    gameState.roundHistory.forEach(round => {
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
    const playerKey = getOrCreatePlayerKey();
    const session   = getPlayerSession();
    const totalRounds = Math.max(1, gameState.round - 1);

    // Build a unified v2 leaderboard entry
    const entry = {
        entryId:        null, // will be assigned/preserved by LeaderboardStore
        playerKey,
        studentId:      gameState.player.studentId || playerKey,
        studentName:    gameState.player.studentName || (session?.studentName) || 'Anonymous Student',
        username:       (session?.username) || '',
        level:          gameState.assignedLevel || 2,
        mode:           'goldfields-venture',
        source:         'level2',
        score:          gameState.getNetWorth(),
        netWorth:       gameState.getNetWorth(),
        finalCash:      gameState.cash,
        roundsPlayed:   totalRounds,
        minesOwned:     gameState.getOwnedMines().length,
        machineryCount: gameState.machinery.length,
        companyName:    gameState.player.companyName || DEFAULT_COMPANY_NAME,
        // legacy fields kept for teacher dashboard compatibility
        round:              gameState.round,
        cash:               gameState.cash,
        totalProfitLoss:    gameState.totalProfitLoss,
        averageRoundProfit: gameState.totalProfitLoss / totalRounds,
        strategyLabel:      calculateStrategyLabel(),
        machineryOwned:     gameState.machinery.length,
        timestamp:          new Date().toISOString(),
        updatedAt:          new Date().toISOString()
    };

    if (typeof LeaderboardStore !== 'undefined') {
        LeaderboardStore.appendEntry(entry);
    } else {
        const records = getClassRecords();
        const index = records.findIndex(r => (r.studentId || r.playerKey) === playerKey);
        if (index >= 0) records[index] = entry;
        else records.push(entry);
        saveClassRecords(records);
    }

    syncTeacherDashboardRecord(entry);
}

function syncTeacherDashboardRecord(record) {
    if (typeof TeacherDashboard === 'undefined') return;
    const dashboard = new TeacherDashboard();
    dashboard.loadFromLocalStorage();
    dashboard.syncFromPlayerRecord(record);
    dashboard.saveToLocalStorage();
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
    document.getElementById('rollButton').disabled = paused;
    const banner = document.getElementById('pause-banner');
    banner.classList.toggle('hidden', !paused);
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
    gameState.assignedLevel = getAssignedLevelFromUrl();
    ensureInvestmentPlansForOwnedMines();
    hydrateIdentityInputs();
    updateAssignedLevelBadge();
    updateAllUI();
    closeAllModals();
    syncPlayerRecord();
    alert('✅ Game loaded successfully!');
}

function resetGame() {
    if (!confirm('Start a new game? All progress will be lost.')) return;
    gameState.reset();
    gameState.assignedLevel = getAssignedLevelFromUrl();
    localStorage.removeItem('level2_autosave');
    hydrateIdentityInputs();
    updateAssignedLevelBadge();
    updateAllUI();
    closeAllModals();
    syncPlayerRecord();
    alert('✅ New game started!');
}
