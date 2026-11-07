/**
 * GameState — Goldfields Venture progression state
 *
 * Tracks:
 * - Mines owned & their upgrades
 * - Cash & net worth
 * - Machinery inventory
 * - Investment plans (per mine, per dig type)
 * - Checkpoint status for progression gates
 * - Quiz attempts and teacher approval
 */

class GameState {
    constructor() {
        this.round = 1;
        this.cash = 200;
        this.gameConfig = null;
        this.originalGameConfig = null;
        this.assignedLevel = 2;
        this.player = {
            studentCode: '',
            leaderboardName: '',
            studentId: '',
            studentName: '',
            companyName: 'Untitled Mining Co.'
        };

        this.ownedMines = {
            southern_cross: {
                id: 'southern_cross',
                owned: true,
                purchasePrice: 0,
                upgrades: []
            }
        };

        this.machinery = [];
        this.roundHistory = [];
        this.totalProfitLoss = 0;
        this.investmentPlans = {};
        this.investmentProfile = null;

        this.checkpointStatus = null;
        this.quizAttempts = [];
        this.approvalStatus = null;
        this.approverName = null;
        this.approvalTimestamp = null;
        this.progressionStateByLevel = {};

        // Per-level save run metadata (see shared/level-save-store.js).
        this.activeRun = null;
        this.startingNetWorth = null;
        this.runCreatedAt = null;
        this.initialCloudState = null;
        this.saveLocked = false;
        this.lastSaveResult = null;
        this.currentRunActivity = false;
    }

    async loadConfig(configPath = '../../shared/game-config.json') {
        try {
            const response = await fetch(configPath);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            this.originalGameConfig = await response.json();
            this.gameConfig = this.cloneConfig(this.originalGameConfig);
            this.applyLevelConfigAdapter();
            this.cash = this.getPlayableStartingCash();
            return true;
        } catch (error) {
            console.error('Failed to load game config:', error);
            return false;
        }
    }

    normalizeLevel(level = this.assignedLevel || 2) {
        const parsed = Number(level);
        return [2, 3, 4, 5].includes(parsed) ? parsed : 2;
    }

    getLevelKey(level = this.assignedLevel || 2) {
        return String(this.normalizeLevel(level));
    }

    cloneConfig(config) {
        return config ? JSON.parse(JSON.stringify(config)) : null;
    }

    getDefaultProgressionState() {
        return {
            checkpointStatus: null,
            quizAttempts: [],
            approvalStatus: null,
            approverName: null,
            approvalTimestamp: null,
            quizScore: null,
            quizPassedAt: null
        };
    }

    ensureProgressionStateMap() {
        if (!this.progressionStateByLevel || typeof this.progressionStateByLevel !== 'object' || Array.isArray(this.progressionStateByLevel)) {
            this.progressionStateByLevel = {};
        }
    }

    getProgressionState(level = this.assignedLevel || 2) {
        this.ensureProgressionStateMap();
        const levelKey = this.getLevelKey(level);
        const existing = this.progressionStateByLevel[levelKey];
        if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
            this.progressionStateByLevel[levelKey] = this.getDefaultProgressionState();
        } else {
            this.progressionStateByLevel[levelKey] = {
                ...this.getDefaultProgressionState(),
                ...existing,
                quizAttempts: Array.isArray(existing.quizAttempts) ? existing.quizAttempts : []
            };
        }
        return this.progressionStateByLevel[levelKey];
    }

    applyProgressionStateForAssignedLevel() {
        const state = this.getProgressionState(this.assignedLevel);
        this.checkpointStatus = state.checkpointStatus || null;
        this.quizAttempts = Array.isArray(state.quizAttempts) ? state.quizAttempts : [];
        this.approvalStatus = state.approvalStatus || null;
        this.approverName = state.approverName || null;
        this.approvalTimestamp = state.approvalTimestamp || null;
    }

    persistProgressionStateForLevel(level = this.assignedLevel || 2) {
        const state = this.getProgressionState(level);
        const isAssignedLevel = this.normalizeLevel(level) === this.normalizeLevel(this.assignedLevel);
        const sourceState = isAssignedLevel
            ? {
                checkpointStatus: this.checkpointStatus || null,
                quizAttempts: Array.isArray(this.quizAttempts) ? this.quizAttempts : [],
                approvalStatus: this.approvalStatus || null,
                approverName: this.approverName || null,
                approvalTimestamp: this.approvalTimestamp || null
            }
            : state;

        state.checkpointStatus = sourceState.checkpointStatus || null;
        state.quizAttempts = Array.isArray(sourceState.quizAttempts) ? sourceState.quizAttempts : [];
        state.approvalStatus = sourceState.approvalStatus || null;
        state.approverName = sourceState.approverName || null;
        state.approvalTimestamp = sourceState.approvalTimestamp || null;
        if (state.quizScore == null && state.quizAttempts.length) {
            state.quizScore = Number(state.quizAttempts[state.quizAttempts.length - 1]?.score) || null;
        }
        if (!state.quizPassedAt && state.checkpointStatus === 'quiz_passed') {
            state.quizPassedAt = state.quizAttempts[state.quizAttempts.length - 1]?.timestamp || new Date().toISOString();
        }
        return state;
    }

    updateProgressionState(updates = {}, level = this.assignedLevel || 2) {
        const state = this.getProgressionState(level);
        Object.assign(state, updates);
        if ('quizAttempts' in updates && !Array.isArray(state.quizAttempts)) {
            state.quizAttempts = [];
        }
        if (this.normalizeLevel(level) === this.normalizeLevel(this.assignedLevel)) {
            this.checkpointStatus = state.checkpointStatus || null;
            this.quizAttempts = Array.isArray(state.quizAttempts) ? state.quizAttempts : [];
            this.approvalStatus = state.approvalStatus || null;
            this.approverName = state.approverName || null;
            this.approvalTimestamp = state.approvalTimestamp || null;
        }
        return state;
    }

    recordQuizAttempt(result, level = this.assignedLevel || 2) {
        if (this.normalizeLevel(level) === this.normalizeLevel(this.assignedLevel)) this.currentRunActivity = true;
        const attempt = {
            score: Number(result?.score) || 0,
            totalQuestions: Number(result?.totalQuestions) || 0,
            passed: !!result?.passed,
            timestamp: new Date().toISOString(),
            results: Array.isArray(result?.results) ? result.results : []
        };
        const state = this.getProgressionState(level);
        const attempts = Array.isArray(state.quizAttempts) ? [...state.quizAttempts, attempt] : [attempt];
        return this.updateProgressionState({
            quizAttempts: attempts,
            quizScore: attempt.score,
            quizPassedAt: attempt.passed ? attempt.timestamp : state.quizPassedAt
        }, level);
    }

    getConfiguredStartingCash(level = this.assignedLevel || 2) {
        const configuredCash = Number(this.gameConfig?.levels?.[this.getLevelKey(level)]?.startingCash);
        if (Number.isFinite(configuredCash) && configuredCash >= 0) {
            return configuredCash;
        }

        const levelTwoCash = Number(this.gameConfig?.levels?.['2']?.startingCash);
        if (Number.isFinite(levelTwoCash) && levelTwoCash >= 0) {
            return levelTwoCash;
        }

        return 200;
    }

    getPlayableStartingCash(level = this.assignedLevel || 2) {
        const configuredCash = this.getConfiguredStartingCash(level);
        if (configuredCash > 0) {
            return configuredCash;
        }

        const levelTwoCash = this.getConfiguredStartingCash(2);
        if (levelTwoCash > 0) {
            return levelTwoCash;
        }

        return 200;
    }

    shouldRecoverLoadedCash(cash, savedState = {}) {
        const numericCash = Number(cash);
        if (!Number.isFinite(numericCash) || numericCash < 0) {
            return true;
        }

        if (numericCash > 0) {
            return false;
        }

        const numericRound = Number(savedState.round);
        const roundHistory = Array.isArray(savedState.roundHistory) ? savedState.roundHistory : [];
        const machinery = Array.isArray(savedState.machinery) ? savedState.machinery : [];
        const quizAttempts = Array.isArray(savedState.quizAttempts) ? savedState.quizAttempts : [];
        const totalProfitLoss = Number(savedState.totalProfitLoss);
        const ownedMineEntries = Object.entries(savedState.ownedMines || {});
        const starterMine = savedState.ownedMines?.southern_cross;
        const onlyStarterMine = ownedMineEntries.length === 1
            && !!starterMine?.owned
            && Array.isArray(starterMine.upgrades)
            && starterMine.upgrades.length === 0;

        return numericCash === 0
            && (!Number.isFinite(numericRound) || numericRound <= 1)
            && roundHistory.length === 0
            && machinery.length === 0
            && quizAttempts.length === 0
            && (!Number.isFinite(totalProfitLoss) || totalProfitLoss === 0)
            && !savedState.checkpointStatus
            && !savedState.approvalStatus
            && onlyStarterMine;
    }

    normalizeLoadedCash(cash, savedState = {}) {
        const numericCash = Number(cash);
        if (!this.shouldRecoverLoadedCash(numericCash, savedState)) {
            return { cash: numericCash, recovered: false };
        }

        return {
            cash: this.getPlayableStartingCash(),
            recovered: true
        };
    }

    applyLevelConfigAdapter() {
        if (!this.gameConfig || typeof this.gameConfig !== 'object') return;

        const levelKey = this.getLevelKey(this.assignedLevel);
        const sourceConfig = this.originalGameConfig && typeof this.originalGameConfig === 'object'
            ? this.originalGameConfig
            : this.gameConfig;
        const baseConfig = this.cloneConfig(sourceConfig);
        if (!baseConfig || typeof baseConfig !== 'object') return;
        const levelConfig = baseConfig?.levels?.[levelKey] || baseConfig?.levels?.['2'];
        if (!levelConfig || typeof levelConfig !== 'object') return;

        this.gameConfig = {
            ...baseConfig,
            machinery: this.flattenMachinery(levelConfig, baseConfig),
            mines: this.flattenMines(levelConfig, baseConfig),
            mineUpgrades: this.flattenMineUpgrades(levelConfig, baseConfig),
            digTypes: this.flattenDigTypes(levelConfig, baseConfig),
            randomEvents: this.flattenRandomEvents(levelConfig, baseConfig)
        };
        this.applyProgressionStateForAssignedLevel();
    }

    flattenMachinery(levelConfig, baseConfig) {
        const normalizeAsset = (item = {}) => ({
            ...item,
            purchaseLimit: item.purchaseLimit ?? item.maxPerMine ?? 1,
            baseValue: item.baseValue ?? item.cost ?? 0,
            profitBonus: item.profitBonus ?? 0,
            canBeSold: item.canBeSold ?? true,
            resaleValue: item.resaleValue ?? 0.75
        });

        const baseMachinery = Object.fromEntries(
            Object.entries(baseConfig?.machinery || {}).map(([id, item]) => [id, normalizeAsset(item)])
        );
        const equipment = Object.fromEntries(
            Object.entries(levelConfig?.equipment || {}).map(([id, item]) => [id, normalizeAsset(item)])
        );
        const directMachinery = Object.fromEntries(
            Object.entries(levelConfig?.machinery || {}).map(([id, item]) => [id, normalizeAsset(item)])
        );
        const personnel = Object.fromEntries(
            Object.entries(levelConfig?.personnel || {}).map(([id, item]) => [id, normalizeAsset(item)])
        );
        const haulage = Object.fromEntries(
            Object.entries(levelConfig?.haulage || {}).map(([id, item]) => [id, normalizeAsset(item)])
        );

        return {
            ...baseMachinery,
            ...directMachinery,
            ...equipment,
            ...personnel,
            ...haulage
        };
    }

    flattenMines(levelConfig, baseConfig) {
        const levelMines = levelConfig?.mines || levelConfig?.regionalMines || {};
        return { ...(baseConfig?.mines || {}), ...levelMines };
    }

    flattenMineUpgrades(levelConfig, baseConfig) {
        const levelMineUpgrades = levelConfig?.mineUpgrades || levelConfig?.upgrades || {};
        return { ...(baseConfig?.mineUpgrades || {}), ...levelMineUpgrades };
    }

    flattenDigTypes(levelConfig, baseConfig) {
        const levelDigTypes = levelConfig?.digTypes || levelConfig?.digTypeConfig || {};
        const merged = { ...(baseConfig?.digTypes || {}), ...levelDigTypes };
        return Object.fromEntries(
            Object.entries(merged).map(([id, dig]) => [id, {
                ...dig,
                multiplier: dig.multiplier ?? dig.baseMultiplier ?? 1
            }])
        );
    }

    flattenRandomEvents(levelConfig, baseConfig) {
        const levelRandomEvents = levelConfig?.randomEvents || levelConfig?.events || {};
        return { ...(baseConfig?.randomEvents || {}), ...levelRandomEvents };
    }

    isMineUpgradeAvailableForLevel(upgrade, level = this.assignedLevel || 2) {
        if (!upgrade || typeof upgrade !== 'object') {
            return false;
        }

        const levelNum = this.normalizeLevel(level);
        const availableFromLevel = Number(upgrade.availableFromLevel ?? upgrade.requirementLevel ?? 2);
        const obsoleteFromLevel = Number(upgrade.obsoleteFromLevel);
        const unlocked = Number.isFinite(availableFromLevel) ? levelNum >= availableFromLevel : true;
        const notObsolete = Number.isFinite(obsoleteFromLevel) ? levelNum < obsoleteFromLevel : true;
        return unlocked && notObsolete;
    }

    getAllowedMineUpgradeIds(level = this.assignedLevel || 2) {
        const levelNum = this.normalizeLevel(level);
        const configDrivenIds = Object.entries(this.gameConfig?.mineUpgrades || {})
            .filter(([, upgrade]) => this.isMineUpgradeAvailableForLevel(upgrade, levelNum))
            .map(([id]) => id);

        if (configDrivenIds.length) {
            return configDrivenIds;
        }

        const order = ['silver', 'gold', 'platinum'];
        if (levelNum <= 2) return [];
        if (levelNum === 3) return order.slice(0, 1);
        if (levelNum === 4) return order.slice(0, 2);
        return [...order];
    }

    isMachineryAvailableForLevel(machinery, level = this.assignedLevel || 2) {
        if (!machinery || typeof machinery !== 'object') {
            return false;
        }

        const levelNum = this.normalizeLevel(level);
        const availableFromLevel = Number(machinery.availableFromLevel);
        const obsoleteFromLevel = Number(machinery.obsoleteFromLevel);
        const unlocked = Number.isFinite(availableFromLevel) ? levelNum >= availableFromLevel : true;
        const notObsolete = Number.isFinite(obsoleteFromLevel) ? levelNum < obsoleteFromLevel : true;
        return unlocked && notObsolete;
    }

    getAllowedMachineryIds(level = this.assignedLevel || 2) {
        const levelNum = this.normalizeLevel(level);
        const configDrivenIds = Object.entries(this.gameConfig?.machinery || {})
            .filter(([, machinery]) => this.isMachineryAvailableForLevel(machinery, levelNum))
            .map(([id]) => id);

        if (configDrivenIds.length) {
            return configDrivenIds;
        }

        const order = ['excavator', 'drilling_rig', 'super_drill'];
        if (levelNum <= 2) return order.slice(0, 1);
        if (levelNum === 3) return order.slice(0, 2);
        return [...order];
    }

    isMineUpgradeAllowed(upgradeId, level = this.assignedLevel || 2) {
        return this.getAllowedMineUpgradeIds(level).includes(upgradeId);
    }

    isMachineryAllowed(machineryId, level = this.assignedLevel || 2) {
        return this.getAllowedMachineryIds(level).includes(machineryId);
    }

    canRollRandomEvents(level = this.assignedLevel || 2) {
        return this.normalizeLevel(level) >= 4;
    }

    getOwnedMines() {
        if (!this.gameConfig?.mines || !this.ownedMines) {
            return [];
        }

        return Object.entries(this.ownedMines)
            .filter(([, mine]) => mine?.owned)
            .map(([id, mine]) => {
                const config = this.gameConfig.mines[id] || {};
                const upgrades = Array.isArray(mine?.upgrades) ? mine.upgrades : [];
                return {
                    ...config,
                    ...mine,
                    upgrades,
                    currentUpgrades: upgrades
                };
            });
    }

    getAvailableMinesForPurchase() {
        if (!this.gameConfig?.mines || !this.ownedMines) {
            return [];
        }

        return Object.entries(this.gameConfig.mines)
            .filter(([id]) => (!this.ownedMines[id] || !this.ownedMines[id].owned) && this.isMineUnlocked(id))
            .map(([, mine]) => mine);
    }

    getMaxActiveMines(level = this.assignedLevel || 2) {
        const maxActiveMines = Number(this.gameConfig?.levels?.[this.getLevelKey(level)]?.maxActiveMines);
        return Number.isFinite(maxActiveMines) && maxActiveMines > 0 ? maxActiveMines : Number.POSITIVE_INFINITY;
    }

    isMineUnlocked(mineId) {
        const mineConfig = this.gameConfig?.mines?.[mineId];
        if (!mineConfig) {
            return false;
        }

        const level = this.normalizeLevel(this.assignedLevel);
        const minLevel = Number(mineConfig.minLevel);
        if (Number.isFinite(minLevel) && level < minLevel) {
            return false;
        }
        if (mineId === 'leonora') return !!this.ownedMines?.kalgoorlie?.owned;
        if (mineId === 'laverton') return !!this.ownedMines?.leonora?.owned;
        return true;
    }

    purchaseMine(mineId) {
        if (!this.gameConfig?.mines) {
            return { success: false, error: 'Game configuration not loaded' };
        }

        const mine = this.gameConfig.mines[mineId];
        if (!mine) {
            return { success: false, error: 'Mine not found' };
        }
        if (!this.isMineUnlocked(mineId)) {
            return { success: false, error: `${mine.name} is locked for Level ${this.assignedLevel}` };
        }
        if (this.ownedMines[mineId]?.owned) {
            return { success: false, error: 'Mine already owned' };
        }
        if (this.getOwnedMines().length >= this.getMaxActiveMines()) {
            return { success: false, error: `Mine limit reached for Level ${this.assignedLevel}` };
        }
        if (this.cash < mine.cost) {
            return { success: false, error: `Insufficient funds. Need $${mine.cost}, have $${this.cash}` };
        }

        this.cash -= mine.cost;
        this.currentRunActivity = true;
        this.ownedMines[mineId] = {
            id: mineId,
            owned: true,
            purchasePrice: mine.cost,
            upgrades: []
        };
        if (!this.investmentPlans[mineId]) {
            this.investmentPlans[mineId] = { safe: 0, medium: 0, deep: 0 };
        }

        return {
            success: true,
            message: `Successfully purchased ${mine.name} for $${mine.cost}`,
            newCash: this.cash
        };
    }

    upgradeMine(mineId, upgradeId) {
        if (!this.gameConfig?.mineUpgrades || !this.gameConfig?.mines) {
            return { success: false, error: 'Game configuration not loaded' };
        }

        const upgrade = this.gameConfig.mineUpgrades[upgradeId];
        const mine = this.ownedMines[mineId];
        if (!upgrade) {
            return { success: false, error: 'Upgrade not found' };
        }
        if (!mine?.owned) {
            return { success: false, error: 'Mine not owned' };
        }
        if (!this.isMineUpgradeAllowed(upgradeId)) {
            return { success: false, error: `Upgrade ${upgrade.name} is locked for Level ${this.assignedLevel}` };
        }
        if (this.cash < upgrade.cost) {
            return { success: false, error: `Insufficient funds. Need $${upgrade.cost}, have $${this.cash}` };
        }
        if (mine.upgrades.includes(upgradeId)) {
            return { success: false, error: 'Mine already has this upgrade' };
        }

        this.cash -= upgrade.cost;
        this.currentRunActivity = true;
        mine.upgrades.push(upgradeId);

        return {
            success: true,
            message: `Applied ${upgrade.name} to ${this.gameConfig.mines[mineId].name} for $${upgrade.cost}`,
            newCash: this.cash
        };
    }

    purchaseMachinery(machineryId) {
        if (!this.gameConfig?.machinery) {
            return { success: false, error: 'Game configuration not loaded' };
        }

        const machinery = this.gameConfig.machinery[machineryId];
        if (!machinery) {
            return { success: false, error: 'Machinery not found' };
        }
        if (!this.isMachineryAllowed(machineryId)) {
            return { success: false, error: `${machinery.name} is locked for Level ${this.assignedLevel}` };
        }
        if (!Array.isArray(this.machinery)) {
            this.machinery = [];
        }

        const ownedCount = this.machinery.filter(m => m.id === machineryId).length;
        if (ownedCount >= machinery.purchaseLimit) {
            return { success: false, error: `Purchase limit reached for ${machinery.name}` };
        }
        if (this.cash < machinery.cost) {
            return { success: false, error: `Insufficient funds. Need $${machinery.cost}, have $${this.cash}` };
        }

        this.cash -= machinery.cost;
        this.currentRunActivity = true;
        this.machinery.push({
            id: machineryId,
            purchasePrice: machinery.cost,
            purchaseRound: this.round
        });

        return {
            success: true,
            message: `Purchased ${machinery.name} for $${machinery.cost}`,
            newCash: this.cash,
            totalMachinery: this.machinery.length
        };
    }

    sellMachinery(machineryIndex) {
        if (!this.gameConfig?.machinery || !Array.isArray(this.machinery)) {
            return { success: false, error: 'Game configuration not loaded' };
        }
        if (machineryIndex < 0 || machineryIndex >= this.machinery.length) {
            return { success: false, error: 'Machinery not found' };
        }

        const ownedMachinery = this.machinery[machineryIndex];
        const machineryConfig = this.gameConfig.machinery[ownedMachinery.id];
        if (!machineryConfig.canBeSold) {
            return { success: false, error: `${machineryConfig.name} cannot be sold` };
        }

        const resaleValue = Math.floor(ownedMachinery.purchasePrice * machineryConfig.resaleValue);
        this.cash += resaleValue;
        this.currentRunActivity = true;
        this.machinery.splice(machineryIndex, 1);

        return {
            success: true,
            message: `Sold ${machineryConfig.name} for $${resaleValue}`,
            newCash: this.cash,
            resaleValue
        };
    }

    getTotalMachineryBonus() {
        if (!this.gameConfig?.machinery || !Array.isArray(this.machinery)) {
            return 0;
        }

        let totalBonus = 0;
        this.machinery.forEach(item => {
            const config = this.gameConfig.machinery[item.id];
            if (config) {
                totalBonus += Number(config.profitBonus) || 0;
            }
        });
        return totalBonus;
    }

    getMineValue() {
        if (!this.gameConfig?.mines || !this.ownedMines) {
            return 0;
        }

        let value = 0;
        Object.entries(this.ownedMines).forEach(([mineId, mine]) => {
            if (mine?.owned) {
                const mineConfig = this.gameConfig.mines[mineId];
                if (mineConfig) {
                    value += Number(mineConfig.baseValue) || 0;
                }
            }
        });
        return value;
    }

    getMachineryValue() {
        if (!this.gameConfig?.machinery || !Array.isArray(this.machinery)) {
            return 0;
        }

        let value = 0;
        this.machinery.forEach(item => {
            const config = this.gameConfig.machinery[item.id];
            if (config) {
                value += Math.floor((Number(item.purchasePrice) || 0) * (Number(config.resaleValue) || 0));
            }
        });
        return value;
    }

    getNetWorth() {
        return this.cash + this.getMineValue() + this.getMachineryValue();
    }

    hasReachedProgressionGoal() {
        const goal = this.gameConfig?.levels?.[this.getLevelKey(this.assignedLevel)]?.progressionGoal;
        return Number(goal) > 0 ? this.getNetWorth() >= goal : false;
    }

    isCheckpointApproved(level = this.assignedLevel || 2) {
        return this.getProgressionState(level).approvalStatus === 'approved';
    }

    canProgressToNextLevel() {
        const state = this.getProgressionState(this.assignedLevel);
        return state.checkpointStatus === 'quiz_passed';
    }

    getDigTypeMultiplier(mineId, digType) {
        if (!this.gameConfig?.digTypes || !this.gameConfig?.mines) {
            return 0;
        }

        const digConfig = this.gameConfig.digTypes[digType];
        if (!digConfig) {
            return 0;
        }

        let multiplier = Number(digConfig.multiplier ?? digConfig.baseMultiplier ?? 0);
        const mineConfig = this.gameConfig.mines[mineId];
        if (digType === 'deep' && Number.isFinite(Number(mineConfig?.deepVeinMultiplier))) {
            multiplier = Number(mineConfig.deepVeinMultiplier);
        }

        const mine = this.ownedMines[mineId];
        if (mine?.upgrades?.length > 0) {
            mine.upgrades.forEach(upgradeId => {
                const upgrade = this.gameConfig.mineUpgrades?.[upgradeId];
                if (upgrade?.appliesTo === digType && upgrade.effectType === 'multiplier_override') {
                    multiplier = Number(upgrade.newMultiplier) || multiplier;
                }
            });
        }

        return multiplier;
    }

    calculateOutcome(investment, digType, mineId, isSuccess, roundEffects = {}) {
        if (!isSuccess) {
            if (digType === 'safe') {
                return 0;
            }
            return -investment;
        }

        let profit = investment * this.getDigTypeMultiplier(mineId, digType);
        profit *= (1 + this.getTotalMachineryBonus());

        if (roundEffects.profitMultiplier) {
            profit *= roundEffects.profitMultiplier;
        }

        return profit;
    }

    recordInvestmentAction(bucket, weight) {
        this.currentRunActivity = true;
        const identity = this.getSaveIdentity();
        if (!identity) return;
        this.getInvestmentProfileApi()?.recordAction(identity, this.assignedLevel, bucket, weight || 1);
    }

    getSaveStore() {
        const store = typeof globalThis !== 'undefined' ? globalThis.WA_GOLD_RUSH_LEVEL_SAVE_STORE : null;
        if (store && typeof store.readLevelSave === 'function') return store;
        if (typeof require === 'function') {
            try { return require('../../shared/level-save-store.js'); } catch (_) { return null; }
        }
        return null;
    }

    getStorage() {
        return typeof localStorage !== 'undefined' ? localStorage : null;
    }

    /** {classCode, studentCode} of the identity applied to this game, or null. */
    getSaveIdentity() {
        const store = this.getSaveStore();
        return store
            ? store.normalizeIdentity({ classCode: this.player?.classCode, studentCode: this.player?.studentCode })
            : null;
    }

    getInvestmentProfileApi() {
        if (typeof InvestmentProfile !== 'undefined') return InvestmentProfile;
        if (typeof require === 'function') {
            try { return require('../../shared/investment-profile.js'); } catch (_) { return null; }
        }
        return null;
    }

    /**
     * Detached snapshot of THIS level's economy. Carries only the identity
     * needed to prove ownership (no StudentName/StudentID).
     */
    captureLevelSnapshot() {
        this.persistProgressionStateForLevel(this.assignedLevel);
        const clone = (value) => JSON.parse(JSON.stringify(value));
        const profileApi = this.getInvestmentProfileApi();
        const identity = this.getSaveIdentity();
        const investmentProfile = profileApi && identity
            ? profileApi.getBuckets(identity, this.assignedLevel)
            : (this.investmentProfile || null);
        return {
            level: this.assignedLevel,
            round: this.round,
            cash: this.cash,
            player: {
                classCode: String(this.player?.classCode || '').trim().toUpperCase(),
                studentCode: String(this.player?.studentCode || '').trim().toUpperCase(),
                leaderboardName: this.player?.leaderboardName || '',
                companyName: this.player?.companyName || ''
            },
            ownedMines: clone(this.ownedMines || {}),
            machinery: clone(Array.isArray(this.machinery) ? this.machinery : []),
            roundHistory: clone(Array.isArray(this.roundHistory) ? this.roundHistory : []),
            investmentPlans: clone(this.investmentPlans || {}),
            investmentProfile: clone(investmentProfile),
            totalProfitLoss: typeof this.totalProfitLoss === 'number' && Number.isFinite(this.totalProfitLoss) ? this.totalProfitLoss : 0,
            currentRunActivity: this.currentRunActivity,
            progression: clone(this.getProgressionState(this.assignedLevel))
        };
    }

    /**
     * Writes this level's save to its own Class|Student|Level slot and merges
     * this level's checkpoint evidence into the student's progression ledger.
     * Never writes the legacy shared `level2_autosave` slot.
     */
    saveToLocalStorage() {
        // Keep the last acknowledged cloud revision (the base for the next
        // conditional write) but record that this device now has changes the
        // cloud has not acknowledged.
        const markLocalChange = (cloud) => {
            const copy = cloud && typeof cloud === 'object' ? { ...cloud } : { status: 'local_only', revision: null };
            if (copy.status === 'synced') copy.status = 'pending';
            return copy;
        };
        try {
            const store = this.getSaveStore();
            const storage = this.getStorage();
            const identity = this.getSaveIdentity();
            if (!store || !storage || !identity || this.getRunProtectionReason()) return false;
            const level = store.normalizeSaveLevel(this.assignedLevel);
            if (level === null) return false;
            const snapshot = this.captureLevelSnapshot();
            const run = this.activeRun || store.ensureLevelRun(storage, identity, level);
            if (!run) return false;
            this.activeRun = { generation: run.generation, runId: run.runId };
            store.recordProgressionEvidence(storage, identity, level, snapshot.progression);
            const existing = store.readLevelSave(storage, identity, level);
            const sameRun = existing.status === 'found'
                && existing.envelope.generation === run.generation
                && existing.envelope.runId === run.runId;
            const envelope = store.createEnvelope({
                identity,
                level,
                generation: run.generation,
                runId: run.runId,
                startingNetWorth: Number.isFinite(this.startingNetWorth) ? this.startingNetWorth : null,
                createdAt: sameRun ? existing.envelope.createdAt : (this.runCreatedAt || undefined),
                cloud: sameRun
                    ? markLocalChange(existing.envelope.cloud)
                    : (this.initialCloudState || { status: 'local_only', revision: null }),
                snapshot
            });
            const result = store.writeLevelSave(storage, envelope, { identity, level });
            this.lastSaveResult = result;
            return result.ok;
        } catch (error) {
            console.error('Failed to save game state:', error);
            return false;
        }
    }

    /**
     * Loads ONLY the save for the applied identity and this.assignedLevel.
     * The level is never changed by loading. Returns
     * { success, status: 'found'|'missing'|'invalid'|'unavailable', reason }.
     */
    loadFromLocalStorage() {
        try {
            const store = this.getSaveStore();
            const storage = this.getStorage();
            const identity = this.getSaveIdentity();
            if (!store || !storage) return { success: false, status: 'unavailable', reason: 'storage_unavailable', recoveredCash: false };
            if (!identity) return { success: false, status: 'invalid', reason: 'identity_invalid', recoveredCash: false };
            const level = store.normalizeSaveLevel(this.assignedLevel);
            if (level === null) return { success: false, status: 'invalid', reason: 'level_invalid', recoveredCash: false };

            const ledger = store.readLedger(storage, identity);
            this.progressionStateByLevel = store.clone(ledger.progressionStateByLevel) || {};
            const result = store.readLevelSave(storage, identity, level);
            if (result.status !== 'found') {
                this.applyProgressionStateForAssignedLevel();
                return { success: false, status: result.status, reason: result.reason, key: result.key, raw: result.raw, recoveredCash: false };
            }
            const envelope = result.envelope;
            const run = ledger.levelRuns?.[String(level)];
            if (run && (run.generation !== envelope.generation || run.runId !== envelope.runId)) {
                this.applyProgressionStateForAssignedLevel();
                return { success: false, status: 'invalid', reason: 'stale_generation', key: result.key, recoveredCash: false };
            }
            if (!run) {
                const protection = this.getRunProtectionReason();
                if (protection || !store.adoptLevelRun(storage, envelope)) {
                    return { success: false, status: 'invalid', reason: protection || 'run_adoption_failed', recoveredCash: false };
                }
            }

            const snapshot = store.clone(envelope.snapshot);
            this.currentRunActivity = typeof snapshot.currentRunActivity === 'boolean' ? snapshot.currentRunActivity : undefined;
            this.round = snapshot.round;
            this.ownedMines = snapshot.ownedMines;
            this.machinery = snapshot.machinery;
            this.roundHistory = snapshot.roundHistory;
            this.totalProfitLoss = snapshot.totalProfitLoss;
            this.investmentPlans = snapshot.investmentPlans;
            this.investmentProfile = store.clone(snapshot.investmentProfile || null);
            if (this.investmentProfile) {
                this.getInvestmentProfileApi()?.mergeBuckets(identity, level, this.investmentProfile);
            }
            if (snapshot.player?.companyName) this.player.companyName = snapshot.player.companyName;
            if (snapshot.progression && typeof snapshot.progression === 'object') {
                const key = this.getLevelKey(level);
                this.progressionStateByLevel[key] = store.mergeProgressionEvidence(this.progressionStateByLevel[key], snapshot.progression);
            }
            this.activeRun = { generation: envelope.generation, runId: envelope.runId };
            this.startingNetWorth = envelope.startingNetWorth;
            this.runCreatedAt = envelope.createdAt;
            this.initialCloudState = store.clone(envelope.cloud);

            this.applyProgressionStateForAssignedLevel();
            const activeState = this.getProgressionState(this.assignedLevel);
            const normalizedCash = this.normalizeLoadedCash(snapshot.cash, {
                ...snapshot,
                checkpointStatus: activeState.checkpointStatus,
                approvalStatus: activeState.approvalStatus,
                quizAttempts: activeState.quizAttempts
            });
            this.cash = normalizedCash.cash;

            this.applyLevelConfigAdapter();
            if (normalizedCash.recovered) {
                this.saveToLocalStorage();
            }
            return { success: true, status: 'found', reason: '', recoveredCash: normalizedCash.recovered, migratedFrom: envelope.migratedFrom || null };
        } catch (error) {
            console.error('Failed to load game state:', error);
            return { success: false, status: 'invalid', reason: 'load_failed', recoveredCash: false };
        }
    }

    /**
     * First visit to a level (no save): start from that level's configured
     * defaults under the level's current run and record the run's immutable
     * starting net worth (baseline for Profit/ROI).
     */
    beginLevelRun(options = {}) {
        const store = this.getSaveStore();
        const storage = this.getStorage();
        const identity = this.getSaveIdentity();
        if (this.getRunProtectionReason()) return null;
        const level = store ? store.normalizeSaveLevel(this.assignedLevel) : null;
        const run = store && storage && identity && level !== null
            ? (options.run || store.ensureLevelRun(storage, identity, level))
            : null;
        if (!run || this.reset() === false) return null;
        this.activeRun = run ? { generation: run.generation, runId: run.runId } : null;
        this.startingNetWorth = this.getNetWorth();
        this.runCreatedAt = new Date().toISOString();
        this.initialCloudState = { status: options.cloudStatus || 'local_only', revision: null };
        return this.activeRun;
    }

    /**
     * Student restart of THIS level only: archive the current save, advance
     * the level's run generation and start fresh. Other levels, checkpoint
     * evidence and earned access are preserved.
     */
    restartLevelRun(options = {}) {
        const store = this.getSaveStore();
        const storage = this.getStorage();
        const identity = this.getSaveIdentity();
        if (!store || !storage || !identity) return { ok: false, reason: 'identity_invalid' };
        const protection = this.getRunProtectionReason();
        if (protection) return { ok: false, reason: protection };
        const result = store.resetLevelSave(storage, identity, this.assignedLevel, options);
        if (!result.ok) return result;
        return this.beginLevelRun({ run: result.run, cloudStatus: 'local_only' })
            ? result : { ok: false, reason: 'run_start_failed' };
    }

    getRunProtectionReason() {
        if (this.saveLocked) return 'save_locked';
        const store = this.getSaveStore();
        const storage = this.getStorage();
        const identity = this.getSaveIdentity();
        if (!store || !storage || !identity) return '';
        if (store.getLevelWriteProtection) return store.getLevelWriteProtection(storage, identity, this.assignedLevel) || '';
        const saved = store.readLevelSave(storage, identity, this.assignedLevel);
        if (!['found', 'missing'].includes(saved.status)) return saved.reason || 'save_unavailable';
        if (['conflict', 'hold', 'held'].includes(saved.envelope?.cloud?.status)) return saved.envelope.cloud.status;
        const hold = store.getUploadHold(storage, identity, this.assignedLevel);
        return hold === 'unverified_new_slot' ? '' : hold;
    }

    /**
     * Reset this level's economy to its configured defaults. Checkpoint
     * evidence (progressionStateByLevel) is shared access evidence and is
     * deliberately preserved.
     */
    reset() {
        if (this.getRunProtectionReason()) return false;
        this.currentRunActivity = false;
        this.round = 1;
        this.cash = this.getPlayableStartingCash();
        this.ownedMines = {
            southern_cross: {
                id: 'southern_cross',
                owned: true,
                purchasePrice: 0,
                upgrades: []
            }
        };
        this.machinery = [];
        this.roundHistory = [];
        this.totalProfitLoss = 0;
        this.investmentPlans = {};
        this.investmentProfile = null;
        this.ensureProgressionStateMap();
        this.applyProgressionStateForAssignedLevel();
        return true;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = GameState;
}
