const express = require('express');
const crypto  = require('crypto');
const multer  = require('multer');
const router      = express.Router();   // /api/verifications
const adminRouter = express.Router();   // /api/admin/verifications
const db      = require('../config/db');
const storage = require('../config/storage');
const { requireSession, checkRole } = require('../middleware/authMiddleware');

// Identity documents are sensitive, so every route here needs a real login session.
// The x-user-id header is never accepted (see requireSession).

const MAX_FILE_BYTES = 10 * 1024 * 1024;   // matches the frontend's 10 MB limit

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: MAX_FILE_BYTES, files: 2, fields: 4, fieldSize: 1024, parts: 6 }
}).fields([
  { name: 'identityDocument',      maxCount: 1 },
  { name: 'qualificationDocument', maxCount: 1 }
]);

function handleUpload(req, res, next) {
  upload(req, res, err => {
    if (!err) return next();
    const message = err.code === 'LIMIT_FILE_SIZE'
      ? 'This file is larger than 10 MB. Please upload a smaller file.'
      : 'Invalid upload. Submit one identity document and at most one qualification document.';
    res.status(400).json({ success: false, message });
  });
}

// File type is decided by the file's leading bytes, never by its name or browser MIME type.
const SIGNATURES = [
  { mime: 'application/pdf', ext: 'pdf', bytes: [0x25, 0x50, 0x44, 0x46, 0x2D] },                   // %PDF-
  { mime: 'image/png',       ext: 'png', bytes: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] },
  { mime: 'image/jpeg',      ext: 'jpg', bytes: [0xFF, 0xD8, 0xFF] }
];

function detectType(buffer) {
  return SIGNATURES.find(s => buffer.length > s.bytes.length && s.bytes.every((b, i) => buffer[i] === b)) || null;
}

// Display name only — storage keys are random and never derived from it.
function safeFileName(name, ext) {
  const base = String(name || '').split(/[\\/]/).pop().replace(/[^\w.\- ()]/g, '_').slice(0, 120).trim();
  return base || `document.${ext}`;
}

// Shared shape for /me and the Admin list (PascalCase, as the frontend expects).
// Legacy rejected rows recorded their reason in AdminNotes.
const RECORD_SQL = `
  SELECT fv.VerificationID, fv.UserID, u.FullName, u.Role,
         c.CategoryName AS Speciality, fv.CustomSpeciality, fv.Status,
         COALESCE(fv.RejectionReason, IF(fv.Status='Rejected', NULLIF(fv.AdminNotes,''), NULL)) AS RejectionReason,
         fv.SubmittedAt, fv.ReviewedAt,
         idd.OriginalName AS IdentityName, qd.OriginalName AS QualificationName
  FROM FreelancerVerifications fv
  JOIN Users u ON u.UserID = fv.UserID
  LEFT JOIN Categories c ON c.CategoryID = fv.CategoryID
  LEFT JOIN VerificationDocuments idd ON idd.VerificationID = fv.VerificationID AND idd.Kind = 'Identity'
  LEFT JOIN VerificationDocuments qd  ON qd.VerificationID  = fv.VerificationID AND qd.Kind  = 'Qualification'`;

function toRecord(row) {
  const { IdentityName, QualificationName, ...record } = row;
  return {
    ...record,
    IdentityDocument:      IdentityName      ? { name: IdentityName,      available: true } : null,
    QualificationDocument: QualificationName ? { name: QualificationName, available: true } : null
  };
}

// ── GET /api/verifications/me — latest submission, or null when Not Submitted ──
router.get('/me', requireSession, checkRole('Customer', 'Freelancer'), async (req, res) => {
  try {
    const [rows] = await db.query(
      `${RECORD_SQL} WHERE fv.UserID=? ORDER BY fv.VerificationID DESC LIMIT 1`,
      [req.session.user.id]
    );
    res.json({ success: true, verification: rows.length ? toRecord(rows[0]) : null });
  } catch (err) {
    console.error('VERIFICATION STATUS ERROR:', err.message);
    res.status(500).json({ success: false, message: 'Could not load your verification status.' });
  }
});

// ── POST /api/verifications — multipart submission ──
// Customers: identity document only. Freelancers: identity required, plus optional
// speciality (categoryId or customSpeciality) and optional qualification document.
router.post('/', requireSession, checkRole('Customer', 'Freelancer'), handleUpload, async (req, res) => {
  const { id: userId, role } = req.session.user;
  const identity      = req.files?.identityDocument?.[0];
  const qualification = req.files?.qualificationDocument?.[0];
  const categoryText  = String(req.body.categoryId ?? '').trim();
  const customText    = String(req.body.customSpeciality ?? '').trim().replace(/\s+/g, ' ');

  const reject = message => res.status(400).json({ success: false, message });

  if (!identity) return reject('An identity document is required to submit.');
  if (role !== 'Freelancer' && (qualification || categoryText || customText))
    return reject('Only freelancers can submit a speciality or qualification document.');
  if (categoryText && customText)
    return reject('Choose a listed speciality or describe your own, not both.');
  if (categoryText && !/^\d+$/.test(categoryText))
    return reject('Please choose a valid speciality.');
  if (customText && (customText.length < 2 || customText.length > 80 || !/^[\p{L}\p{N} &'()+,./-]+$/u.test(customText)))
    return reject('Describe your speciality in 2-80 characters using letters, numbers and basic punctuation.');

  const files = [{ kind: 'Identity', label: 'identity document', file: identity }];
  if (qualification) files.push({ kind: 'Qualification', label: 'qualification document', file: qualification });
  for (const f of files) {
    f.type = detectType(f.file.buffer);
    if (!f.type) return reject(`The ${f.label} is not a valid PDF, JPG or PNG file.`);
  }

  const uploadedKeys = [];
  let conn;
  let committed = false;
  try {
    let categoryId = null;
    if (categoryText) {
      const [cat] = await db.query('SELECT CategoryID FROM Categories WHERE CategoryID=? AND IsActive=1', [categoryText]);
      if (!cat.length) return reject('Please choose a valid speciality.');
      categoryId = cat[0].CategoryID;
    }

    conn = await db.getConnection();
    await conn.beginTransaction();

    // Lock the user row so two simultaneous submissions cannot both pass the check below.
    await conn.query('SELECT UserID FROM Users WHERE UserID=? FOR UPDATE', [userId]);
    const [latest] = await conn.query(
      'SELECT Status FROM FreelancerVerifications WHERE UserID=? ORDER BY VerificationID DESC LIMIT 1',
      [userId]
    );
    if (latest.length && latest[0].Status !== 'Rejected') {
      await conn.rollback();
      return res.status(409).json({
        success: false,
        message: latest[0].Status === 'Pending'
          ? 'Your verification is already pending review.'
          : 'Your account is already verified.'
      });
    }

    const [result] = await conn.query(
      `INSERT INTO FreelancerVerifications (UserID, CategoryID, CustomSpeciality, Status, SubmittedAt)
       VALUES (?, ?, ?, 'Pending', NOW())`,
      [userId, categoryId, customText || null]
    );
    const verificationId = result.insertId;

    for (const f of files) {
      const storageKey = `verifications/${crypto.randomUUID()}.${f.type.ext}`;
      uploadedKeys.push(storageKey);   // recorded first so a partial upload is still cleaned up
      await storage.uploadObject(storageKey, f.file.buffer, f.type.mime);
      await conn.query(
        `INSERT INTO VerificationDocuments
          (VerificationID, Kind, StorageKey, OriginalName, MimeType, SizeBytes)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [verificationId, f.kind, storageKey, safeFileName(f.file.originalname, f.type.ext), f.type.mime, f.file.size]
      );
    }

    if (role === 'Freelancer')
      await conn.query("UPDATE Freelancers SET VerificationStatus='Pending' WHERE UserID=?", [userId]);

    await conn.commit();
    committed = true;

    const [rows] = await db.query(`${RECORD_SQL} WHERE fv.VerificationID=?`, [verificationId]);
    res.status(201).json({
      success: true,
      message: 'Your verification was submitted and is now awaiting review.',
      verification: toRecord(rows[0])
    });
  } catch (err) {
    console.error('VERIFICATION SUBMIT ERROR:', err.message);
    if (!committed) {
      if (conn) await conn.rollback().catch(() => {});
      await storage.deleteObjects(uploadedKeys).catch(e =>
        console.error('ORPHANED VERIFICATION FILES:', uploadedKeys.join(', '), e.message));
    }
    if (!res.headersSent)
      res.status(500).json({ success: false, message: 'Could not submit your verification. Please try again.' });
  } finally {
    if (conn) conn.release();
  }
});

// ── ADMIN ─────────────────────────────────────────────────
adminRouter.use(requireSession, checkRole('Admin'));

// GET /api/admin/verifications — all submissions; the dashboard filters by status itself
adminRouter.get('/', async (req, res) => {
  try {
    const [rows] = await db.query(`${RECORD_SQL} ORDER BY fv.SubmittedAt DESC, fv.VerificationID DESC`);
    res.json({ success: true, verifications: rows.map(toRecord) });
  } catch (err) {
    console.error('VERIFICATION LIST ERROR:', err.message);
    res.status(500).json({ success: false, message: 'Could not load verifications.' });
  }
});

// GET /api/admin/verifications/:verificationId/documents/:kind
// Streams the private file through the backend so window.open() can display it.
const DOCUMENT_KINDS = { identity: 'Identity', qualification: 'Qualification' };

adminRouter.get('/:verificationId/documents/:kind', async (req, res) => {
  const kind = DOCUMENT_KINDS[req.params.kind];
  if (!kind) return res.status(404).json({ success: false, message: 'Document not found.' });
  try {
    const [docs] = await db.query(
      'SELECT StorageKey, OriginalName, MimeType FROM VerificationDocuments WHERE VerificationID=? AND Kind=?',
      [req.params.verificationId, kind]
    );
    if (!docs.length) return res.status(404).json({ success: false, message: 'Document not found.' });

    const file = await storage.downloadObject(docs[0].StorageKey);
    res.set({
      'Content-Type':           docs[0].MimeType,
      'Content-Disposition':    `inline; filename="${docs[0].OriginalName}"`,
      'Cache-Control':          'private, no-store',
      'X-Content-Type-Options': 'nosniff'
    });
    res.send(file);
  } catch (err) {
    console.error('VERIFICATION DOCUMENT ERROR:', err.message);
    res.status(500).json({ success: false, message: 'Could not load the document.' });
  }
});

// PUT /api/admin/verifications/:verificationId/status — { status, reason }
adminRouter.put('/:verificationId/status', async (req, res) => {
  const { status } = req.body;
  const reason = String(req.body.reason ?? '').trim();
  if (!['Approved', 'Rejected'].includes(status))
    return res.status(400).json({ success: false, message: 'Status must be Approved or Rejected.' });
  if (status === 'Rejected' && (reason.length < 3 || reason.length > 500))
    return res.status(400).json({ success: false, message: 'A rejection reason (3-500 characters) is required.' });

  let conn;
  try {
    conn = await db.getConnection();
    await conn.beginTransaction();

    const [rows] = await conn.query(
      `SELECT fv.VerificationID, fv.UserID, fv.Status, fv.CustomSpeciality, c.CategoryName, u.Role,
              EXISTS(SELECT 1 FROM VerificationDocuments d
                     WHERE d.VerificationID = fv.VerificationID AND d.Kind = 'Identity') AS HasIdentity
       FROM FreelancerVerifications fv
       JOIN Users u ON u.UserID = fv.UserID
       LEFT JOIN Categories c ON c.CategoryID = fv.CategoryID
       WHERE fv.VerificationID=? FOR UPDATE`,
      [req.params.verificationId]
    );
    const v = rows[0];
    let refusal = null;
    if (!v) refusal = [404, 'Verification not found.'];
    else if (v.Status !== 'Pending') refusal = [409, 'Only pending submissions can be reviewed.'];
    else if (status === 'Approved' && !v.HasIdentity)
      refusal = [409, 'This submission has no identity document on record and cannot be approved. Reject it with a reason so the user can resubmit.'];
    if (refusal) {
      await conn.rollback();
      return res.status(refusal[0]).json({ success: false, message: refusal[1] });
    }

    await conn.query(
      `UPDATE FreelancerVerifications
       SET Status=?, RejectionReason=?, ReviewedAt=NOW(), ReviewedBy=?
       WHERE VerificationID=?`,
      [status, status === 'Rejected' ? reason : null, req.session.user.id, v.VerificationID]
    );

    // Customer submissions never touch freelancer profile fields.
    // A freelancer's speciality only changes when the submission is approved.
    if (v.Role === 'Freelancer') {
      const speciality = v.CustomSpeciality || v.CategoryName;
      if (status === 'Approved' && speciality)
        await conn.query(
          "UPDATE Freelancers SET VerificationStatus='Verified', SkillCategory=? WHERE UserID=?",
          [speciality, v.UserID]
        );
      else
        await conn.query(
          'UPDATE Freelancers SET VerificationStatus=? WHERE UserID=?',
          [status === 'Approved' ? 'Verified' : 'Rejected', v.UserID]
        );
    }

    await conn.commit();
    res.json({ success: true, message: `Submission ${status.toLowerCase()}.` });
  } catch (err) {
    if (conn) await conn.rollback().catch(() => {});
    console.error('VERIFICATION REVIEW ERROR:', err.message);
    res.status(500).json({ success: false, message: 'Could not update the submission.' });
  } finally {
    if (conn) conn.release();
  }
});

module.exports = { router, adminRouter };
