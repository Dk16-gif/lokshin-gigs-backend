const express = require('express');
const router  = express.Router();
const db      = require('../config/db');
const { requireAuth, checkRole } = require('../middleware/authMiddleware');

router.get('/', requireAuth, async (req, res) => {
  try {
    const { category, search } = req.query;
    let sql = `SELECT j.*, u.FullName AS CustomerName, u.RefNumber AS CustomerRef,
               COALESCE(c.CategoryName,'Uncategorised') AS CategoryName
               FROM Jobs j JOIN Users u ON j.CustomerID=u.UserID
               LEFT JOIN Categories c ON j.CategoryID=c.CategoryID
               WHERE j.Status='Open'`;
    const params = [];
    if (category) { sql += ' AND j.CategoryID=?'; params.push(category); }
    if (search)   { sql += ' AND (j.Title LIKE ? OR j.Description LIKE ?)'; params.push(`%${search}%`,`%${search}%`); }
    sql += ' ORDER BY j.PostedAt DESC';
    const [jobs] = await db.query(sql, params);
    res.json({ success: true, jobs });
  } catch (err) {
    res.status(500).json({ success: false, message: `Could not load jobs: ${err.message}` });
  }
});

router.get('/my', requireAuth, checkRole('Customer'), async (req, res) => {
  try {
    const [jobs] = await db.query(
      `SELECT j.*, COALESCE(c.CategoryName,'Uncategorised') AS CategoryName,
              acc.FullName AS AcceptedFreelancer, acc.UserID AS AcceptedFreelancerId,
              acc.PhoneNumber AS AcceptedFreelancerPhone, acc.RefNumber AS AcceptedFreelancerRef
       FROM Jobs j
       LEFT JOIN Categories c ON j.CategoryID=c.CategoryID
       LEFT JOIN Applications a ON a.JobID=j.JobID AND a.Status='Accepted'
       LEFT JOIN Users acc ON acc.UserID=a.FreelancerID
       WHERE j.CustomerID=? ORDER BY j.PostedAt DESC`,
      [req.session.user.id]
    );
    res.json({ success: true, jobs });
  } catch (err) {
    res.status(500).json({ success: false, message: `Could not load jobs: ${err.message}` });
  }
});

router.get('/:id', requireAuth, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT j.*, u.FullName AS CustomerName, u.RefNumber AS CustomerRef,
              COALESCE(c.CategoryName,'Uncategorised') AS CategoryName
       FROM Jobs j JOIN Users u ON j.CustomerID=u.UserID
       LEFT JOIN Categories c ON j.CategoryID=c.CategoryID
       WHERE j.JobID=?`, [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Job not found.' });
    res.json({ success: true, job: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: `Could not load job: ${err.message}` });
  }
});

router.post('/', requireAuth, checkRole('Customer'), async (req, res) => {
  try {
    const { title, description, location, budget, categoryId } = req.body;
    if (!title || !description || !location || !budget || !categoryId)
      return res.status(400).json({ success: false, message: 'All fields are required.' });
    if (isNaN(parseFloat(budget)) || parseFloat(budget) < 10)
      return res.status(400).json({ success: false, message: 'Budget must be at least R10.' });
    let finalCat = categoryId;
    try {
      const [cat] = await db.query('SELECT CategoryID FROM Categories WHERE CategoryID=?', [categoryId]);
      if (!cat.length) {
        const [first] = await db.query('SELECT CategoryID FROM Categories LIMIT 1');
        if (first.length) finalCat = first[0].CategoryID;
      }
    } catch {}
    const [result] = await db.query(
      'INSERT INTO Jobs (CustomerID,CategoryID,Title,Description,Location,Budget) VALUES (?,?,?,?,?,?)',
      [req.session.user.id, finalCat, title.trim(), description.trim(), location.trim(), parseFloat(budget)]
    );
    res.status(201).json({ success: true, message: 'Job posted successfully!', jobId: result.insertId });
  } catch (err) {
    res.status(500).json({ success: false, message: `Could not post job: ${err.message}` });
  }
});

router.put('/:id/status', requireAuth, async (req, res) => {
  try {
    const { status } = req.body;
    if (!['Open','In Progress','Completed','Cancelled'].includes(status))
      return res.status(400).json({ success: false, message: 'Invalid status.' });
    await db.query('UPDATE Jobs SET Status=? WHERE JobID=?', [status, req.params.id]);
    res.json({ success: true, message: `Job marked as ${status}.` });
  } catch (err) {
    res.status(500).json({ success: false, message: `Could not update: ${err.message}` });
  }
});

router.get('/:id/applications', requireAuth, async (req, res) => {
  try {
    // Applications include freelancer quotes, so only the job's customer (or an admin) may view them.
    const [job] = await db.query('SELECT CustomerID FROM Jobs WHERE JobID=?', [req.params.id]);
    if (!job.length) return res.status(404).json({ success: false, message: 'Job not found.' });
    const { id: userId, role } = req.session.user;
    if (role !== 'Admin' && job[0].CustomerID !== userId)
      return res.status(403).json({ success: false, message: 'Access denied.' });
    const [apps] = await db.query(
      `SELECT a.*, u.FullName AS FreelancerName, u.PhoneNumber, u.RefNumber AS FreelancerRef,
              COALESCE(f.SkillCategory,'General') AS SkillCategory,
              COALESCE(f.Rating,0) AS Rating, f.VerificationStatus
       FROM Applications a JOIN Users u ON a.FreelancerID=u.UserID
       LEFT JOIN Freelancers f ON f.UserID=a.FreelancerID
       WHERE a.JobID=? ORDER BY a.DateApplied DESC`, [req.params.id]
    );
    res.json({ success: true, applications: apps });
  } catch (err) {
    res.status(500).json({ success: false, message: `Could not load applications: ${err.message}` });
  }
});

router.post('/:id/apply', requireAuth, checkRole('Freelancer'), async (req, res) => {
  try {
    const { coverNote, quotedPrice } = req.body;

    // Validate the freelancer's quote. Only strings or numbers are accepted (arrays like [100] would otherwise coerce to "100").
    const quoteText = ['string', 'number'].includes(typeof quotedPrice) ? String(quotedPrice).trim() : '';

    if (!/^\d+(?:\.\d{1,2})?$/.test(quoteText)) {
      return res.status(400).json({
        success: false,
        message: 'Enter a valid quote with no more than two decimal places.'
      });
    }

    const quoteAmount = Number(quoteText);

    if (
      !Number.isFinite(quoteAmount) ||
      quoteAmount <= 0 ||
      quoteAmount > 99999999.99
    ) {
      return res.status(400).json({
        success: false,
        message: 'Your quote must be greater than R0 and within the supported price limit.'
      });
    }

    const [job] = await db.query(
      'SELECT Status FROM Jobs WHERE JobID=?',
      [req.params.id]
    );

    if (!job.length) {
      return res.status(404).json({
        success: false,
        message: 'Job not found.'
      });
    }

    if (job[0].Status !== 'Open') {
      return res.status(400).json({
        success: false,
        message: 'This job is no longer open.'
      });
    }

    const [dup] = await db.query(
      'SELECT ApplicationID FROM Applications WHERE JobID=? AND FreelancerID=?',
      [req.params.id, req.session.user.id]
    );

    if (dup.length) {
      return res.status(409).json({
        success: false,
        message: 'You already applied for this job.'
      });
    }

    await db.query(
      `INSERT INTO Applications
        (JobID, FreelancerID, CoverNote, QuotedPrice)
       VALUES (?, ?, ?, ?)`,
      [
        req.params.id,
        req.session.user.id,
        coverNote || '',
        quoteAmount
      ]
    );

    res.status(201).json({
      success: true,
      message: 'Application submitted successfully!'
    });
  } catch (err) {
    console.error('APPLICATION SUBMISSION ERROR:', err.message);
    res.status(500).json({
      success: false,
      message: 'Could not submit your application.'
    });
  }
});

router.put('/:jobId/applications/:appId', requireAuth, checkRole('Customer'), async (req, res) => {
  try {
    const { status } = req.body;
    if (!['Accepted','Rejected'].includes(status))
      return res.status(400).json({ success: false, message: 'Invalid status.' });
    await db.query('UPDATE Applications SET Status=? WHERE ApplicationID=?', [status, req.params.appId]);
    if (status === 'Accepted') {
      await db.query(
        "UPDATE Applications SET Status='Rejected' WHERE JobID=? AND ApplicationID!=? AND Status='Pending'",
        [req.params.jobId, req.params.appId]
      );
      await db.query("UPDATE Jobs SET Status='In Progress' WHERE JobID=?", [req.params.jobId]);
    }
    res.json({ success: true, message: `Application ${status.toLowerCase()}.` });
  } catch (err) {
    res.status(500).json({ success: false, message: `Could not update: ${err.message}` });
  }
});

module.exports = router;
