const express = require('express');
const router  = express.Router();
const db      = require('../config/db');
const { requireAuth, checkRole } = require('../middleware/authMiddleware');

const admin = [requireAuth, checkRole('Admin')];

// ── GET /api/admin/stats ──────────────────────────────────
router.get('/stats', ...admin, async (req, res) => {
  try {
    const [[{ totalUsers }]]        = await db.query("SELECT COUNT(*) AS totalUsers FROM Users WHERE Role!='Admin'");
    const [[{ totalFreelancers }]]  = await db.query("SELECT COUNT(*) AS totalFreelancers FROM Users WHERE Role='Freelancer'");
    const [[{ totalJobs }]]         = await db.query('SELECT COUNT(*) AS totalJobs FROM Jobs');
    const [[{ openJobs }]]          = await db.query("SELECT COUNT(*) AS openJobs FROM Jobs WHERE Status='Open'");
    const [[{ completedJobs }]]     = await db.query("SELECT COUNT(*) AS completedJobs FROM Jobs WHERE Status='Completed'");
    const [[{ totalReviews }]]      = await db.query('SELECT COUNT(*) AS totalReviews FROM Reviews');
    const [[{ pendingVerif }]]      = await db.query("SELECT COUNT(*) AS pendingVerif FROM FreelancerVerifications WHERE Status='Pending'");
    const [[{ openReports }]]       = await db.query("SELECT COUNT(*) AS openReports FROM UserReports WHERE Status='Open'");
    const [[{ flaggedUsers }]]      = await db.query("SELECT COUNT(*) AS flaggedUsers FROM Users WHERE IsFlagged=1");
    const [[{ openDisputes }]]      = await db.query("SELECT COUNT(*) AS openDisputes FROM PaymentDisputes WHERE Status='Open'");

    res.json({
      success: true,
      stats: {
        totalUsers, totalFreelancers, totalJobs, openJobs,
        completedJobs, totalReviews, pendingVerif,
        openReports, flaggedUsers, openDisputes
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: `Could not load stats: ${err.message}` });
  }
});

// ── GET /api/admin/users ──────────────────────────────────
router.get('/users', ...admin, async (req, res) => {
  try {
    const [users] = await db.query(
      `SELECT u.UserID, u.RefNumber, u.FullName, u.Email, u.PhoneNumber,
              u.Role, u.IsActive, u.IsFlagged, u.CreatedAt,
              f.VerificationStatus, f.BackgroundCheckStatus, f.Rating
       FROM Users u
       LEFT JOIN Freelancers f ON f.UserID = u.UserID
       ORDER BY u.CreatedAt DESC`
    );
    res.json({ success: true, users });
  } catch (err) {
    res.status(500).json({ success: false, message: `Could not load users: ${err.message}` });
  }
});

// ── PUT /api/admin/users/:id/toggle ──────────────────────
router.put('/users/:id/toggle', ...admin, async (req, res) => {
  try {
    await db.query('UPDATE Users SET IsActive = NOT IsActive WHERE UserID=?', [req.params.id]);
    res.json({ success: true, message: 'User status updated.' });
  } catch (err) {
    res.status(500).json({ success: false, message: `Could not update user: ${err.message}` });
  }
});

// ── PUT /api/admin/users/:id/unflag ──────────────────────
router.put('/users/:id/unflag', ...admin, async (req, res) => {
  try {
    await db.query('UPDATE Users SET IsFlagged = 0 WHERE UserID=?', [req.params.id]);
    res.json({ success: true, message: 'User unflagged.' });
  } catch (err) {
    res.status(500).json({ success: false, message: `Could not unflag user: ${err.message}` });
  }
});

// ── DELETE /api/admin/users/:id ───────────────────────────
router.delete('/users/:id', ...admin, async (req, res) => {
  try {
    await db.query('DELETE FROM Users WHERE UserID=?', [req.params.id]);
    res.json({ success: true, message: 'User deleted.' });
  } catch (err) {
    res.status(500).json({ success: false, message: `Could not delete user: ${err.message}` });
  }
});

// ── GET /api/admin/jobs ───────────────────────────────────
router.get('/jobs', ...admin, async (req, res) => {
  try {
    const [jobs] = await db.query(
      `SELECT j.*, u.FullName AS CustomerName, u.RefNumber AS CustomerRef,
              COALESCE(c.CategoryName,'Uncategorised') AS CategoryName
       FROM Jobs j
       JOIN Users u ON j.CustomerID=u.UserID
       LEFT JOIN Categories c ON j.CategoryID=c.CategoryID
       ORDER BY j.PostedAt DESC`
    );
    res.json({ success: true, jobs });
  } catch (err) {
    res.status(500).json({ success: false, message: `Could not load jobs: ${err.message}` });
  }
});

// ── GET /api/admin/flagged ────────────────────────────────
router.get('/flagged', ...admin, async (req, res) => {
  try {
    const [users] = await db.query(
      `SELECT u.UserID, u.RefNumber, u.FullName, u.Email, u.Role,
              COUNT(ur.ReportID) AS reportCount
       FROM Users u
       LEFT JOIN UserReports ur ON ur.ReportedUserID = u.UserID
       WHERE u.IsFlagged = 1
       GROUP BY u.UserID
       ORDER BY reportCount DESC`
    );
    res.json({ success: true, users });
  } catch (err) {
    res.status(500).json({ success: false, message: `Could not load flagged users: ${err.message}` });
  }
});

// ── GET /api/admin/reports/summary ───────────────────────
router.get('/reports/summary', ...admin, async (req, res) => {
  try {
    const [byType] = await db.query(
      "SELECT Type, COUNT(*) AS count FROM UserReports GROUP BY Type ORDER BY count DESC"
    );
    const [recent] = await db.query(
      `SELECT ur.*, u1.FullName AS ReportedName, u1.RefNumber,
              u2.FullName AS ReportedByName
       FROM UserReports ur
       JOIN Users u1 ON ur.ReportedUserID = u1.UserID
       JOIN Users u2 ON ur.ReportedByID   = u2.UserID
       WHERE ur.Status = 'Open'
       ORDER BY ur.CreatedAt DESC LIMIT 10`
    );
    res.json({ success: true, byType, recent });
  } catch (err) {
    res.status(500).json({ success: false, message: `Could not load report summary: ${err.message}` });
  }
});

// ── GET /api/admin/payments ───────────────────────────────
router.get('/payments', ...admin, async (req, res) => {
  try {
    const [payments] = await db.query(
      `SELECT p.*, j.Title AS JobTitle,
              u1.FullName AS CustomerName,
              u2.FullName AS FreelancerName
       FROM Payments p
       JOIN Jobs j   ON p.JobID = j.JobID
       JOIN Users u1 ON p.CustomerID   = u1.UserID
       JOIN Users u2 ON p.FreelancerID = u2.UserID
       ORDER BY p.PaidAt DESC`
    );
    res.json({ success: true, payments });
  } catch (err) {
    res.status(500).json({ success: false, message: `Could not load payments: ${err.message}` });
  }
});

module.exports = router;
