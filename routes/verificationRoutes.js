const express = require('express');
const router  = express.Router();
const db      = require('../config/db');
const { requireAuth, checkRole } = require('../middleware/authMiddleware');

// ── POST /api/verification/submit ────────────────────────
// Freelancer submits documents for verification
// In production: integrate with Smile Identity or Onfido for automated KYC
// For now: manual admin review system
router.post('/submit', requireAuth, checkRole('Freelancer'), async (req, res) => {
  try {
    const {
      idNumber,          // SA ID number
      idType,            // 'SA ID', 'Passport', 'Drivers Licence'
      proofOfAddress,    // description or URL of uploaded document
      certifications,    // array of certification descriptions
      yearsExperience
    } = req.body;

    if (!idNumber || !idType)
      return res.status(400).json({
        success: false,
        message: 'ID number and ID type are required for verification.'
      });

    // Validate SA ID number format (13 digits)
    if (idType === 'SA ID' && !/^\d{13}$/.test(idNumber))
      return res.status(400).json({
        success: false,
        message: 'SA ID number must be exactly 13 digits.'
      });

    // Check if already submitted
    const [existing] = await db.query(
      'SELECT VerificationID FROM FreelancerVerifications WHERE UserID = ?',
      [req.session.user.id]
    );

    if (existing.length) {
      // Update existing submission
      await db.query(
        `UPDATE FreelancerVerifications
         SET IDNumber=?, IDType=?, ProofOfAddress=?, Certifications=?,
             YearsExperience=?, Status='Pending', SubmittedAt=NOW()
         WHERE UserID=?`,
        [
          idNumber, idType,
          proofOfAddress || '',
          JSON.stringify(certifications || []),
          yearsExperience || 0,
          req.session.user.id
        ]
      );
    } else {
      await db.query(
        `INSERT INTO FreelancerVerifications
         (UserID, IDNumber, IDType, ProofOfAddress, Certifications, YearsExperience, Status)
         VALUES (?,?,?,?,?,?,?)`,
        [
          req.session.user.id, idNumber, idType,
          proofOfAddress || '',
          JSON.stringify(certifications || []),
          yearsExperience || 0,
          'Pending'
        ]
      );
    }

    // Update freelancer verification status
    await db.query(
      "UPDATE Freelancers SET VerificationStatus='Pending' WHERE UserID=?",
      [req.session.user.id]
    );

    res.json({
      success: true,
      message: 'Verification documents submitted. Our team will review within 24-48 hours.'
    });

  } catch (err) {
    console.error('VERIFICATION ERROR:', err.message);
    res.status(500).json({ success: false, message: `Could not submit verification: ${err.message}` });
  }
});

// ── GET /api/verification/status ─────────────────────────
// Freelancer checks their own verification status
router.get('/status', requireAuth, checkRole('Freelancer'), async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT fv.Status, fv.IDType, fv.SubmittedAt, fv.ReviewedAt, fv.AdminNotes,
              f.VerificationStatus, f.BackgroundCheckStatus
       FROM FreelancerVerifications fv
       JOIN Freelancers f ON f.UserID = fv.UserID
       WHERE fv.UserID = ?`,
      [req.session.user.id]
    );

    if (!rows.length) {
      const [fl] = await db.query(
        'SELECT VerificationStatus, BackgroundCheckStatus FROM Freelancers WHERE UserID=?',
        [req.session.user.id]
      );
      return res.json({
        success: true,
        status: 'Not Submitted',
        verificationStatus: fl[0]?.VerificationStatus || 'Unverified',
        backgroundCheck:    fl[0]?.BackgroundCheckStatus || 'Not Started'
      });
    }

    res.json({
      success:            true,
      status:             rows[0].Status,
      idType:             rows[0].IDType,
      submittedAt:        rows[0].SubmittedAt,
      reviewedAt:         rows[0].ReviewedAt,
      adminNotes:         rows[0].AdminNotes,
      verificationStatus: rows[0].VerificationStatus,
      backgroundCheck:    rows[0].BackgroundCheckStatus
    });

  } catch (err) {
    res.status(500).json({ success: false, message: `Could not get status: ${err.message}` });
  }
});

// ── GET /api/verification/pending — admin sees all pending ──
router.get('/pending', requireAuth, checkRole('Admin'), async (req, res) => {
  try {
    const [pending] = await db.query(
      `SELECT fv.*, u.FullName, u.Email, u.PhoneNumber, u.RefNumber,
              f.SkillCategory, f.Rating, f.TotalReviews
       FROM FreelancerVerifications fv
       JOIN Users u ON fv.UserID = u.UserID
       JOIN Freelancers f ON f.UserID = fv.UserID
       WHERE fv.Status = 'Pending'
       ORDER BY fv.SubmittedAt ASC`
    );
    res.json({ success: true, pending });
  } catch (err) {
    res.status(500).json({ success: false, message: `Could not load pending: ${err.message}` });
  }
});

// ── PUT /api/verification/:userId/review — admin approves or rejects ──
router.put('/:userId/review', requireAuth, checkRole('Admin'), async (req, res) => {
  try {
    const { decision, notes, backgroundCheckStatus } = req.body;
    // decision: 'Approved' or 'Rejected'
    if (!['Approved', 'Rejected'].includes(decision))
      return res.status(400).json({ success: false, message: 'Decision must be Approved or Rejected.' });

    await db.query(
      `UPDATE FreelancerVerifications
       SET Status=?, AdminNotes=?, ReviewedAt=NOW()
       WHERE UserID=?`,
      [decision, notes || '', req.params.userId]
    );

    await db.query(
      `UPDATE Freelancers
       SET VerificationStatus=?, BackgroundCheckStatus=?
       WHERE UserID=?`,
      [
        decision === 'Approved' ? 'Verified' : 'Rejected',
        backgroundCheckStatus || 'Not Started',
        req.params.userId
      ]
    );

    res.json({
      success: true,
      message: `Freelancer verification ${decision.toLowerCase()}.`
    });

  } catch (err) {
    res.status(500).json({ success: false, message: `Could not process review: ${err.message}` });
  }
});

module.exports = router;
