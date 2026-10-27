if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const express  = require('express');
const session  = require('express-session');
const cors     = require('cors');
const app      = express();

// ── CORS ──────────────────────────────────────────────────
// ADDITIONAL_FRONTEND_ORIGINS: comma-separated exact origins (e.g. Vercel previews).
// Matched exactly like FRONTEND_URL — no wildcards or patterns.
const additionalOrigins = (process.env.ADDITIONAL_FRONTEND_ORIGINS || '')
  .split(',')
  .map(o => o.trim().replace(/\/+$/, ''))
  .filter(Boolean);

const allowedOrigins = [
  process.env.FRONTEND_URL,
  ...additionalOrigins,
  'http://localhost:5173',
  'http://localhost:3000',
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set('trust proxy', 1);

// ── SESSION — must come before passport ──────────────────
app.use(session({
  secret:            process.env.SESSION_SECRET || 'lokshin_gigs_secret_2026',
  resave:            false,
  saveUninitialized: false,
  cookie: {
    secure:   process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge:   86400000
  }
}));

// ── PASSPORT — Google OAuth ───────────────────────────────
const { router: googleAuthRouter, passport } = require('./routes/googleAuthRoutes');
app.use(passport.initialize());
app.use(passport.session());

// ── ROUTES ────────────────────────────────────────────────
app.use('/api/auth',         require('./routes/authRoutes'));       // email/password auth
app.use('/api/auth',         googleAuthRouter);                     // Google OAuth
app.use('/api/jobs',         require('./routes/jobRoutes'));
app.use('/api/users',        require('./routes/userRoutes'));
app.use('/api/reviews',      require('./routes/reviewRoutes'));
app.use('/api/admin',        require('./routes/adminRoutes'));
app.use('/api/categories',   require('./routes/categoryRoutes'));
app.use('/api/applications', require('./routes/applicationRoutes'));
app.use('/api/verification', require('./routes/verificationRoutes'));
app.use('/api/payments',     require('./routes/paymentRoutes'));
app.use('/api/reports',      require('./routes/reportRoutes'));

// ── HEALTH CHECK ──────────────────────────────────────────
app.get('/health', (req, res) => res.json({
  status: 'ok',
  app:    'Lokshin Gigs API v2.1',
  time:   new Date().toISOString()
}));

// ── 404 ───────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Endpoint not found.' });
});

// ── ERROR HANDLER ─────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ success: false, message: 'Internal server error.' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Lokshin Gigs API v2.1 running on port ${PORT}`));
module.exports = app;
