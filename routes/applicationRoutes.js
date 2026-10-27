const express = require('express');
const router  = express.Router();
const db      = require('../config/db');
const { requireAuth, checkRole } = require('../middleware/authMiddleware');

router.get('/my', requireAuth, checkRole('Freelancer'), async (req, res) => {
  try {
    const [applications] = await db.query(
      `SELECT a.ApplicationID, a.CoverNote, a.QuotedPrice, a.Status, a.DateApplied,
              j.JobID, j.Title AS JobTitle, j.Location, j.Budget, j.Status AS JobStatus
       FROM Applications a JOIN Jobs j ON a.JobID=j.JobID
       WHERE a.FreelancerID=? ORDER BY a.DateApplied DESC`,
      [req.session.user.id]
    );
    res.json({ success: true, applications });
  } catch (err) {
    res.status(500).json({ success: false, message: `Could not load applications: ${err.message}` });
  }
});

router.get('/active', requireAuth, checkRole('Freelancer'), async (req, res) => {
  try {
    const [jobs] = await db.query(
      `SELECT j.JobID, j.Title, j.Description, j.Location, j.Budget, j.Status,
              u.FullName AS CustomerName, u.PhoneNumber AS CustomerPhone, u.RefNumber AS CustomerRef
       FROM Applications a
       JOIN Jobs j  ON a.JobID=j.JobID
       JOIN Users u ON j.CustomerID=u.UserID
       WHERE a.FreelancerID=? AND a.Status='Accepted'
         AND j.Status IN ('In Progress','Completed')
       ORDER BY j.PostedAt DESC`,
      [req.session.user.id]
    );
    res.json({ success: true, jobs });
  } catch (err) {
    res.status(500).json({ success: false, message: `Could not load active jobs: ${err.message}` });
  }
});

module.exports = router;
