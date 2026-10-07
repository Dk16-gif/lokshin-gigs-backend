const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcryptjs');
const crypto  = require('crypto');
const db      = require('../config/db');

// ── VALIDATION HELPERS ────────────────────────────────────
function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
function validatePhone(phone) {
  // Accepts SA numbers: 0XX XXX XXXX
  return /^0[6-8][0-9]{8}$/.test(phone.replace(/\s|-/g, ''));
}
function validatePassword(password) {
  return password && password.length >= 6;
}

// ── POST /api/auth/register ───────────────────────────────
// Required: fullName, email, phone, password, role
// Freelancer also requires: skillCategory
router.post('/register', async (req, res) => {
  try {
    const { fullName, email, password, phone, role, skillCategory, experience, bio } = req.body;

    // Required fields check
    const missing = [];
    if (!fullName || fullName.trim().length < 2) missing.push('Full name (min 2 characters)');
    if (!email)    missing.push('Email address');
    if (!phone)    missing.push('Phone number');
    if (!password) missing.push('Password');
    if (!role)     missing.push('Role');
    if (missing.length)
      return res.status(400).json({
        success: false,
        message: `Missing required fields: ${missing.join(', ')}.`
      });

    // Format validation
    if (!validateEmail(email))
      return res.status(400).json({ success: false, message: 'Please enter a valid email address.' });

    if (!validatePhone(phone))
      return res.status(400).json({
        success: false,
        message: 'Please enter a valid SA phone number (e.g. 0821234567).'
      });

    if (!validatePassword(password))
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long.'
      });

    if (!['Customer', 'Freelancer'].includes(role))
      return res.status(400).json({ success: false, message: 'Role must be Customer or Freelancer.' });

    if (role === 'Freelancer' && !skillCategory)
      return res.status(400).json({
        success: false,
        message: 'Freelancers must select a skill category.'
      });

    // Duplicate email check
    const [byEmail] = await db.query(
      'SELECT UserID FROM Users WHERE Email = ?',
      [email.trim().toLowerCase()]
    );
    if (byEmail.length)
      return res.status(409).json({
        success: false,
        message: 'An account with this email already exists. Please log in instead.'
      });

    // Duplicate phone check
    const [byPhone] = await db.query(
      'SELECT UserID FROM Users WHERE PhoneNumber = ?',
      [phone.trim()]
    );
    if (byPhone.length)
      return res.status(409).json({
        success: false,
        message: 'An account with this phone number already exists.'
      });

    // Generate unique reference number: LG-CUST-000001 or LG-FREL-000001
    const prefix = role === 'Customer' ? 'LG-CUST' : 'LG-FREL';
    const [[{ total }]] = await db.query('SELECT COUNT(*) AS total FROM Users');
    const refNumber = `${prefix}-${String(total + 1).padStart(6, '0')}`;

    // Hash password
    const hash = await bcrypt.hash(password, 12);

    // Insert user
    const [result] = await db.query(
      'INSERT INTO Users (FullName, Email, Password, PhoneNumber, Role, RefNumber) VALUES (?,?,?,?,?,?)',
      [fullName.trim(), email.trim().toLowerCase(), hash, phone.trim(), role, refNumber]
    );

    // Freelancer profile
    if (role === 'Freelancer') {
      await db.query(
        `INSERT INTO Freelancers
         (UserID, SkillCategory, Experience, Bio, VerificationStatus, BackgroundCheckStatus)
         VALUES (?,?,?,?,?,?)`,
        [result.insertId, skillCategory, experience || '', bio || '', 'Unverified', 'Not Started']
      );
    }

    res.status(201).json({
      success:   true,
      message:   'Registration successful! Please log in.',
      refNumber
    });

  } catch (err) {
    console.error('REGISTER ERROR:', err.message);
    res.status(500).json({ success: false, message: `Registration failed: ${err.message}` });
  }
});

// ── POST /api/auth/login ──────────────────────────────────
// Required: email + password only
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password)
      return res.status(400).json({
        success: false,
        message: 'Email address and password are required.'
      });

    if (!validateEmail(email))
      return res.status(400).json({ success: false, message: 'Please enter a valid email address.' });

    const [users] = await db.query(
      'SELECT * FROM Users WHERE Email = ?',
      [email.trim().toLowerCase()]
    );

    if (!users.length)
      return res.status(401).json({
        success: false,
        message: 'No account found with this email. Please register first.'
      });

    const user = users[0];

    if (!user.IsActive)
      return res.status(403).json({
        success: false,
        message: 'Your account has been suspended. Please contact support.'
      });

    const match = await bcrypt.compare(password, user.Password);
    if (!match)
      return res.status(401).json({
        success: false,
        message: 'Incorrect password. Please try again.'
      });

    req.session.user = {
      id:        user.UserID,
      name:      user.FullName,
      email:     user.Email,
      role:      user.Role,
      refNumber: user.RefNumber
    };

    req.session.save(err => {
      if (err)
        return res.status(500).json({ success: false, message: 'Session error. Please try again.' });
      res.json({
        success: true,
        user: {
          id:        user.UserID,
          name:      user.FullName,
          role:      user.Role,
          refNumber: user.RefNumber
        }
      });
    });

  } catch (err) {
    console.error('LOGIN ERROR:', err.message);
    res.status(500).json({ success: false, message: `Login failed: ${err.message}` });
  }
});

// ── POST /api/auth/logout ─────────────────────────────────
router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

// ── GET /api/auth/me ──────────────────────────────────────
router.get('/me', (req, res) => {
  if (req.session?.user) res.json({ success: true, user: req.session.user });
  else res.status(401).json({ success: false });
});

// ── POST /api/auth/forgot-password ───────────────────────
// Requires SendGrid or Nodemailer to actually send email
// For now generates the token and logs it (ready for email integration)
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email)
      return res.status(400).json({ success: false, message: 'Email address is required.' });

    const [users] = await db.query(
      'SELECT UserID FROM Users WHERE Email = ?',
      [email.trim().toLowerCase()]
    );

    // Always say success to prevent email enumeration
    if (!users.length)
      return res.json({
        success: true,
        message: 'If that email is registered a reset link has been sent.'
      });

    const token   = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 3600000); // 1 hour

    await db.query(
      'UPDATE Users SET ResetToken = ?, ResetTokenExpiry = ? WHERE UserID = ?',
      [token, expires, users[0].UserID]
    );

    // TODO: plug in SendGrid or Nodemailer here to email the token
    // Reset link: https://your-frontend.vercel.app/reset-password?token=TOKEN
    console.log(`[DEV] Password reset token for ${email}: ${token}`);

    res.json({
      success: true,
      message: 'If that email is registered a reset link has been sent.',
      ...(process.env.NODE_ENV !== 'production' && { devToken: token })
    });

  } catch (err) {
    res.status(500).json({ success: false, message: `Error: ${err.message}` });
  }
});

// ── POST /api/auth/reset-password ────────────────────────
router.post('/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword)
      return res.status(400).json({ success: false, message: 'Token and new password are required.' });
    if (!validatePassword(newPassword))
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters.' });

    const [users] = await db.query(
      'SELECT UserID FROM Users WHERE ResetToken = ? AND ResetTokenExpiry > NOW()',
      [token]
    );

    if (!users.length)
      return res.status(400).json({
        success: false,
        message: 'Reset link is invalid or has expired. Please request a new one.'
      });

    const hash = await bcrypt.hash(newPassword, 12);
    await db.query(
      'UPDATE Users SET Password = ?, ResetToken = NULL, ResetTokenExpiry = NULL WHERE UserID = ?',
      [hash, users[0].UserID]
    );

    res.json({ success: true, message: 'Password reset successfully. Please log in.' });

  } catch (err) {
    res.status(500).json({ success: false, message: `Error: ${err.message}` });
  }
});

module.exports = router;
