document.addEventListener('DOMContentLoaded', () => {
    
    // --- 1. Dynamic Greeting ---
    const greetingEl = document.getElementById('dynamicGreeting');
    const timeDateEl = document.getElementById('timeDateDisplay');
    
    function updateGreeting() {
        const hour = new Date().getHours();
        const userName = "Student"; // Replace with actual user name from auth
        let greeting = "Good Evening";
        
        if (hour < 12) greeting = "Good Morning";
        else if (hour < 18) greeting = "Good Afternoon";
        
        greetingEl.innerHTML = `${greeting}, <span style="color: var(--primary-orange)">${userName}</span>`;
        
        const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute:'2-digit' };
        timeDateEl.textContent = new Date().toLocaleDateString('en-US', options);
    }
    
    updateGreeting();
    setInterval(updateGreeting, 60000); // Update time every minute


    // --- 3. Profile Dropdown & Dark Mode ---
    const avatar = document.getElementById('profileAvatar');
    const menu = document.getElementById('profileMenu');
    const toggleDarkModeBtn = document.getElementById('toggleDarkMode');
    const body = document.body;

    avatar.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.classList.toggle('show');
    });

    document.addEventListener('click', () => {
        menu.classList.remove('show');
    });

    // Check Local Storage for Theme
    if(localStorage.getItem('theme') === 'light') {
        body.classList.replace('dark-mode', 'light-mode');
    }

    toggleDarkModeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (body.classList.contains('dark-mode')) {
            body.classList.replace('dark-mode', 'light-mode');
            localStorage.setItem('theme', 'light');
        } else {
            body.classList.replace('light-mode', 'dark-mode');
            localStorage.setItem('theme', 'dark');
        }
    });

    // --- 4. Dynamic Dashboard Rendering (Smart Quiz Filtering) ---
    const upcomingListEl = document.getElementById('upcomingQuizzes');

    async function fetchUpcomingQuizzes() {
        const token = localStorage.getItem('quizmuj_token');
        if (!token) return;

        try {
            const res = await fetch('http://localhost:5001/api/v1/student/my-quizzes', {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            const data = await res.json();

            if (data.success) {
                if (data.profileIncomplete) {
                    window.location.href = 'profile-setup.html';
                    return;
                }

                upcomingListEl.innerHTML = ''; // Clear loading states

                if (data.data.length === 0) {
                    // Empty State Rendering
                    upcomingListEl.innerHTML = `
                        <div style="text-align: center; padding: 2rem; color: var(--text-muted);">
                            <div style="font-size: 3rem; margin-bottom: 1rem;">🌴</div>
                            <h3 style="color: var(--text-color); margin-bottom: 0.5rem;">You're all caught up!</h3>
                            <p>No quizzes scheduled for your batch.</p>
                        </div>
                    `;
                    return;
                }

                // Connect to Socket Cohort Room specifically based on DB params
                if (data.studentCohort) {
                    socket.emit('joinCohortRoom', data.studentCohort);
                }

                // Loop through returned JSON data
                data.data.forEach(quiz => {
                    injectQuizCard(quiz);
                });
            } else {
                console.error("API Error: ", data.error);
                upcomingListEl.innerHTML = `<li class="quiz-item"><p style="color: #ef4444">Failed to load quizzes.</p></li>`;
            }
        } catch (error) {
            console.error("Network Error: ", error);
            upcomingListEl.innerHTML = `<li class="quiz-item"><p style="color: #ef4444">Server disconnected.</p></li>`;
        }
    }

    // Dynamic UI Injection Function Helper
    function injectQuizCard(quiz) {
        // Remove empty state if present
        if (upcomingListEl.innerHTML.includes('all caught up')) {
            upcomingListEl.innerHTML = '';
        }

        const startDate = new Date(quiz.startTime);
        const formattedTime = startDate.toLocaleDateString() + ' at ' + startDate.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        
        // --- Phase 2: Assessment Gateway Logic ---
        const endpoint = quiz.type === 'google_form' ? 'external-quiz.html' : 'student-exam.html';

        upcomingListEl.innerHTML += `
            <li class="quiz-item fade-in" style="animation-duration: 0.5s">
                <div class="quiz-info">
                    <h4>${quiz.title}</h4>
                    <p>🕒 ${formattedTime} | Type: ${quiz.type === 'native' ? 'Proctored' : 'External'}</p>
                </div>
                <div class="quiz-action">
                    <button onclick="window.location.href='${endpoint}?quizId=${quiz._id}'">Join</button>
                </div>
            </li>
        `;
    }

    fetchUpcomingQuizzes();

    // Mock Recent Results (Pending generic Results backend implementation)
    const recentResults = [
        { id: 4, title: 'Web Development Basics', date: 'Oct 8, 2023', score: '92%' },
        { id: 5, title: 'Database Management', date: 'Oct 5, 2023', score: '85%' },
        { id: 6, title: 'Machine Learning 101', date: 'Sep 28, 2023', score: '78%' }
    ];

    const recentListEl = document.getElementById('recentResults');
    recentResults.forEach(quiz => {
        recentListEl.innerHTML += `
            <li class="quiz-item">
                <div class="quiz-info">
                    <h4>${quiz.title}</h4>
                    <p>📅 ${quiz.date}</p>
                </div>
                <div class="quiz-action">
                    <span class="score">${quiz.score}</span>
                </div>
            </li>
        `;
    });

    // --- 5. Socket.io Live Notifications ---
    const notifDot = document.getElementById('notifDot');
    const bellBtn = document.getElementById('bellBtn');
    const toastContainer = document.getElementById('toastContainer');
    
    // Connect to Backend WebSocket
    const socket = io('http://localhost:5001'); // Ensure aligned to Express server port

    socket.on('connect', () => {
        console.log('Connected to QuizMUJ Live Server');
    });

    socket.on('global-announcement', (data) => {
        // data expects: { title, message }
        showToast(data.message || 'New announcement from Administrator');
        notifDot.classList.add('active'); // Wake up the bell dot
    });

    // Real-Time Targeted Broadcasting Hook
    socket.on('new-quiz-available', (quizData) => {
        console.log("Real-Time Broadcast Received:", quizData);
        showToast(`New Quiz Available: ${quizData.title}`);
        notifDot.classList.add('active');
        injectQuizCard(quizData);
    });

    bellBtn.addEventListener('click', () => {
        notifDot.classList.remove('active');
        // In a real app, open a modal with notification history
        alert("You're caught up! No new notifications.");
    });

    function showToast(message) {
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.innerHTML = `
            <div class="toast-icon">📢</div>
            <div class="toast-content">
                <strong>Admin Broadcast</strong><br>
                <span style="font-size: 0.9em; color: var(--text-muted);">${message}</span>
            </div>
        `;
        
        toastContainer.appendChild(toast);

        // Remove toast after 5 seconds
        setTimeout(() => {
            toast.classList.add('toast-closing');
            toast.addEventListener('animationend', () => {
                toast.remove();
            });
        }, 5000);
    }
    
    // Testing the toast (Mocking a push from admin)
    setTimeout(() => {
        showToast("Welcome to QuizMUJ! Your journey begins now.");
        notifDot.classList.add('active');
    }, 2000);
});
