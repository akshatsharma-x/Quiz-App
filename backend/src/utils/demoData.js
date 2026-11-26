// Demo dataset used by `npm run seed:demo` and by SHOWCASE_MODE (public demo deployments).
// Demo accounts are *upserted* (stable ids), so visitors stay signed in when data refreshes.
const User = require('../models/User');
const Quiz = require('../models/Quiz');
const Result = require('../models/Result');
const QuestionBank = require('../models/QuestionBank');
const Announcement = require('../models/Announcement');
const { evaluateAttempt } = require('./quizUtils');

const DEMO_PASSWORD = 'Demo1234';
const DEMO_FACULTY = { name: 'Demo Faculty', email: 'demo.faculty@quizmuj.app' };
const DAY = 24 * 3600 * 1000;

const isDemoEmail = (email) => /^demo\./i.test(String(email || '').trim());

// Deterministic PRNG so every seed tells the same story
let seed = 20261126;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const between = (a, b) => a + Math.floor(rand() * (b - a + 1));

const STUDENTS = [
  ['Aarav Sharma', 'B.Tech', 'CSE', '2024-2028', 'Semester 4', 'A', 0.78],
  ['Priya Mehta', 'B.Tech', 'CSE', '2024-2028', 'Semester 4', 'A', 0.92],
  ['Rohan Gupta', 'B.Tech', 'CSE', '2024-2028', 'Semester 4', 'A', 0.64],
  ['Ananya Desai', 'B.Tech', 'CSE', '2024-2028', 'Semester 4', 'A', 0.86],
  ['Vikram Singh', 'B.Tech', 'CSE', '2024-2028', 'Semester 4', 'B', 0.55],
  ['Ishita Rao', 'B.Tech', 'CSE', '2024-2028', 'Semester 4', 'B', 0.81],
  ['Kabir Khan', 'B.Tech', 'CSE', '2024-2028', 'Semester 4', 'B', 0.7],
  ['Sneha Iyer', 'B.Tech', 'CSE', '2024-2028', 'Semester 4', 'B', 0.95],
  ['Arjun Nair', 'B.Tech', 'IT', '2024-2028', 'Semester 4', 'A', 0.6],
  ['Meera Pillai', 'B.Tech', 'IT', '2024-2028', 'Semester 4', 'A', 0.74],
  ['Dev Malhotra', 'BBA', 'Finance', '2025-2028', 'Semester 2', 'A', 0.69],
  ['Riya Kapoor', 'BBA', 'Finance', '2025-2028', 'Semester 2', 'A', 0.83]
];
const emailOf = (name) => `demo.${name.toLowerCase().replace(/\s+/g, '.')}@muj.manipal.edu`;

const Q = {
  ds: [
    ['What is the worst-case time complexity of searching in a balanced BST?', ['O(n)', 'O(log n)', 'O(1)', 'O(n log n)'], 'O(log n)', 'trees', 'A balanced BST keeps its height at O(log n), so a search visits one node per level.'],
    ['Which data structure follows FIFO order?', ['Stack', 'Queue', 'Tree', 'Graph'], 'Queue', 'queues', 'A queue removes elements in the order they were added: first in, first out.'],
    ['Breadth-first search is usually implemented with a…', ['Stack', 'Queue', 'Heap', 'Hash map'], 'Queue', 'graphs', 'BFS explores level by level, which a FIFO queue models naturally.'],
    ['Which traversal of a BST yields keys in sorted order?', ['Pre-order', 'In-order', 'Post-order', 'Level-order'], 'In-order', 'trees', 'In-order visits left subtree, node, right subtree — ascending order for a BST.'],
    ['Dijkstra’s algorithm can give wrong answers with…', ['Negative edge weights', 'Cycles', 'Undirected graphs', 'Sparse graphs'], 'Negative edge weights', 'graphs', 'Dijkstra assumes a finalised distance never decreases, which negative edges violate.'],
    ['Which task is a stack the natural fit for?', ['Undo history', 'Printer queues', 'Round-robin scheduling', 'Breadth-first search'], 'Undo history', 'stacks', 'Undo needs last-in, first-out access to the most recent action.'],
    ['Average lookup time in a hash table with a good hash function is…', ['O(1)', 'O(log n)', 'O(n)', 'O(n²)'], 'O(1)', 'hashing', 'Uniform hashing keeps buckets short, so lookups take constant time on average.'],
    ['Which of these is NOT a self-balancing tree?', ['AVL tree', 'Red-black tree', 'Binary search tree', 'B-tree'], 'Binary search tree', 'trees', 'A plain BST can degrade into a linked list; AVL, red-black and B-trees rebalance.'],
    ['The best-case time complexity of insertion sort is…', ['O(n)', 'O(n log n)', 'O(n²)', 'O(log n)'], 'O(n)', 'sorting', 'On already-sorted input insertion sort only compares each element once.'],
    ['Merge sort’s worst-case time complexity is…', ['O(n log n)', 'O(n²)', 'O(n)', 'O(log n)'], 'O(n log n)', 'sorting', 'Merge sort always splits in half and merges in linear time.']
  ],
  sql: [
    ['Which SQL clause filters groups after aggregation?', ['WHERE', 'HAVING', 'ORDER BY', 'LIMIT'], 'HAVING', 'sql', 'WHERE filters rows before grouping; HAVING filters the aggregated groups.'],
    ['A relation in 2NF must also be in…', ['1NF', '3NF', 'BCNF', '4NF'], '1NF', 'normalisation', 'Each normal form builds on the previous one.'],
    ['Which join returns only matching rows from both tables?', ['INNER JOIN', 'LEFT JOIN', 'FULL OUTER JOIN', 'CROSS JOIN'], 'INNER JOIN', 'sql', 'An inner join keeps only rows with a match on both sides.'],
    ['A primary key column can contain NULL values.', ['True', 'False'], 'False', 'dbms', 'Primary keys must be unique and NOT NULL.'],
    ['Which property of ACID guarantees committed data survives a crash?', ['Atomicity', 'Consistency', 'Isolation', 'Durability'], 'Durability', 'dbms', 'Durability means committed transactions are persisted.'],
    ['Removing transitive dependencies brings a table to…', ['2NF', '3NF', '1NF', 'BCNF'], '3NF', 'normalisation', '3NF eliminates transitive dependencies on the key.']
  ],
  os: [
    ['Which scheduling algorithm can cause starvation?', ['Round robin', 'Shortest job first', 'FCFS', 'None of these'], 'Shortest job first', 'scheduling'],
    ['A context switch saves the…', ['Process state', 'Disk contents', 'Network buffers', 'Compiler cache'], 'Process state', 'processes'],
    ['How many Coffman conditions are needed for deadlock?', ['2', '3', '4', '5'], '4', 'deadlock'],
    ['Paging eliminates…', ['External fragmentation', 'Internal fragmentation', 'Thrashing', 'Page faults'], 'External fragmentation', 'memory']
  ],
  bba: [
    ['The 4 Ps of marketing are product, price, place and…', ['Promotion', 'People', 'Process', 'Profit'], 'Promotion', 'marketing'],
    ['A SWOT analysis covers strengths, weaknesses, opportunities and…', ['Threats', 'Targets', 'Trends', 'Tactics'], 'Threats', 'strategy'],
    ['Market segmentation divides a market by…', ['Shared customer characteristics', 'Product price', 'Company size', 'Sales region only'], 'Shared customer characteristics', 'marketing']
  ]
};
const toQuestions = (rows) => rows.map(([questionText, options, correctAnswer, tag, explanation]) => ({
  questionText, options, correctAnswer, tags: tag ? [tag] : [], explanation: explanation || ''
}));

// Builds a submitted attempt with plausible answers, timings and proctoring data
const makeResult = (quiz, student, skill, submittedAt, { violations = 0 } = {}) => {
  const answerMap = {};
  const timeMap = {};
  quiz.questions.forEach((q) => {
    const id = String(q._id);
    timeMap[id] = between(9, 70);
    const roll = rand();
    if (roll < skill) answerMap[id] = q.correctAnswer;
    else if (roll < skill + (1 - skill) * 0.85) answerMap[id] = q.options.find((o) => o !== q.correctAnswer);
  });
  const evaluation = evaluateAttempt(quiz, answerMap, timeMap);
  const spent = Object.values(timeMap).reduce((s, t) => s + t, 0);
  const startedAt = new Date(submittedAt.getTime() - spent * 1000);
  const auditLog = [];
  for (let i = 0; i < violations; i++) {
    const t = new Date(startedAt.getTime() + (i + 1) * Math.floor((spent * 1000) / (violations + 2)));
    auditLog.push({ action: i % 2 ? 'full_screen_exit' : 'tab_switch', timestamp: t, details: `Left the exam (violation #${i + 1})` });
    auditLog.push({ action: 'focus_restored', timestamp: new Date(t.getTime() + between(3, 25) * 1000), details: 'Returned to the exam' });
  }
  return {
    user: student._id,
    quiz: quiz._id,
    quizType: 'native',
    status: 'submitted',
    startedAt,
    deadline: new Date(Math.min(startedAt.getTime() + quiz.timeLimit * 60000, quiz.endTime.getTime())),
    submittedAt,
    submissionType: 'manual',
    score: evaluation.score,
    totalPossibleScore: evaluation.totalPossibleScore,
    answers: evaluation.answers,
    timeSpentSeconds: spent,
    tabSwitches: violations,
    auditLog,
    isFlagged: violations > 3,
    flagReasons: violations > 3 ? [`Left the exam window ${violations} times`] : []
  };
};

const demoAccounts = () => ({
  student: { name: STUDENTS[0][0], email: emailOf(STUDENTS[0][0]), password: DEMO_PASSWORD },
  faculty: { name: DEMO_FACULTY.name, email: DEMO_FACULTY.email, password: DEMO_PASSWORD }
});

// Creates the demo account or restores it to a clean state (keeping its _id)
const upsertDemoUser = async (doc) => {
  const existing = await User.findOne({ email: doc.email });
  if (!existing) return User.create({ ...doc, password: DEMO_PASSWORD, isVerified: true });
  const { createdAt, ...fields } = doc;
  await User.updateOne({ _id: existing._id }, {
    $set: { ...fields, isVerified: true, isBanned: false, totalScore: 0 },
    $unset: { lastSeenAnnouncementsAt: 1 }
  });
  return User.findById(existing._id);
};

/**
 * (Re)builds the demo dataset. With `reset`, ALL quizzes, attempts, announcements and bank
 * questions are removed first (intended for dedicated demo databases only).
 */
const seedDemoData = async ({ reset = false } = {}) => {
  seed = 20261126;
  const now = Date.now();
  const at = (offsetMs) => new Date(now + offsetMs);

  if (reset) {
    await Promise.all([Quiz.deleteMany({}), Result.deleteMany({}), Announcement.deleteMany({}), QuestionBank.deleteMany({})]);
  }

  const faculty = await upsertDemoUser({ ...DEMO_FACULTY, role: 'admin' });

  // ---- Students -----------------------------------------------------------------------
  const students = [];
  for (let i = 0; i < STUDENTS.length; i++) {
    const [name, program, branch, batchYear, semester, section, skill] = STUDENTS[i];
    const user = await upsertDemoUser({
      name, email: emailOf(name), role: 'user',
      program, branch, batchYear, semester, section,
      createdAt: at(-(i < 9 ? 20 - i : 4 - (i - 9)) * DAY),
      lastLoginAt: at(-between(1, 30) * 3600 * 1000)
    });
    students.push({ user, skill, program, branch });
  }

  // ---- Question bank --------------------------------------------------------------------
  const bank = [...toQuestions(Q.ds), ...toQuestions(Q.sql), ...toQuestions(Q.os), ...toQuestions(Q.bba)];
  await QuestionBank.insertMany(bank.map((q) => ({ ...q, createdBy: faculty._id })));

  // ---- Quizzes ------------------------------------------------------------------------------
  const cse = { targetProgram: 'B.Tech', targetBranch: 'CSE', targetBatchYear: '2024-2028', targetSemester: 'All', targetSection: 'All' };
  const btech = { targetProgram: 'B.Tech', targetBranch: 'All', targetBatchYear: '2024-2028', targetSemester: 'All', targetSection: 'All' };
  const mk = (doc) => Quiz.create({ type: 'native', pointsPerQuestion: 1, passPercentage: 40, createdBy: faculty._id, ...doc });

  const linear = await mk({ ...cse, title: 'Linear Data Structures Quiz', description: 'Stacks, queues, hashing and sorting basics.', timeLimit: 15, pointsPerQuestion: 2,
    startTime: at(-9 * DAY), endTime: at(-2 * DAY + 3 * 3600 * 1000), answerReveal: 'after_end', questions: toQuestions([Q.ds[1], Q.ds[5], Q.ds[6], Q.ds[8], Q.ds[9], Q.ds[2]]) });
  const sqlQuiz = await mk({ ...btech, title: 'SQL & Normalisation Test', description: 'Joins, aggregation and normal forms. Calculators are not allowed.', timeLimit: 20,
    startTime: at(-6 * DAY), endTime: at(-20 * 3600 * 1000), answerReveal: 'after_end', questions: toQuestions(Q.sql) });
  const trees = await mk({ ...cse, title: 'Trees & Graphs Practice', description: 'Traversals, balancing and shortest paths. Answers are shown right after you submit.', timeLimit: 20,
    startTime: at(-3 * DAY), endTime: at(4 * DAY), answerReveal: 'immediately', shuffleQuestions: true, questions: toQuestions([Q.ds[0], Q.ds[3], Q.ds[4], Q.ds[7], Q.ds[2]]) });
  const midterm = await mk({ ...cse, title: 'Data Structures Midterm', description: 'Covers units 1–3. Full-screen focus mode; tab switches are reported live.', timeLimit: 30,
    startTime: at(-90 * 60 * 1000), endTime: at(8 * 3600 * 1000), answerReveal: 'after_end', shuffleOptions: true, questions: toQuestions(Q.ds) });
  await mk({ ...btech, title: 'Operating Systems Weekly', description: 'Scheduling, deadlocks and memory management.', timeLimit: 15,
    startTime: at(DAY + 2 * 3600 * 1000), endTime: at(DAY + 5 * 3600 * 1000), questions: toQuestions(Q.os) });
  await mk({ targetProgram: 'BBA', targetBranch: 'All', targetBatchYear: 'All', targetSemester: 'All', targetSection: 'All',
    title: 'Marketing Fundamentals', description: 'The 4 Ps, segmentation and SWOT.', timeLimit: 10,
    startTime: at(-2 * 3600 * 1000), endTime: at(2 * DAY), answerReveal: 'immediately', questions: toQuestions(Q.bba) });
  await mk({ ...cse, title: 'Computer Networks Basics (draft)', description: 'Hidden until it is reviewed.', timeLimit: 20, isActive: false,
    startTime: at(3 * DAY), endTime: at(4 * DAY), questions: toQuestions(Q.os.slice(0, 2)) });

  // ---- Attempts spread over the past week (feeds charts, streaks and the leaderboard) -------------
  const results = [];
  const cseStudents = students.filter((s) => s.program === 'B.Tech' && s.branch === 'CSE');
  const btechStudents = students.filter((s) => s.program === 'B.Tech');
  cseStudents.forEach((s, i) => {
    const day = i === 0 ? -2 : -(between(2, 8));
    results.push(makeResult(linear, s.user, s.skill, at(day * DAY + between(1, 6) * 3600 * 1000 - 14 * 3600 * 1000), { violations: i === 4 ? 5 : i === 2 ? 1 : 0 }));
  });
  btechStudents.forEach((s, i) => {
    if (i === 6) return; // one student missed it
    const when = i === 0 ? at(-26 * 3600 * 1000) : at(-between(26, 120) * 3600 * 1000);
    results.push(makeResult(sqlQuiz, s.user, s.skill, when, { violations: i === 8 ? 2 : 0 }));
  });
  cseStudents.forEach((s, i) => {
    if (i === 3 || i === 6) return; // still to attempt
    const when = i === 0 ? at(-3 * 3600 * 1000) : at(-between(2, 60) * 3600 * 1000);
    results.push(makeResult(trees, s.user, s.skill, when));
  });
  cseStudents.slice(1, 6).forEach((s, i) => {
    results.push(makeResult(midterm, s.user, s.skill, at(-between(5, 70) * 60 * 1000), { violations: i === 3 ? 4 : 0 }));
  });
  await Result.insertMany(results);

  // Keep the legacy points counter consistent with the inserted attempts
  for (const s of students) {
    const points = results.filter((r) => String(r.user) === String(s.user._id)).reduce((sum, r) => sum + r.score, 0);
    if (points) await User.updateOne({ _id: s.user._id }, { $set: { totalScore: points } });
  }

  // ---- Announcements -------------------------------------------------------------------------------
  const announcements = [
    [{ title: 'Midterm is live', message: 'The Data Structures midterm is open until this evening. Use a stable connection — your answers autosave.', priority: 'important', ...cse }, -80 * 60 * 1000],
    [{ title: 'SQL results published', message: 'Answers and explanations for the SQL & Normalisation Test are now visible on your results page.', priority: 'info', ...btech }, -18 * 3600 * 1000],
    [{ title: 'Welcome to QuizMUJ', message: 'All quizzes for your cohort appear on your dashboard automatically. Good luck this term!', priority: 'info', targetProgram: 'All', targetBranch: 'All', targetBatchYear: 'All', targetSemester: 'All', targetSection: 'All' }, -6 * DAY]
  ];
  for (const [doc, offset] of announcements) {
    const a = await Announcement.create({ ...doc, createdBy: faculty._id });
    // Backdate via the raw collection (Mongoose timestamps would overwrite createdAt)
    await Announcement.collection.updateOne({ _id: a._id }, { $set: { createdAt: at(offset), updatedAt: at(offset) } });
  }


  return { students: students.length, questions: bank.length, quizzes: 7, attempts: results.length, announcements: 3 };
};

module.exports = { seedDemoData, demoAccounts, isDemoEmail, DEMO_PASSWORD };
