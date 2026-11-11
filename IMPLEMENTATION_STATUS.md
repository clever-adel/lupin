# Implementation status

Last updated: 2026-11-10 (session 2). **Not production-ready** — see "Not started".

## Done and verified

| Area | What exists | How it was verified |
|---|---|---|
| Phase 1 audit | `docs/AUDIT.md`, `docs/ARCHITECTURE.md`, `docs/ERD.md`, `DECISIONS.md` | All 33 PDF pages rendered and read |
| Database | `V1__baseline_schema.sql` (all tables), `V2__reference_data.sql` (roles, permissions, 27 governorates, sizes, 3 departments, empty policy drafts, settings keys) | Applied by Flyway on PostgreSQL 18 in every test run |
| Backend foundation | Spring Boot 3.5.16, Java 21, Maven wrapper, profiles, one error format, health endpoint | Tests |
| Auth & security | Register, login, logout, logout-all, refresh rotation + reuse detection, Argon2id, HttpOnly SameSite=Lax cookies, CSRF double-submit, lockout, rate limits, RBAC, closed CORS, security headers, owner bootstrap from env | `AuthFlowIT` (11), `HttpSecurityIT` (3, real HTTP) |
| Catalog & inventory API | Departments, product list (filters, sort, pagination), facets, product detail, variant lookup for the bag; admin: department status, category, product with colours/photos/variants/stock, publish, stock adjust + movement ledger + audit log | `CatalogIT` (8) |
| Checkout backend (API only, no pages yet) | `V3__checkout_support.sql`; content read API (`/content/site`, published policies, FAQ); delivery (`/delivery/governorates`, `/delivery/options`, per-governorate fee and availability); server bag (`/cart`, merge of a guest bag); pricing engine (`POST /checkout/quote`: automatic promotions, promo codes with limits, free-delivery threshold); orders (`POST /orders` with atomic stock reservation, idempotency key, expected-total check; list, detail, cancel, undo) | `CheckoutIT` (8), incl. 8 simultaneous buyers for 3 pieces → exactly 3 orders |
| Checkout pages | Bag works for guests (this browser) and members (server bag; the guest bag moves into the account after sign-in); `/checkout` (details, delivery option, promo code, cash on delivery, server-computed summary); `/orders/:reference` (confirmation, items, totals, address, tracking, cancel with confirmation, undo); order list on `/account`; EN + AR | Browser run against the local API: add to bag → checkout → order `LP-10000` placed (EGP 11,060) → cancel → undo → shown in account; Arabic RTL and 375 px with no horizontal scroll |
| Payments | Cash on delivery (payment row per order); manual InstaPay (customer submits reference → staff confirm/reject via `/admin/payments/…`, audit-logged); Paymob boundary (`POST /orders/{ref}/payment/paymob` → hosted checkout address; `POST /payments/webhooks/paymob` with HMAC-SHA512 check, amount check, idempotent event log); automatic cancel of unpaid online orders; checkout shows only usable methods; order page shows what is left to pay | `PaymentIT` (5): forged, unsigned and tampered webhooks refused; wrong amount not paid; duplicate delivery applied once; redirect alone changes nothing; late payment on a cancelled order flagged for refund. InstaPay flow tried in the browser up to "checking your transfer". **Paymob itself was faked in tests — see below** |
| Staff side | Order workflow API (`/admin/orders`, `/admin/orders/{ref}`, `/admin/orders/{ref}/status`, `/admin/summary`): fixed transitions, stock deducted on shipment, cash recorded on delivery, staff cancel (paid orders flagged for refund), every change audit-logged; `/admin/products` (all statuses, stock per variant); `/admin/delivery/options` (create, edit, per-governorate fees); `/admin/settings` (validated; payment and checkout settings owner-only). Dashboard at `/admin` (English): orders with counts and search, order detail with next-step actions, transfers to check, products & stock, settings | `AdminIT` (5). Browser run as the local owner: confirmed a transfer, walked `LP-10000` from new to delivered, added stock, opened settings |
| Catalogue and content management | APIs: product detail + edit (`GET/PUT /admin/products/{id}`), offers and promo codes (`/admin/promotions`, `/admin/promotions/targets`), policies (draft by staff, publish / change-when-live / take down by owner only), questions & answers. Dashboard screens: new product (names, category, price, sizes, colours, first stock), edit product, Offers, Content (home headline, footer contact, policies, Q&A). Storefront: announcement bar, hero copy from settings, footer Help + Contact, `/policies/:slug`, `/faq` (with FAQ structured data), EN + AR | `ContentAdminIT` (4). Browser run as the local owner: created a product, a promo code, a question and a (demo-text) delivery policy through the forms and saw them on the storefront in English and Arabic |
| Hardening | `sitemap.xml` (public pages in EN + AR with hreflang) and `robots.txt` (private and staff pages disallowed; everything disallowed unless the site origin is `https://lupinwear.store`); Content-Security-Policy with a per-request script nonce (no `unsafe-inline` for scripts); guests no longer call `/auth/me` (readable `lw_s` marker cookie, no secret); one shared sign-in redirect for private pages | Playwright `e2e/store.e2e.ts` (5) against the running local stack; `e2e/csp.e2e.ts` (1) against the served production build |
| Accessibility and performance | Automated WCAG 2.1 A/AA scan (axe) of public, customer and staff pages in EN + AR; keyboard-only run (skip link, visible focus, focus moves to the new page's content, size choice and add to bag, sign-in tabs with arrow keys, focus on first invalid field); fixes: icon links named by content, proper tab semantics on sign-in, heading levels on the shop page, no text under 12 px. Fonts self-hosted (no third-party requests at all). `robots`/CSP unchanged | Playwright `e2e/a11y.e2e.ts` (5). Lighthouse 12 on the production build, mobile emulation, four pages: accessibility 100, best practices 100, performance 71–74, SEO 69 — see the two notes under "Built but not verified" |
| API locked to the storefront | The Worker adds a shared key (`X-Lupin-Edge-Key`) to every request it makes or forwards and strips any client-sent copy, `Forwarded` and `X-Forwarded-For`; the API refuses requests without the key (403) before anything else runs; health probes exempt; staging and production refuse to start without a key of 32+ characters | `EdgeKeyIT` (2). On the running local stack with the key on: direct API call → 403 (also with a guessed key or forged forwarded headers), through the storefront → 200, 10 browser tests pass |
| Staff accounts and admin fixes (session 3) | Staff land on the dashboard after sign-in and their account page links to it; Staff screen (owner adds admins/owners, switches them off and on, sets a new password); change-your-own-password for everyone; owner records a manual refund; offers are fully editable; staff requests re-check the account, its roles and a live session on every call, so a switched-off or re-keyed staff member is locked out at once | `StaffIT` (6) and `e2e/admin.e2e.ts` (9 scenarios covering every dashboard screen and button) |
| Test coverage (session 3) | Backend unit tests for pure logic (signature, Paymob configuration, slugs, discount percent, sort, staff workflow table, lockout); frontend unit tests for form rules, API client (CSRF, one refresh, errors), code-to-text mapping; browser tests for shop filters, product controls, guest bag, language switch, not-found pages, every sign-in/sign-up error, checkout validation | See test results below |
| Logo assets | Transparent lockup, mark, wordmark, favicon/app icon derived from the master PNG by `tools/derive-logo-assets.py` | Compared by eye with the original; cap on the I intact |
| Storefront | React Router 7.18 SSR on the Cloudflare Workers runtime, `/api` proxy, design tokens, EN + AR (RTL), opening animation, header/footer, home, shop (URL-driven filters, works without JS), product, bag + favourites, sign in / create account, account | Browser run against the local API: pages render, add to bag, server-priced bag, register → account, Arabic RTL, 375 px with no horizontal scroll |
| SEO basics | Per-page title/description, canonical, `hreflang`, Open Graph, Product + Breadcrumb JSON-LD, `noindex` on private/filtered pages | `seo.test.ts`; markup not yet run through a validator |

**Test results (actually run, 2026-11-10):**

**Latest full run (session 3, 2026-11-11):**

- `backend`: `./mvnw test` → **70 tests, 0 failures** (52 against a real PostgreSQL, 18 pure unit tests).
- `frontend` unit: `npx vitest run` → **42 tests, 0 failures**; `npx tsc` exit 0; `npm run build` succeeds.
- `frontend` browser: `run-e2e.ps1` → **26 passed** on a throwaway stack (fresh database, API :8090, storefront :5183), plus the production-build check `csp.e2e.ts` → **1 passed** against `vite preview`. 27 browser tests in total: 5 accessibility/keyboard, 9 dashboard, 5 store, 7 storefront, 1 production build.
- Bugs these tests found and that are now fixed: a changed password was not saved; a re-keyed staff member kept dashboard access until their token expired; a guest's bag could look empty at checkout right after sign-up; the "password changed" message was lost in a redirect.
- Still not covered by any automated test: the real Paymob round trip (no keys), email flows (none exist), the dashboard in Arabic (it has none), product photos (not built).

Earlier runs, kept for the record:

- `backend`: `./mvnw test` → 46 tests, 0 failures (session 2).
- `frontend`: `npx tsc` → exit 0 · `npx vitest run` → **13 tests, 0 failures** · `npm run build` → succeeds (session 2). 
- `frontend` browser tests, latest full run: `E2E_PREVIEW_URL=http://localhost:4173 npx playwright test` → **11 passed** (5 store, 5 accessibility/keyboard, 1 production-build policy and fonts). Earlier note: `npx playwright test` → 5 passed (needs the local API and `npm run dev` running; uses the local owner login for the staff test). `E2E_PREVIEW_URL=http://localhost:4173 npx playwright test csp` → **1 passed** against `npm run build` + `npx vite preview --port 4173`. They cover: sign-up, add to bag, cash checkout, cancel and undo, staff confirm and cancel, customers blocked from the dashboard, Arabic RTL at 375 px, guests redirected from private pages, sitemap and robots, CSP. Not covered by browser tests: InstaPay, promo codes, the dashboard forms (settings, products, offers, content).

## Source control

The work is committed locally on `main` (first commit `d8418b0`). The remote `origin` is `https://github.com/clever-adel/lupin.git` (public); `main` was first pushed on 2026-11-11. `D:\lupin` is still owned by a different Windows account ID, so git was told to trust it (`safe.directory D:/lupin` in the user's global git config, added with the owner's approval). The commit author is `cleve` with the owner's email, set for this repository only; change it with `git config user.name` if another name is wanted.

## Built but not verified

- **Paymob against the real service.** `HttpPaymobGateway` (the outbound "create intention" call), the hosted-checkout address and the webhook field layout are written from Paymob's public docs and have never talked to Paymob: there is no merchant account or test key yet. Before any real payment: put test keys in the environment, pay with a Paymob test card, and confirm the webhook arrives and verifies. Card / wallet / Fawry stay hidden until keys exist.
- The unpaid-order job's timer (`UnpaidOrderJob`) — its logic is tested, the 5-minute schedule itself is not, and on Cloud Run it needs an always-on instance or Cloud Scheduler.
- `backend/Dockerfile`, `docker-compose.yml`, `.github/workflows/ci.yml` — written, never executed (no Docker here, no GitHub repo yet).
- Swagger UI (springdoc 2.8.9) — not opened.
- CI (`.github/workflows/ci.yml`) runs on GitHub and passes as of commit `8b5be13` (2026-11-11): backend `./mvnw verify` with the integration tests on Testcontainers PostgreSQL 17, and frontend typecheck, unit tests and build. The browser tests are not part of CI yet; they run locally with `run-e2e.ps1`.
- **Real-world performance.** Lighthouse was run against the local preview server, which sends files uncompressed (Lighthouse itself reports ~330 KB that compression would save) and with simulated slow 4G: performance 71–74, first paint about 4.2–4.4 s, no layout shift, no blocking time. Cloudflare compresses automatically, so the deployed number should be better, but it has not been measured. Measure again after deployment.
- **Lighthouse SEO 69** is entirely the "page is blocked from indexing" check: `robots.txt` deliberately blocks everything unless the site origin is `https://lupinwear.store`. Not yet confirmed on the real domain.
- **Screen readers.** No pass with a real screen reader (NVDA, VoiceOver, TalkBack) has been done; the automated scan cannot judge reading order or whether announcements make sense, in either language.
- The dashboard's keyboard use was not tested beyond the automated scan.

## Not started

Favourites on the server · product photos (Cloudinary signed upload: nothing built yet, needs the account) · adding colours or sizes to an existing product · editing an existing offer beyond on/off · collections · staff accounts screen · reports · returns after shipment · saved addresses · WhatsApp button · refunds (manual for now; paid orders cannot be cancelled by the customer) · InstaPay proof-image upload · Cloudinary signed upload · reviews · the pages for offers, Q&A, policies · WhatsApp button (needs the owner's number) · password reset, email/phone verification, OAuth, admin MFA · the whole admin dashboard UI · sitemap.xml, robots.txt · Playwright E2E · deployment, DNS, backups, monitoring.

## Known gaps in what exists

1. Checkout is one page, not the PDF's four steps (details → receipt → payment → done); the confirmation is the order page. "Order now" from the PDF is still not on the product page. Guests must sign in before checkout.
2. Product photos are labelled placeholders; no image has been uploaded.
3. Hero shows only the approved brand lines; campaign copy comes with the content module.
4. (Fixed in session 2.) Guests made two failing auth requests per page.
5. (Fixed in session 2.) The backend trusted `X-Forwarded-*` from anyone. It now only answers requests carrying the Worker's key (D-48). At deployment the same random value must be set as `LUPIN_EDGE_SECRET` (API) and `EDGE_SHARED_SECRET` (Worker secret).
24. Locally the lock is on only if `frontend/.dev.vars` exists (git-ignored; created on this machine with a random key). The local API reads the key from that file. Delete the file to run without the lock.
6. (Fixed in session 2.) CSP allowed inline scripts. Styles still allow inline, and fonts still load from Google.
7. Rate limiting is per instance (D-24). Registration reveals existing emails (D-25).
8. Dev seed SQL is packaged in the jar (loaded only by the `local` profile).
9. Flyway warns that PostgreSQL 18 is newer than it was tested with; CI/Docker use PostgreSQL 17.
10. (Fixed in session 2.) Fonts came from Google Fonts; they are now self-hosted (D-45).
23. The local API keeps PostgreSQL's program files in `backend/.local-pg/` (git-ignored). They used to sit in the Windows temp folder, where part of them was removed while the server was running and every page hung. The backend test suite still extracts to the temp folder.
11. A promotion scoped to a parent category does not cover its sub-categories.
12. The per-line limit is the constant 10; the `maxQuantityPerLine` setting is not read yet.
13. The local demo seed adds two demo delivery options (60 / 120), turns COD on, and turns InstaPay on with a made-up address (`demo-not-real@instapay`); none of that exists outside the `local` profile.
17. The dashboard is English only and has no automated UI tests.
22. Each browser-test run leaves two `e2e-…@example.test` customers and one cancelled order in the local demo database.
20. The local demo database now holds test content made during verification: a "Demo Form Jacket" draft, promo code `DEMO10`, one demo question, a delivery policy with demo text, and a "Demo label" on the home headline. Delete `backend/.localdb` to start clean.
21. Policy and FAQ text is plain text (paragraphs only): no headings, lists or links.
18. Staff permissions are by role (ADMIN / OWNER); the finer permission codes in the database are not enforced yet. Admin MFA is not built. A staff member's role cannot be changed after creation (create a new account instead).
25. Browser tests run on their own stack: `powershell -ExecutionPolicy Bypass -File .\run-e2e.ps1` (optional filter, e.g. `admin`). It deletes and recreates `backend/.e2e-db` each time and never touches the everyday local data.
19. Local demo staff login: `owner@lupin.local`, password in the git-ignored file `backend/.local-owner-password` (random, generated on this machine; exists only in the local demo database).
16. The webhook and "start payment" paths lock rows in different orders; under a rare race PostgreSQL may abort one and Paymob retries the webhook.
14. Some server error texts are English only; the pages translate known error codes and fall back to a generic message.
15. Arabic dates use the numeric form (10/11/2026).

## Run it locally (no Docker needed)

```
# terminal 1 — API on :8080 with embedded PostgreSQL + demo data
cd backend
$env:JAVA_HOME="$env:USERPROFILE\.lupin-tools\jdk21"
.\mvnw.cmd spring-boot:test-run "-Dspring-boot.run.main-class=store.lupinwear.LocalDevServer"

# terminal 2 — storefront on :5173
cd frontend
npm run dev
```

If the API is stopped uncleanly and will not restart, delete `backend/.localdb` (demo data only).

## Next task

Remaining before deployment: a manual screen-reader pass; browser tests for the dashboard forms, InstaPay and promo codes; get CI running once a GitHub repository exists. Then deployment, followed by a Lighthouse run on the real domain (needs the owner's GitHub, Cloudflare, Google Cloud and Neon accounts). Blocked on accounts: product photos (Cloudinary), Paymob test-mode run, password reset and email verification (email provider).

## Waiting on the owner

See "Owner" column and "Open questions" in `DECISIONS.md`: order-reference prefix, undo window, header logo arrangement, policy texts, real delivery fees and contact details, Paymob / Cloudinary / email / SMS accounts, GitHub + Cloudflare + Google Cloud + Neon accounts.
