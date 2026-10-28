-- ============================================================
-- LOKSHIN GIGS v2.1 — COMPLETE DATABASE SCHEMA
-- ============================================================

-- ── CATEGORIES ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS Categories (
  CategoryID   INT AUTO_INCREMENT PRIMARY KEY,
  CategoryName VARCHAR(100) NOT NULL UNIQUE,
  Description  TEXT,
  IsActive     TINYINT(1) DEFAULT 1
);

-- ── USERS ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS Users (
  UserID           INT AUTO_INCREMENT PRIMARY KEY,
  RefNumber        VARCHAR(20)  UNIQUE,
  FullName         VARCHAR(100) NOT NULL,
  Email            VARCHAR(100) NOT NULL UNIQUE,
  Password         VARCHAR(255) NOT NULL,
  PhoneNumber      VARCHAR(15)  NOT NULL,
  Role             ENUM('Customer','Freelancer','Admin') NOT NULL,
  GoogleID         VARCHAR(100) DEFAULT NULL,        -- stores Google account ID for OAuth users
  IsActive         TINYINT(1) DEFAULT 1,
  IsFlagged        TINYINT(1) DEFAULT 0,
  ResetToken       VARCHAR(100) DEFAULT NULL,
  ResetTokenExpiry DATETIME     DEFAULT NULL,
  CreatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ── FREELANCERS ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS Freelancers (
  FreelancerID          INT AUTO_INCREMENT PRIMARY KEY,
  UserID                INT NOT NULL,
  SkillCategory         VARCHAR(100) NOT NULL,
  Experience            TEXT,
  Bio                   TEXT,
  Rating                DECIMAL(3,2) DEFAULT 0.00,
  TotalReviews          INT DEFAULT 0,
  VerificationStatus    ENUM('Unverified','Pending','Verified','Rejected') DEFAULT 'Unverified',
  BackgroundCheckStatus ENUM('Not Started','In Progress','Passed','Failed') DEFAULT 'Not Started',
  IsAvailable           TINYINT(1) DEFAULT 1,
  FOREIGN KEY (UserID) REFERENCES Users(UserID) ON DELETE CASCADE
);

-- ── FREELANCER VERIFICATIONS ──────────────────────────────
CREATE TABLE IF NOT EXISTS FreelancerVerifications (
  VerificationID  INT AUTO_INCREMENT PRIMARY KEY,
  UserID          INT NOT NULL,
  CategoryID      INT NULL,
  CustomSpeciality VARCHAR(80) NULL,
  IDNumber        VARCHAR(20) NULL,
  IDType          ENUM('SA ID','Passport','Drivers Licence') NULL,
  ProofOfAddress  TEXT,
  Certifications  JSON,
  YearsExperience INT DEFAULT 0,
  Status          ENUM('Pending','Approved','Rejected') DEFAULT 'Pending',
  AdminNotes      TEXT,
  RejectionReason VARCHAR(500) NULL,
  SubmittedAt     DATETIME DEFAULT CURRENT_TIMESTAMP,
  ReviewedAt      DATETIME DEFAULT NULL,
  ReviewedBy      INT NULL,
  INDEX idx_fv_user_status (UserID, Status),
  FOREIGN KEY (UserID) REFERENCES Users(UserID) ON DELETE CASCADE,
  CONSTRAINT fk_fv_category FOREIGN KEY (CategoryID) REFERENCES Categories(CategoryID),
  CONSTRAINT fk_fv_reviewer FOREIGN KEY (ReviewedBy) REFERENCES Users(UserID) ON DELETE SET NULL
);

-- ── VERIFICATION DOCUMENTS (bytes live in private object storage) ──
CREATE TABLE IF NOT EXISTS VerificationDocuments (
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

-- ── JOBS ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS Jobs (
  JobID       INT AUTO_INCREMENT PRIMARY KEY,
  CustomerID  INT NOT NULL,
  CategoryID  INT NOT NULL,
  Title       VARCHAR(150) NOT NULL,
  Description TEXT NOT NULL,
  Location    VARCHAR(200) NOT NULL,
  Budget      DECIMAL(10,2) NOT NULL,
  Status      ENUM('Open','In Progress','Completed','Cancelled') DEFAULT 'Open',
  PostedAt    DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (CustomerID) REFERENCES Users(UserID) ON DELETE CASCADE,
  FOREIGN KEY (CategoryID) REFERENCES Categories(CategoryID)
);

-- ── APPLICATIONS ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS Applications (
  ApplicationID INT AUTO_INCREMENT PRIMARY KEY,
  JobID         INT NOT NULL,
  FreelancerID  INT NOT NULL,
  CoverNote     TEXT,
  QuotedPrice   DECIMAL(10,2) NULL,
  Status        ENUM('Pending','Accepted','Rejected') DEFAULT 'Pending',
  DateApplied   DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (JobID)        REFERENCES Jobs(JobID) ON DELETE CASCADE,
  FOREIGN KEY (FreelancerID) REFERENCES Users(UserID) ON DELETE CASCADE
);

-- ── REVIEWS ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS Reviews (
  ReviewID        INT AUTO_INCREMENT PRIMARY KEY,
  JobID           INT NOT NULL,
  CustomerID      INT NOT NULL,
  FreelancerID    INT NOT NULL,
  Rating          INT NOT NULL CHECK (Rating BETWEEN 1 AND 5),
  Comment         TEXT,
  WouldRecommend  TINYINT(1) DEFAULT 0,
  ReviewDate      DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (JobID)        REFERENCES Jobs(JobID) ON DELETE CASCADE,
  FOREIGN KEY (CustomerID)   REFERENCES Users(UserID),
  FOREIGN KEY (FreelancerID) REFERENCES Users(UserID)
);

-- ── REVIEW REPORTS ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ReviewReports (
  ReportID   INT AUTO_INCREMENT PRIMARY KEY,
  ReviewID   INT NOT NULL,
  ReportedBy INT NOT NULL,
  Reason     TEXT NOT NULL,
  CreatedAt  DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (ReviewID)   REFERENCES Reviews(ReviewID) ON DELETE CASCADE,
  FOREIGN KEY (ReportedBy) REFERENCES Users(UserID)
);

-- ── PAYMENTS ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS Payments (
  PaymentID    INT AUTO_INCREMENT PRIMARY KEY,
  JobID        INT NOT NULL UNIQUE,
  CustomerID   INT NOT NULL,
  FreelancerID INT NOT NULL,
  Amount       DECIMAL(10,2) NOT NULL,
  Method       ENUM('Cash','EFT','SnapScan','Yoco','Other') NOT NULL,
  Status       ENUM('Pending','Confirmed','Disputed','Refunded') DEFAULT 'Pending',
  Reference    VARCHAR(100) UNIQUE,
  Notes        TEXT,
  PaidAt       DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (JobID)        REFERENCES Jobs(JobID),
  FOREIGN KEY (CustomerID)   REFERENCES Users(UserID),
  FOREIGN KEY (FreelancerID) REFERENCES Users(UserID)
);

-- ── PAYMENT DISPUTES ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS PaymentDisputes (
  DisputeID   INT AUTO_INCREMENT PRIMARY KEY,
  JobID       INT NOT NULL,
  RaisedBy    INT NOT NULL,
  Reason      VARCHAR(200) NOT NULL,
  Description TEXT,
  Status      ENUM('Open','Resolved','Dismissed') DEFAULT 'Open',
  Resolution  TEXT,
  ResolvedAt  DATETIME DEFAULT NULL,
  CreatedAt   DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (JobID)    REFERENCES Jobs(JobID),
  FOREIGN KEY (RaisedBy) REFERENCES Users(UserID)
);

-- ── USER REPORTS ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS UserReports (
  ReportID        INT AUTO_INCREMENT PRIMARY KEY,
  ReportedUserID  INT NOT NULL,
  ReportedByID    INT NOT NULL,
  Type            ENUM('Fraud','No Show','Poor Quality','Harassment','Fake Profile','Other') NOT NULL,
  Description     TEXT NOT NULL,
  Status          ENUM('Open','Dismissed','Warning Issued','Suspended','Resolved') DEFAULT 'Open',
  AdminNotes      TEXT,
  ResolvedAt      DATETIME DEFAULT NULL,
  CreatedAt       DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (ReportedUserID) REFERENCES Users(UserID),
  FOREIGN KEY (ReportedByID)   REFERENCES Users(UserID)
);

-- ── SEED CATEGORIES ───────────────────────────────────────
INSERT IGNORE INTO Categories (CategoryName, Description) VALUES
('Handyman',        'General repairs, TV mounting, furniture assembly'),
('Plumbing',        'Pipe repairs, installations, leak fixing'),
('Electrical',      'Wiring, plugs, circuit breakers, appliance installation'),
('Painting',        'Interior and exterior painting services'),
('Gardening',       'Lawn mowing, tree trimming, general garden work'),
('House Cleaning',  'Domestic cleaning, deep cleans, post-construction cleaning'),
('Computer Repairs','Virus removal, hardware repairs, software installation'),
('Tutoring',        'Academic tutoring for all grades and subjects'),
('Graphic Design',  'Logos, flyers, branding, social media graphics'),
('Photography',     'Events, portraits, product photography'),
('Beauty Services', 'Haircuts, braiding, makeup, nails'),
('Appliance Repair','Washing machines, fridges, stoves, microwaves');

-- ── SEED DEMO USERS ───────────────────────────────────────
INSERT IGNORE INTO Users (RefNumber, FullName, Email, Password, PhoneNumber, Role) VALUES
('LG-CUST-000001', 'Thabo Mokoena',   'customer@demo.com',
 '$2b$12$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2uheWG/igi.', '0811234567', 'Customer'),
('LG-FREL-000002', 'Bra Ben Dlamini', 'freelancer@demo.com',
 '$2b$12$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2uheWG/igi.', '0829876543', 'Freelancer'),
('LG-ADMN-000000', 'Admin User',      'admin@lokshingigs.co.za',
 '$2b$12$REPLACE_RUN_THIS_IN_TERMINAL', '0800000000', 'Admin');

INSERT IGNORE INTO Freelancers (UserID, SkillCategory, Experience, Bio, Rating, TotalReviews, VerificationStatus)
SELECT UserID, 'Handyman',
  '8 years experience in TV mounting, furniture assembly, and general repairs.',
  'Reliable and professional handyman based in Soweto. Available 7 days a week.',
  4.9, 47, 'Verified'
FROM Users WHERE Email = 'freelancer@demo.com';

INSERT IGNORE INTO Jobs (CustomerID, CategoryID, Title, Description, Location, Budget, Status)
SELECT u.UserID, 1, 'TV Wall Mount Installation',
  'Need to mount a 55-inch Samsung TV on the lounge wall. Bracket already purchased.',
  'Soweto, Meadowlands', 280, 'Open'
FROM Users u WHERE u.Email = 'customer@demo.com';

INSERT IGNORE INTO Jobs (CustomerID, CategoryID, Title, Description, Location, Budget, Status)
SELECT u.UserID, 8, 'Grade 12 Maths Tutoring',
  'Looking for a patient maths tutor for my son writing matric this year.',
  'Orlando East', 200, 'Open'
FROM Users u WHERE u.Email = 'customer@demo.com';
