let questionCounter = 0;

document.addEventListener('DOMContentLoaded', () => {
    // Add the first empty question block by default
    addQuestionBlock();

    // Smart Pre-fill Logic: Auto-populate from Admin Post-Login Wizard targeting configurations
    ['targetProgram', 'targetBranch', 'targetBatchYear', 'targetSemester', 'targetSection'].forEach(key => {
        const savedVal = sessionStorage.getItem(`adminPrefill_${key}`);
        if (savedVal) {
            const el = document.getElementById(key);
            if (el) el.value = savedVal;
        }
    });
});

function addQuestionBlock() {
    questionCounter++;
    const qId = questionCounter;
    
    const wrapper = document.getElementById('questionsWrapper');
    
    const html = `
        <div class="question-block" id="questionBox_${qId}">
            <button class="remove-btn" onclick="removeQuestion(${qId})">✕ Remove</button>
            <div class="form-group">
                <label>Question ${qId}</label>
                <textarea id="qText_${qId}" rows="2" placeholder="Enter your question text..." required></textarea>
            </div>
            
            <div class="form-group" style="display: flex; gap: 15px;">
                <div style="flex: 1;">
                    <label>Subject Tags (Comma separated)</label>
                    <input type="text" id="qTags_${qId}" placeholder="e.g., physics, midterm, hard">
                </div>
                <div style="flex: 1;">
                    <label>Correct Answer</label>
                    <input type="text" id="qCorrect_${qId}" placeholder="Exact text of the correct option" required>
                </div>
            </div>

            <label>Options</label>
            <div class="options-container" id="optionsContainer_${qId}">
                <!-- Default 4 options -->
                <div class="option-row"><input type="text" class="opt-input-${qId}" placeholder="Option A" required></div>
                <div class="option-row"><input type="text" class="opt-input-${qId}" placeholder="Option B" required></div>
                <div class="option-row"><input type="text" class="opt-input-${qId}" placeholder="Option C" required></div>
                <div class="option-row"><input type="text" class="opt-input-${qId}" placeholder="Option D" required></div>
            </div>
            <button class="btn btn-outline" style="padding: 5px 10px; font-size: 0.8rem; margin-top: 10px;" onclick="addOptionField(${qId})">+ Add Option</button>
        </div>
    `;
    
    wrapper.insertAdjacentHTML('beforeend', html);
}

function removeQuestion(id) {
    document.getElementById(`questionBox_${id}`).remove();
}

function addOptionField(qId) {
    const container = document.getElementById(`optionsContainer_${qId}`);
    // Mongoose schema limits to max 6 options
    if(container.children.length >= 6) {
        alert("Maximum 6 options allowed per question.");
        return;
    }
    const row = document.createElement('div');
    row.className = 'option-row';
    row.innerHTML = `<input type="text" class="opt-input-${qId}" placeholder="Additional Option" required>
                     <button onclick="this.parentElement.remove()" style="background:none;border:none;color:red;cursor:pointer;">✕</button>`;
    container.appendChild(row);
}

// Extract DOM into API-Ready JSON Payload
async function generateJSON() {
    const title = document.getElementById('quizTitle').value;
    if(!title) { alert("Quiz Title is required!"); return; }

    const questionsHTML = document.getElementsByClassName('question-block');
    if(questionsHTML.length === 0) { alert("Please add at least one question."); return; }

    const payload = {
        title: title,
        description: document.getElementById('quizDesc').value,
        type: 'native',
        timeLimit: parseInt(document.getElementById('timeLimit').value),
        targetProgram: document.getElementById('targetProgram').value,
        targetBranch: document.getElementById('targetBranch').value,
        targetBatchYear: document.getElementById('targetBatchYear').value,
        targetSemester: document.getElementById('targetSemester').value,
        targetSection: document.getElementById('targetSection').value,
        // Mock start/end times since UI lacks them for brevity
        startTime: new Date(),
        endTime: new Date(Date.now() + 86400000 * 7), // active for 7 days
        questions: []
    };

    // Iterate over every question block
    for(let block of questionsHTML) {
        // Extract the unique ID suffix (e.g., '1' from 'questionBox_1')
        const id = block.id.split('_')[1];
        
        const qText = document.getElementById(`qText_${id}`).value;
        const qCorrect = document.getElementById(`qCorrect_${id}`).value;
        const qTags = document.getElementById(`qTags_${id}`).value.split(',').map(s => s.trim()).filter(Boolean);
        
        // Gather all option inputs for this specific question
        const optionInputs = document.getElementsByClassName(`opt-input-${id}`);
        const optionsArray = [];
        for(let input of optionInputs) {
            if(input.value.trim() !== '') optionsArray.push(input.value.trim());
        }

        if(!qText || !qCorrect || optionsArray.length < 2) {
            alert(`Please complete all fields and provide at least 2 options for Question ${id}`);
            return;
        }

        payload.questions.push({
            questionText: qText,
            options: optionsArray,
            correctAnswer: qCorrect,
            tags: qTags
        });
    }

    // Display the payload
    document.getElementById('debugPanel').style.display = 'block';
    document.getElementById('jsonOutput').innerText = JSON.stringify(payload, null, 4);

    // Initiate the POST request to the backend Native Quiz API
    try {
        const token = localStorage.getItem('quizmuj_token');
        if (!token) {
            alert('Unauthorized. Please log in.');
            return;
        }

        const res = await fetch('http://localhost:5001/api/v1/quizzes', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(payload)
        });

        const data = await res.json();
        
        if (res.ok) {
            alert("✅ Native Quiz Configured & Activated! Routing back to the Dashboard.");
            window.location.href = 'admin.html';
        } else {
            alert(`❌ Failed to create quiz: ${data.error}`);
        }
    } catch (error) {
        console.error("Critical Network Error:", error);
        alert("Network disconnected while saving quiz. Please check server.");
    }
}
