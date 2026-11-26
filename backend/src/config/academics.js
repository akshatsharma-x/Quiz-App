// Single source of truth for the academic structure used for cohort targeting.
// Served to the frontend via GET /api/v1/meta/academics so the student profile,
// admin wizard, quiz builder and external-quiz form always offer identical values.

const PROGRAMS = {
  'B.Tech': {
    durationYears: 4,
    semesters: 8,
    branches: ['CSE', 'IT', 'CCE', 'ECE', 'AIML', 'DSE', 'Mechanical', 'Civil', 'Electrical']
  },
  BBA: {
    durationYears: 3,
    semesters: 6,
    branches: ['General', 'Finance', 'Marketing', 'HR', 'Business Analytics']
  },
  BCA: {
    durationYears: 3,
    semesters: 6,
    branches: ['General', 'Data Science', 'Cloud Computing']
  }
};

const SECTIONS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

// Batch windows are generated relative to the current year so the list never goes stale.
// Includes the batch that is graduating this year plus every running batch.
const batchYearsFor = (durationYears, now = new Date()) => {
  const year = now.getFullYear();
  const years = [];
  for (let start = year - durationYears; start <= year; start++) {
    years.push(`${start}-${start + durationYears}`);
  }
  return years;
};

const semesterLabels = (count) => Array.from({ length: count }, (_, i) => `Semester ${i + 1}`);

const getCatalog = () => {
  const programs = {};
  Object.entries(PROGRAMS).forEach(([name, cfg]) => {
    programs[name] = {
      branches: cfg.branches,
      batchYears: batchYearsFor(cfg.durationYears),
      semesters: semesterLabels(cfg.semesters)
    };
  });
  return { programs, sections: SECTIONS };
};

// Validates a full academic identity (used when a student saves their profile).
const validateProfile = ({ program, branch, batchYear, semester, section }) => {
  const catalog = getCatalog();
  const p = catalog.programs[program];
  if (!p) return 'Please select a valid program';
  if (!p.branches.includes(branch)) return `Please select a valid branch for ${program}`;
  if (!/^\d{4}-\d{4}$/.test(batchYear || '')) return 'Please select a valid batch year';
  if (!p.semesters.includes(semester)) return `Please select a valid semester for ${program}`;
  if (!SECTIONS.includes(section)) return 'Please select a valid section';
  return null;
};

// Validates quiz/announcement targeting where every field may also be 'All'.
const validateTargeting = (t) => {
  const catalog = getCatalog();
  const program = t.targetProgram || 'All';
  if (program !== 'All' && !catalog.programs[program]) return 'Invalid target program';
  const p = catalog.programs[program];
  const branch = t.targetBranch || 'All';
  if (branch !== 'All' && p && !p.branches.includes(branch)) return `Invalid target branch for ${program}`;
  const batch = t.targetBatchYear || 'All';
  if (batch !== 'All' && !/^\d{4}-\d{4}$/.test(batch)) return 'Invalid target batch year';
  const sem = t.targetSemester || 'All';
  if (sem !== 'All' && !/^Semester \d{1,2}$/.test(sem)) return 'Invalid target semester';
  const sec = t.targetSection || 'All';
  if (sec !== 'All' && !SECTIONS.includes(sec)) return 'Invalid target section';
  return null;
};

module.exports = { getCatalog, validateProfile, validateTargeting, SECTIONS };
