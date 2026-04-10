/* frontend/student-leaderboard.js */
document.addEventListener('DOMContentLoaded', () => {

    // --- Profile Dropdown & Theme Logic ---
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

    // --- Gamification Data ---
    const CURRENT_USER_ID = 'u_42'; 
    
    // Top 5 Students Mock Data
    const globalLeaderboard = [
        { id: 'u_1', name: 'Rohan Gupta', major: 'B.Tech IT', xp: 45200, avatar: 'R' },
        { id: 'u_2', name: 'Priya Sharma', major: 'B.Tech CSE', xp: 42150, avatar: 'P' },
        { id: 'u_3', name: 'Vikram Singh', major: 'B.Tech CSE', xp: 39800, avatar: 'V' },
        { id: 'u_4', name: 'Ananya Desai', major: 'BCA', xp: 35420, avatar: 'A' },
        { id: 'u_5', name: 'Kabir Khan', major: 'B.Tech CCE', xp: 34100, avatar: 'K' }
    ];

    // Build the UI
    const leaderboardListEl = document.getElementById('leaderboardList');
    
    function renderLeaderboard() {
        leaderboardListEl.innerHTML = '';
        
        globalLeaderboard.forEach((student, index) => {
            const rank = index + 1;
            let rankClass = `rank-${rank}`;
            if (rank > 3) rankClass = ''; // Only color top 3
            
            const isCurrentUser = student.id === CURRENT_USER_ID;
            const highlightClass = isCurrentUser ? 'highlight-user' : '';
            const tagHtml = isCurrentUser ? `<span class="user-tag">You</span>` : '';

            // Using simple initial for avatar rather than images. Same styling as navbar avatar.
            const lbItem = document.createElement('li');
            lbItem.className = `lb-item ${rankClass} ${highlightClass}`;
            
            lbItem.innerHTML = `
                <div class="lb-rank">#${rank}</div>
                <div class="avatar" style="width:45px;height:45px;">${student.avatar}</div>
                <div class="lb-details">
                    <h4>${student.name} ${tagHtml}</h4>
                    <p>${student.major}</p>
                </div>
                <div class="lb-score">
                    ${student.xp.toLocaleString()} <span>XP</span>
                </div>
            `;
            
            leaderboardListEl.appendChild(lbItem);
        });
        
        // Let's add the current user (if outside top 5) to the bottom of the list with a separator
        const finalItem = document.createElement('li');
        finalItem.className = `lb-item highlight-user`;
        finalItem.style.marginTop = '1rem';
        finalItem.style.borderStyle = 'dashed'; // Indicate disjoint item
        
        finalItem.innerHTML = `
            <div class="lb-rank" style="font-size:0.9rem">#42</div>
            <div class="avatar" style="width:45px;height:45px;">A</div>
            <div class="lb-details">
                <h4>Akshat Sharma <span class="user-tag">You</span></h4>
                <p>B.Tech CSE</p>
            </div>
            <div class="lb-score">
                12,450 <span>XP</span>
            </div>
        `;
        
        leaderboardListEl.appendChild(finalItem);
    }

    renderLeaderboard();
});
