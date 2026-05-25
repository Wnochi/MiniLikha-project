# MiniLikha — Project Plan & Missing Items

This document analyzes the current repository state and provides a prioritized, actionable plan to turn the UI placeholders into a working storefront and admin workflow. It focuses on what is missing, recommended fixes, acceptance criteria, and next steps (no code changes in this file).

---

## 1) Quick Summary / Current Snapshot

- Purpose: Small handcrafted storefront using Firestore + Firebase Auth.
- Key static files present: [index.html](index.html), [admin.html](admin.html), [customer.js](customer.js), [admin.js](admin.js), [firebase-config.js](firebase-config.js), [firebase.json](firebase.json), [firestore.rules](firestore.rules).
- What already exists: complete UI skeletons with placeholders (catalog, product detail, cart, checkout, admin panels). Frontend modules (`customer.js`, `admin.js`) are wired to Firestore and expect a `db` and `auth` export from `firebase-config.js`.
- What is missing: live Firestore documents (no product/order data seeded), some admin-auth UI elements expected by `admin.js` are not present in `admin.html`, and image/upload flows and security validation are incomplete.

---

## 2) High-level Observations (from repo inspection)

- `index.html` contains all customer-side DOM placeholders and loads `./customer.js` which expects a `products` collection and certain DOM IDs (e.g., `catalog-grid`, `detail-title`, `detail-price`, `cart-badge`).
- `admin.html` contains inventory and orders tables, but there is no login overlay markup even though `admin.js` references `admin-login-overlay`, `admin-login-form`, `login-error`, and `admin-logout-btn`.
- `admin.js` and `customer.js` both import `./firebase-config.js` which already exports `db` and `auth` — good. `firebase-config.js` contains concrete config values; confirm these map to the correct Firebase project.
- `firestore.rules` allow public reads of `products` and public creation of `orders` (and require auth for writes to `products`). Consider tightening validation for `orders`.

---

## 3) What’s Missing / Why the UI is empty

- Firestore `products` collection: no seeded documents, so catalog renders empty ('No products available at the moment.').
- Admin authentication UI: login overlay and controls are missing from `admin.html` though `admin.js` expects them.
- Admin account(s): at least one admin user (email/password) must exist in Firebase Auth, or `admin.js` must provide a sign-up flow.
- Image hosting and upload integration: admin currently accepts an `Image URL` text input; there is no Storage upload flow. If images are not hosted externally, products will lack images.
- Security & validation: `orders` can be created by anyone. There is minimal payload validation in rules — risk of spam or malformed documents.
- Deployment checklist: hosting is configured in `firebase.json` but no deployment steps / README in repo.

---

## 4) Recommended Priority Plan (ordered, with tasks & acceptance criteria)

**Phase A — Immediate (Quick wins, high impact)**
- Task A1: Seed Firestore with sample product documents.
  - Why: Makes the storefront usable immediately and surfaces frontend display issues.
  - Acceptance: `index.html` shows 6–12 products; clicking a card shows detail view; `admin.html` inventory table lists the same items.
  - Est. effort: 0.5–1 hour (via Firebase Console or import).

- Task A2: Add missing admin login overlay markup to `admin.html`.
  - Why: `admin.js` references login elements; without them admin panel cannot require sign-in or display orders.
  - Acceptance: IDs referenced in `admin.js` exist: `admin-login-overlay`, `admin-login-form`, `login-error`, `admin-logout-btn`. After markup is present, logging in (existing admin user) hides overlay and shows orders.
  - Est. effort: 15–30 minutes.

- Task A3: Create an admin user in Firebase Auth (email/password) via Firebase Console.
  - Why: Allows protected writes to `products` and reading/updating `orders` in admin UI.
  - Acceptance: Able to sign in from admin UI and add products.
  - Est. effort: 10–15 minutes.

**Phase B — Data modelling & seeding**
- Task B1: Define canonical `products` document fields and `orders` document fields (see Section 6).
- Task B2: Create a seed dataset (6–12 rich sample products) and import via console or script.
  - Acceptance: Each product document contains required fields (name, price, slots, imageUrl, description, createdAt).
  - Est. effort: 1–2 hours.

**Phase C — Admin UX / Data Ops**
- Task C1: Implement product image uploads (option):
  - Option 1 (fast): Continue using `imageUrl` input and host sample images on an external CDN (Unsplash). Quick and low-effort.
  - Option 2 (robust): Add Firebase Storage integration + upload flow in `admin.html`/`admin.js` so admins can upload images, then save `imageUrl` to Firestore. Also ensure `firebase-config.js` storageBucket is correct.
  - Acceptance: Admin can attach an image and product shows image in storefront.
  - Est. effort: Option 1 = 0.5–1 hour; Option 2 = 2–4 hours.

- Task C2: Add Edit / Delete controls for product rows in admin inventory and implement confirm flows.
  - Acceptance: Admin can edit product fields and deletes remove documents from Firestore (with confirm dialog).
  - Est. effort: 2–4 hours.

**Phase D — Frontend robustness & UX**
- Task D1: Add loading states, empty states, and better error messaging in `customer.js` and `admin.js`.
  - Acceptance: UI shows spinner or placeholder while listeners attach; shows friendly errors if Firestore unavailable.
  - Est. effort: 1–2 hours.

- Task D2: Strengthen checkout UX: confirm slot deduction failure handling, show friendly messages for insufficient slots, and disable button during transaction.
  - Acceptance: Attempting to buy > available slots triggers a clear error and no partially-updated state.
  - Est. effort: 1–2 hours.

**Phase E — Security, validation & rules**
- Task E1: Harden Firestore rules (recommendations):
  - Only allow writes to `products` if `request.auth.uid` is in a server-maintained admin list (e.g., a small `admins` collection) or the UID matches a configured admin UID.
  - Validate `orders` shape on create: required fields, types, max lengths, and reasonable numeric ranges.
  - Consider throttling or adding reCAPTCHA before creating `orders` to reduce spam.
  - Acceptance: Rules tested via Firestore simulator and manual attempts; rules prevent unauthorized writes.
  - Est. effort: 1–3 hours.

**Phase F — Testing, deploy & documentation**
- Task F1: Manual test plan & checklist (see Section 7).
- Task F2: Prepare `README.md` with setup instructions (Firebase console steps, how to seed data, how to create admin user, how to deploy).
- Task F3: Deploy to Firebase Hosting and verify live site.
  - Acceptance: Live site shows seeded products and admin panel works after login.
  - Est. effort: 1–3 hours.

**Phase G — Optional / Later**
- CI/CD deploy with GitHub Actions that run a build and `firebase deploy`.
- Scheduled backups of Firestore exports or export on release.
- Analytics and error monitoring (Sentry, GA4).
- Performance improvements and accessibility audits.

---

## 5) Immediate Next 3 Steps (what to do right now)

1. Seed 6 sample products in Firestore (quick via Console). This will immediately populate `index.html`.
2. Add the missing login overlay / form elements to `admin.html` matching `admin.js` IDs.
3. Create an admin user in Firebase Auth (via Console) and test sign-in from the admin UI.

Completing these will make the UI show data and allow adding products from the admin panel.

---

## 6) Suggested Firestore Data Model (fields to include)

- Collection `products` (document per product):
  - `name` (string) — required
  - `description` (string)
  - `price` (number) — required
  - `slots` (number) — integer, remaining batch slots
  - `imageUrl` (string) — absolute URL (or Storage path)
  - `createdAt` (timestamp)
  - `tags` (array of strings) — optional
  - `featured` (boolean) — optional

- Collection `orders` (document per order):
  - `customerName` (string)
  - `customerPhone` (string)
  - `customerAddress` (string)
  - `paymentMethod` (string)
  - `items` (array) — each item: `{ id, name, qty, price }`
  - `totalPaid` (number)
  - `timestamp` (timestamp or ISO string)
  - `orderStatus` (string) — e.g., Pending/Confirmed/Cancelled

- (Optional) Collection `admins` or `metadata/admins` mapping admin UIDs for rule checks.

---

## 7) Quick Manual Test Cases / Acceptance Criteria

- Browse Catalog: catalog shows >0 products and images; clicking a product opens detail with correct title/price/desc/slots.
- Add to Cart: clicking reserve on a product adds it to cart and updates `cart-badge`.
- Checkout Happy Path: submitting checkout deducts slots using Firestore transaction and creates an `orders` document.
- Oversell Prevention: attempting to reserve more slots than available results in a clear error and no slot deduction.
- Admin Add Product: Admin signs in and adding a product creates a `products` document and it appears on storefront.
- Admin Orders View: Admin signs in and can see `orders` collection rows.

---

## 8) Estimated Timeline (rough)

- Quick wins (seed data + admin markup + create admin): same day — ~1.5–2.5 hours.
- Data model + seeding + basic storage image approach: 1–3 hours.
- Full admin CRUD + storage upload: 2–5 hours.
- Security hardening & rules testing: 1–3 hours.
- Testing, docs, and deployment: 1–3 hours.

Total to a working MVP: 6–14 hours depending on chosen image/upload approach and depth of rules validation.

---

## 9) Notes & Caveats

- `firebase-config.js` currently exposes client config (expected for client SDK). Keep server keys and service accounts out of the repo.
- `firestore.rules` currently allow public creation of orders — decide whether anonymous orders are acceptable or require a validation step.
- If you choose Firebase Storage, confirm `storageBucket` in `firebase-config.js` is the correct host (it may need the `appspot.com` domain).
- For production, prefer restricting product writes only to well-known admin UIDs rather than "any authenticated user".

---

## 10) Deliverable

- This plan was saved to: [PROJECT_PLAN.md](PROJECT_PLAN.md) in the repository root.

---

If you want, I can now:
- create the missing admin login markup in `admin.html` (small edit),
- generate a JSON seed file with 6 product entries you can import, or
- implement the Firebase Storage upload flow in the admin UI.

Which of the above would you like me to do next? (I will not write code until you confirm.)
