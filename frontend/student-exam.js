// frontend/student-exam.js
document.addEventListener('DOMContentLoaded', () => {
    
    // --- State Management ---
    let ACTIVE_QUESTIONS = [];
    let currentQuizId = null;
    let violationCount = 0; // The Forensics state
    let studentProfile = JSON.parse(localStorage.getItem('quizmuj_user') || '{}');

    const STORAGE_KEY = 'quizmuj_exam_state_v1';
    let state = {
        currentIndex: 0,
        answers: {}, // { qId: selectedOptionIndex }
        review: {},  // { qId: boolean }
        timeLeft: 0 
    };

    // --- DOM Elements ---
    const qTextEl = document.getElementById('qText');
    const optionsContainer = document.getElementById('optionsContainer');
    const qNumberDisplay = document.getElementById('qNumberDisplay');
    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');
    const markReviewBtn = document.getElementById('markReviewBtn');
    const questionGrid = document.getElementById('questionGrid');
    const saveStatus = document.getElementById('saveStatus');
    const timerDisplay = document.getElementById('examTimer');
    const cheatModal = document.getElementById('cheatModal');
    const acknowledgeWarningBtn = document.getElementById('acknowledgeWarningBtn');
    const finalSubmitBtn = document.getElementById('finalSubmitBtn');

    // --- Initialization & Resilience ---
    async function init() {
        // Module 1: URL Parameter Extraction & DB Fetch
        const urlParams = new URLSearchParams(window.location.search);
        currentQuizId = urlParams.get('quizId');

        if (!currentQuizId) {
            alert("No Quiz ID Provided! Redirecting...");
            window.location.href = 'student-dashboard.html';
            return;
        }

        try {
            const token = localStorage.getItem('quizmuj_token');
            const res = await fetch(`http://localhost:5001/api/v1/quizzes/${currentQuizId}`, {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${token}` }
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error);

            ACTIVE_QUESTIONS = data.data.questions;
            state.timeLeft = data.data.timeLimit * 60; // Convert minutes to seconds
        } catch (error) {
            console.error("Failed to load quiz params:", error);
            alert("Security Gate rejection or Quiz expired. Re-routing.");
            window.location.href = 'student-dashboard.html';
            return;
        }

        // Load state from localStorage if exists (Resilience Recovery)
        const savedState = localStorage.getItem(STORAGE_KEY + '_' + currentQuizId);
        if (savedState) {
            try {
                const parsed = JSON.parse(savedState);
                state = { ...state, ...parsed };
                if (state.currentIndex >= ACTIVE_QUESTIONS.length || state.currentIndex < 0) {
                    state.currentIndex = 0;
                }
                console.log("State restored from local storage.");
            } catch(e) {
                console.error("Failed to parse saved state");
            }
        }

        buildGrid();
        renderQuestion(state.currentIndex);
        startTimer();
        
        // Auto-save every 10 seconds securely scoped to this Quiz ID
        setInterval(autoSave, 10000);
    }

    // --- Core Logic ---
    function renderQuestion(index) {
        const q = ACTIVE_QUESTIONS[index];
        qTextEl.textContent = q.questionText; // Dynamic node binding mapping schema
        qNumberDisplay.textContent = `Question ${index + 1} of ${ACTIVE_QUESTIONS.length}`;

        // Render Options
        optionsContainer.innerHTML = '';
        q.options.forEach((optText, optIndex) => {
            const btn = document.createElement('div');
            btn.className = 'option-btn';
            if (state.answers[q._id] === optIndex) { // Map to _id 
                btn.classList.add('selected');
            }
            btn.textContent = optText;
            
            btn.addEventListener('click', () => {
                document.querySelectorAll('.option-btn').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
                
                state.answers[q._id] = optIndex;
                updateGridVisuals();
                autoSave(); 
            });
            
            optionsContainer.appendChild(btn);
        });

        prevBtn.disabled = (index === 0);
        
        if (index === ACTIVE_QUESTIONS.length - 1) {
            nextBtn.textContent = 'Finish';
        } else {
            nextBtn.textContent = 'Next →';
        }

        if (state.review[q._id]) {
            markReviewBtn.innerHTML = '⭐ Marked for Review';
            markReviewBtn.style.color = 'var(--review)';
            markReviewBtn.style.borderColor = 'var(--review)';
        } else {
            markReviewBtn.innerHTML = '☆ Mark for Review';
            markReviewBtn.style.color = '';
            markReviewBtn.style.borderColor = '';
        }

        updateGridVisuals();
    }

    function buildGrid() {
        questionGrid.innerHTML = '';
        ACTIVE_QUESTIONS.forEach((q, idx) => {
            const btn = document.createElement('button');
            btn.className = 'grid-btn';
            btn.textContent = idx + 1;
            btn.addEventListener('click', () => {
                state.currentIndex = idx;
                renderQuestion(idx);
            });
            questionGrid.appendChild(btn);
        });
        updateGridVisuals();
    }

    function updateGridVisuals() {
        const buttons = questionGrid.querySelectorAll('.grid-btn');
        buttons.forEach((btn, idx) => {
            const q = ACTIVE_QUESTIONS[idx];
            
            btn.className = 'grid-btn';
            
            if (state.currentIndex === idx) btn.classList.add('active');
            
            if (state.review[q._id]) {
                btn.classList.add('review');
            } else if (state.answers[q._id] !== undefined) {
                btn.classList.add('answered');
            }
        });
    }

    // --- Navigation Events ---
    prevBtn.addEventListener('click', () => {
        if (state.currentIndex > 0) {
            state.currentIndex--;
            renderQuestion(state.currentIndex);
        }
    });

    nextBtn.addEventListener('click', () => {
        if (state.currentIndex < ACTIVE_QUESTIONS.length - 1) {
            state.currentIndex++;
            renderQuestion(state.currentIndex);
        } else {
            submitExam();
        }
    });

    markReviewBtn.addEventListener('click', () => {
        const qId = ACTIVE_QUESTIONS[state.currentIndex]._id;
        state.review[qId] = !state.review[qId];
        renderQuestion(state.currentIndex); // Re-render to update button text
        autoSave();
    });

    // --- Resilience: Auto Save ---
    function autoSave() {
        localStorage.setItem(STORAGE_KEY + '_' + currentQuizId, JSON.stringify(state));
        
        // Visual indicator
        saveStatus.classList.add('syncing');
        saveStatus.innerHTML = '☁️ Saving...';
        
        setTimeout(() => {
            saveStatus.classList.remove('syncing');
            const d = new Date();
            const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            saveStatus.innerHTML = `✅ Saved at ${timeStr}`;
        }, 1000);
    }

    // --- Timer ---
    function startTimer() {
        const timerObj = setInterval(() => {
            if (state.timeLeft <= 0) {
                clearInterval(timerObj);
                submitExam(true);
                return;
            }
            
            state.timeLeft--;
            
            const minutes = Math.floor(state.timeLeft / 60);
            const seconds = state.timeLeft % 60;
            
            timerDisplay.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
            
            // Turn Red at < 5 minutes
            if (state.timeLeft < 300) {
                timerDisplay.classList.add('danger');
            }
            
            // Every minute, save timer state
            if (state.timeLeft % 60 === 0) autoSave();
            
        }, 1000);
    }

    function submitExam(forced = false) {
        // Clear local storage logic for actual submit
        if (forced || confirm("Are you sure you want to submit your exam? You cannot undo this action.")) {
            localStorage.removeItem(STORAGE_KEY + '_' + currentQuizId);
            alert("Exam submitted successfully! Redirecting to dashboard...");
            window.location.href = 'student-dashboard.html';
        }
    }

    finalSubmitBtn.addEventListener('click', () => submitExam(false));

    // --- Socket.io & Anti-Cheat Logic ---
    const socket = io('http://localhost:5001'); // Point securely to backend API 5001

    socket.on('connect', () => {
        console.log('Focus Mode connected to Proctor Server');
        
        // Push the EXACT student identity straight into the Admin's "Live Exam Room Monitoring" Table
        socket.emit('startLiveExam', { 
            name: studentProfile.name || 'Unknown', 
            email: studentProfile.email || 'Unknown Enrollment',
            quizId: currentQuizId 
        });
    });

    // Page Visibility API - Live Forensics Node
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            console.warn("FOCUS LOST: Tab switched or browser minimized.");
            violationCount++; // Mutate local tracker

            // Emit massive priority alert to backend routing
            socket.emit('proctor-violation', {
                studentName: studentProfile.name || 'Unknown Student',
                rollNo: studentProfile.email || 'Unknown Enrollment', 
                quizId: currentQuizId,
                violationCount: violationCount,
                timestamp: new Date().toISOString()
            });

            // Trigger Severe Local UI
            cheatModal.classList.add('show');
        } else {
            console.log("Focus restored.");
        }
    });

    acknowledgeWarningBtn.addEventListener('click', () => {
        cheatModal.classList.remove('show');
    });

    // Boot
    init();
});
