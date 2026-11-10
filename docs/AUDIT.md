# LUPIN WEAR — Phase 1 audit

Date: 2026-11-09. Sources: `LUPIN-Brand-Identity-and-Website-Prototype-v2.pdf` (all 33 pages rendered and inspected), `LUPIN — Cap Logo@2x.png`, master prompt v2.

## 1. Business summary

LUPIN ("LUPIN.") is an Egyptian clothing brand selling online at `https://lupinwear.store`, priced in EGP, delivering to all 27 governorates. Logo line: **STEAL THE LOOK** (Arabic: اسرق الأنظار). Supporting line: **BEYOND THE VISIBLE**. Voice: charming, confident, slightly mischievous; short sentences.

Approved changes that override the PDF:

| Topic | PDF shows | Approved |
|---|---|---|
| Logo | Old plain wordmark in header screenshots | Cap-integrated lockup `LUPIN — Cap Logo@2x.png` (2778×1630, off-white on black) everywhere |
| Payment provider | Mostly already "Paymob" in v2 | Paymob only; capabilities verified against live docs + merchant account before go-live |
| Scope | "A men's jacket label" | Men, Women, Kids; summer/winter; any category — data-driven |

## 2. Existing codebase

`D:\lupin` was **empty** (no files, no git repository). Nothing implemented, nothing to preserve. The clickable prototype referenced by the PDF was not supplied; screens are rebuilt from the PDF.

Local machine: Node 26 / npm 11 and Python present. **Git, Java, Maven, Docker were not installed.** Portable JDK 21, Maven and MinGit were placed in `%USERPROFILE%\.lupin-tools` (no admin rights, no system settings changed). Docker is not installed, see DECISIONS.md D-07.

## 3. Screens extracted from the PDF

Store: opening animation (p7) · home: announcement marquee, hero, department tiles, offers with countdown, promo-code cards with copy + uses left, collection grid (p7, p12) · shop: department tabs, category pills, search, sort, filters, cards with badge/price/saving/colour count (p13) · product: gallery per colour, swatches, size buttons with sold-out crossed, qty, Order now, Add to bag, favourite, share, accordions (p14) · bag + favourites + free-delivery hint (p15) · checkout details with delivery options, promo field, live receipt (p16) · receipt (p17) · payment method grid (p18) · cancel confirm + cancelled page with Undo (p19) · order confirmed (p20) · sign in / create account / phone code / social (p21) · my account: orders, favourites, details (p21) · Q&A search (p22) · policies with side nav (p22) · Arabic RTL (p23) · mobile (p24).

Dashboard: sign-in with lockout, overview KPIs + 14-day chart + orders by status + top products + latest orders (p25) · orders list/filter/search/CSV, order drawer with status, print, WhatsApp (p26) · products list + editor with colours, photos, sizes, live preview (p27) · departments & categories (p11) · offers & promo codes (p28) · delivery & payment (p29) · site content & policies (p30) · customers & ratings (p11) · Arabic (p31).

## 4. Inconsistencies and how each is handled

| # | Finding | Handling |
|---|---|---|
| 1 | PDF payment page (p18) has an on-site card number / CVC form and a "test mode 4242…" hint | **Not built.** Card data never touches our servers; card payments redirect to Paymob hosted checkout. |
| 2 | PDF says InstaPay next to gateway methods | Manual bank transfer with reference/proof and admin verification ("Verifying transfer" status in p26 matches this). |
| 3 | Order references are `SH-…` (left over from the earlier "SHADOW." brand) | Configurable prefix, default `LP-`. Owner to confirm. |
| 4 | Sign-in screens print demo credentials | Never shipped. No default passwords exist anywhere. |
| 5 | Dashboard "Site content" includes sign-in keys and payment server | Secrets live only in server env / secret manager. Dashboard shows *status* (configured / not configured), never values. |
| 6 | Admin signs in with "Username" | Email + password, same hardened auth, separate `/admin` area, MFA-ready. |
| 7 | "Opening animation … every visit" vs. "avoid delaying interaction" | Plays once per browser session, tap/Esc/any key skips, disabled under `prefers-reduced-motion`, footer "Replay intro" link (as in p21). |
| 8 | PDF statuses (Awaiting payment, Verifying transfer, Paid, Cash on delivery, Confirmed, Shipped, Delivered, Cancelled) mix payment and fulfilment | Two fields: `order_status` and `payment_status`; the dashboard filter chips are derived views. |
| 9 | Prices, fees (75 / 150 / free ≥ 5,000), codes (LUPIN15, WELCOME200, DUO10), reviews, customers, studio address, `orders@lupin.eg`, social handles | Demo data. Nothing hardcoded; delivery fees, thresholds and contact details are DB settings the owner fills in. Dev seed data is clearly marked and never loaded in production. |
| 10 | "Free size exchange for 14 days" appears as fact | Stored as a draft policy; policies are unpublished until the owner approves them. |
| 11 | Contact email domain `lupin.eg` ≠ site domain `lupinwear.store` | Owner to supply real contact details. |
| 12 | "Ratings & reviews" home section, but no review screen in the PDF | Reviews: verified-purchase only, moderated before display. |
| 13 | Product editor has one stock number per product | Stock is per variant (colour × size), as the master prompt requires. |
| 14 | Arabic slogan glyphs in the PDF text layer are garbled by extraction | Arabic copy typed fresh (اسرق الأنظار / ما وراء المرئي); owner to proof-read. |
| 15 | PDF next step: trademark check for "LUPIN" class 25 | Outside engineering scope; flagged as a launch risk. |

## 5. Requirements checklist

Legend: ☐ not started · ◐ in progress · ☑ done and verified. Live state is tracked in `IMPLEMENTATION_STATUS.md`; this is the scope list.

**Foundation** — repo layout, Docker Compose, Flyway, profiles (local/staging/prod), env examples, CI.
**Auth** — register, login, logout, refresh rotation + reuse detection, password reset, email verification, phone OTP (provider boundary), OAuth Google/Apple/Facebook (boundary; hidden until configured), lockout, rate limits, CSRF, RBAC (CUSTOMER / ADMIN / OWNER), admin MFA (TOTP).
**Catalog** — departments (active / coming soon / hidden), categories + subcategories, products, colours, sizes, variants, ≤10 images per colour, main colour/image, seasons/collections, size guide.
**Inventory** — per-variant stock, movements ledger, concurrency-safe reserve/release.
**Storefront** — every screen in §3, EN/AR, RTL, mobile first, SSR, SEO, accessibility.
**Cart & favourites** — guest bag in browser, server bag for members, merge on sign-in, server-validated quantities.
**Checkout & orders** — details → receipt → payment → done; server pricing; snapshots; cancel + undo window; tracking.
**Promotions** — automatic offers, promo codes, limits, per-customer limits, free delivery.
**Delivery** — governorates, zones, options, fees, estimates, threshold, pickup, shipment reference.
**Payments** — Paymob (hosted), COD, manual InstaPay; HMAC webhooks; idempotency; refunds.
**Admin** — every screen in §3 with real data, CSV export, print, audit log.
**Content** — settings, hero, announcement, sections, FAQ, policies (draft/published), all bilingual.
**Ops** — Dockerfile, Cloud Run, Workers, Neon, Cloudinary, backups + tested restore, monitoring, alerts.
**QA** — JUnit/Mockito/Testcontainers, Vitest/RTL, Playwright, security, a11y, performance.

## 6. Risks

1. **Paymob specifics are unverified.** Method availability, HMAC scheme and refund API depend on the merchant account. Integration is built behind an interface and stays "pending" until sandbox-tested.
2. **Free-tier limits.** Neon free compute suspends when idle (cold starts) and has storage/compute caps; Cloud Run needs a billing account even within its free tier; Cloudinary free credits cap storage + bandwidth. All quotas to be re-read at deploy time — nothing paid is created without approval.
3. **Cloud Run cold starts** for a JVM (several seconds) with scale-to-zero. Mitigations are documented; min-instances = 1 costs money and needs approval.
4. **No real product data, photos or approved policies yet** — launch blockers that code cannot remove.
5. **Legal** — Egyptian consumer-protection and data-protection (Law 151/2020) review has not happened. No compliance claims are made.
6. **SMS OTP and social sign-in** need paid/approved provider accounts.
7. **Single developer machine without Docker** — Testcontainers tests run in CI; locally the same tests run on an embedded PostgreSQL binary.
