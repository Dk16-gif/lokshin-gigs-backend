const express = require('express');
const router  = express.Router();
const db      = require('../config/db');
const { requireAuth, checkRole } = require('../middleware/authMiddleware');

// ── PAYMENT POLICY ────────────────────────────────────────
// Current model: Payment is handled IN PERSON between customer and freelancer.
// The platform records the agreed amount, method, and confirmation from both parties.
// Future: PayFast or Yoco integration for online payments.

// ── POST /api/payments/confirm ───────────────────────────
// Customer confirms they have paid the freelancer in person
router.post('/confirm', requireAuth, checkRole('Customer'), async (req, res) => {
  try {
    const { jobId, freelancerId, amount, method, notes } = req.body;
    // method: 'Cash', 'EFT', 'SnapScan', 'Other'

    if (!jobId || !freelancerId || !amount || !method)
      return res.status(400).json({
        success: false,
        message: 'Job ID, freelancer ID, amount, and payment method are required.'
      });

    const validMethods = ['Cash', 'EFT', 'SnapScan', 'Yoco', 'Other'];
    if (!validMethods.includes(method))
      return res.status(400).json({
        success: false,
        message: `Payment method must be one of: ${validMethods.join(', ')}.`
      });

    // Verify job belongs to this customer
    const [jobs] = await db.query(
      'SELECT JobID, Status FROM Jobs WHERE JobID = ? AND CustomerID = ?',
      [jobId, req.session.user.id]
    );
    if (!jobs.length)
      return res.status(404).json({ success: false, message: 'Job not found.' });

    // Check for existing payment record
    const [existing] = await db.query(
      'SELECT PaymentID FROM Payments WHERE JobID = ?',
      [jobId]
    );
    if (existing.length)
      return res.status(409).json({
        success: false,
        message: 'Payment has already been recorded for this job.'
      });

    const reference = `PAY-${Date.now()}-${jobId}`;

    await db.query(
      `INSERT INTO Payments
       (JobID, CustomerID, FreelancerID, Amount, Method, Status, Reference, Notes)
       VALUES (?,?,?,?,?,?,?,?)`,
      [jobId, req.session.user.id, freelancerId, parseFloat(amount), method, 'Confirmed', reference, notes || '']
    );

    // Mark job as completed once payment confirmed
    await db.query(
      "UPDATE Jobs SET Status = 'Completed' WHERE JobID = ?",
      [jobId]
    );

    res.status(201).json({
      success:   true,
      message:   'Payment confirmed. Job marked as completed.',
      reference
    });

  } catch (err) {
    console.error('PAYMENT ERROR:', err.message);
    res.status(500).json({ success: false, message: `Could not record payment: ${err.message}` });
  }
});

// ── POST /api/payments/dispute ───────────────────────────
// Either party can raise a dispute about payment
router.post('/dispute', requireAuth, async (req, res) => {
  try {
    const { jobId, reason, description } = req.body;

    if (!jobId || !reason)
      return res.status(400).json({ success: false, message: 'Job ID and reason are required.' });

    const [payments] = await db.query('SELECT PaymentID FROM Payments WHERE JobID = ?', [jobId]);

    await db.query(
      `INSERT INTO PaymentDisputes
       (JobID, RaisedBy, Reason, Description, Status)
       VALUES (?,?,?,?,?)`,
      [jobId, req.session.user.id, reason, description || '', 'Open']
    );

    res.json({
      success: true,
      message: 'Dispute raised. Our team will review within 24 hours and contact both parties.'
    });

  } catch (err) {
    res.status(500).json({ success: false, message: `Could not raise dispute: ${err.message}` });
  }
});

// ── GET /api/payments/job/:id ─────────────────────────────
// Get payment details for a job
router.get('/job/:id', requireAuth, async (req, res) => {
  try {
    const [payments] = await db.query(
      `SELECT p.*, u1.FullName AS CustomerName, u2.FullName AS FreelancerName
       FROM Payments p
       JOIN Users u1 ON p.CustomerID = u1.UserID
       JOIN Users u2 ON p.FreelancerID = u2.UserID
       WHERE p.JobID = ?`,
      [req.params.id]
    );
    res.json({ success: true, payment: payments[0] || null });
  } catch (err) {
    res.status(500).json({ success: false, message: `Could not load payment: ${err.message}` });
  }
});

// ── GET /api/payments/disputes — admin views all disputes ──
router.get('/disputes', requireAuth, checkRole('Admin'), async (req, res) => {
  try {
    const [disputes] = await db.query(
      `SELECT pd.*, u.FullName AS RaisedByName, j.Title AS JobTitle
       FROM PaymentDisputes pd
       JOIN Users u ON pd.RaisedBy = u.UserID
       JOIN Jobs j  ON pd.JobID = j.JobID
       ORDER BY pd.CreatedAt DESC`
    );
    res.json({ success: true, disputes });
  } catch (err) {
    res.status(500).json({ success: false, message: `Could not load disputes: ${err.message}` });
  }
});

// ── PUT /api/payments/disputes/:id/resolve — admin resolves ──
router.put('/disputes/:id/resolve', requireAuth, checkRole('Admin'), async (req, res) => {
  try {
    const { resolution, outcome } = req.body;
    // outcome: 'Resolved', 'Refund Required', 'No Action'
    await db.query(
      'UPDATE PaymentDisputes SET Status=?, Resolution=?, ResolvedAt=NOW() WHERE DisputeID=?',
      [outcome || 'Resolved', resolution || '', req.params.id]
    );
    res.json({ success: true, message: 'Dispute resolved.' });
  } catch (err) {
    res.status(500).json({ success: false, message: `Could not resolve dispute: ${err.message}` });
  }
});

module.exports = router;
