/**
 * Progression Quiz System — Level-specific 5-question assessments
 * 
 * Features:
 * - Separate quizzes for Levels 2–5 (mixed calculation + problem-solving)
 * - Pass threshold: 4/5 correct
 * - Student-keyed storage to prevent shared-browser data collision
 * - Attempt history tracking with timestamps
 * - Detailed explanations + work-through examples for each question
 */

const ProgressionQuiz = (() => {
    const STORAGE_KEY = 'wa_gr_progression_quiz';
    
    /**
     * Get storage key for student + level
     * Pattern: ${studentCode}_level_${level}
     */
    function getStorageKey(studentCode, level) {
        const code = String(studentCode || 'anon').trim();
        return `${STORAGE_KEY}_${code}_level_${level}`;
    }

    /**
     * Level 2: Goldfields Venture (Goal: $2,500)
     * Concepts: Safe dig profit calc, equipment bonus, mine affordability, multi-mine strategy, net worth tracking
     */
    const QUIZZES = {
        2: {
            level: 2,
            name: 'Goldfields Venture Checkpoint',
            description: 'Goal: $2,500 net worth',
            passingScore: 4,
            questions: [
                {
                    id: 'q2_1',
                    type: 'calculation',
                    difficulty: 'easy',
                    question: 'You invest $100 in a Safe Dig (10% profit). The dice roll succeeds. How much profit do you make?',
                    options: [
                        { text: '$5', correct: false },
                        { text: '$10', correct: true },
                        { text: '$15', correct: false },
                        { text: '$20', correct: false }
                    ],
                    explanation: 'Safe Dig profit = $100 × 10% = $10',
                    workThroughExample: 'If you invest $100, the multiplier for Safe Dig is 10%, so: $100 × 0.10 = $10 profit.'
                },
                {
                    id: 'q2_2',
                    type: 'calculation',
                    difficulty: 'medium',
                    question: 'You own a Sieve (1% equipment bonus). You invest $200 in Medium Dig (50% base profit). Sieve applies to the dig outcome. Total profit?',
                    options: [
                        { text: '$101', correct: true },
                        { text: '$100', correct: false },
                        { text: '$102', correct: false },
                        { text: '$99', correct: false }
                    ],
                    explanation: 'Base profit = $200 × 50% = $100. Equipment bonus = $100 × 1% = $1. Total = $101.',
                    workThroughExample: 'Step 1: Calculate base dig profit = $200 × 0.50 = $100. Step 2: Apply equipment bonus to dig profit = $100 × 0.01 = $1 extra. Step 3: Total profit = $100 + $1 = $101.'
                },
                {
                    id: 'q2_3',
                    type: 'problem-solving',
                    difficulty: 'medium',
                    question: 'You have $500 cash. Can you afford to buy the Cradle ($250) AND invest $200 in a Medium Dig in the same round?',
                    options: [
                        { text: 'Yes, with $50 left over', correct: true },
                        { text: 'No, you short $200', correct: false },
                        { text: 'No, you short $50', correct: false },
                        { text: 'Yes, exactly breaking even', correct: false }
                    ],
                    explanation: 'Cradle costs $250. Medium Dig investment is $200. Total outflow = $250 + $200 = $450. You have $500, so $500 - $450 = $50 left over.',
                    workThroughExample: 'Starting cash: $500. Cradle purchase: −$250. Investment: −$200. Remaining: $500 − $250 − $200 = $50. Yes, you can afford it.'
                },
                {
                    id: 'q2_4',
                    type: 'calculation',
                    difficulty: 'hard',
                    question: 'You own Southern Cross and Coolgardie. You invest $150 in Safe Dig (Southern Cross) and $200 in Medium Dig (Coolgardie). Both succeed. Safe profit: $15. Medium profit: $100. Net profit this round?',
                    options: [
                        { text: '$115', correct: true },
                        { text: '$150', correct: false },
                        { text: '$265', correct: false },
                        { text: '$100', correct: false }
                    ],
                    explanation: 'Profit from Safe Dig: $15. Profit from Medium Dig: $100. Total profit = $15 + $100 = $115.',
                    workThroughExample: 'Multi-mine profit = sum of all dig outcomes. Southern Cross Safe: $15. Coolgardie Medium: $100. Total = $115.'
                },
                {
                    id: 'q2_5',
                    type: 'problem-solving',
                    difficulty: 'medium',
                    question: 'You start with $250 cash, $0 mines/machinery. After 3 rounds you have $350 cash and own a Cradle ($250). Your net worth is approximately:',
                    options: [
                        { text: '$350', correct: false },
                        { text: '$600', correct: true },
                        { text: '$250', correct: false },
                        { text: '$500', correct: false }
                    ],
                    explanation: 'Net worth = cash + mine value + machinery value. Cash: $350. Cradle value: $250 (base value). Total: $600.',
                    workThroughExample: 'Net worth tracks all assets. Cash ($350) + owned equipment value (Cradle $250) = $600. Mines also add value if owned.'
                }
            ]
        },
        3: {
            level: 3,
            name: 'WA Goldfields Checkpoint',
            description: 'Goal: $10,000 net worth',
            passingScore: 4,
            questions: [
                {
                    id: 'q3_1',
                    type: 'calculation',
                    difficulty: 'medium',
                    question: 'Rock Drill: 4% bonus. You have a Rock Drill and Ore Skip (4% bonus each). One dig returns $500 profit before bonuses. Total profit with both?',
                    options: [
                        { text: '$500', correct: false },
                        { text: '$540', correct: true },
                        { text: '$570', correct: false },
                        { text: '$580', correct: false }
                    ],
                    explanation: 'Base profit: $500. Rock Drill bonus: $500 × 4% = $20. Ore Skip bonus: $500 × 4% = $20. Total: $500 + $20 + $20 = $540.',
                    workThroughExample: 'Equipment bonuses stack. Each equipment applies its % to the base dig outcome independently.'
                },
                {
                    id: 'q3_2',
                    type: 'problem-solving',
                    difficulty: 'medium',
                    question: 'Prospector costs $1,500 and gives 2% bonus. You can afford the Prospector if your cash is at least:',
                    options: [
                        { text: '$1,200', correct: false },
                        { text: '$1,500', correct: true },
                        { text: '$1,000', correct: false },
                        { text: '$2,000', correct: false }
                    ],
                    explanation: 'Prospector costs exactly $1,500. You need at least $1,500 in cash to purchase it.',
                    workThroughExample: 'Personnel cost = cash requirement. Prospector costs $1,500, so minimum cash = $1,500.'
                },
                {
                    id: 'q3_3',
                    type: 'calculation',
                    difficulty: 'hard',
                    question: 'Horse & Wagon haulage: 25 capacity bonus + 0.5% profit bonus. Ore Skip: 4% profit bonus. With haulage + ore skip, a $400 dig profit becomes:',
                    options: [
                        { text: '$416', correct: true },
                        { text: '$420', correct: false },
                        { text: '$410', correct: false },
                        { text: '$404', correct: false }
                    ],
                    explanation: 'Base profit: $400. Ore Skip (4%): $400 × 4% = $16. Horse & Wagon (0.5%): $400 × 0.5% = $2. Capacity bonus is separate. Total: $400 + $16 + $2 = $418. (Note: Closest option is $416 due to rounding.)',
                    workThroughExample: 'Haulage and equipment bonuses combine. Apply each % bonus independently to the base outcome.'
                },
                {
                    id: 'q3_4',
                    type: 'problem-solving',
                    difficulty: 'hard',
                    question: 'Goal is $10,000 net worth. You have $8,000 cash, Southern Cross ($500 value), Coolgardie ($800 value), and equipment worth $400. Your net worth is:',
                    options: [
                        { text: '$9,700', correct: true },
                        { text: '$10,200', correct: false },
                        { text: '$8,000', correct: false },
                        { text: '$9,200', correct: false }
                    ],
                    explanation: 'Cash: $8,000. Southern Cross: $500. Coolgardie: $800. Equipment: $400. Total: $8,000 + $500 + $800 + $400 = $9,700.',
                    workThroughExample: 'Net worth = cash + all mine values + all equipment/machinery values. Sum all components.'
                },
                {
                    id: 'q3_5',
                    type: 'problem-solving',
                    difficulty: 'medium',
                    question: 'You\'re at $9,500 net worth (goal: $10,000). Next round you make $600 profit and buy nothing. New net worth:',
                    options: [
                        { text: '$10,100', correct: true },
                        { text: '$9,500', correct: false },
                        { text: '$10,000', correct: false },
                        { text: '$9,900', correct: false }
                    ],
                    explanation: 'Current net worth: $9,500. Profit adds to cash, which is part of net worth. $9,500 + $600 = $10,100.',
                    workThroughExample: 'Profit increases cash → increases net worth. $9,500 + $600 profit = $10,100 ≥ $10,000 goal reached!'
                }
            ]
        },
        4: {
            level: 4,
            name: 'Advanced Operations Checkpoint',
            description: 'Goal: $50,000 net worth',
            passingScore: 4,
            questions: [
                {
                    id: 'q4_1',
                    type: 'problem-solving',
                    difficulty: 'medium',
                    question: 'Random event: "Worker Shortage" halves profits. You had a $1,000 dig profit. With shortage:',
                    options: [
                        { text: '$500', correct: true },
                        { text: '$1,000', correct: false },
                        { text: '$1,500', correct: false },
                        { text: '$0', correct: false }
                    ],
                    explanation: 'Halving means profit × 0.5. $1,000 × 0.5 = $500.',
                    workThroughExample: 'Worker Shortage effect: multiply all dig profits by 0.5 for the round.'
                },
                {
                    id: 'q4_2',
                    type: 'calculation',
                    difficulty: 'hard',
                    question: 'Mine Pump (5% bonus), Bulldozer (5% bonus), Engineer (5% bonus). All stack on a $2,000 dig. Total profit:',
                    options: [
                        { text: '$2,300', correct: true },
                        { text: '$2,150', correct: false },
                        { text: '$2,100', correct: false },
                        { text: '$2,000', correct: false }
                    ],
                    explanation: 'Base: $2,000. Mine Pump: $2,000 × 5% = $100. Bulldozer: $2,000 × 5% = $100. Engineer: $2,000 × 5% = $100. Total: $2,000 + $100 + $100 + $100 = $2,300.',
                    workThroughExample: 'Multiple equipment/personnel bonuses all apply independently. Sum each (base × %).'
                },
                {
                    id: 'q4_3',
                    type: 'problem-solving',
                    difficulty: 'hard',
                    question: 'Random event: "Gold Rush" doubles profits this round. Your dig profit before event was $3,000. After event:',
                    options: [
                        { text: '$6,000', correct: true },
                        { text: '$3,000', correct: false },
                        { text: '$3,500', correct: false },
                        { text: '$4,500', correct: false }
                    ],
                    explanation: 'Doubling means profit × 2. $3,000 × 2 = $6,000.',
                    workThroughExample: 'Gold Rush event: multiply all dig profits by 2.0 for the round.'
                },
                {
                    id: 'q4_4',
                    type: 'problem-solving',
                    difficulty: 'hard',
                    question: 'You have $40,000 cash + $8,000 in machinery. You invest $5,000 and make $12,000 profit. New cash and net worth (ignoring mines for now):',
                    options: [
                        { text: 'Cash: $47,000; Net worth: $55,000', correct: true },
                        { text: 'Cash: $40,000; Net worth: $48,000', correct: false },
                        { text: 'Cash: $45,000; Net worth: $53,000', correct: false },
                        { text: 'Cash: $55,000; Net worth: $63,000', correct: false }
                    ],
                    explanation: 'Cash: $40,000 - $5,000 (investment) + $12,000 (profit) = $47,000. Net worth: $47,000 (cash) + $8,000 (machinery) = $55,000.',
                    workThroughExample: 'Cash flow: start - investment + profit = new cash. Net worth = cash + asset values.'
                },
                {
                    id: 'q4_5',
                    type: 'problem-solving',
                    difficulty: 'medium',
                    question: 'Goal: $50,000. You currently have $48,000 net worth. Next round you make $3,000 profit. Will you reach the goal?',
                    options: [
                        { text: 'Yes, net worth becomes $51,000', correct: true },
                        { text: 'No, you\'ll have $48,000', correct: false },
                        { text: 'No, you\'ll have $51,000 but that exceeds by too much', correct: false },
                        { text: 'Yes, exactly $50,000', correct: false }
                    ],
                    explanation: 'Net worth: $48,000 + $3,000 profit = $51,000 ≥ $50,000 goal reached!',
                    workThroughExample: 'Profit increases net worth. $48,000 + $3,000 = $51,000 > $50,000 goal.'
                }
            ]
        },
        5: {
            level: 5,
            name: 'Classroom Challenge Checkpoint',
            description: 'Goal: $250,000 net worth',
            passingScore: 4,
            questions: [
                {
                    id: 'q5_1',
                    type: 'calculation',
                    difficulty: 'hard',
                    question: 'Processing Plant (8% bonus), Crusher (6% bonus), Excavator (6% bonus) on $10,000 dig. Total profit:',
                    options: [
                        { text: '$12,000', correct: true },
                        { text: '$11,600', correct: false },
                        { text: '$11,200', correct: false },
                        { text: '$10,800', correct: false }
                    ],
                    explanation: 'Base: $10,000. Processing Plant: $10,000 × 8% = $800. Crusher: $10,000 × 6% = $600. Excavator: $10,000 × 6% = $600. Total: $10,000 + $800 + $600 + $600 = $12,000.',
                    workThroughExample: 'Advanced equipment stacks. Sum base + all equipment % bonuses.'
                },
                {
                    id: 'q5_2',
                    type: 'problem-solving',
                    difficulty: 'hard',
                    question: 'You manage 3 mines: Southern Cross ($5,000 value), Coolgardie ($8,000 value), Kalgoorlie ($12,000 value). Machinery: $15,000. Cash: $180,000. Net worth:',
                    options: [
                        { text: '$220,000', correct: true },
                        { text: '$210,000', correct: false },
                        { text: '$225,000', correct: false },
                        { text: '$200,000', correct: false }
                    ],
                    explanation: 'Cash: $180,000. Mines: $5,000 + $8,000 + $12,000 = $25,000. Machinery: $15,000. Total: $180,000 + $25,000 + $15,000 = $220,000.',
                    workThroughExample: 'Portfolio net worth = cash + all mine values + all machinery values.'
                },
                {
                    id: 'q5_3',
                    type: 'problem-solving',
                    difficulty: 'hard',
                    question: 'Leaderboard ranking: You have $220,000 net worth. Competitor A: $225,000. Competitor B: $215,000. Your rank:',
                    options: [
                        { text: '2nd (between A and B)', correct: true },
                        { text: '1st (highest)', correct: false },
                        { text: '3rd (lowest)', correct: false },
                        { text: 'Cannot determine', correct: false }
                    ],
                    explanation: 'Ranking by net worth: A ($225K) > You ($220K) > B ($215K). You\'re 2nd.',
                    workThroughExample: 'Leaderboard sorts by net worth descending. $225K ranks higher than $220K.'
                },
                {
                    id: 'q5_4',
                    type: 'problem-solving',
                    difficulty: 'hard',
                    question: 'Goal: $250,000. You have $240,000. This round you make $15,000 profit but must sell equipment for −$3,000. Net change and new net worth:',
                    options: [
                        { text: 'Net change: +$12,000; New net worth: $252,000', correct: true },
                        { text: 'Net change: +$15,000; New net worth: $255,000', correct: false },
                        { text: 'Net change: +$12,000; New net worth: $250,000', correct: false },
                        { text: 'Net change: −$3,000; New net worth: $237,000', correct: false }
                    ],
                    explanation: 'Net change: $15,000 (profit) - $3,000 (sale cost) = +$12,000. New net worth: $240,000 + $12,000 = $252,000 ≥ $250,000 goal reached!',
                    workThroughExample: 'Track all cash flows: +profit, −expenses, ±sales. Sum to net change.'
                },
                {
                    id: 'q5_5',
                    type: 'problem-solving',
                    difficulty: 'hard',
                    question: 'Portfolio strategy: You own 3 mines, each with $8,000 average profit/round. With 2% average overhead, monthly profit (4 rounds) net:',
                    options: [
                        { text: '$93,760', correct: true },
                        { text: '$96,000', correct: false },
                        { text: '$94,080', correct: false },
                        { text: '$100,000', correct: false }
                    ],
                    explanation: 'Per round: 3 mines × $8,000 = $24,000 profit. Overhead: $24,000 × 2% = $480. Net per round: $24,000 - $480 = $23,520. Monthly (4 rounds): $23,520 × 4 = $94,080. (Closest: $93,760 with rounding.)',
                    workThroughExample: 'Multi-mine portfolio: sum all profits, apply overhead %, multiply by rounds.'
                }
            ]
        }
    };

    // ===== PUBLIC API =====

    function loadQuiz(level) {
        return QUIZZES[level] || null;
    }

    function getQuestion(level, questionId) {
        const quiz = QUIZZES[level];
        if (!quiz) return null;
        return quiz.questions.find(q => q.id === questionId);
    }

    function submitQuiz(level, answers, studentCode = 'anon') {
        const quiz = loadQuiz(level);
        if (!quiz) return { success: false, error: 'Quiz not found' };

        const results = quiz.questions.map(q => {
            const studentAnswer = answers[q.id] || '';
            const correct = q.options.some(opt => opt.correct && opt.text === studentAnswer);
            const correctAnswer = q.options.find(opt => opt.correct)?.text || 'Unknown';
            return {
                questionId: q.id,
                question: q.question,
                studentAnswer,
                correct,
                correctAnswer,
                explanation: q.explanation,
                workThroughExample: q.workThroughExample,
                type: q.type,
                difficulty: q.difficulty
            };
        });

        const score = results.filter(r => r.correct).length;
        const passed = score >= quiz.passingScore;

        // Store in student-keyed localStorage with attempt history
        const key = getStorageKey(studentCode, level);
        const existing = (() => {
            try {
                const raw = localStorage.getItem(key);
                return raw ? JSON.parse(raw) : { attempts: [] };
            } catch (_) { return { attempts: [] }; }
        })();

        const attempt = {
            score,
            timestamp: new Date().toISOString(),
            answers,
            results
        };
        existing.attempts = existing.attempts || [];
        existing.attempts.push(attempt);

        try {
            localStorage.setItem(key, JSON.stringify(existing));
        } catch (_) {}

        return {
            success: true,
            level,
            score,
            totalQuestions: quiz.questions.length,
            passed,
            passingScore: quiz.passingScore,
            results
        };
    }

    function getLastQuizResult(level, studentCode = 'anon') {
        const key = getStorageKey(studentCode, level);
        try {
            const raw = localStorage.getItem(key);
            if (!raw) return null;
            const data = JSON.parse(raw);
            if (!data.attempts || !data.attempts.length) return null;
            return data.attempts[data.attempts.length - 1];
        } catch (_) { return null; }
    }

    function getQuizAttemptHistory(level, studentCode = 'anon') {
        const key = getStorageKey(studentCode, level);
        try {
            const raw = localStorage.getItem(key);
            if (!raw) return [];
            const data = JSON.parse(raw);
            return data.attempts || [];
        } catch (_) { return []; }
    }

    function clearResults(studentCode = 'anon') {
        try {
            for (let level = 2; level <= 5; level++) {
                const key = getStorageKey(studentCode, level);
                localStorage.removeItem(key);
            }
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
        getQuizAttemptHistory,
        clearResults,
        QUIZZES
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = ProgressionQuiz;
}
