document.addEventListener('DOMContentLoaded', () => {
    
    // 1. AUTH GUARD
    const token = localStorage.getItem('quizmuj_token');
    if (!token) {
        window.location.href = 'login.html';
    } else {
        document.body.style.display = 'block';
        initializeDashboard();
    }

    // 2. LOGOUT LOGIC
    document.getElementById('logoutBtn').addEventListener('click', () => {
        if(confirm("Are you sure you want to logout?")) {
            localStorage.removeItem('quizmuj_token');
            window.location.href = 'login.html';
        }
    });
});

function initializeDashboard() {
    setGreeting();
    animateCounters();
    drawChart();
    
    // Set today's date in navbar
    const dateOptions = { weekday: 'short', month: 'short', day: 'numeric' };
    document.getElementById('currentDate').innerText = new Date().toLocaleDateString('en-US', dateOptions);
}

// ★ DYNAMIC GREETING: Changes based on time of day
function setGreeting() {
    const hour = new Date().getHours();
    const greetingElement = document.getElementById('greeting');
    let greeting = "Hello";
    
    if (hour < 12) greeting = "Good Morning";
    else if (hour < 18) greeting = "Good Afternoon";
    else greeting = "Good Evening";

    greetingElement.innerText = `${greeting}, Quizzer! 👋`;
}

// ★ NUMBER ANIMATION: Counts up from 0 to the target number
function animateCounters() {
    const counters = document.querySelectorAll('.counter');
    
    counters.forEach(counter => {
        const target = +counter.getAttribute('data-target');
        const increment = target / 50; // Speed of count
        
        const updateCount = () => {
            const c = +counter.innerText;
            if (c < target) {
                counter.innerText = Math.ceil(c + increment);
                setTimeout(updateCount, 20);
            } else {
                counter.innerText = target;
            }
        };
        updateCount();
    });
}

// ★ CUSTOM CANVAS CHART: Drawing a graph without libraries (Impressive!)
function drawChart() {
    const canvas = document.getElementById('performanceChart');
    const ctx = canvas.getContext('2d');
    
    // Set Canvas Resolution
    canvas.width = canvas.parentElement.offsetWidth;
    canvas.height = 200;

    const data = [20, 45, 30, 60, 50, 85, 70]; // Mock Data points
    const width = canvas.width;
    const height = canvas.height;
    const padding = 20;
    const step = (width - padding * 2) / (data.length - 1);

    // Gradient Fill for under the line
    let gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, "rgba(255, 121, 0, 0.4)"); // Orange transparent
    gradient.addColorStop(1, "rgba(255, 121, 0, 0.0)");

    ctx.beginPath();
    ctx.moveTo(padding, height - data[0] * 2); // *2 to scale height visually

    // Draw the line
    data.forEach((point, index) => {
        const x = padding + index * step;
        const y = height - (point * 2) - padding;
        ctx.lineTo(x, y);
    });

    // Style the line
    ctx.strokeStyle = "#ff7900";
    ctx.lineWidth = 3;
    ctx.stroke();

    // Fill the area below
    ctx.lineTo(width - padding, height);
    ctx.lineTo(padding, height);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    // Draw Dots on points
    data.forEach((point, index) => {
        const x = padding + index * step;
        const y = height - (point * 2) - padding;
        
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fillStyle = "white";
        ctx.fill();
        ctx.strokeStyle = "#ff7900";
        ctx.stroke();
    });
}