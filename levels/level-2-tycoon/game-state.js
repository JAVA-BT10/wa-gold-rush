/**
 * Level 2: Mining Tycoon - Game State Manager
 * Handles all game state for multiple mines, machinery, upgrades, and net worth
 */

class GameState {
    constructor() {
        this.round = 1;
        this.cash = 200;
        this.gameConfig = null;
        this.assignedLevel = 2;
        this.player = {
            studentId: '',
            studentName: '',
            companyName: 'Untitled Mining Co.'
        };
        
        // Mines tracking
        this.ownedMines = {
            'southern_cross': {
                id: 'southern_cross',
                owned: true,
                purchasePrice: 0,
                upgrades: []
            }
        };
        
        // Machinery inventory
        this.machinery = [];
        
        // Upgrade tracking (per mine)
        this.roundHistory = [];
        this.totalProfitLoss = 0;
        this.investmentPlans = {};
    }

    /**
     * Initialize game state from config
     */
    async loadConfig(configPath = '../../shared/game-config.json') {
        try {
            const response = await fetch(configPath);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            this.gameConfig = await response.json();
            this.cash = this.gameConfig?.levels?.['2']?.startingCash || this.cash;
            console.log('Game config loaded:', this.gameConfig);
            return true;
        } catch (error) {
            console.error('Failed to load game config:', error);
            return false;
        }
    }

    getAllowedMineUpgradeIds(level = this.assignedLevel || 2) {
        const order = ['silver', 'gold', 'platinum'];
        if (level <= 2) return [];
        if (level === 3) return order.slice(0, 1);
        if (level === 4) return order.slice(0, 2);
        return [...order];
    }

    getAllowedMachineryIds(level = this.assignedLevel || 2) {
        const order = ['excavator', 'drilling_rig', 'super_drill'];
        if (level <= 2) return order.slice(0, 1);
        if (level === 3) return order.slice(0, 2);
        return [...order];
    }

    isMineUpgradeAllowed(upgradeId, level = this.assignedLevel || 2) {
        return this.getAllowedMineUpgradeIds(level).includes(upgradeId);
    }

    isMachineryAllowed(machineryId, level = this.assignedLevel || 2) {
        return this.getAllowedMachineryIds(level).includes(machineryId);
    }

    canRollRandomEvents(level = this.assignedLevel || 2) {
        return level >= 4;
    }

    /**
     * Get all owned mines
     */
    getOwnedMines() {
        if (!this.gameConfig?.mines) {
            return [];
        }

        return Object.entries(this.ownedMines)
            .filter(([id, mine]) => mine.owned)
            .map(([id, mine]) => {
                const config = this.gameConfig.mines[id];
                return {
                    ...config,
                    ...mine,
                    currentUpgrades: mine.upgrades || []
                };
            });
    }

    /**
     * Get all available mines for purchase
     */
    getAvailableMinesForPurchase() {
        if (!this.gameConfig?.mines) {
            return [];
        }

        return Object.entries(this.gameConfig.mines)
            .filter(([id]) => (!this.ownedMines[id] || !this.ownedMines[id].owned) && this.isMineUnlocked(id))
            .map(([id, mine]) => mine);
    }

    isMineUnlocked(mineId) {
        if (!this.gameConfig?.mines?.[mineId]) {
            return false;
        }
        const level = this.assignedLevel || 2;
        if (mineId === 'kalgoorlie' && level < 3) return false;
        if (mineId === 'leonora') return level >= 4 && !!this.ownedMines.kalgoorlie?.owned;
        if (mineId === 'laverton') return level >= 4 && !!this.ownedMines.leonora?.owned;
        return true;
    }

    /**
     * Purchase a new mine
     */
    purchaseMine(mineId) {
        if (!this.gameConfig?.mines) {
            return { success: false, error: 'Game configuration not loaded' };
        }

        const mine = this.gameConfig.mines[mineId];
        
        if (!mine) {
            return { success: false, error: 'Mine not found' };
        }
        
        if (this.ownedMines[mineId]?.owned) {
            return { success: false, error: 'Mine already owned' };
        }
        
        if (this.cash < mine.cost) {
            return { success: false, error: `Insufficient funds. Need $${mine.cost}, have $${this.cash}` };
        }
        
        // Purchase the mine
        this.cash -= mine.cost;
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

    /**
     * Upgrade a mine
     */
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
        
        // Check if upgrade already applied
        if (mine.upgrades.includes(upgradeId)) {
            return { success: false, error: 'Mine already has this upgrade' };
        }
        
        // Apply upgrade
        this.cash -= upgrade.cost;
        mine.upgrades.push(upgradeId);
        
        return {
            success: true,
            message: `Applied ${upgrade.name} to ${this.gameConfig.mines[mineId].name} for $${upgrade.cost}`,
            newCash: this.cash
        };
    }

    /**
     * Purchase machinery
     */
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
        
        // Check purchase limit
        const ownedCount = this.machinery.filter(m => m.id === machineryId).length;
        if (ownedCount >= machinery.purchaseLimit) {
            return { success: false, error: `Purchase limit reached for ${machinery.name}` };
        }
        
        if (this.cash < machinery.cost) {
            return { success: false, error: `Insufficient funds. Need $${machinery.cost}, have $${this.cash}` };
        }
        
        // Purchase machinery
        this.cash -= machinery.cost;
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

    /**
     * Sell machinery
     */
    sellMachinery(machineryIndex) {
        if (!this.gameConfig?.machinery) {
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
        this.machinery.splice(machineryIndex, 1);
        
        return {
            success: true,
            message: `Sold ${machineryConfig.name} for $${resaleValue}`,
            newCash: this.cash,
            resaleValue: resaleValue
        };
    }

    /**
     * Get total machinery profit bonus
     */
    getTotalMachineryBonus() {
        if (!this.gameConfig?.machinery) {
            return 0;
        }

        let totalBonus = 0;
        this.machinery.forEach(item => {
            const config = this.gameConfig.machinery[item.id];
            totalBonus += config.profitBonus;
        });
        return totalBonus;
    }

    /**
     * Calculate mine value (purchase price)
     */
    getMineValue() {
        if (!this.gameConfig?.mines) {
            return 0;
        }

        let value = 0;
        Object.entries(this.ownedMines).forEach(([mineId, mine]) => {
            if (mine.owned) {
                value += this.gameConfig.mines[mineId].baseValue;
            }
        });
        return value;
    }

    /**
     * Calculate machinery value (at resale value)
     */
    getMachineryValue() {
        if (!this.gameConfig?.machinery) {
            return 0;
        }

        let value = 0;
        this.machinery.forEach(item => {
            const config = this.gameConfig.machinery[item.id];
            value += Math.floor(item.purchasePrice * config.resaleValue);
        });
        return value;
    }

    /**
     * Calculate net worth (Cash + Mines + Machinery)
     */
    getNetWorth() {
        return this.cash + this.getMineValue() + this.getMachineryValue();
    }

    /**
     * Get dig type with applied mine upgrades
     */
    getDigTypeMultiplier(mineId, digType) {
        if (!this.gameConfig?.digTypes || !this.gameConfig?.mines) {
            return 0;
        }

        const digConfig = this.gameConfig.digTypes[digType];
        if (!digConfig) {
            return 0;
        }
        let multiplier = digConfig.multiplier;
        
        // Check mine-specific overrides (like Leonora's 500% Deep Vein)
        const mineConfig = this.gameConfig.mines[mineId];
        if (digType === 'deep' && mineConfig.deepVeinMultiplier) {
            multiplier = mineConfig.deepVeinMultiplier;
        }
        
        // Apply mine upgrades
        const mine = this.ownedMines[mineId];
        if (mine?.upgrades?.length > 0) {
            mine.upgrades.forEach(upgradeId => {
                const upgrade = this.gameConfig.mineUpgrades[upgradeId];
                if (upgrade.appliesTo === digType && upgrade.effectType === 'multiplier_override') {
                    multiplier = upgrade.newMultiplier;
                }
            });
        }
        
        return multiplier;
    }

    /**
     * Calculate outcome for a dig
     */
    calculateOutcome(investment, digType, mineId, isSuccess, roundEffects = {}) {
        if (!isSuccess) {
            return -investment;
        }

        let profit = investment * this.getDigTypeMultiplier(mineId, digType);
        const machineryBonus = this.getTotalMachineryBonus();
        profit *= (1 + machineryBonus);

        if (roundEffects.profitMultiplier) {
            profit *= roundEffects.profitMultiplier;
        }

        return profit;
    }

    /**
     * Save game state to localStorage
     */
    saveToLocalStorage(slotName = 'level2_autosave') {
        try {
            const saveData = {
                timestamp: new Date().toISOString(),
                gameState: {
                    round: this.round,
                    cash: this.cash,
                    assignedLevel: this.assignedLevel,
                    player: this.player,
                    ownedMines: this.ownedMines,
                    machinery: this.machinery,
                    roundHistory: this.roundHistory,
                    totalProfitLoss: this.totalProfitLoss,
                    investmentPlans: this.investmentPlans
                }
            };
            localStorage.setItem(slotName, JSON.stringify(saveData));
            return { success: true, message: `Game saved to ${slotName}` };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Load game state from localStorage
     */
    loadFromLocalStorage(slotName = 'level2_autosave') {
        try {
            const saveData = JSON.parse(localStorage.getItem(slotName));
            if (!saveData) {
                return { success: false, error: 'No save data found' };
            }
            
            this.round = saveData.gameState.round;
            this.cash = saveData.gameState.cash;
            this.assignedLevel = saveData.gameState.assignedLevel || this.assignedLevel;
            this.player = {
                ...this.player,
                ...(saveData.gameState.player || {})
            };
            this.ownedMines = saveData.gameState.ownedMines;
            this.machinery = saveData.gameState.machinery;
            this.roundHistory = saveData.gameState.roundHistory;
            this.totalProfitLoss = saveData.gameState.totalProfitLoss;
            this.investmentPlans = saveData.gameState.investmentPlans || {};
            
            return { success: true, message: 'Game loaded from save' };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Reset game to initial state
     */
    reset() {
        this.round = 1;
        this.cash = this.gameConfig?.levels?.['2']?.startingCash || 200;
        this.assignedLevel = 2;
        this.player = {
            studentId: '',
            studentName: '',
            companyName: 'Untitled Mining Co.'
        };
        this.ownedMines = {
            'southern_cross': {
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
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = GameState;
}
