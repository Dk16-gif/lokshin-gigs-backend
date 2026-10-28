# Lokshin Gigs — Backend API v2.1

Node.js + Express.js REST API for the Lokshin Gigs community freelance marketplace.

## Setup

```bash
npm install
cp .env.example .env
# fill in your .env values
node server.js
```

## What Was Built

| Feature | Status | Notes |
|---|---|---|
| Form validation | ✅ | All routes validate required fields and formats |
| Duplicate account prevention | ✅ | Checks email AND phone number |
| Unique user identifiers | ✅ | RefNumber e.g. LG-CUST-000001 |
| SA phone number validation | ✅ | Regex: 0[6-8]XXXXXXXX |
| Password strength enforcement | ✅ | Minimum 6 characters |
| Forgot password | ✅ | Token generated — needs SendGrid to send email |
| Reviews and comments | ✅ | Rating 1-5, comment, would recommend flag |
| Duplicate review prevention | ✅ | One review per job per customer |
| ID verification system | ✅ | Manual admin review — upgrade to Smile Identity later |
| Background check tracking | ✅ | Status field — manual process for now |
| Service provider reports | ✅ | 6 report types, auto-flag after 3 reports |
| Payment recording | ✅ | In-person payments recorded with reference number |
| Payment disputes | ✅ | Either party can raise a dispute |
| Admin flagged user management | ✅ | View, unflag, suspend flagged accounts |

## What Needs a Third-Party Service

| Feature | Service Needed | Cost |
|---|---|---|
| Forgot password email sending | SendGrid or Nodemailer | Free tier available |
| Automated ID verification (KYC) | Smile Identity | Paid |
| Online payments | PayFast or Yoco | Free to register |
| Automated background checks | MIE or TransUnion | Paid |

## API Endpoints

### Auth
| Method | Endpoint | Required Fields |
|---|---|---|
| POST | /api/auth/register | fullName, email, phone, password, role |
| POST | /api/auth/login | email, password |
| POST | /api/auth/logout | — |
| GET  | /api/auth/me | — |
| POST | /api/auth/forgot-password | email |
| POST | /api/auth/reset-password | token, newPassword |

### Jobs
| Method | Endpoint | Description |
|---|---|---|
| GET  | /api/jobs | Browse open jobs |
| GET  | /api/jobs/my | Customer's own jobs |
| POST | /api/jobs | Post a new job |
| PUT  | /api/jobs/:id/status | Update job status |
| GET  | /api/jobs/:id/applications | View applications |
| POST | /api/jobs/:id/apply | Apply for a job |
| PUT  | /api/jobs/:jobId/applications/:appId | Accept or reject |

### Reviews
| Method | Endpoint | Description |
|---|---|---|
| POST | /api/reviews | Submit a review (Customer only, job must be Completed) |
| GET  | /api/reviews/freelancer/:id | All reviews for a freelancer |
| GET  | /api/reviews/job/:id | Review for a specific job |
| POST | /api/reviews/:id/report | Report a fraudulent review |

### Verification
| Method | Endpoint | Description |
|---|---|---|
| GET  | /api/verifications/me | Current user's latest verification (`null` = Not Submitted) |
| POST | /api/verifications | Multipart: `identityDocument` (required); Freelancers may add `qualificationDocument`, `categoryId` or `customSpeciality` |
| GET  | /api/admin/verifications | Admin lists all submissions |
| GET  | /api/admin/verifications/:verificationId/documents/:kind | Admin views a private document (`identity` or `qualification`) |
| PUT  | /api/admin/verifications/:verificationId/status | Admin approves, or rejects with a `reason` |

These routes require a logged-in session (the `x-user-id` header is not accepted). Documents are stored in a private Supabase Storage bucket; see `.env.example`. The old singular `/api/verification/*` routes are retired (HTTP 410).

### Payments
| Method | Endpoint | Description |
|---|---|---|
| POST | /api/payments/confirm | Customer confirms in-person payment |
| POST | /api/payments/dispute | Raise a payment dispute |
| GET  | /api/payments/job/:id | Payment details for a job |
| GET  | /api/payments/disputes | Admin views all disputes |
| PUT  | /api/payments/disputes/:id/resolve | Admin resolves dispute |

### Reports
| Method | Endpoint | Description |
|---|---|---|
| POST | /api/reports | Report a user |
| GET  | /api/reports/freelancer/:id | Public report summary for a freelancer |
| GET  | /api/reports/all | Admin views all reports |
| PUT  | /api/reports/:id/resolve | Admin resolves a report |

### Admin
| Method | Endpoint | Description |
|---|---|---|
| GET | /api/admin/stats | Full platform statistics |
| GET | /api/admin/users | All users with verification status |
| PUT | /api/admin/users/:id/toggle | Activate or suspend |
| PUT | /api/admin/users/:id/unflag | Remove flag from user |
| DELETE | /api/admin/users/:id | Delete user |
| GET | /api/admin/jobs | All jobs |
| GET | /api/admin/flagged | All flagged users |
| GET | /api/admin/reports/summary | Report summary by type |
| GET | /api/admin/payments | All payment records |

### Other
| Method | Endpoint | Description |
|---|---|---|
| GET | /api/categories | List all categories |
| GET | /api/users/profile | Current user profile |
| PUT | /api/users/profile | Update profile |
| GET | /api/applications/my | Freelancer's applications |
| GET | /api/applications/active | Freelancer's active jobs |
| GET | /health | Health check |
