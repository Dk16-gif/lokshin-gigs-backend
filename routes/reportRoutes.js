const express = require('express');
const router  = express.Router();
const db      = require('../config/db');
const { requireAuth, checkRole } = require('../middleware/authMiddleware');

// ── POST /api/reports — report a user or freelancer ──────
router.post('/', requireAuth, async (req, res) => {
  try {
    const { reportedUserId, type, description } = req.body;
    // type: 'Fraud', 'No Show', 'Poor Quality', 'Harassment', 'Fake Profile', 'Other'

    if (!reportedUserId || !type || !description)
      return res.status(400).json({
        success: false,
        message: 'Reported user, report type, and description are all required.'
      });

    if (reportedUserId === req.session.user.id)
      return res.status(400).json({ success: false, message: 'You cannot report yourself.' });

    const validTypes = ['Fraud', 'No Show', 'Poor Quality', 'Harassment', 'Fake Profile', 'Other'];
    if (!validTypes.includes(type))
      return res.status(400).json({
        success: false,
        message: `Report type must be one of: ${validTypes.join(', ')}.`
      });

    if (description.length < 20)
      return res.status(400).json({
        success: false,
        message: 'Please provide a detailed description (at least 20 characters).'
      });

    // Check reported user exists
    const [users] = await db.query('SELECT UserID, FullName FROM Users WHERE UserID = ?', [reportedUserId]);
    if (!users.length)
      return res.status(404).json({ success: false, message: 'User not found.' });

    await db.query(
      'INSERT INTO UserReports (ReportedUserID, ReportedByID, Type, Description, Status) VALUES (?,?,?,?,?)',
      [reportedUserId, req.session.user.id, type, description, 'Open']
    );

    // Auto-flag user if they have 3+ reports
    const [[{ reportCount }]] = await db.query(
      'SELECT COUNT(*) AS reportCount FROM UserReports WHERE ReportedUserID = ?',
      [reportedUserId]
    );
    if (reportCount >= 3) {
      await db.query(
        'UPDATE Users SET IsFlagged = 1 WHERE UserID = ?',
        [reportedUserId]
      );
    }

    res.status(201).json({
      success: true,
      message: 'Report submitted. Our team will investigate within 24 hours.'
    });

  } catch (err) {
    console.error('REPORT ERROR:', err.message);
    res.status(500).json({ success: false, message: `Could not submit report: ${err.message}` });
  }
});

// ── GET /api/reports/freelancer/:id — public report summary ──
// Shows how many reports a freelancer has (not the details)
router.get('/freelancer/:id', async (req, res) => {
  try {
    const [[{ totalReports }]] = await db.query(
      "SELECT COUNT(*) AS totalReports FROM UserReports WHERE ReportedUserID = ? AND Status != 'Dismissed'",
      [req.params.id]
    );

    const [typeBreakdown] = await db.query(
      "SELECT Type, COUNT(*) AS count FROM UserReports WHERE ReportedUserID = ? AND Status != 'Dismissed' GROUP BY Type",
      [req.params.id]
    );

    res.json({ success: true, totalReports, breakdown: typeBreakdown });

  } catch (err) {
    res.status(500).json({ success: false, message: `Could not load reports: ${err.message}` });
  }
});

// ── GET /api/reports/all — admin sees all reports ────────
router.get('/all', requireAuth, checkRole('Admin'), async (req, res) => {
  try {
    const [reports] = await db.query(
      `SELECT ur.*,
              u1.FullName AS ReportedName, u1.Email AS ReportedEmail, u1.RefNumber AS ReportedRef,
              u2.FullName AS ReportedByName
       FROM UserReports ur
       JOIN Users u1 ON ur.ReportedUserID = u1.UserID
       JOIN Users u2 ON ur.ReportedByID   = u2.UserID
       ORDER BY ur.CreatedAt DESC`
    );
    res.json({ success: true, reports });
  } catch (err) {
    res.status(500).json({ success: false, message: `Could not load reports: ${err.message}` });
  }
});

// ── PUT /api/reports/:id/resolve — admin resolves ────────
router.put('/:id/resolve', requireAuth, checkRole('Admin'), async (req, res) => {
  try {
    const { action, notes } = req.body;
    // action: 'Dismissed', 'Warning Issued', 'Suspended', 'Resolved'
    await db.query(
      'UPDATE UserReports SET Status=?, AdminNotes=?, ResolvedAt=NOW() WHERE ReportID=?',
      [action || 'Resolved', notes || '', req.params.id]
    );
    res.json({ success: true, message: `Report marked as ${action}.` });
  } catch (err) {
    res.status(500).json({ success: false, message: `Could not resolve report: ${err.message}` });
  }
});

module.exports = router;
