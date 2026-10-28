-- Document-backed verification workflow.
-- Additive only: existing FreelancerVerifications rows and legacy columns
-- (IDNumber, IDType, ProofOfAddress, Certifications, YearsExperience, AdminNotes) are preserved.
-- IDNumber/IDType become nullable because new submissions upload a document instead.
-- Document bytes live in private object storage; only metadata and storage keys are stored here.
--
-- For a clean database only. Compatible with MySQL 5.5+ and MariaDB.
-- The CREATE runs first so that a database which already has a (legacy) VerificationDocuments
-- table fails on the first statement, before anything is changed. Such a database, or one where
-- this migration stopped part-way, must use database/recovery/ instead.
--
-- MySQL 5.5 notes: DATETIME cannot default to CURRENT_TIMESTAMP (TIMESTAMP is used), and InnoDB
-- index keys are limited to 767 bytes (StorageKey is ASCII, so its unique key is 255 bytes).

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

ALTER TABLE FreelancerVerifications
  MODIFY IDNumber VARCHAR(20) NULL,
  MODIFY IDType   ENUM('SA ID','Passport','Drivers Licence') NULL,
  ADD COLUMN CategoryID       INT          NULL AFTER UserID,
  ADD COLUMN CustomSpeciality VARCHAR(80)  NULL AFTER CategoryID,
  ADD COLUMN RejectionReason  VARCHAR(500) NULL AFTER AdminNotes,
  ADD COLUMN ReviewedBy       INT          NULL AFTER ReviewedAt,
  ADD INDEX idx_fv_user_status (UserID, Status),
  ADD CONSTRAINT fk_fv_category FOREIGN KEY (CategoryID) REFERENCES Categories(CategoryID),
  ADD CONSTRAINT fk_fv_reviewer FOREIGN KEY (ReviewedBy) REFERENCES Users(UserID) ON DELETE SET NULL;
