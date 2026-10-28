-- Document-backed verification workflow.
-- Additive only: existing FreelancerVerifications rows and legacy columns
-- (IDNumber, IDType, ProofOfAddress, Certifications, YearsExperience, AdminNotes) are preserved.
-- IDNumber/IDType become nullable because new submissions upload a document instead.
-- Document bytes live in private object storage; only metadata and storage keys are stored here.

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

CREATE TABLE VerificationDocuments (
  DocumentID     INT AUTO_INCREMENT PRIMARY KEY,
  VerificationID INT NOT NULL,
  Kind           ENUM('Identity','Qualification') NOT NULL,
  StorageKey     VARCHAR(255) NOT NULL,
  OriginalName   VARCHAR(255) NOT NULL,
  MimeType       VARCHAR(100) NOT NULL,
  SizeBytes      INT UNSIGNED NOT NULL,
  UploadedAt     DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_vd_storage_key (StorageKey),
  UNIQUE KEY uq_vd_verification_kind (VerificationID, Kind),
  FOREIGN KEY (VerificationID) REFERENCES FreelancerVerifications(VerificationID) ON DELETE CASCADE
);
