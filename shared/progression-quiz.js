/**
 * Progression Quiz System (V3.0)
 * Implements 5-question assessments for level progression checkpoints
 * Mixed problem-solving and calculation-based questions
 * Pass threshold: 4/5 or 5/5
 */

const ProgressionQuiz = (() => {
    const STORAGE_KEY = 'wa_gr_progression_quiz';

    /**
     * Quiz definitions per level
     * Each quiz has 5 questions mixing problem-solving and calculations
     */
    const QUIZZES = {
        2: {
            level: 2,
            name: 'Level 2: Goldfields Venture',
            description: 'Test your mining calculations and investment strategies',
            passingScore: 4,
            questions: [
                {
                    id: 'q1_l2',
                    type: 'calculation',
                    difficulty: 'easy',
                    question: 'You invest $50 in a Safe Dig. The roll is a 5. What is your profit?',
                    explanation: 'Safe Dig: Investment always returned + 10% profit if roll 2-6. $50 × 0.10 = $5 profit',
                    options: [
                        { text: '$5', correct: true },
                        { text: '$0', correct: false },
                        { text: '$50', correct: false },
                        { text: '$10', correct: false }
                    ],
                    workThroughExample: 'Safe Dig pays 10% profit on success. Investment: $50. Profit: $50 × 0.10 = $5. Total returned: $55.'
                },
                {
                    id: 'q2_l2',
                    type: 'problem_solving',
                    difficulty: 'medium',
                    question: 'You own a mine with a Cradle (+2% bonus). You invest $100 in a Medium Dig and roll a 9. What is your total return?',
                    explanation: 'Medium Dig base: 50% profit. Cradle adds +2%. Total bonus: 2%. Calculation: $100 × (0.50 + 0.02) = $100 × 0.52 = $52 profit. Return: $152.',
                    options: [
                        { text: '$152', correct: true },
                        { text: '$150', correct: false },
                        { text: '$100', correct: false },
                        { text: '$156', correct: false }
                    ],
                    workThroughExample: 'Medium Dig profit rate: 50%. Equipment bonus: +2%. Combined: 52%. Investment: $100. Return: $100 + ($100 × 0.52) = $152.'
                },
                {
                    id: 'q3_l2',
                    type: 'calculation',
                    difficulty: 'medium',
                    question: 'You have $300 cash. You want to buy Coolgardie Mine ($500). How much more do you need?',
                    explanation: 'Mine cost: $500. Current cash: $300. Shortfall: $500 − $300 = $200 needed.',
                    options: [
                        { text: '$200', correct: true },
                        { text: '$100', correct: false },
                        { text: '$800', correct: false },
                        { text: '$150', correct: false }
                    ],
                    workThroughExample: 'To find how much more you need: Mine Cost - Cash On Hand = $500 - $300 = $200 additional funds needed.'
                },
                {
                    id: 'q4_l2',
                    type: 'problem_solving',
                    difficulty: 'hard',
                    question: 'You own two mines. Southern Cross: $40 invested (Safe, roll 4). Coolgardie: $60 invested (Medium, roll 8) with Cradle (+2%). What is your total profit this round?',
                    explanation: 'SC Safe: $40 × 0.10 = $4. Coolgardie Medium: $60 × (0.50 + 0.02) = $31.20. Total: $4 + $31.20 = $35.20.',
                    options: [
                        { text: '$35.20', correct: true },
                        { text: '$30', correct: false },
                        { text: '$40', correct: false },
                        { text: '$36', correct: false }
                    ],
                    workThroughExample: 'Mine 1 (Safe): $40 × 10% = $4. Mine 2 (Medium + Cradle): $60 × 52% = $31.20. Total profit: $4 + $31.20 = $35.20.'
                },
                {
                    id: 'q5_l2',
                    type: 'calculation',
                    difficulty: 'medium',
                    question: 'Your net worth is $2,300 (cash: $1,200, mines: $800, equipment: $300). You spend $400 on new equipment. What is your new net worth?',
                    explanation: 'Old net worth: $2,300. Spend: $400 (reduces cash). New net worth: $2,300 − $400 = $1,900.',
                    options: [
                        { text: '$1,900', correct: true },
                        { text: '$2,300', correct: false },
                        { text: '$2,700', correct: false },
                        { text: '$1,500', correct: false }
                    ],
                    workThroughExample: 'When you spend cash on equipment, net worth decreases by that amount. $2,300 - $400 = $1,900 new net worth.'
                }
            ]
        },
        3: {
            level: 3,
            name: 'Level 3: WA Goldfields',
            description: 'Advanced mining calculations with multiple mines and infrastructure',
            passingScore: 4,
            questions: [
                {
                    id: 'q1_l3',
                    type: 'calculation',
                    difficulty: 'medium',
                    question: 'A mine has Rock Drill (+4%) and Ore Skip (+4%) installed. What is the total equipment bonus?',
                    explanation: 'Equipment bonuses stack additively. +4% + 4% = +8% total equipment bonus.',
                    options: [
                        { text: '+8%', correct: true },
                        { text: '+4%', correct: false },
                        { text: '+16%', correct: false },
                        { text: '+6%', correct: false }
                    ],
                    workThroughExample: 'Equipment bonuses are additive (they add together). Rock Drill +4% + Ore Skip +4% = 8% total bonus.'
                },
                {
                    id: 'q2_l3',
                    type: 'problem_solving',
                    difficulty: 'hard',
                    question: 'You have 3 mines with Horse & Wagon (+$25 capacity each). Your Medium Mine has base $100 investment limit. What is the max investment for that mine?',
                    explanation: 'Base capacity: $100. Each wagon adds +$25. With 1 wagon: $100 + $25 = $125. With 2 wagons: $100 + $50 = $150. With 3 wagons: $100 + $75 = $175.',
                    options: [
                        { text: '$125 (or more with additional wagons)', correct: true },
                        { text: '$100', correct: false },
                        { text: '$200', correct: false },
                        { text: '$75', correct: false }
                    ],
                    workThroughExample: 'Haulage increases investment capacity. Per wagon: +$25. If 1 wagon: $100 base + $25 = $125 max investment.'
                },
                {
                    id: 'q3_l3',
                    type: 'calculation',
                    difficulty: 'medium',
                    question: 'A Prospector costs $1,500. You hire one for your Coolgardie Mine. If Prospector gives +2% profit bonus, how much extra profit do you make on a $200 successful Medium Dig?',
                    explanation: 'Medium Dig base: 50%. Prospector adds: +2%. Total: 52%. Profit: $200 × 0.52 = $104. Extra from Prospector: $200 × 0.02 = $4.',
                    options: [
                        { text: '$4', correct: true },
                        { text: '$104', correct: false },
                        { text: '$3', correct: false },
                        { text: '$200', correct: false }
                    ],
                    workThroughExample: 'Prospector adds +2% to profits. On $200: 2% of $200 = 0.02 × $200 = $4 extra profit.'
                },
                {
                    id: 'q4_l3',
                    type: 'problem_solving',
                    difficulty: 'hard',
                    question: 'You own 3 mines. Each has equipment costing ~$2,750. Each mine has 1 Prospector ($1,500). Total spent: ~$12,750. If you started with $300 and made $8,000 profit, can you afford all upgrades?',
                    explanation: 'Starting cash: $300. Profit: $8,000. Total available: $8,300. Cost: $12,750. Shortfall: $12,750 − $8,300 = $4,450. No, you cannot afford all upgrades.',
                    options: [
                        { text: 'No, need $4,450 more', correct: true },
                        { text: 'Yes, with $500 to spare', correct: false },
                        { text: 'Yes, exactly enough', correct: false },
                        { text: 'No, need $10,000 more', correct: false }
                    ],
                    workThroughExample: 'Total cash: $300 + $8,000 = $8,300. Total costs: ~$12,750. Difference: $8,300 - $12,750 = -$4,450. Need $4,450 more.'
                },
                {
                    id: 'q5_l3',
                    type: 'calculation',
                    difficulty: 'medium',
                    question: 'Goal for Level 3: Net Worth = $10,000. You currently have $6,500. How much more net worth do you need?',
                    explanation: 'Goal: $10,000. Current: $6,500. Needed: $10,000 − $6,500 = $3,500.',
                    options: [
                        { text: '$3,500', correct: true },
                        { text: '$6,500', correct: false },
                        { text: '$13,500', correct: false },
                        { text: '$3,000', correct: false }
                    ],
                    workThroughExample: 'Goal - Current = Needed. $10,000 - $6,500 = $3,500 more net worth required to complete Level 3.'
                }
            ]
        },
        4: {
            level: 4,
            name: 'Level 4: Advanced Operations',
            description: 'Complex multi-mine strategy with random events and advanced equipment',
            passingScore: 4,
            questions: [
                {
                    id: 'q1_l4',
                    type: 'calculation',
                    difficulty: 'medium',
                    question: 'You own 4 mines with a Bulldozer (+5%) and Excavator (+6%) on each. What is total equipment bonus per mine?',
                    explanation: 'Bulldozer: +5%. Excavator: +6%. Total: 5% + 6% = +11% per mine.',
                    options: [
                        { text: '+11%', correct: true },
                        { text: '+5%', correct: false },
                        { text: '+30%', correct: false },
                        { text: '+6%', correct: false }
                    ],
                    workThroughExample: 'Equipment bonuses stack additively. Bulldozer +5% + Excavator +6% = 11% total per mine.'
                },
                {
                    id: 'q2_l4',
                    type: 'problem_solving',
                    difficulty: 'hard',
                    question: 'Random event: "Worker Shortage" halves profits. You made $500 profit this round before the event. After event, how much do you keep?',
                    explanation: 'Profit before event: $500. Halved: $500 ÷ 2 = $250.',
                    options: [
                        { text: '$250', correct: true },
                        { text: '$500', correct: false },
                        { text: '$750', correct: false },
                        { text: '$100', correct: false }
                    ],
                    workThroughExample: 'When "Worker Shortage" occurs, all profits are halved. $500 ÷ 2 = $250 profit after event.'
                },
                {
                    id: 'q3_l4',
                    type: 'calculation',
                    difficulty: 'medium',
                    question: 'You have an Underground Mine with Mine Pump (+5%) and Engineer (+5%). Investment: $300 Deep Vein (roll 12, success). Multiplier: 3.0. Total profit?',
                    explanation: 'Base: $300 × 3.0 = $900. Equipment bonus: +5%. Personnel bonus: +5%. Combined: 10%. Profit: $900 × (1 + 0.10) = $990.',
                    options: [
                        { text: '$990', correct: true },
                        { text: '$900', correct: false },
                        { text: '$1,080', correct: false },
                        { text: '$950', correct: false }
                    ],
                    workThroughExample: 'Deep Vein: $300 × 3.0 = $900. Equipment +5% and Personnel +5% = +10% total. $900 × 1.10 = $990 profit.'
                },
                {
                    id: 'q4_l4',
                    type: 'problem_solving',
                    difficulty: 'hard',
                    question: 'Random event: "Gold Rush" adds +20% profit. You profited $400 this round. After Gold Rush bonus, what is your total?',
                    explanation: 'Base profit: $400. Bonus: +20%. Extra: $400 × 0.20 = $80. Total: $400 + $80 = $480.',
                    options: [
                        { text: '$480', correct: true },
                        { text: '$400', correct: false },
                        { text: '$500', correct: false },
                        { text: '$320', correct: false }
                    ],
                    workThroughExample: '"Gold Rush" adds 20% bonus profit. $400 + ($400 × 20%) = $400 + $80 = $480 total.'
                },
                {
                    id: 'q5_l4',
                    type: 'calculation',
                    difficulty: 'medium',
                    question: 'Goal for Level 4: Net Worth = $50,000. You currently have $38,000. How much more net worth needed?',
                    explanation: 'Goal: $50,000. Current: $38,000. Needed: $50,000 − $38,000 = $12,000.',
                    options: [
                        { text: '$12,000', correct: true },
                        { text: '$38,000', correct: false },
                        { text: '$88,000', correct: false },
                        { text: '$10,000', correct: false }
                    ],
                    workThroughExample: 'Goal - Current = Needed. $50,000 - $38,000 = $12,000 more net worth to reach Level 4 goal.'
                }
            ]
        },
        5: {
            level: 5,
            name: 'Level 5: Classroom Challenge',
            description: 'Portfolio management and competitive strategy across multiple sites',
            passingScore: 4,
            questions: [
                {
                    id: 'q1_l5',
                    type: 'problem_solving',
                    difficulty: 'hard',
                    question: 'You manage 3 mines with different equipment. Southern Cross: Cradle + Dry Blower (+2% +3%). Coolgardie: Excavator (+6%). Kalgoorlie: Crusher + Processing Plant (+6% +8%). Which mine has highest equipment bonus?',
                    explanation: 'SC: 2% + 3% = 5%. Coolgardie: 6%. Kalgoorlie: 6% + 8% = 14%. Kalgoorlie highest.',
                    options: [
                        { text: 'Kalgoorlie with +14%', correct: true },
                        { text: 'Coolgardie with +6%', correct: false },
                        { text: 'Southern Cross with +5%', correct: false },
                        { text: 'All equal', correct: false }
                    ],
                    workThroughExample: 'Compare bonuses: SC (2%+3%=5%), Coolgardie (6%), Kalgoorlie (6%+8%=14%). Kalgoorlie wins with 14%.'
                },
                {
                    id: 'q2_l5',
                    type: 'calculation',
                    difficulty: 'medium',
                    question: 'You have 3 Road Trains (+250 capacity each). Southern Cross has 1 train (+$250). Coolgardie has 2 trains (+$500). What is Kalgoorlie base increase if it gets 1 train?',
                    explanation: 'Each Road Train: +$250 capacity. 1 train for Kalgoorlie: +$250.',
                    options: [
                        { text: '+$250', correct: true },
                        { text: '+$500', correct: false },
                        { text: '+$750', correct: false },
                        { text: '0', correct: false }
                    ],
                    workThroughExample: 'Each Road Train grants +$250 investment capacity to its mine. So 1 train = +$250 for Kalgoorlie.'
                },
                {
                    id: 'q3_l5',
                    type: 'problem_solving',
                    difficulty: 'hard',
                    question: 'Portfolio strategy: You have $5,000. Kalgoorlie Mine costs $2,000. Processing Plant costs $15,000. Operations Manager costs $6,000. Can you afford all three this round?',
                    explanation: 'Total cost: $2,000 + $15,000 + $6,000 = $23,000. Cash: $5,000. No, need $18,000 more.',
                    options: [
                        { text: 'No, need $18,000 more', correct: true },
                        { text: 'Yes, with $500 spare', correct: false },
                        { text: 'Yes, exactly', correct: false },
                        { text: 'No, need $5,000 more', correct: false }
                    ],
                    workThroughExample: 'Total needed: $2,000 + $15,000 + $6,000 = $23,000. Available: $5,000. Shortfall: $23,000 - $5,000 = $18,000.'
                },
                {
                    id: 'q4_l5',
                    type: 'calculation',
                    difficulty: 'medium',
                    question: 'Leaderboard snapshot: You: $120,000 NW. Rival A: $125,000. Rival B: $100,000. You gain $15,000. What is your new rank?',
                    explanation: 'Your new NW: $120,000 + $15,000 = $135,000. Rivals: $125,000 and $100,000. You rank 1st.',
                    options: [
                        { text: '1st ($135,000)', correct: true },
                        { text: '2nd ($130,000)', correct: false },
                        { text: '3rd ($120,000)', correct: false },
                        { text: '1st ($120,000)', correct: false }
                    ],
                    workThroughExample: 'Your net worth: $120,000 + $15,000 = $135,000. Rankings: 1st ($135k), 2nd ($125k), 3rd ($100k).'
                },
                {
                    id: 'q5_l5',
                    type: 'calculation',
                    difficulty: 'medium',
                    question: 'Level 5 Goal: Net Worth = $250,000. You are at $185,000. How much more do you need?',
                    explanation: 'Goal: $250,000. Current: $185,000. Needed: $250,000 − $185,000 = $65,000.',
                    options: [
                        { text: '$65,000', correct: true },
                        { text: '$185,000', correct: false },
                        { text: '$435,000', correct: false },
                        { text: '$60,000', correct: false }
                    ],
                    workThroughExample: 'Goal - Current = Needed. $250,000 - $185,000 = $65,000 more net worth to reach Level 5 goal.'
                }
            ]
        }
    };

    /**
     * Load a quiz for a specific level
     */
    function loadQuiz(level) {
        return QUIZZES[level] || null;
    }

    /**
     * Get a specific question from a quiz
     */
    function getQuestion(level, questionId) {
        const quiz = QUIZZES[level];
        if (!quiz) return null;
        return quiz.questions.find(q => q.id === questionId);
    }

    /**
     * Submit quiz answers and calculate score
     */
    function submitQuiz(level, answers) {
        const quiz = QUIZZES[level];
        if (!quiz) {
            return { success: false, error: 'Quiz not found for this level' };
        }

        let score = 0;
        const results = [];

        quiz.questions.forEach(question => {
            const studentAnswer = answers[question.id];
            const isCorrect = question.options.some(opt => opt.correct && opt.text === studentAnswer);
            
            if (isCorrect) {
                score++;
            }

            results.push({
                questionId: question.id,
                question: question.question,
                studentAnswer: studentAnswer || 'Not answered',
                correct: isCorrect,
                correctAnswer: question.options.find(opt => opt.correct).text,
                explanation: question.explanation,
                workThroughExample: question.workThroughExample,
                type: question.type,
                difficulty: question.difficulty
            });
        });

        const passed = score >= quiz.passingScore;

        const quizResult = {
            success: true,
            level: level,
            score: score,
            totalQuestions: quiz.questions.length,
            passed: passed,
            passingScore: quiz.passingScore,
            results: results,
            timestamp: new Date().toISOString()
        };

        // Save result to localStorage
        _saveQuizResult(level, quizResult);

        return quizResult;
    }

    /**
     * Save quiz result to localStorage
     */
    function _saveQuizResult(level, result) {
        try {
            const allResults = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
            allResults[`level_${level}`] = result;
            localStorage.setItem(STORAGE_KEY, JSON.stringify(allResults));
        } catch (error) {
            console.error('Failed to save quiz result:', error);
        }
    }

    /**
     * Get last quiz result for a level
     */
    function getLastQuizResult(level) {
        try {
            const allResults = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
            return allResults[`level_${level}`] || null;
        } catch (error) {
            console.error('Failed to get quiz result:', error);
            return null;
        }
    }

    /**
     * Clear all quiz results
     */
    function clearResults() {
        try {
            localStorage.removeItem(STORAGE_KEY);
            return { success: true, message: 'Quiz results cleared' };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    return {
        loadQuiz,
        getQuestion,
        submitQuiz,
        getLastQuizResult,
        clearResults,
        QUIZZES
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = ProgressionQuiz;
}
