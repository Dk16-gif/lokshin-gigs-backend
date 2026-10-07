const express    = require('express');
const router     = express.Router();
const passport   = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const db         = require('../config/db');

// ── PASSPORT GOOGLE STRATEGY ──────────────────────────────
passport.use(new GoogleStrategy(
  {
    clientID:     process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL:  process.env.NODE_ENV === 'production'
      ? `${process.env.BACKEND_URL}/api/auth/google/callback`
      : 'http://localhost:3000/api/auth/google/callback'
  },
  async (accessToken, refreshToken, profile, done) => {
    try {
      const email    = profile.emails[0].value;
      const fullName = profile.displayName;

      // Check if user already exists
      const [existing] = await db.query(
        'SELECT * FROM Users WHERE Email = ?',
        [email.toLowerCase()]
      );

      if (existing.length) {
        // User exists — check if active
        const user = existing[0];
        if (!user.IsActive)
          return done(null, false, { message: 'Account suspended.' });
        return done(null, user);
      }

      // New user — create account automatically
      // Google accounts default to Customer role
      // They can switch to Freelancer later from their profile
      const [[{ total }]] = await db.query('SELECT COUNT(*) AS total FROM Users');
      const refNumber = `LG-CUST-${String(total + 1).padStart(6, '0')}`;

      const [result] = await db.query(
        `INSERT INTO Users
         (RefNumber, FullName, Email, Password, PhoneNumber, Role, GoogleID)
         VALUES (?,?,?,?,?,?,?)`,
        [
          refNumber,
          fullName,
          email.toLowerCase(),
          'GOOGLE_AUTH',        // no password — they use Google to log in
          '0000000000',         // placeholder phone — prompt them to update
          'Customer',
          profile.id
        ]
      );

      const [newUser] = await db.query(
        'SELECT * FROM Users WHERE UserID = ?',
        [result.insertId]
      );

      return done(null, newUser[0]);

    } catch (err) {
      console.error('GOOGLE AUTH ERROR:', err.message);
      return done(err, null);
    }
  }
));

// ── SERIALIZE / DESERIALIZE ───────────────────────────────
passport.serializeUser((user, done) => {
  done(null, user.UserID);
});

passport.deserializeUser(async (id, done) => {
  try {
    const [users] = await db.query('SELECT * FROM Users WHERE UserID = ?', [id]);
    done(null, users[0] || null);
  } catch (err) {
    done(err, null);
  }
});

// ── ROUTES ────────────────────────────────────────────────

// Step 1: Frontend hits this to start Google login
// GET /api/auth/google
router.get('/google',
  passport.authenticate('google', {
    scope: ['profile', 'email']
  })
);

// Step 2: Google redirects back here after user approves
// GET /api/auth/google/callback
router.get('/google/callback',
  passport.authenticate('google', { failureRedirect: `${process.env.FRONTEND_URL}/login?error=google_failed` }),
  (req, res) => {
    // Set our own session so the rest of the app works normally
    req.session.user = {
      id:        req.user.UserID,
      name:      req.user.FullName,
      email:     req.user.Email,
      role:      req.user.Role,
      refNumber: req.user.RefNumber
    };

    req.session.save(err => {
      if (err) return res.redirect(`${process.env.FRONTEND_URL}/login?error=session_failed`);

      // Redirect to the right dashboard based on role
      const role = req.user.Role;
      if      (role === 'Admin')      return res.redirect(`${process.env.FRONTEND_URL}/admin`);
      else if (role === 'Freelancer') return res.redirect(`${process.env.FRONTEND_URL}/freelancer-dashboard`);
      else                            return res.redirect(`${process.env.FRONTEND_URL}/customer-dashboard`);
    });
  }
);

module.exports = { router, passport };
