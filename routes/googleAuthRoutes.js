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

      const [existing] = await db.query(
        'SELECT * FROM Users WHERE Email = ?',
        [email.toLowerCase()]
      );

      if (existing.length) {
        if (!existing[0].IsActive)
          return done(null, false, { message: 'Account suspended.' });
        return done(null, { ...existing[0], isNew: false });
      }

      // New user — don't create yet, collect phone and role first
      return done(null, {
        isNew:     true,
        googleId:  profile.id,
        FullName:  fullName,
        Email:     email,
        Role:      null,
        UserID:    null,
        RefNumber: null
      });

    } catch (err) {
      console.error('GOOGLE AUTH ERROR:', err.message);
      return done(err, null);
    }
  }
    
));

// ── SERIALIZE / DESERIALIZE ───────────────────────────────
passport.serializeUser((user, done) => {
  if (user.isNew) return done(null, 'new_' + user.googleId);
  done(null, user.UserID);
});

passport.deserializeUser(async (id, done) => {
  try {
    if (String(id).startsWith('new_')) return done(null, { isNew: true, googleId: id.replace('new_', '') });
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
  passport.authenticate('google', { failureRedirect: `${process.env.FRONTEND_URL}/pages/login.html?error=google_failed` }),
  (req, res) => {
    if (req.user.isNew) {
      const name  = encodeURIComponent(req.user.FullName);
      const email = encodeURIComponent(req.user.Email);
      const gid   = encodeURIComponent(req.user.googleId);
      return res.redirect(
        `${process.env.FRONTEND_URL}/pages/google-setup.html?name=${name}&email=${email}&gid=${gid}`
      );
    }

    req.session.user = {
      id:        req.user.UserID,
      name:      req.user.FullName,
      email:     req.user.Email,
      role:      req.user.Role,
      refNumber: req.user.RefNumber
    };

    req.session.save(err => {
      if (err) return res.redirect(`${process.env.FRONTEND_URL}/pages/login.html?error=session_failed`);
      const role = req.user.Role;
      const name = encodeURIComponent(req.user.FullName);
      const id   = req.user.UserID;
      const ref  = req.user.RefNumber;
      if (role === 'Admin')
        return res.redirect(`${process.env.FRONTEND_URL}/pages/admin-dashboard.html?uid=${id}&name=${name}&role=${role}&ref=${ref}`);
      else if (role === 'Freelancer')
        return res.redirect(`${process.env.FRONTEND_URL}/pages/freelancer-dashboard.html?uid=${id}&name=${name}&role=${role}&ref=${ref}`);
      else
        return res.redirect(`${process.env.FRONTEND_URL}/pages/customer-dashboard.html?uid=${id}&name=${name}&role=${role}&ref=${ref}`);
    });
  }
);

module.exports = { router, passport };
