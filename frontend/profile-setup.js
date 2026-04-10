/* frontend/profile-setup.js */
document.addEventListener('DOMContentLoaded', () => {

    // Target Elements
    const programSelect = document.getElementById('programSelect');
    const branchSelect = document.getElementById('branchSelect');
    const batchYearSelect = document.getElementById('batchYearSelect');
    const semesterSelect = document.getElementById('semesterSelect');
    const sectionSelect = document.getElementById('sectionSelect');
    const setupForm = document.getElementById('setupForm');

    // Cascading Data Mock
    const academicData = {
        'B.Tech': {
            branches: ['CSE', 'IT', 'CCE', 'ECE'],
            years: ['2023-2027', '2024-2028', '2025-2029']
        },
        'BBA': {
            branches: ['General', 'Finance', 'Marketing'],
            years: ['2023-2026', '2024-2027', '2025-2028']
        },
        'BCA': {
            branches: ['General', 'Data Science'],
            years: ['2023-2026', '2024-2027', '2025-2028']
        }
    };

    const maxSemesters = 8;
    const sections = ['A', 'B', 'C', 'D', 'E'];

    // State
    const toggleField = (field, enable, placeholderName) => {
        field.disabled = !enable;
        if (!enable) field.innerHTML = `<option value="" disabled selected>Select ${placeholderName}</option>`;
    };

    const populateSelection = (field, arr, placeholder) => {
        field.innerHTML = `<option value="" disabled selected>${placeholder}</option>`;
        arr.forEach(val => {
            field.innerHTML += `<option value="${val}">${val}</option>`;
        });
        field.disabled = false;
    };

    // Events
    programSelect.addEventListener('change', (e) => {
        const prog = e.target.value;
        const data = academicData[prog];
        
        if (data) {
            populateSelection(branchSelect, data.branches, 'Select Branch');
            toggleField(batchYearSelect, false, 'Batch Year');
            toggleField(semesterSelect, false, 'Semester');
            toggleField(sectionSelect, false, 'Section');
        }
    });

    branchSelect.addEventListener('change', () => {
        const prog = programSelect.value;
        const data = academicData[prog];
        populateSelection(batchYearSelect, data.years, 'Select Batch Year');
        toggleField(semesterSelect, false, 'Semester');
        toggleField(sectionSelect, false, 'Section');
    });

    batchYearSelect.addEventListener('change', () => {
        const sems = Array.from({length: maxSemesters}, (_, i) => `Semester ${i + 1}`);
        populateSelection(semesterSelect, sems, 'Semester');
        toggleField(sectionSelect, false, 'Section');
    });

    semesterSelect.addEventListener('change', () => {
        populateSelection(sectionSelect, sections, 'Section');
    });

    // Form Submission
    setupForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const btn = document.getElementById('saveProfileBtn');
        btn.textContent = 'Saving...';
        btn.disabled = true;

        const payload = {
            program: programSelect.value,
            branch: branchSelect.value,
            batchYear: batchYearSelect.value,
            semester: semesterSelect.value,
            section: sectionSelect.value
        };

        const token = localStorage.getItem('quizmuj_token');

        try {
            const res = await fetch('http://localhost:5001/api/v1/student/profile', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(payload)
            });

            const data = await res.json();
            
            if (data.success) {
                // Return to Dashboard Hub
                window.location.href = 'student-dashboard.html';
            } else {
                alert(data.error || 'Failed to save profile');
                btn.textContent = 'Save & Continue';
                btn.disabled = false;
            }
        } catch (error) {
            console.error('Fetch error:', error);
            alert('Server error attempting to save academic credentials.');
            btn.textContent = 'Save & Continue';
            btn.disabled = false;
        }
    });
});
