// frontend/student-analytics.js
document.addEventListener('DOMContentLoaded', () => {

    // --- Theme Toggle ---
    const toggleDarkModeBtn = document.getElementById('toggleDarkMode');
    const body = document.body;

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
        // Redraw canvas dynamically to fix colors if needed
        drawRadarChart();
    });

    // --- 1. Pure HTML5 Canvas Radar Chart ---
    // Data definition
    const chartData = {
        labels: ['Data Structures', 'Algorithms', 'Databases', 'Networking', 'Operating Systems'],
        data: [0.85, 0.70, 0.90, 0.60, 0.75] // Scale 0 to 1
    };

    function drawRadarChart() {
        const canvas = document.getElementById('radarChart');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        
        const width = canvas.width;
        const height = canvas.height;
        const centerX = width / 2;
        const centerY = height / 2;
        
        // Settings
        const radius = Math.min(centerX, centerY) - 40; // padding
        const numSides = chartData.labels.length;
        const angleStep = (Math.PI * 2) / numSides;
        
        // Theme dependent colors
        const isLight = body.classList.contains('light-mode');
        const gridColor = isLight ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.1)';
        const textColor = isLight ? '#0f172a' : '#f1f5f9';
        const primaryOrange = '#ff7900';
        const fillOrange = 'rgba(255, 121, 0, 0.3)';

        ctx.clearRect(0, 0, width, height);

        // 1. Draw web/grid (concentric polygons)
        const levels = 5;
        ctx.strokeStyle = gridColor;
        ctx.lineWidth = 1;
        
        for (let i = 1; i <= levels; i++) {
            const levelRadius = radius * (i / levels);
            ctx.beginPath();
            for (let j = 0; j <= numSides; j++) {
                const angle = j * angleStep - Math.PI / 2; // -PI/2 to start at top
                const x = centerX + levelRadius * Math.cos(angle);
                const y = centerY + levelRadius * Math.sin(angle);
                if (j === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.stroke();
        }

        // 2. Draw axes and labels
        ctx.font = '12px Inter, sans-serif';
        ctx.fillStyle = textColor;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        for (let i = 0; i < numSides; i++) {
            const angle = i * angleStep - Math.PI / 2;
            const x = centerX + radius * Math.cos(angle);
            const y = centerY + radius * Math.sin(angle);
            
            // Draw axis line
            ctx.beginPath();
            ctx.moveTo(centerX, centerY);
            ctx.lineTo(x, y);
            ctx.stroke();

            // Draw label slightly outside
            const labelX = centerX + (radius + 20) * Math.cos(angle);
            const labelY = centerY + (radius + 20) * Math.sin(angle);
            ctx.fillText(chartData.labels[i], labelX, labelY);
        }

        // 3. Plot data polygon
        ctx.beginPath();
        for (let i = 0; i < numSides; i++) {
            const val = chartData.data[i];
            const angle = i * angleStep - Math.PI / 2;
            const x = centerX + radius * val * Math.cos(angle);
            const y = centerY + radius * val * Math.sin(angle);
            
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.closePath();
        
        // Fill and stroke
        ctx.fillStyle = fillOrange;
        ctx.fill();
        ctx.strokeStyle = primaryOrange;
        ctx.lineWidth = 3;
        ctx.stroke();

        // 4. Draw data points
        for (let i = 0; i < numSides; i++) {
            const val = chartData.data[i];
            const angle = i * angleStep - Math.PI / 2;
            const x = centerX + radius * val * Math.cos(angle);
            const y = centerY + radius * val * Math.sin(angle);
            
            ctx.beginPath();
            ctx.arc(x, y, 5, 0, Math.PI * 2);
            ctx.fillStyle = primaryOrange;
            ctx.fill();
            ctx.strokeStyle = body.classList.contains('light-mode') ? '#fff' : '#0b0f19';
            ctx.lineWidth = 2;
            ctx.stroke();
        }
    }

    // Initial draw
    drawRadarChart();


    // --- 2. Actionable Feedback ---
    const feedbackListEl = document.getElementById('feedbackList');
    const mockFeedback = [
        {
            q: "What is the time complexity of searching in a perfectly balanced binary search tree?",
            selected: "O(n)",
            correct: "O(log n)"
        },
        {
            q: "Which sorting algorithm has the worst-case time complexity of O(n²)?",
            selected: "Merge Sort",
            correct: "Quick Sort"
        }
    ];

    mockFeedback.forEach(fb => {
        feedbackListEl.innerHTML += `
            <div class="feedback-item">
                <div class="feedback-q">${fb.q}</div>
                <div class="feedback-ans ans-wrong">❌ Your Answer: ${fb.selected}</div>
                <div class="feedback-ans ans-correct">✅ Correct Answer: ${fb.correct}</div>
            </div>
        `;
    });


    // --- 3. Historical Data Table ---
    const historyTableBody = document.getElementById('historyTableBody');
    const searchInput = document.getElementById('searchInput');

    const mockHistory = [
        { name: 'Advanced Data Structures Midterm', date: 'Oct 8, 2023', score: '75%', status: 'Passed' },
        { name: 'Operating Systems Quiz 1', date: 'Sep 25, 2023', score: '92%', status: 'Passed' },
        { name: 'Computer Networks Basics', date: 'Sep 10, 2023', score: '45%', status: 'Failed' },
        { name: 'Database Normalization', date: 'Aug 21, 2023', score: '88%', status: 'Passed' },
        { name: 'Software Engineering Principles', date: 'Aug 05, 2023', score: '100%', status: 'Passed' }
    ];

    function renderTable(filter = '') {
        historyTableBody.innerHTML = '';
        
        const filtered = mockHistory.filter(h => 
            h.name.toLowerCase().includes(filter.toLowerCase())
        );

        if (filtered.length === 0) {
            historyTableBody.innerHTML = `<tr><td colspan="5" style="text-align:center;">No results found</td></tr>`;
            return;
        }

        filtered.forEach(h => {
            const statusClass = h.status === 'Passed' ? 'passed' : 'failed';
            historyTableBody.innerHTML += `
                <tr>
                    <td><strong>${h.name}</strong></td>
                    <td>${h.date}</td>
                    <td><strong>${h.score}</strong></td>
                    <td><span class="status-badge ${statusClass}">${h.status}</span></td>
                    <td><button class="review-btn" onclick="alert('Viewing analytics for ${h.name}...')">Review</button></td>
                </tr>
            `;
        });
    }

    renderTable();

    searchInput.addEventListener('input', (e) => {
        renderTable(e.target.value);
    });
});
