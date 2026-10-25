# Walk With Us — Production Authentication & Role-Based Access Control (RBAC) Guide

This document is the definitive administrative, architectural, and security operations manual for Walk With Us. It covers the full lifecycle of authentication, database-backed roles, administrative bootstrapping, staff authorization, and security practices.

---

## 1. Authentication Architecture

Walk With Us uses **Supabase Auth** (GoTrue / PostgreSQL) integrated with custom PostgreSQL triggers, Row Level Security (RLS), and SECURITY DEFINER stored procedures.

### Core Architecture Highlights:
* **Single Source of Truth:** `AuthProvider` in `src/hooks/useAuth.tsx` coordinates `supabase.auth.getSession()` and `supabase.auth.onAuthStateChange()`. All call sites (`Header`, `Footer`, route guards, pages) consume this unified state without duplicate network requests.
* **Server-Enforced Authorization:** The client never derives authorization from browser storage, user-editable JWT claims, or localStorage. The user's role is resolved directly from PostgreSQL via `public.get_my_role()`.
* **Fail-Closed Security Model:** If role lookup fails, encounters network degradation, returns an unrecognized role, or if an account is inactive (`is_active = false`), `get_my_role()` returns `NULL`, and all protected route guards immediately fail closed.
* **Separation of Concerns:**
  - Frontend guards (`ProtectedRoute`, `StaffRoute`, `AdminRoute`) provide user navigation and feedback.
  - PostgreSQL Row Level Security (RLS) and stored procedures provide the impenetrable security boundary. Even if a malicious actor circumvents the frontend router, database policies prevent unauthorized reads and return error code `42501` on unauthorized writes.

---

## 2. Database Tables & Schema

### Active Table: `public.profiles`
*(Note: An earlier proposed `user_profiles` table was audited and does not exist. The production system exclusively uses `public.profiles`.)*

```sql
Table: public.profiles
  - id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE
  - full_name   TEXT NOT NULL
  - phone       TEXT NULL
  - avatar_url  TEXT NULL
  - role        user_role NOT NULL DEFAULT 'requester'::user_role
  - is_active   BOOLEAN NOT NULL DEFAULT true
  - created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  - updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
```

### Supporting Tables:
* **`public.admin_actions`:** Comprehensive audit trail recording every administrative lifecycle transition, document verification change, initial admin bootstrap, and role assignment.
  - Columns: `id`, `admin_id`, `request_id`, `action`, `old_status`, `new_status`, `notes`, `created_at`.
* **`auth.users`:** Supabase internal auth schema storing credentials, hashed passwords (bcrypt), confirmation timestamps, and metadata.
* **`public.help_requests`:** Beneficiary assistance requests scoped by requester RLS and verified by staff.
* **`public.help_request_documents`:** Metadata for sensitive verification proofs stored in the private `request-documents` bucket.
* **`public.donations`:** Financial donation records with strict immutable client boundaries.

---

## 3. Role Definitions & Permission Matrix

The database defines the PostgreSQL enum `user_role` with 6 explicit values:
`'requester'`, `'donor'`, `'volunteer'`, `'partner'`, `'staff'`, `'admin'`.

| Capability | Public / Anon | Requester | Donor | Volunteer / Partner | Staff | Admin |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| Browse published requests | Yes | Yes | Yes | Yes | Yes | Yes |
| Create and submit help requests | No | Yes (own drafts) | No | No | Optional | Yes |
| View own donation history | No | Own records | Own records | Own records | Own records | Own records |
| View all donation records | No | No | No | No | Yes (`donations_select_staff`) | Yes (`donations_select_staff`) |
| Access private documents | No | Own requests | No | No | Assigned/Reviewed | Full access per policy |
| Review & verify help requests | No | No | No | No | Yes | Yes |
| Transition request lifecycle | No | Submit draft | No | No | Review, verify, reject, publish | Full |
| Respond to volunteer/partner enquiries | No | No | No | No | Yes | Yes |
| Change user roles (`set_user_role`) | No | No | No | No | **Forbidden** | **Yes** (audited) |
| Deactivate accounts (`set_user_active_status`) | No | No | No | No | **Forbidden** | **Yes** (audited) |
| View administrative audit logs | No | No | No | No | Yes (`admin_actions`) | Yes (`admin_actions`) |

---

## 4. How the Project Owner Creates the First Administrator

To prevent unauthorized account elevation, Walk With Us features a secure, idempotent bootstrapping procedure: `public.bootstrap_initial_admin(p_user_id uuid)`.

### Step-by-Step Instructions:

1. **Create the Administrator Account via the Web App:**
   - Go to `/register`.
   - Register the administrator's email (e.g. `admin@walkwithus.org`) and set a strong password.
   - Confirm the email address if email confirmations are enabled in your Supabase project.

2. **Retrieve the User UUID from Supabase:**
   - Log into your Supabase Dashboard (`https://supabase.com/dashboard/project/ffpndfstdseefgfxrmgz`).
   - Navigate to **Authentication > Users**.
   - Copy the User UUID for the target administrator account (e.g. `0f35d667-c8ce-47f7-90a9-9fd12e6a25b6`).

3. **Execute the Bootstrap Function in the Supabase SQL Editor:**
   Open the Supabase **SQL Editor** and run:
   ```sql
   SELECT public.bootstrap_initial_admin('0f35d667-c8ce-47f7-90a9-9fd12e6a25b6'::uuid);
   ```

4. **Verify Bootstrap Execution:**
   The function will return:
   ```json
   {
     "success": true,
     "message": "Initial administrator successfully bootstrapped.",
     "user_id": "0f35d667-c8ce-47f7-90a9-9fd12e6a25b6",
     "role": "admin"
   }
   ```
   An entry is automatically written to `public.admin_actions` with action `'bootstrap_initial_admin'`.

### Bootstrap Security Guardrails:
* **One-Time Lock:** As soon as at least one active administrator exists in `public.profiles`, any subsequent call with a different UUID is **immediately denied**:
  `"Bootstrap denied: System already has an active administrator. Existing administrators must use set_user_role()."`
* **Idempotent:** Calling it again with the same administrator UUID returns `{"success": true, "message": "User is already an active administrator."}` without error or duplicate records.

---

## 5. Adding and Revoking Administrators & Staff

Once the initial administrator is bootstrapped, all subsequent role changes must be performed through the audited RPC: `public.set_user_role(p_target_user_id, p_new_role, p_notes)`.

### A. Promoting a User to Staff
An administrator executes:
```sql
-- Via Supabase SQL Editor or authenticated Admin UI:
SELECT public.set_user_role(
  'TARGET_USER_UUID'::uuid,
  'staff'::user_role,
  'Promoted to field operations verification staff'
);
```

### B. Promoting a User to Administrator
```sql
SELECT public.set_user_role(
  'TARGET_USER_UUID'::uuid,
  'admin'::user_role,
  'Promoted to co-administrator by primary project owner'
);
```

### C. Revoking Staff Privileges
```sql
SELECT public.set_user_role(
  'TARGET_USER_UUID'::uuid,
  'requester'::user_role,
  'Staff privileges revoked'
);
```

### D. Revoking Administrator Privileges (With Lockout Protection)
```sql
SELECT public.set_user_role(
  'TARGET_USER_UUID'::uuid,
  'staff'::user_role,
  'Reassigned to staff role'
);
```
**Built-in Safety:** The database trigger strictly prevents removing or demoting the last remaining active administrator:
`"Operation aborted: Cannot remove or demote the last remaining active administrator."`

### E. Deactivating / Suspending an Account
```sql
SELECT public.set_user_active_status(
  'TARGET_USER_UUID'::uuid,
  false,
  'Suspended pending review'
);
```
When `is_active` is set to `false`, `get_my_role()` returns `NULL`, immediately locking the account out of staff/admin consoles and failing closed on all database queries.

---

## 6. Frontend Route Protection

The frontend uses three distinct tiers of React Router v6 guards:

1. **`ProtectedRoute` (`src/components/ProtectedRoute.tsx`):**
   - Requires an active Supabase session (`user !== null`).
   - If unauthenticated, redirects to `/login` preserving `location` in router state (`state: { from: location }`).
   - Sanitizes redirect targets with `safeReturnPath()` to prevent open-redirect vulnerabilities.

2. **`StaffRoute` (`src/components/StaffRoute.tsx`):**
   - Requires an authenticated user with `role in ['staff', 'admin']`.
   - Displays a dedicated loading state while resolving the server role.
   - If not staff or admin, redirects to `/` with `replace: true`. Fails closed.

3. **`AdminRoute` (`src/components/AdminRoute.tsx`):**
   - Requires an authenticated user with `role === 'admin'`.
   - If not admin, redirects to `/` with `replace: true`. Fails closed.

---

## 7. Account & Profile Management (`/profile`)

Authenticated users have access to `/profile` (accessible from the header user dropdown):
* **View Information:** User email, account ID, member since date, active status, and role badge.
* **Update Permitted Fields:** Edit full name and contact phone number.
* **Direct Role Protection:** Database trigger `protect_profile_fields()` blocks any direct REST updates to `role`, `id`, `created_at`, or `is_active`.
* **Password Change:** Change password with confirmation validation via `supabase.auth.updateUser({ password })`.
* **Email Change:** Request email address modification via `supabase.auth.updateUser({ email })`. Supabase dispatches confirmation links to both email addresses before changing the record.
* **Audit & Retention Notice:** Explains beneficiary request and financial donation data retention policies.

---

## 8. Required Environment Variables

The frontend application requires **only public/publishable credentials**. Secret service-role keys must NEVER be placed in client `.env` files.

```bash
# Frontend environment (.env.local or production hosting environment)
VITE_SUPABASE_URL=https://ffpndfstdseefgfxrmgz.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_RibIKdHWO2ZhV6XQ5g6wtQ_Dgad1UZA
VITE_SITE_URL=http://localhost:5173

# Razorpay Test Mode Public Key
VITE_RAZORPAY_KEY_ID=rzp_test_...
```

*Backend Edge Functions (managed in Supabase Vault / Secrets):*
* `RAZORPAY_KEY_ID`
* `RAZORPAY_KEY_SECRET`
* `RAZORPAY_WEBHOOK_SECRET`
* `SUPABASE_SERVICE_ROLE_KEY`

---

## 9. Automated Testing & Verification Results

All 20 test files and 172 automated tests pass with exit code 0:

```
Test Files  20 passed (20)
Tests       172 passed (172)
TypeCheck   0 errors (npx tsc --noEmit passed)
Build       Production build succeeded in 5.97s (npm run build passed)
```

### Verified Test Scenarios:
1. `Successful registration`: Creates user via `auth.signUp`
2. `Invalid registration input`: Enforces minimum 8 chars, valid email format
3. `Duplicate-email handling`: Gracefully reports existing email without error leaks
4. `Email-verification flow`: Shows pending screen with functional resend trigger
5. `Successful login`: Authenticates and restores active session
6. `Invalid login`: Displays clean feedback on invalid credentials
7. `Session restoration after refresh`: Restores auth state and server role
8. `Logout`: Clears session and revokes access to private pages
9. `Password recovery`: Dispatches reset email to `/reset-password`
10. `Password reset`: Securely updates credentials via `updateUser`
11. `Unauthenticated route access`: Redirects to `/login` preserving target
12. `Regular user to staff route`: Denied and redirected to `/`
13. `Regular user to admin route`: Denied and redirected to `/`
14. `Self role escalation attempt`: Blocked by `protect_profile_fields` trigger
15. `Cross-user role modification`: Blocked by `set_user_role` and RLS
16. `Tampering with verification fields`: Blocked by RLS (code 42501)
17. `Staff accessing admin controls`: Blocked by `AdminRoute` and DB procedures
18. `Authorized admin operations`: Successfully promotes role and writes audit log
19. `Anonymous access to private requests`: RLS returns empty dataset
20. `Cross-user private document access`: RLS returns 42501 permission denied
21. `Direct REST requests bypassing UI`: Database RLS stops unauthorized writes
22. `Network degradation & expired sessions`: Fails closed safely with user notification

---

## 10. Disaster Recovery & Emergency Admin Access

If an administrator loses access to their credentials or email:

1. **Log in to the Supabase Project Dashboard** (accessible only to project owners).
2. **Option A: Trigger Password Reset from Auth:**
   - In **Authentication > Users**, find the administrator account and click **Send password recovery**.
3. **Option B: Promote a Backup Account via SQL:**
   - If needed, run the following SQL query in the Supabase SQL Editor:
   ```sql
   -- Promotes backup account to administrator
   SELECT public.set_user_role(
     'NEW_ADMIN_USER_UUID'::uuid,
     'admin'::user_role,
     'Emergency administrative recovery by database owner'
   );
   ```

---

## 11. Pre-Production Release Security Checklist

Before taking the application live for real users and real payments:
* [x] Database RLS enabled on all 9 public tables (`profiles`, `help_requests`, `help_request_documents`, `donations`, `admin_actions`, `categories`, `volunteer_applications`, `partner_enquiries`, `enquiry_actions`).
* [x] `public.profiles` protected by `protect_profile_fields` trigger against direct role modification.
* [x] Initial system administrator bootstrapped and verified.
* [x] Lockout protection verified (preventing deactivation/demotion of last admin).
* [x] Password visibility toggles provided on all auth forms.
* [x] Open redirect protection verified (`safeReturnPath`).
* [x] Frontend environment verified to contain only publishable keys (`sb_publishable_...`).
* [x] All 20 test suites (172 tests) passing with 0 errors.
* [x] Production build tested and verified (`npm run build` succeeds).
