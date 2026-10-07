const express = require('express');
const router  = express.Router();
const db      = require('../config/db');
const { requireAuth } = require('../middleware/authMiddleware');

router.get('/profile', requireAuth, async (req, res) => {
  try {
    const [users] = await db.query(
      'SELECT UserID,RefNumber,FullName,Email,PhoneNumber,Role,CreatedAt FROM Users WHERE UserID=?',
      [req.session.user.id]
    );
    if (!users.length) return res.status(404).json({ success: false, message: 'User not found.' });
    const profile = users[0];
    if (profile.Role === 'Freelancer') {
      const [fl] = await db.query('SELECT * FROM Freelancers WHERE UserID=?', [profile.UserID]);
      profile.freelancerData = fl[0] || null;
    }
    res.json({ success: true, profile });
  } catch (err) {
    res.status(500).json({ success: false, message: `Could not load profile: ${err.message}` });
  }
});

router.put('/profile', requireAuth, async (req, res) => {
  try {
    const { fullName, phone, skillCategory, experience, bio } = req.body;
    if (!fullName || !phone)
      return res.status(400).json({ success: false, message: 'Name and phone are required.' });
    if (fullName.trim().length < 2)
      return res.status(400).json({ success: false, message: 'Full name must be at least 2 characters.' });
    await db.query('UPDATE Users SET FullName=?, PhoneNumber=? WHERE UserID=?',
      [fullName.trim(), phone.trim(), req.session.user.id]);
    if (req.session.user.role === 'Freelancer') {
      const [fl] = await db.query('SELECT FreelancerID FROM Freelancers WHERE UserID=?', [req.session.user.id]);
      if (fl.length)
        await db.query('UPDATE Freelancers SET SkillCategory=?, Experience=?, Bio=? WHERE UserID=?',
          [skillCategory || 'General', experience || '', bio || '', req.session.user.id]);
    }
    req.session.user.name = fullName.trim();
    res.json({ success: true, message: 'Profile updated successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, message: `Could not update profile: ${err.message}` });
  }
});

router.get('/freelancers', requireAuth, async (req, res) => {
  try {
    const [freelancers] = await db.query(
      `SELECT u.UserID, u.RefNumber, u.FullName, u.Email, u.PhoneNumber,
              f.SkillCategory, f.Experience, f.Bio,
              COALESCE(f.Rating,0) AS Rating,
              COALESCE(f.TotalReviews,0) AS TotalReviews,
              f.VerificationStatus, f.BackgroundCheckStatus
       FROM Users u JOIN Freelancers f ON u.UserID=f.UserID
       WHERE u.IsActive=1 ORDER BY f.Rating DESC`
    );
    res.json({ success: true, freelancers });
  } catch (err) {
    res.status(500).json({ success: false, message: `Could not load freelancers: ${err.message}` });
  }
});

module.exports = router;
