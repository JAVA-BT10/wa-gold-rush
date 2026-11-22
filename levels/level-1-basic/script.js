// ===== CONSTANTS =====
const MAX_ROUNDS = 10;
const DICE_SIDES = 6;
const INITIAL_CASH = 100;
const ANIMATION_DURATION = 1000; // milliseconds

const DIG_TYPES = {
    safe: {
        name: 'Safe Dig',
        multiplier: 0.10,
        minTotal: 0,
        maxTotal: Infinity,
        icon: '✅',
        inputId: 'investment-safe'
    },
    medium: {
        name: 'Medium Dig',
        multiplier: 0.50,
        minTotal: 7,
        maxTotal: 10,
        icon: '⚠️',
        inputId: 'investment-medium'
    },
    deep: {
        name: 'Deep Vein Dig',
        multiplier: 3,
        minTotal: 11,
        maxTotal: 12,
        icon: '💰',
        inputId: 'investment-deep'
    }
};

// ===== GAME STATE =====
const gameState = {
    cash: INITIAL_CASH,
    round: 1,
    gameOver: false,
    isRolling: false,
    animationIntervalId: null,
    roundTimeoutId: null
};

// ===== INITIALIZATION =====
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM loaded, setting up event listeners');
    const playBtn = document.getElementById('playButton');
    const resetBtn = document.getElementById('resetButton');

    if (!playBtn) console.warn('playButton not found in DOM');
    else {
        console.log('Attaching click handler to playButton');
        playBtn.addEventListener('click', playRound);
    }

    if (!resetBtn) console.warn('resetButton not found in DOM');
    else {
        console.log('Attaching click handler to resetButton');
        resetBtn.addEventListener('click', resetGame);
    }

    // Add listeners to investment inputs to update total
    Object.values(DIG_TYPES).forEach(dig => {
        const input = document.getElementById(dig.inputId);
        if (input) {
            input.addEventListener('input', updateTotalInvestment);
        }
    });

    updateUI();
});

// ===== UTILITY FUNCTIONS =====
function rollDice() {
    return Math.floor(Math.random() * DICE_SIDES) + 1;
}

function updateUI() {
    const cashEl = document.getElementById('cash');
    const roundEl = document.getElementById('round');
    if (cashEl) cashEl.innerText = gameState.cash.toFixed(2);
    if (roundEl) roundEl.innerText = Math.min(gameState.round, MAX_ROUNDS);
}

function updateTotalInvestment() {
    let total = 0;
    Object.values(DIG_TYPES).forEach(dig => {
        const input = document.getElementById(dig.inputId);
        if (input) {
            total += Number(input.value) || 0;
        }
    });
    
    const totalEl = document.getElementById('total-investment');
    if (totalEl) totalEl.innerText = total.toFixed(2);
}

function getInvestments() {
    const investments = {};
    let totalInvestment = 0;

    Object.entries(DIG_TYPES).forEach(([key, dig]) => {
        const input = document.getElementById(dig.inputId);
        const amount = input ? Number(input.value) : 0;

        if (isNaN(amount) || amount < 0) {
            throw new Error('Invalid investment amount.');
        }

        investments[key] = amount;
        totalInvestment += amount;
    });

    if (totalInvestment <= 0) {
        throw new Error('Allocate at least some cash to a dig type.');
    }

    if (totalInvestment > gameState.cash) {
        throw new Error('You do not have enough cash for this total investment.');
    }

    return investments;
}

function calculateOutcome(digType, total, investment) {
    const dig = DIG_TYPES[digType];

    if (!dig) {
        throw new Error('Invalid dig type.');
    }

    const success = total >= dig.minTotal && total <= dig.maxTotal;
    let profit = success ? investment * dig.multiplier : -investment;
    if (!success && digType === 'safe') {
        profit = 0;
    }

    return { profit, success };
}

function generateResultMessage(digType, investment, profit, success) {
    const dig = DIG_TYPES[digType];
    const icon = success ? dig.icon : '❌';

    if (success) {
        return `${icon} ${dig.name} Successful<br>
                Investment: $${investment.toFixed(2)}<br>
                Profit: +$${profit.toFixed(2)}`;
    } else if (digType === 'safe') {
        return `➖ ${dig.name} Returned<br>
                Investment: $${investment.toFixed(2)}<br>
                Principal Returned: $${investment.toFixed(2)}<br>
                Profit: +$${profit.toFixed(2)}`;
    } else {
        return `${icon} ${dig.name} Failed<br>
                Investment: $${investment.toFixed(2)}<br>
                Lost: $${Math.abs(profit).toFixed(2)}`;
    }
}

function animateDiceRoll() {
    const diceEl = document.getElementById('dice');
    if (!diceEl) return;

    diceEl.classList.add('rolling');

    if (gameState.animationIntervalId) {
        clearInterval(gameState.animationIntervalId);
    }

    // Generate random numbers during animation
    gameState.animationIntervalId = setInterval(() => {
        const die1 = rollDice();
        const die2 = rollDice();
        const total = die1 + die2;
        diceEl.innerHTML =
            `🎲 Dice 1: <strong>${die1}</strong><br>
             🎲 Dice 2: <strong>${die2}</strong><br>
             ➕ Total: <strong>${total}</strong>`;
    }, 100);

    // Stop animation after duration
    setTimeout(() => {
        clearInterval(gameState.animationIntervalId);
        gameState.animationIntervalId = null;
        diceEl.classList.remove('rolling');
    }, ANIMATION_DURATION);
}

function clearPendingRoll() {
    if (gameState.animationIntervalId) {
        clearInterval(gameState.animationIntervalId);
        gameState.animationIntervalId = null;
    }

    if (gameState.roundTimeoutId) {
        clearTimeout(gameState.roundTimeoutId);
        gameState.roundTimeoutId = null;
    }

    gameState.isRolling = false;
}

function displayDiceRoll(die1, die2, total) {
    const diceEl = document.getElementById('dice');
    if (diceEl) {
        diceEl.innerHTML =
            `🎲 Dice 1: <strong>${die1}</strong><br>
             🎲 Dice 2: <strong>${die2}</strong><br>
             ➕ Total: <strong>${total}</strong>`;
    }
}

function displayResults(results) {
    const resultsContainer = document.getElementById('results-container');
    if (resultsContainer) {
        let html = '';
        let totalProfit = 0;

        results.forEach(result => {
            html += `<div class="result-card">${result.message}</div>`;
            totalProfit += result.profit;
        });

        html += `<div class="result-summary">
                    <strong>Round Profit/Loss: ${totalProfit >= 0 ? '+' : ''}$${totalProfit.toFixed(2)}</strong>
                 </div>`;

        resultsContainer.innerHTML = html;
    }
}

function displayGameOver() {
    const resultsContainer = document.getElementById('results-container');
    if (resultsContainer) {
        resultsContainer.innerHTML +=
            `<br><br>
             <div class="result-summary">
                 <strong>🏁 GAME OVER</strong><br>
                 Final Cash: $${gameState.cash.toFixed(2)}
             </div>`;
    }
    gameState.gameOver = true;
    const playBtn = document.getElementById('playButton');
    if (playBtn) playBtn.disabled = true;
}

// Reset the game to initial state
function resetGame() {
    console.log('Reset game called');
    if (!confirm("Are you sure you want to restart the game?")) {
        return;
    }

    clearPendingRoll();

    gameState.cash = INITIAL_CASH;
    gameState.round = 1;
    gameState.gameOver = false;

    // Reset investment inputs
    Object.values(DIG_TYPES).forEach(dig => {
        const input = document.getElementById(dig.inputId);
        if (input) input.value = '0';
    });

    const playBtn = document.getElementById('playButton');
    if (playBtn) playBtn.disabled = false;

    updateUI();
    updateTotalInvestment();

    const diceEl = document.getElementById('dice');
    const resultsContainer = document.getElementById('results-container');
    if (diceEl) {
        diceEl.classList.remove('rolling');
        diceEl.innerHTML = '-';
    }
    if (resultsContainer) resultsContainer.innerHTML = '<p id="result">Start mining!</p>';
}

// ===== MAIN GAME LOGIC =====
function playRound() {
    console.log('playRound called');
    
    if (gameState.isRolling) {
        console.log('Already rolling, ignoring click');
        return;
    }

    try {
        if (gameState.round > MAX_ROUNDS || gameState.gameOver) {
            alert('Game Over! Click "Restart Game" to play again.');
            return;
        }

        gameState.isRolling = true;
        const playBtn = document.getElementById('playButton');
        if (playBtn) playBtn.disabled = true;

        const investments = getInvestments();
        const totalInvestment = Object.values(investments).reduce((a, b) => a + b, 0);

        console.log('Investments:', investments, 'Total:', totalInvestment);

        // Roll the actual dice
        const die1 = rollDice();
        const die2 = rollDice();
        const total = die1 + die2;

        console.log('Dice rolled:', die1, die2, 'Total:', total);

        // Start dice animation
        animateDiceRoll();

        // Wait for animation to complete
        gameState.roundTimeoutId = setTimeout(() => {
            gameState.roundTimeoutId = null;
            // Display final dice roll
            displayDiceRoll(die1, die2, total);

            // Calculate outcomes for each dig type
            const results = [];
            let roundProfit = 0;

            Object.entries(investments).forEach(([digType, investment]) => {
                if (investment > 0) {
                    const { profit, success } = calculateOutcome(digType, total, investment);
                    const message = generateResultMessage(digType, investment, profit, success);
                    results.push({ digType, message, profit, success, investment });
                    roundProfit += profit;
                }
            });

            gameState.cash += roundProfit;

            displayResults(results);

            updateUI();
            gameState.round++;

            if (gameState.round > MAX_ROUNDS) {
                displayGameOver();
            }

            gameState.isRolling = false;
            if (playBtn) playBtn.disabled = false;
        }, ANIMATION_DURATION);

    } catch (error) {
        console.error('Error in playRound:', error);
        alert(error.message);
        gameState.isRolling = false;
        const playBtn = document.getElementById('playButton');
        if (playBtn) playBtn.disabled = false;
    }
}
