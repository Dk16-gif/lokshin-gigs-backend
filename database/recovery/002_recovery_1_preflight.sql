-- ═══════════════════════════════════════════════════════════════════════════
-- PRODUCTION RECOVERY FOR MIGRATION 002 — STEP 1 OF 3: PREFLIGHT (READ-ONLY)
-- ═══════════════════════════════════════════════════════════════════════════
-- Changes nothing. Continue to 002_recovery_2_apply.sql ONLY if BOTH:
--   * [Q1] returns preflight_verdict = PASS, and
--   * every manual SHOW check [Q2]–[Q7] matches its "expect" note.
--
-- phpMyAdmin:
--   * Select the production database in the left panel FIRST, then open its SQL tab.
--     (From the server-level SQL tab DATABASE() is NULL and information_schema checks see nothing.)
--   * Run each [Qn] query ON ITS OWN. Older phpMyAdmin shows only the last result of a batch.
--
-- Why two kinds of check: information_schema has been seen returning empty results in this
-- phpMyAdmin even though SHOW COLUMNS showed the table. [Q1] therefore only reports PASS when it
-- has positive evidence for every condition — empty information_schema results produce FAIL,
-- never PASS. [Q2]–[Q7] use SHOW statements and do not depend on information_schema.
-- If [Q1] says FAIL but the SHOW checks look right, STOP: information_schema is not visible in
-- this session. Do not proceed on the SHOW checks alone; select the database as above or run
-- the preflight from the mysql command-line client, and get a PASS first.

-- [Q1] Automated verdict (information_schema). Expect preflight_verdict = PASS and failed_checks empty.
--      Table names are compared case-insensitively (LOWER) so lower_case_table_names cannot hide them.
SELECT
  IF(c.database_selected = 1
     AND c.legacy_tables_found = 1
     AND c.legacy_column_count = 7
     AND c.legacy_columns_matching = 7
     AND c.new_columns_present = 0
     AND c.legacy_referenced_by = 0
     AND c.archive_tables_found = 0
     AND c.fk_name_uses = 0
     AND c.fv_tables_found = 1
     AND c.fv_new_columns = 4
     AND c.fv_nullable_id_columns = 2
     AND c.fv_new_foreign_keys = 2
     AND c.fv_verification_id_is_int_pk = 1
     AND c.fv_engine_innodb = 1
     AND c.charsets_available = 2,
     'PASS', 'FAIL') AS preflight_verdict,
  CONCAT_WS(', ',
    IF(c.database_selected = 1,             NULL, 'no database selected (DATABASE() is NULL)'),
    IF(c.fv_tables_found = 1,               NULL, 'FreelancerVerifications not visible in information_schema'),
    IF(c.legacy_tables_found = 1,           NULL, 'legacy VerificationDocuments not visible (or more than one)'),
    IF(c.legacy_column_count = 7,           NULL, 'legacy table does not have exactly 7 columns'),
    IF(c.legacy_columns_matching = 7,       NULL, 'legacy column names/types differ'),
    IF(c.new_columns_present = 0,           NULL, 'VerificationDocuments already has new columns (recovery already applied?)'),
    IF(c.legacy_referenced_by = 0,          NULL, 'another table references VerificationDocuments'),
    IF(c.archive_tables_found = 0,          NULL, 'VerificationDocuments_legacy_archive already exists'),
    IF(c.fk_name_uses = 0,                  NULL, 'constraint fk_vd_verification already exists'),
    IF(c.fv_new_columns = 4,                NULL, 'FreelancerVerifications ALTER columns missing'),
    IF(c.fv_nullable_id_columns = 2,        NULL, 'IDNumber/IDType not nullable'),
    IF(c.fv_new_foreign_keys = 2,           NULL, 'fk_fv_category/fk_fv_reviewer missing'),
    IF(c.fv_verification_id_is_int_pk = 1,  NULL, 'FreelancerVerifications.VerificationID is not an INT primary key'),
    IF(c.fv_engine_innodb = 1,              NULL, 'FreelancerVerifications is not InnoDB'),
    IF(c.charsets_available = 2,            NULL, 'utf8mb4/ascii character sets unavailable')
  ) AS failed_checks,
  c.*
FROM (
  SELECT
    DATABASE() AS current_database,
    VERSION()  AS server_version,                                        -- expect 5.5.x
    @@lower_case_table_names AS lower_case_table_names,                  -- informational
    IF(DATABASE() IS NULL, 0, 1) AS database_selected,
    (SELECT COUNT(*) FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) = 'freelancerverifications')
      AS fv_tables_found,                                                -- positive proof information_schema is visible
    (SELECT COUNT(*) FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) = 'verificationdocuments')
      AS legacy_tables_found,
    (SELECT COUNT(*) FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) = 'verificationdocuments')
      AS legacy_column_count,
    (SELECT COUNT(*) FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) = 'verificationdocuments'
         AND LOWER(CONCAT(COLUMN_NAME, ':', COLUMN_TYPE)) IN (
           'id:int(11)', 'uploadedat:timestamp', 'freelancerid:int(11)', 'filename:varchar(255)',
           'filepath:varchar(500)', 'documenttype:varchar(100)', 'status:varchar(50)'))
      AS legacy_columns_matching,
    (SELECT COUNT(*) FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) = 'verificationdocuments'
         AND LOWER(COLUMN_NAME) IN ('documentid', 'verificationid', 'kind', 'storagekey'))
      AS new_columns_present,
    (SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE
       WHERE TABLE_SCHEMA = DATABASE() AND LOWER(REFERENCED_TABLE_NAME) = 'verificationdocuments')
      AS legacy_referenced_by,
    (SELECT COUNT(*) FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) = 'verificationdocuments_legacy_archive')
      AS archive_tables_found,
    (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
       WHERE CONSTRAINT_SCHEMA = DATABASE() AND LOWER(CONSTRAINT_NAME) = 'fk_vd_verification')
      AS fk_name_uses,
    (SELECT COUNT(*) FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) = 'freelancerverifications'
         AND LOWER(COLUMN_NAME) IN ('categoryid', 'customspeciality', 'rejectionreason', 'reviewedby'))
      AS fv_new_columns,
    (SELECT COUNT(*) FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) = 'freelancerverifications'
         AND LOWER(COLUMN_NAME) IN ('idnumber', 'idtype') AND IS_NULLABLE = 'YES')
      AS fv_nullable_id_columns,
    (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
       WHERE CONSTRAINT_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) = 'freelancerverifications'
         AND LOWER(CONSTRAINT_NAME) IN ('fk_fv_category', 'fk_fv_reviewer'))
      AS fv_new_foreign_keys,
    (SELECT COUNT(*) FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) = 'freelancerverifications'
         AND LOWER(COLUMN_NAME) = 'verificationid' AND COLUMN_TYPE = 'int(11)' AND COLUMN_KEY = 'PRI')
      AS fv_verification_id_is_int_pk,
    (SELECT COUNT(*) FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) = 'freelancerverifications' AND ENGINE = 'InnoDB')
      AS fv_engine_innodb,
    (SELECT COUNT(*) FROM information_schema.CHARACTER_SETS
       WHERE CHARACTER_SET_NAME IN ('utf8mb4', 'ascii'))
      AS charsets_available
) c;

-- ── Manual checks (SHOW statements; independent of information_schema) ──────────────────────

-- [Q2] Expect: database = the production schema name (not NULL); version 5.5.x.
SELECT DATABASE() AS current_database, VERSION() AS server_version, @@lower_case_table_names AS lower_case_table_names;

-- [Q3] Expect exactly two rows: FreelancerVerifications and VerificationDocuments.
--      There must be NO VerificationDocuments_legacy_archive.
SHOW TABLES LIKE '%erification%';

-- [Q4] Expect exactly these 7 rows, in any order. Field and Type must match exactly:
--        ID            int(11)       (Key PRI, Extra auto_increment)
--        UploadedAt    timestamp     (Default CURRENT_TIMESTAMP)
--        FreelancerID  int(11)
--        FileName      varchar(255)
--        FilePath      varchar(500)
--        DocumentType  varchar(100)
--        Status        varchar(50)   (Null NO, Default Pending)
--      There must be NO DocumentID, VerificationID, Kind or StorageKey column.
SHOW COLUMNS FROM VerificationDocuments;

-- [Q5] Record this number: step 3 must report the same count in the archive. (Currently expected 0.)
SELECT COUNT(*) AS legacy_row_count FROM VerificationDocuments;

-- [Q6] Expect: CategoryID, CustomSpeciality, RejectionReason and ReviewedBy present;
--      IDNumber and IDType show Null = YES; VerificationID is int(11) with Key = PRI.
SHOW COLUMNS FROM FreelancerVerifications;

-- [Q7] Expect: ENGINE=InnoDB, and CONSTRAINT `fk_fv_category` and CONSTRAINT `fk_fv_reviewer` present.
SHOW CREATE TABLE FreelancerVerifications;

-- [Q8] Not a check: save this output with the backup notes (legacy definition before the rename).
SHOW CREATE TABLE VerificationDocuments;
