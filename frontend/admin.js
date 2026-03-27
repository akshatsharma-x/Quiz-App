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

    // 3. SECURE SOCKET.IO LIVE EXAM ROOM TRACKING
    const socket = io('http://localhost:5001');

    // Register this socket as an admin to authorize receiving broadcasts
    socket.emit('joinAdminRoom');

    // Handle updates to the active test-takers
    socket.on('liveTakersUpdate', (takersArray) => {
        const tableBody = document.getElementById('liveTakersTable');
        
        if (takersArray.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #888;">No students currently taking exams.</td></tr>';
            return;
        }

        tableBody.innerHTML = ''; // Clear old data
        
        takersArray.forEach(student => {
            const timeStarted = new Date(student.startTime).toLocaleTimeString();
            const warningColor = student.warnings > 0 ? '#ff4757' : '#2ed573';
            const warningBadge = student.warnings > 0 ? `⚠️ ${student.warnings} Warnings` : `✅ Clear`;

            const row = `<tr>
                <td style="font-weight: 600;">${student.name}</td>
                <td>${student.email}</td>
                <td><span class="badge" style="background: var(--bg-card); color: var(--primary);">${student.quizId}</span></td>
                <td>${timeStarted}</td>
                <td style="color: ${warningColor}; font-weight: 600;">${warningBadge}</td>
            </tr>`;
            tableBody.innerHTML += row;
        });
    });

    // Handle incoming Anti-Cheat Alerts in real-time
    socket.on('cheatAlert', (alertData) => {
        showToastAlert(`🚨 Anti-Cheat: ${alertData.name} was caught switching tabs! (Warning #${alertData.warnings})`);
    });

    // 4. MODULE 4: ANALYTICS & CSV EXPORT 
    const exportCard = document.getElementById('exportResultsCard');
    if (exportCard) {
        exportCard.addEventListener('click', async () => {
            const quizId = prompt("Enter the exact Quiz ID you wish to export:");
            if (!quizId) return;

            try {
                showToastAlert(`Generating robust CSV report for Quiz: ${quizId}...`);
                
                const response = await fetch(`http://localhost:5001/api/v1/admin/results/${quizId}/csv`, {
                    method: 'GET',
                    headers: { 'Authorization': `Bearer ${token}` }
                });

                if (!response.ok) {
                    const data = await response.json().catch(() => ({}));
                    throw new Error(data.error || 'Failed to generate CSV. Check the Quiz ID.');
                }

                // Force a secure file download from the memory blob
                const blob = await response.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `LMS_Report_${quizId}.csv`;
                document.body.appendChild(a);
                a.click();
                a.remove();
                window.URL.revokeObjectURL(url);
                showToastAlert(`✅ Successfully downloaded CSV for Quiz ${quizId}`);
            } catch (error) {
                showToastAlert(`❌ Error: ${error.message}`);
            }
        });
    }

    // 5. MODULE 3: EXTERNAL FORM INTEGRATOR
    const embedExternalCard = document.getElementById('embedExternalCard');
    const externalQuizModal = document.getElementById('externalQuizModal');
    const closeExtModal = document.querySelector('.close-modal');
    const externalQuizForm = document.getElementById('externalQuizForm');

    if (embedExternalCard && externalQuizModal && closeExtModal) {
        embedExternalCard.addEventListener('click', () => {
            externalQuizModal.style.display = 'flex';
        });

        closeExtModal.addEventListener('click', () => {
            externalQuizModal.style.display = 'none';
        });

        // Close when clicking outside modal-content
        externalQuizModal.addEventListener('click', (e) => {
            if (e.target === externalQuizModal) {
                externalQuizModal.style.display = 'none';
            }
        });
    }

    if (externalQuizForm) {
        externalQuizForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const payload = {
                title: document.getElementById('extQuizTitle').value,
                googleFormUrl: document.getElementById('extQuizUrl').value,
                targetBatch: document.getElementById('extQuizBatch').value,
                scheduledTime: document.getElementById('extQuizTime').value
            };

            try {
                const res = await fetch('http://localhost:5001/api/v1/admin/quizzes/external', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify(payload)
                });

                const data = await res.json();
                if (res.ok) {
                    showToastAlert('✅ External Quiz successfully embedded!');
                    externalQuizModal.style.display = 'none';
                    externalQuizForm.reset();
                } else {
                    showToastAlert(`❌ Error: ${data.error || 'Failed to embed'}`);
                }
            } catch (error) {
                showToastAlert('❌ Network error. Please try again.');
            }
        });
    }

    // 6. MODULE 6: CSV BULK IMPORT (Drag & Drop)
    const bulkImportCard = document.getElementById('bulkImportCard');
    const bulkImportModal = document.getElementById('bulkImportModal');
    const closeBulkModal = document.querySelector('.close-bulk-modal');
    const dropZone = document.getElementById('dropZone');
    const csvFileInput = document.getElementById('csvFileInput');
    const dropText = document.getElementById('dropText');
    const uploadProgress = document.getElementById('uploadProgress');
    const progressBar = document.getElementById('progressBar');

    if (bulkImportCard && bulkImportModal && closeBulkModal) {
        bulkImportCard.addEventListener('click', () => {
            bulkImportModal.style.display = 'flex';
        });

        closeBulkModal.addEventListener('click', () => {
            bulkImportModal.style.display = 'none';
        });

        // Close on outside click
        bulkImportModal.addEventListener('click', (e) => {
            if (e.target === bulkImportModal) bulkImportModal.style.display = 'none';
        });
    }

    if (dropZone && csvFileInput) {
        // Trigger hidden file input when clicking the drop zone
        dropZone.addEventListener('click', () => csvFileInput.click());

        // Handle styling when file is hovered over the drop zone
        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.style.background = '#ffe5b4'; // Darker orange tint
            dropZone.style.transform = 'scale(1.02)';
        });

        dropZone.addEventListener('dragleave', (e) => {
            e.preventDefault();
            dropZone.style.background = '#fffaf0';
            dropZone.style.transform = 'scale(1)';
        });

        // Handle the actual file drop event
        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.style.background = '#fffaf0';
            dropZone.style.transform = 'scale(1)';
            
            if (e.dataTransfer.files.length) {
                handleFileUpload(e.dataTransfer.files[0]);
            }
        });

        // Handle classic browser manual file selection
        csvFileInput.addEventListener('change', (e) => {
            if (e.target.files.length) {
                handleFileUpload(e.target.files[0]);
            }
        });
    }

    // Process the file using fetch and FormData to upload via multer
    async function handleFileUpload(file) {
        if (!file.name.endsWith('.csv')) {
            return showToastAlert('❌ Invalid file type. Please upload a .csv file.');
        }

        dropText.innerText = `Selected: ${file.name}`;
        uploadProgress.style.display = 'block';
        
        // Faux progress bar for UX (Wait 1 sec)
        setTimeout(() => progressBar.style.width = '70%', 100);

        // Building the FormData payload required for multipart/form-data
        const formData = new FormData();
        formData.append('file', file);

        try {
            const res = await fetch('http://localhost:5001/api/v1/admin/questions/bulk', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`
                    // Do NOT set Content-Type header manually when sending FormData, 
                    // the browser automatically sets it with the correct multipart boundary!
                },
                body: formData
            });

            const data = await res.json();
            progressBar.style.width = '100%';

            setTimeout(() => {
                if (res.ok) {
                    showToastAlert(`✅ Success! ${data.message}`);
                    bulkImportModal.style.display = 'none';
                } else {
                    showToastAlert(`❌ Upload failed: ${data.error}`);
                }
                
                // Reset UI state
                uploadProgress.style.display = 'none';
                progressBar.style.width = '0%';
                dropText.innerText = 'Drag & Drop CSV File Or Click to Browse';
                csvFileInput.value = '';
            }, 800);

        } catch (error) {
            uploadProgress.style.display = 'none';
            showToastAlert('❌ Network error during upload.');
        }
    }

    function showToastAlert(message) {
        const container = document.getElementById('toastContainer');
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.innerText = message;
        container.appendChild(toast);

        // Auto remove after 5 seconds
        setTimeout(() => {
            toast.style.animation = 'slideIn 0.3s ease-out reverse forwards';
            setTimeout(() => toast.remove(), 300);
        }, 5000);
    }
});