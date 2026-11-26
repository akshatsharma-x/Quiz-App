// Real-time layer (Socket.io). Every socket is authenticated with the same JWT as the
// REST API, so identities shown to admins come from the database, never from the client.
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const User = require('./models/User');
const Result = require('./models/Result');
const Quiz = require('./models/Quiz');
const { matchesCohort } = require('./utils/quizUtils');

let io = null;

// Live exam sessions: `${userId}:${quizId}` -> session
const liveSessions = new Map();
const sessionKey = (userId, quizId) => `${userId}:${quizId}`;

const VIOLATION_TYPES = ['tab_switch', 'window_blur', 'full_screen_exit', 'copy_attempt', 'mouse_leave'];
const COUNTED_VIOLATIONS = ['tab_switch', 'window_blur', 'full_screen_exit'];

const VIOLATION_MESSAGES = {
  tab_switch: 'switched tabs or minimised the window',
  window_blur: 'moved focus away from the exam window',
  full_screen_exit: 'exited full-screen mode',
  copy_attempt: 'attempted to copy exam content',
  mouse_leave: 'moved the cursor outside the exam'
};

const cohortLabel = (u) => [u.program, u.branch, u.batchYear, u.semester, u.section && `Sec ${u.section}`]
  .filter(Boolean).join(' · ');

const toSocketUser = (user) => ({
  id: String(user._id),
  name: user.name,
  email: user.email,
  role: user.role,
  program: user.program,
  branch: user.branch,
  batchYear: user.batchYear,
  semester: user.semester,
  section: user.section
});

const publicSession = (s) => ({
  userId: s.userId,
  name: s.name,
  email: s.email,
  cohort: s.cohort,
  quizId: s.quizId,
  quizTitle: s.quizTitle,
  resultId: s.resultId,
  startedAt: s.startedAt,
  deadline: s.deadline,
  violations: s.violations,
  answered: s.answered,
  total: s.total,
  status: s.status,
  lastActivityAt: s.lastActivityAt
});

const getLiveTakers = () => Array.from(liveSessions.values()).map(publicSession)
  .sort((a, b) => new Date(a.startedAt) - new Date(b.startedAt));

// ---- Debounced broadcasts -------------------------------------------------------------
let liveTimer = null;
const broadcastLive = () => {
  if (!io || liveTimer) return;
  liveTimer = setTimeout(() => {
    liveTimer = null;
    io.to('admins').emit('live:update', getLiveTakers());
  }, 250);
};

const onlineStudentCount = () => {
  if (!io) return 0;
  const ids = new Set();
  for (const [, s] of io.of('/').sockets) {
    if (s.data.user && s.data.user.role !== 'admin') ids.add(s.data.user.id);
  }
  return ids.size;
};

let presenceTimer = null;
const broadcastPresence = () => {
  if (!io || presenceTimer) return;
  presenceTimer = setTimeout(() => {
    presenceTimer = null;
    io.to('admins').emit('presence', { onlineStudents: onlineStudentCount() });
  }, 500);
};

let leaderboardTimer = null;
const notifyLeaderboardChanged = () => {
  if (!io || leaderboardTimer) return;
  leaderboardTimer = setTimeout(() => {
    leaderboardTimer = null;
    io.to('students').emit('leaderboard:update');
  }, 1500);
};

// ---- Emit helpers used by controllers -------------------------------------------------
const emitToAdmins = (event, payload) => { if (io) io.to('admins').emit(event, payload); };
const emitToUser = (userId, event, payload) => { if (io) io.to(`user:${userId}`).emit(event, payload); };
const emitToQuizRoom = (quizId, event, payload) => { if (io) io.to(`quiz:${quizId}`).emit(event, payload); };
const emitToAllStudents = (event, payload) => { if (io) io.to('students').emit(event, payload); };

const emitToMatchingStudents = async (target, event, payload) => {
  if (!io) return 0;
  const sockets = await io.in('students').fetchSockets();
  let n = 0;
  sockets.forEach((s) => {
    if (matchesCohort(target, s.data.user)) {
      s.emit(event, payload);
      n++;
    }
  });
  return n;
};

const endLiveSession = (userId, quizId) => {
  if (liveSessions.delete(sessionKey(userId, quizId))) broadcastLive();
};

// Deadlines changed by an admin (window/time-limit edit) must reach the live sessions too,
// otherwise the pruner would drop them at the old deadline.
const syncSessionDeadlines = (quizId, entries) => {
  let changed = false;
  entries.forEach(({ userId, deadline }) => {
    const s = liveSessions.get(sessionKey(userId, quizId));
    if (s) { s.deadline = deadline; changed = true; }
  });
  if (changed) broadcastLive();
};

const endQuizSessions = (quizId) => {
  let changed = false;
  for (const [key, s] of liveSessions) {
    if (s.quizId === String(quizId)) {
      liveSessions.delete(key);
      changed = true;
    }
  }
  if (changed) broadcastLive();
};

// Keep cohort data fresh after a profile update (no reconnect needed)
const refreshUserSockets = async (user) => {
  if (!io) return;
  const sockets = await io.in(`user:${user._id}`).fetchSockets();
  sockets.forEach((s) => { s.data.user = toSocketUser(user); });
};

const disconnectUser = async (userId) => {
  if (!io) return;
  const sockets = await io.in(`user:${userId}`).fetchSockets();
  sockets.forEach((s) => s.disconnect(true));
};

const AUDIT_CAP = 500; // keep attempt documents bounded no matter what a client sends

const persistAudit = (resultId, action, details, countAsViolation) => {
  const update = { $push: { auditLog: { $each: [{ action, details, timestamp: new Date() }], $slice: -AUDIT_CAP } } };
  if (countAsViolation) update.$inc = { tabSwitches: 1 };
  return Result.updateOne({ _id: resultId, status: 'in_progress' }, update)
    .catch((err) => console.error('[PROCTOR] Failed to persist audit entry:', err.message));
};

// ---- Initialisation -------------------------------------------------------------------
const init = (httpServer, corsOrigin) => {
  io = new Server(httpServer, {
    cors: { origin: corsOrigin, methods: ['GET', 'POST'] }
  });

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth && socket.handshake.auth.token;
      if (!token) return next(new Error('unauthorized'));
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id).select('+passwordChangedAt');
      if (!user || user.isBanned) return next(new Error('unauthorized'));
      if (user.passwordChangedAt && decoded.iat * 1000 < user.passwordChangedAt.getTime()) {
        return next(new Error('unauthorized'));
      }
      socket.data.user = toSocketUser(user);
      next();
    } catch (err) {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const me = socket.data.user;
    socket.join(`user:${me.id}`);

    if (me.role === 'admin') {
      socket.join('admins');
      socket.emit('live:update', getLiveTakers());
      socket.emit('presence', { onlineStudents: onlineStudentCount() });
    } else {
      socket.join('students');
    }
    broadcastPresence();

    // A student entering (or resuming) an exam
    socket.on('exam:join', async (payload, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      try {
        if (me.role === 'admin') return reply({ ok: false, error: 'Admins cannot take exams' });
        const quizId = String((payload && payload.quizId) || '');
        if (!/^[a-f0-9]{24}$/i.test(quizId)) return reply({ ok: false, error: 'Invalid quiz' });

        const attempt = await Result.findOne({ user: me.id, quiz: quizId, status: 'in_progress' });
        if (!attempt) return reply({ ok: false, error: 'No active attempt' });
        const quiz = await Quiz.findById(quizId).select('title questions._id').lean();
        if (!quiz) return reply({ ok: false, error: 'Quiz not found' });

        socket.join(`quiz:${quizId}`);
        socket.data.quizId = quizId;

        const key = sessionKey(me.id, quizId);
        const existing = liveSessions.get(key);
        liveSessions.set(key, {
          userId: me.id,
          name: me.name,
          email: me.email,
          cohort: cohortLabel(me),
          quizId,
          quizTitle: quiz.title,
          resultId: String(attempt._id),
          startedAt: attempt.startedAt,
          deadline: attempt.deadline,
          violations: attempt.tabSwitches || 0,
          answered: existing ? existing.answered : (attempt.answers || []).filter((a) => a.selectedOption).length,
          total: (quiz.questions || []).length,
          status: 'active',
          socketId: socket.id,
          lastActivityAt: new Date(),
          lastViolationAt: 0
        });
        broadcastLive();
        reply({ ok: true, violations: attempt.tabSwitches || 0 });
      } catch (err) {
        console.error('[PROCTOR] exam:join failed:', err.message);
        reply({ ok: false, error: 'Server error' });
      }
    });

    const currentSession = () => socket.data.quizId && liveSessions.get(sessionKey(me.id, socket.data.quizId));

    socket.on('exam:progress', (payload) => {
      const s = currentSession();
      if (!s || !payload) return;
      const answered = Number(payload.answered);
      if (Number.isFinite(answered)) s.answered = Math.max(0, Math.min(answered, s.total));
      s.lastActivityAt = new Date();
      if (s.status === 'offline') s.status = 'active';
      broadcastLive();
    });

    socket.on('exam:violation', (payload, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      const s = currentSession();
      if (!s || !payload || !VIOLATION_TYPES.includes(payload.type)) return reply({ ok: false });

      // Throttle bursts (e.g. blur + visibilitychange firing together)
      const now = Date.now();
      if (now - s.lastViolationAt < 800) return reply({ ok: true, violations: s.violations });
      s.lastViolationAt = now;

      const counted = COUNTED_VIOLATIONS.includes(payload.type);
      // Blur → minimise → tab switch while already away is one episode, not three violations
      if (counted && s.status === 'away') return reply({ ok: true, violations: s.violations });
      if (counted) {
        s.violations += 1;
        if (s.status !== 'away') s.awayAt = now;
        s.status = 'away';
      }
      s.lastActivityAt = new Date();
      const details = `${VIOLATION_MESSAGES[payload.type]}${counted ? ` (violation #${s.violations})` : ''}`;
      persistAudit(s.resultId, payload.type, details, counted);

      emitToAdmins('live:alert', {
        type: payload.type,
        name: s.name,
        email: s.email,
        quizId: s.quizId,
        quizTitle: s.quizTitle,
        violations: s.violations,
        message: `${s.name} ${VIOLATION_MESSAGES[payload.type]}`,
        timestamp: new Date().toISOString()
      });
      broadcastLive();
      reply({ ok: true, violations: s.violations });
    });

    socket.on('exam:focus-restored', () => {
      const s = currentSession();
      // Only meaningful after a recorded "away" episode; duration is measured server-side
      if (!s || s.status !== 'away' || !s.awayAt) return;
      const seconds = Math.round((Date.now() - s.awayAt) / 100) / 10;
      s.awayAt = null;
      s.status = 'active';
      s.lastActivityAt = new Date();
      persistAudit(s.resultId, 'focus_restored', `Returned to the exam after ${seconds}s`, false);
      emitToAdmins('live:alert', {
        type: 'focus_restored',
        name: s.name,
        email: s.email,
        quizId: s.quizId,
        quizTitle: s.quizTitle,
        violations: s.violations,
        message: `${s.name} returned after ${seconds}s away`,
        timestamp: new Date().toISOString()
      });
      broadcastLive();
    });

    socket.on('disconnect', () => {
      const s = currentSession();
      if (s && s.socketId === socket.id) {
        s.status = 'offline';
        s.lastActivityAt = new Date();
        persistAudit(s.resultId, 'network_disconnect', 'Connection to the proctoring server was lost', false);
        broadcastLive();
      }
      broadcastPresence();
    });
  });

  // Drop sessions whose deadline has long passed (e.g. student closed the tab)
  const pruner = setInterval(() => {
    const cutoff = Date.now() - 2 * 60 * 1000;
    let changed = false;
    for (const [key, s] of liveSessions) {
      if (s.deadline && new Date(s.deadline).getTime() < cutoff) {
        liveSessions.delete(key);
        changed = true;
      }
    }
    if (changed) broadcastLive();
  }, 30 * 1000);
  pruner.unref();

  return io;
};

module.exports = {
  init,
  getIO: () => io,
  emitToAdmins,
  emitToUser,
  emitToQuizRoom,
  emitToAllStudents,
  emitToMatchingStudents,
  endLiveSession,
  endQuizSessions,
  syncSessionDeadlines,
  getLiveTakers,
  onlineStudentCount,
  notifyLeaderboardChanged,
  refreshUserSockets,
  disconnectUser
};
