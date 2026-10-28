-- ═══════════════════════════════════════════════════════════════════════════
-- PRODUCTION RECOVERY FOR MIGRATION 002 — STEP 2 OF 3: APPLY
-- ═══════════════════════════════════════════════════════════════════════════
-- For the production database where migration 002 stopped part-way on MySQL 5.5:
-- the FreelancerVerifications ALTER succeeded, but CREATE TABLE VerificationDocuments
-- failed because a legacy table of that name already exists (and DATETIME cannot
-- default to CURRENT_TIMESTAMP on 5.5).
--
-- DO NOT run this on a clean database — use database/migrations/002_verification_documents.sql.
-- DO NOT re-run the FreelancerVerifications ALTER — it has already been applied.
--
-- RUN ONLY AFTER 002_recovery_1_preflight.sql returned preflight_verdict = PASS and every manual
-- SHOW check matched. In phpMyAdmin, select the production database in the left panel first;
-- without a selected database both statements fail with "No database selected" (nothing changes).
-- Run the two statements one at a time and confirm each succeeded before the next.
--
-- PRECONDITIONS (all verified by 002_recovery_1_preflight.sql; stop if any differ):
--   * A current backup of the production database exists.
--   * MySQL 5.5.x; FreelancerVerifications is InnoDB with VerificationID INT(11) PRIMARY KEY.
--   * FreelancerVerifications already has CategoryID, CustomSpeciality, RejectionReason and
--     ReviewedBy; IDNumber and IDType are nullable; fk_fv_category and fk_fv_reviewer exist.
--   * VerificationDocuments exists with EXACTLY these 7 legacy columns:
--       ID            INT AUTO_INCREMENT PRIMARY KEY
--       UploadedAt    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
--       FreelancerID  INT NULL
--       FileName      VARCHAR(255)
--       FilePath      VARCHAR(500)
--       DocumentType  VARCHAR(100)
--       Status        VARCHAR(50) NOT NULL DEFAULT 'Pending'
--   * No table references VerificationDocuments by foreign key.
--   * No table VerificationDocuments_legacy_archive and no constraint fk_vd_verification exist.
--
-- WHAT IT DOES:
--   1. Renames the legacy table to VerificationDocuments_legacy_archive. RENAME TABLE keeps
--      every row, column, index and constraint; the legacy table is never dropped.
--   2. Creates the new VerificationDocuments table expected by routes/verificationRoutes.js.
--
-- MySQL 5.5 COMPATIBILITY:
--   * UploadedAt is TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP (5.5 allows CURRENT_TIMESTAMP
--     defaults only on TIMESTAMP, one per table; no ON UPDATE clause, so it never changes).
--   * InnoDB index keys are limited to 767 bytes on 5.5. StorageKey (always
--     'verifications/<uuid>.<ext>') is ASCII, so its unique key is 255 bytes. The table itself
--     is utf8mb4; filenames are already reduced to ASCII by the application.
--   * The foreign key is named explicitly so it cannot clash with any constraint that moved to
--     the archive table.
--
-- IF IT FAILS: DDL is not transactional in MySQL. If statement 1 succeeds but statement 2
-- fails, restore the original name with
--     RENAME TABLE VerificationDocuments_legacy_archive TO VerificationDocuments;
-- then investigate. Running this script a second time stops at statement 1 (the archive
-- table already exists), so it cannot archive the new table by mistake.

RENAME TABLE VerificationDocuments TO VerificationDocuments_legacy_archive;

CREATE TABLE VerificationDocuments (
  DocumentID     INT AUTO_INCREMENT PRIMARY KEY,
  VerificationID INT NOT NULL,
  Kind           ENUM('Identity','Qualification') NOT NULL,
  StorageKey     VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  OriginalName   VARCHAR(255) NOT NULL,
  MimeType       VARCHAR(100) NOT NULL,
  SizeBytes      INT UNSIGNED NOT NULL,
  UploadedAt     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_vd_storage_key (StorageKey),
  UNIQUE KEY uq_vd_verification_kind (VerificationID, Kind),
  CONSTRAINT fk_vd_verification FOREIGN KEY (VerificationID)
    REFERENCES FreelancerVerifications(VerificationID) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
