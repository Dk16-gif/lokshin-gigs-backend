const express = require('express');
const router  = express.Router();
const db      = require('../config/db');
const { requireAuth, checkRole } = require('../middleware/authMiddleware');

// ── POST /api/reviews — submit a review after job completion ──
router.post('/', requireAuth, checkRole('Customer'), async (req, res) => {
  try {
    const { jobId, freelancerId, rating, comment, wouldRecommend } = req.body;

    if (!jobId || !freelancerId || !rating)
      return res.status(400).json({
        success: false,
        message: 'Job ID, freelancer ID, and a rating are required.'
      });

    const ratingNum = parseInt(rating);
    if (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5)
      return res.status(400).json({ success: false, message: 'Rating must be a number between 1 and 5.' });

    // Verify the job belongs to this customer and is completed
    const [jobs] = await db.query(
      "SELECT JobID, Status FROM Jobs WHERE JobID = ? AND CustomerID = ?",
      [jobId, req.session.user.id]
    );
    if (!jobs.length)
      return res.status(404).json({ success: false, message: 'Job not found.' });
    if (jobs[0].Status !== 'Completed')
      return res.status(400).json({
        success: false,
        message: 'You can only review a job after it has been completed.'
      });

    // Prevent duplicate review
    const [dup] = await db.query(
      'SELECT ReviewID FROM Reviews WHERE JobID = ? AND CustomerID = ?',
      [jobId, req.session.user.id]
    );
    if (dup.length)
      return res.status(409).json({
        success: false,
        message: 'You have already submitted a review for this job.'
      });

    // Validate comment length if provided
    if (comment && comment.length > 1000)
      return res.status(400).json({
        success: false,
        message: 'Comment must be under 1000 characters.'
      });

    await db.query(
      `INSERT INTO Reviews
       (JobID, CustomerID, FreelancerID, Rating, Comment, WouldRecommend)
       VALUES (?,?,?,?,?,?)`,
      [jobId, req.session.user.id, freelancerId, ratingNum, comment || '', wouldRecommend ? 1 : 0]
    );

    // Recalculate freelancer average rating
    const [[avg]] = await db.query(
      'SELECT AVG(Rating) AS a, COUNT(*) AS t FROM Reviews WHERE FreelancerID = ?',
      [freelancerId]
    );
    await db.query(
      'UPDATE Freelancers SET Rating = ?, TotalReviews = ? WHERE UserID = ?',
      [parseFloat(avg.a).toFixed(2), avg.t, freelancerId]
    );

    res.status(201).json({ success: true, message: 'Review submitted successfully. Thank you!' });

  } catch (err) {
    console.error('REVIEW ERROR:', err.message);
    res.status(500).json({ success: false, message: `Could not submit review: ${err.message}` });
  }
});

// ── GET /api/reviews/freelancer/:id — all reviews for a freelancer ──
router.get('/freelancer/:id', async (req, res) => {
  try {
    const [reviews] = await db.query(
      `SELECT r.ReviewID, r.Rating, r.Comment, r.WouldRecommend, r.ReviewDate,
              u.FullName AS CustomerName,
              j.Title AS JobTitle
       FROM Reviews r
       JOIN Users u ON r.CustomerID = u.UserID
       JOIN Jobs j  ON r.JobID = j.JobID
       WHERE r.FreelancerID = ?
       ORDER BY r.ReviewDate DESC`,
      [req.params.id]
    );

    // Summary stats
    const total     = reviews.length;
    const avgRating = total ? (reviews.reduce((s, r) => s + r.Rating, 0) / total).toFixed(1) : 0;
    const recommend = total ? reviews.filter(r => r.WouldRecommend).length : 0;

    res.json({
      success: true,
      summary: { total, avgRating, wouldRecommend: recommend },
      reviews
    });

  } catch (err) {
    res.status(500).json({ success: false, message: `Could not load reviews: ${err.message}` });
  }
});

// ── GET /api/reviews/job/:id — review for a specific job ──
router.get('/job/:id', requireAuth, async (req, res) => {
  try {
    const [reviews] = await db.query(
      `SELECT r.*, u.FullName AS CustomerName
       FROM Reviews r JOIN Users u ON r.CustomerID = u.UserID
       WHERE r.JobID = ?`,
      [req.params.id]
    );
    res.json({ success: true, review: reviews[0] || null });
  } catch (err) {
    res.status(500).json({ success: false, message: `Could not load review: ${err.message}` });
  }
});

// ── POST /api/reviews/:id/report — report a fraudulent review ──
router.post('/:id/report', requireAuth, async (req, res) => {
  try {
    const { reason } = req.body;
    if (!reason)
      return res.status(400).json({ success: false, message: 'Please provide a reason for the report.' });

    await db.query(
      'INSERT INTO ReviewReports (ReviewID, ReportedBy, Reason) VALUES (?,?,?)',
      [req.params.id, req.session.user.id, reason]
    );
    res.json({ success: true, message: 'Review reported. Our team will investigate.' });
  } catch (err) {
    res.status(500).json({ success: false, message: `Could not report review: ${err.message}` });
  }
});

module.exports = router;
