document.addEventListener('DOMContentLoaded', () => {
    // 1. AUTH GUARD: Check if user is logged in
    const authToken = localStorage.getItem('quizmuj_token');

    if (!authToken) {
        // Not logged in? Redirect to login immediately
        window.location.href = 'login.html';
    } else {
        // Logged in? Show the body content
        document.body.style.display = 'block';
    }

    // 2. LOGOUT FUNCTIONALITY
    const logoutBtn = document.getElementById('logoutBtn');
    
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            if(confirm("Are you sure you want to logout?")) {
                // Clear the session token
                localStorage.removeItem('quizmuj_token'); 
                // Redirect to login page
                window.location.href = 'login.html'; 
            }
        });
    }
});