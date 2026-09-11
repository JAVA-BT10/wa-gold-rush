
// ========== PROGRESSION CHECKPOINT SYSTEM ==========
function checkProgressionGoal() {
    if (!gameState || !gameState.gameConfig) return;
    
    // Get progression goal for current level
    const levelKey = String(gameState.assignedLevel || 2);
    const goal = gameState.gameConfig.progressionCheckpoint?.levels?.[levelKey];
    
    if (!goal || gameState.getNetWorth() < goal) return;
    
    // Only show quiz once per session
    if (gameState.checkpointStatus === 'quiz_available' || 
        gameState.checkpointStatus === 'quiz_passed') return;
    
    gameState.checkpointStatus = 'quiz_available';
    showProgressionQuiz();
}

function showProgressionQuiz() {
    if (!window.ProgressionQuiz) {
        console.warn('ProgressionQuiz not loaded');
        return;
    }
    
    const levelKey = String(gameState.assignedLevel || 2);
    const quiz = ProgressionQuiz.loadQuiz(levelKey);
    
    if (!quiz || !quiz.questions) {
        console.warn('No quiz available for level', levelKey);
        return;
    }
    
    const modal = document.getElementById('checkpointQuizModal');
    if (!modal) return;
    
    const container = document.getElementById('quizContainer');
    const resultsContainer = document.getElementById('quizResultsContainer');
    const submitDiv = document.getElementById('quizSubmitButton');
    
    // Reset UI
    if (resultsContainer) resultsContainer.style.display = 'none';
    if (submitDiv) submitDiv.style.display = 'block';
    
    // Render questions
    container.innerHTML = '';
    quiz.questions.forEach((q, idx) => {
        const qDiv = document.createElement('div');
        qDiv.style.cssText = 'margin: 20px 0; padding: 15px; background: #f9f9f9; border-radius: 8px;';
        
        let optionsHtml = '';
        if (q.options && Array.isArray(q.options)) {
            optionsHtml = q.options.map((opt, oidx) => `
                <label style="display: block; margin: 8px 0; cursor: pointer;">
                    <input type="radio" name="q${q.id}" value="${escapeHtml(opt.text || opt)}" required>
                    ${escapeHtml(opt.text || opt)}
                </label>
            `).join('');
        }
        
        qDiv.innerHTML = `
            <p><strong>Q${idx + 1}: ${escapeHtml(q.question)}</strong></p>
            ${optionsHtml}
        `;
        container.appendChild(qDiv);
    });
    
    // Attach submit handler
    const submitBtn = document.getElementById('submitQuizButton');
    if (submitBtn) {
        submitBtn.onclick = () => submitQuiz(quiz);
    }
    
    // Show modal
    modal.classList.add('active');
}

function submitQuiz(quiz) {
    const answers = {};
    const levelKey = String(gameState.assignedLevel || 2);
    
    quiz.questions.forEach(q => {
        const selected = document.querySelector(`input[name="q${q.id}"]:checked`);
        answers[q.id] = selected ? selected.value : '';
    });
    
    // Submit to ProgressionQuiz system
    const result = ProgressionQuiz.submitQuiz(levelKey, answers);
    displayQuizResults(result, quiz);
}

function displayQuizResults(result, quiz) {
    const container = document.getElementById('quizContainer');
    const resultsContainer = document.getElementById('quizResultsContainer');
    const submitDiv = document.getElementById('quizSubmitButton');
    const retakeBtn = document.getElementById('quizRetakeButton');
    const continueBtn = document.getElementById('quizContinueButton');
    const resultTitle = document.getElementById('quizResultTitle');
    const scoreDisplay = document.getElementById('quizScoreDisplay');
    const answerReview = document.getElementById('quizAnswerReview');
    
    // Hide quiz, show results
    if (container) container.style.display = 'none';
    if (submitDiv) submitDiv.style.display = 'none';
    if (resultsContainer) resultsContainer.style.display = 'block';
    
    // Display title and score
    const passed = result.passed;
    if (resultTitle) {
        resultTitle.textContent = passed ? '🎉 Quiz Passed!' : '❌ Quiz Failed';
    }
    if (scoreDisplay) {
        scoreDisplay.textContent = `${result.score} / ${result.totalQuestions}`;
        scoreDisplay.style.color = passed ? '#4caf50' : '#f44336';
    }
    
    // Display answer review
    if (answerReview && result.results) {
        const reviewHtml = result.results.map(r => `
            <div style="margin: 10px 0; padding: 10px; background: ${r.correct ? '#e8f5e9' : '#ffebee'}; border-radius: 4px; border-left: 4px solid ${r.correct ? '#4caf50' : '#f44336'};">
                <p style="margin: 0 0 5px 0;"><strong>${r.correct ? '✅' : '❌'} ${escapeHtml(r.question)}</strong></p>
                <p style="margin: 0 0 5px 0; font-size: 12px; color: #666;">Your answer: ${escapeHtml(r.studentAnswer)}</p>
                <p style="margin: 0 0 5px 0; font-size: 12px; color: #4caf50;"><strong>Correct:</strong> ${escapeHtml(r.correctAnswer)}</p>
                <p style="margin: 0; font-size: 12px; color: #555; font-style: italic;">${escapeHtml(r.explanation)}</p>
            </div>
        `).join('');
        answerReview.innerHTML = reviewHtml;
    }
    
    // Show appropriate buttons
    if (passed) {
        if (retakeBtn) retakeBtn.style.display = 'none';
        if (continueBtn) {
            continueBtn.style.display = 'block';
            continueBtn.onclick = () => closeAllModals();
        }
        gameState.checkpointStatus = 'quiz_passed';
    } else {
        if (retakeBtn) {
            retakeBtn.style.display = 'block';
            retakeBtn.onclick = () => {
                gameState.checkpointStatus = 'quiz_available';
                showProgressionQuiz();
            };
        }
        if (continueBtn) continueBtn.style.display = 'none';
    }
}

// ========== END PROGRESSION CHECKPOINT SYSTEM ==========

