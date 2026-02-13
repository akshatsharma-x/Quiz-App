document.addEventListener('DOMContentLoaded', () => {
    
    // 1. AUTH CHECK
    const token = localStorage.getItem('quizmuj_token');
    
    // Optional: You could check for a specific "admin_token" here later
    if (!token) {
        window.location.href = 'login.html';
    } else {
        document.body.style.display = 'block';
    }

    // 2. LOGOUT LOGIC
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            if(confirm("Logout from Admin Console?")) {
                localStorage.removeItem('quizmuj_token');
                window.location.href = 'login.html';
            }
        });
    }
});