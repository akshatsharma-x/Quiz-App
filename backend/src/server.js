const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const http = require('http');
const dotenv = require('dotenv');

// Load env vars before anything reads them
dotenv.config({ path: path.join(__dirname, '../.env') });

const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const connectDB = require('./config/db');
const errorHandler = require('./middlewares/error');
const realtime = require('./realtime');
const ensureAdmin = require('./utils/seedAdmin');
const runMigrations = require('./utils/migrations');
const { seedDemoData } = require('./utils/demoData');
const Result = require('./models/Result');
const { startSweeper } = require('./services/attempts');

// ---- Configuration sanity checks --------------------------------------------------------
if (!process.env.MONGO_URI) {
  console.error('MONGO_URI is not set. Copy backend/.env.example to backend/.env and configure it.');
  process.exit(1);
}
if (!process.env.JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    console.error('JWT_SECRET must be set in production.');
    process.exit(1);
  }
  process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
  console.warn('[CONFIG] JWT_SECRET is not set – using a random secret (sessions reset on restart).');
}

const corsOrigin = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean)
  : '*';

const app = express();
app.disable('x-powered-by');
// Only trust X-Forwarded-For from known proxies. Env vars are strings, so map them to the
// types Express expects: "1"/"2" = number of proxy hops (PaaS load balancers), "true"/"false",
// or a list such as "loopback, uniquelocal" (docker-compose behind nginx).
const parseTrustProxy = (raw) => {
  if (!raw) return 'loopback';
  const v = raw.trim();
  if (/^\d+$/.test(v)) return Number(v);
  if (v === 'true') return true;
  if (v === 'false') return false;
  return v;
};
app.set('trust proxy', parseTrustProxy(process.env.TRUST_PROXY));

// Baseline security headers
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'SAMEORIGIN'
  });
  next();
});

app.use(cors({ origin: corsOrigin }));
app.use(express.json({ limit: '1mb' }));
// Express 5 leaves req.body undefined when there is no (JSON) body – normalise it
app.use((req, res, next) => {
  if (req.body === undefined || req.body === null || typeof req.body !== 'object') req.body = {};
  next();
});

// ---- API ----------------------------------------------------------------------------------
app.use('/api/v1/auth', require('./routes/auth'));
app.use('/api/v1/quizzes', require('./routes/quizzes'));
app.use('/api/v1/admin', require('./routes/admin'));
app.use('/api/v1/student', require('./routes/student'));
app.use('/api/v1/meta', require('./routes/meta'));

app.get('/api/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'QuizMUJ API is running',
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString()
  });
});

app.use('/api', (req, res) => {
  res.status(404).json({ success: false, error: `Route ${req.method} ${req.originalUrl} not found` });
});

// ---- Frontend (served directly when running without nginx) -------------------------------
const FRONTEND_DIR = process.env.FRONTEND_DIR || path.join(__dirname, '../../frontend');
if (fs.existsSync(path.join(FRONTEND_DIR, 'index.html'))) {
  app.use(express.static(FRONTEND_DIR, {
    extensions: ['html'],
    setHeaders: (res, filePath) => {
      // No build step / hashed filenames → always revalidate code, cache images
      if (/\.(html|js|css)$/i.test(filePath)) res.setHeader('Cache-Control', 'no-cache');
      else res.setHeader('Cache-Control', 'public, max-age=604800');
    }
  }));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || !req.accepts('html')) return next();
    res.status(404).sendFile(path.join(FRONTEND_DIR, '404.html'), (err) => err && next());
  });
}

app.use(errorHandler);

// ---- Boot -----------------------------------------------------------------------------------
const PORT = process.env.PORT || 5001;
const server = http.createServer(app);
realtime.init(server, corsOrigin);

const start = async () => {
  await connectDB();
  await runMigrations().catch((err) => console.error('[MIGRATE] Data migration failed:', err.message));
  await ensureAdmin().catch((err) => console.error('[SEED] Could not ensure admin account:', err.message));

  // Public demo: rebuild the demo dataset on every boot (free hosts restart after idling)
  // and every 6 hours, so exam windows stay current and the demo always works.
  if (process.env.SHOWCASE_MODE === 'true') {
    const refresh = async (reason) => {
      try {
        if (reason !== 'boot' && await Result.exists({ status: 'in_progress' })) return; // never mid-exam
        const r = await seedDemoData({ reset: true });
        console.log(`[SHOWCASE] Demo data refreshed (${reason}): ${r.quizzes} quizzes, ${r.attempts} attempts`);
        realtime.emitToAllStudents('quiz:updated', {});
        realtime.emitToAdmins('quizzes:changed', {});
      } catch (err) {
        console.error('[SHOWCASE] Could not refresh demo data:', err.message);
      }
    };
    await refresh('boot');
    setInterval(() => refresh('scheduled'), 6 * 3600 * 1000).unref();
  }
  startSweeper();
  server.listen(PORT, () => {
    console.log(`QuizMUJ server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
    if (fs.existsSync(path.join(FRONTEND_DIR, 'index.html'))) {
      console.log(`Open http://localhost:${PORT} in your browser`);
    }
  });
};

if (require.main === module) {
  start();
}

process.on('unhandledRejection', (err) => {
  console.error('Unhandled promise rejection:', err);
});

const shutdown = (signal) => {
  console.log(`${signal} received – shutting down gracefully`);
  server.close(() => {
    mongoose.connection.close(false).finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(0), 5000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = { app, server, start };
