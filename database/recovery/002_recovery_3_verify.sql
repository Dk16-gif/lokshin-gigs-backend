-- ═══════════════════════════════════════════════════════════════════════════
-- PRODUCTION RECOVERY FOR MIGRATION 002 — STEP 3 OF 3: VERIFY (READ-ONLY)
-- ═══════════════════════════════════════════════════════════════════════════
-- Run after 002_recovery_2_apply.sql. Changes nothing. Recovery is confirmed only if BOTH:
--   * [V1] returns verify_verdict = PASS, and
--   * every manual SHOW check [V2]–[V7] matches its "expect" note.
--
-- phpMyAdmin: select the production database in the left panel first, then run each [Vn]
-- query ON ITS OWN (older phpMyAdmin shows only the last result of a batch).
-- [V1] reports PASS only with positive evidence; empty information_schema results give FAIL.
-- If [V1] says FAIL but the SHOW checks look right, information_schema is not visible in this
-- session — select the database or use the mysql command-line client and re-run [V1].

-- [V1] Automated verdict (information_schema). Expect verify_verdict = PASS and failed_checks empty.
SELECT
  IF(c.database_selected = 1
     AND c.archive_tables_found = 1
     AND c.archive_column_count = 7
     AND c.archive_columns_matching = 7
     AND c.new_tables_found = 1
     AND c.new_columns_match = 1
     AND c.storage_key_ascii = 1
     AND c.new_engine_innodb = 1
     AND c.unique_keys = 2
     AND c.fk_to_verifications = 1,
     'PASS', 'FAIL') AS verify_verdict,
  CONCAT_WS(', ',
    IF(c.database_selected = 1,        NULL, 'no database selected (DATABASE() is NULL)'),
    IF(c.archive_tables_found = 1,     NULL, 'VerificationDocuments_legacy_archive not visible'),
    IF(c.archive_column_count = 7,     NULL, 'archive does not have exactly 7 columns'),
    IF(c.archive_columns_matching = 7, NULL, 'archive column names/types differ from the legacy table'),
    IF(c.new_tables_found = 1,         NULL, 'new VerificationDocuments not visible'),
    IF(c.new_columns_match = 1,        NULL, 'new VerificationDocuments columns differ'),
    IF(c.storage_key_ascii = 1,        NULL, 'StorageKey is not ascii'),
    IF(c.new_engine_innodb = 1,        NULL, 'new table is not InnoDB'),
    IF(c.unique_keys = 2,              NULL, 'unique keys missing'),
    IF(c.fk_to_verifications = 1,      NULL, 'fk_vd_verification missing or wrong')
  ) AS failed_checks,
  c.*
FROM (
  SELECT
    DATABASE() AS current_database,
    IF(DATABASE() IS NULL, 0, 1) AS database_selected,
    (SELECT COUNT(*) FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) = 'verificationdocuments_legacy_archive')
      AS archive_tables_found,
    (SELECT COUNT(*) FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) = 'verificationdocuments_legacy_archive')
      AS archive_column_count,
    (SELECT COUNT(*) FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) = 'verificationdocuments_legacy_archive'
         AND LOWER(CONCAT(COLUMN_NAME, ':', COLUMN_TYPE)) IN (
           'id:int(11)', 'uploadedat:timestamp', 'freelancerid:int(11)', 'filename:varchar(255)',
           'filepath:varchar(500)', 'documenttype:varchar(100)', 'status:varchar(50)'))
      AS archive_columns_matching,
    (SELECT COUNT(*) FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) = 'verificationdocuments')
      AS new_tables_found,
    (SELECT LOWER(GROUP_CONCAT(CONCAT(COLUMN_NAME, ':', COLUMN_TYPE) ORDER BY ORDINAL_POSITION)) =
            'documentid:int(11),verificationid:int(11),kind:enum(''identity'',''qualification''),storagekey:varchar(255),originalname:varchar(255),mimetype:varchar(100),sizebytes:int(10) unsigned,uploadedat:timestamp'
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) = 'verificationdocuments')
      AS new_columns_match,
    (SELECT COUNT(*) FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) = 'verificationdocuments'
         AND LOWER(COLUMN_NAME) = 'storagekey' AND CHARACTER_SET_NAME = 'ascii')
      AS storage_key_ascii,
    (SELECT COUNT(*) FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) = 'verificationdocuments' AND ENGINE = 'InnoDB')
      AS new_engine_innodb,
    (SELECT COUNT(DISTINCT INDEX_NAME) FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) = 'verificationdocuments'
         AND NON_UNIQUE = 0 AND INDEX_NAME IN ('uq_vd_storage_key', 'uq_vd_verification_kind'))
      AS unique_keys,
    (SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS
       WHERE CONSTRAINT_SCHEMA = DATABASE() AND LOWER(CONSTRAINT_NAME) = 'fk_vd_verification'
         AND LOWER(TABLE_NAME) = 'verificationdocuments'
         AND LOWER(REFERENCED_TABLE_NAME) = 'freelancerverifications' AND DELETE_RULE = 'CASCADE')
      AS fk_to_verifications
) c;

-- ── Manual checks (SHOW statements; independent of information_schema) ──────────────────────

-- [V2] Expect exactly three rows: FreelancerVerifications, VerificationDocuments and
--      VerificationDocuments_legacy_archive.
SHOW TABLES LIKE '%erification%';

-- [V3] Expect the 7 legacy columns (ID, UploadedAt, FreelancerID, FileName, FilePath,
--      DocumentType, Status) with the same types as preflight [Q4].
SHOW COLUMNS FROM VerificationDocuments_legacy_archive;

-- [V4] Expect the same number as preflight [Q5] legacy_row_count.
SELECT COUNT(*) AS archive_row_count FROM VerificationDocuments_legacy_archive;

-- [V5] Expect exactly these 8 rows, in this order:
--        DocumentID int(11) PRI auto_increment, VerificationID int(11),
--        Kind enum('Identity','Qualification'), StorageKey varchar(255), OriginalName varchar(255),
--        MimeType varchar(100), SizeBytes int(10) unsigned, UploadedAt timestamp (Default CURRENT_TIMESTAMP)
SHOW COLUMNS FROM VerificationDocuments;

-- [V6] Expect 0.
SELECT COUNT(*) AS new_row_count FROM VerificationDocuments;

-- [V7] Expect: ENGINE=InnoDB; StorageKey ... CHARACTER SET ascii; UNIQUE KEY `uq_vd_storage_key`;
--      UNIQUE KEY `uq_vd_verification_kind`; CONSTRAINT `fk_vd_verification` FOREIGN KEY (`VerificationID`)
--      REFERENCES `FreelancerVerifications` (`VerificationID`) ON DELETE CASCADE.
SHOW CREATE TABLE VerificationDocuments;
