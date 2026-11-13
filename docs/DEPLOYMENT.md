# Going live: step by step

**Status: this guide has not been executed yet.** The commands are written from the providers'
documented tools; each phase ends with a check so a mistake shows up before the next phase.
Nothing here costs money by itself except where it says so.

What goes where:

| Part | Where | Cost |
|---|---|---|
| Database | Neon PostgreSQL | Free tier |
| Back end (Java API) | Render (free plan, no card) — or Google Cloud Run if you later add billing | Free; sleeps when idle (see Phase 2) |
| Storefront | Cloudflare Workers | Free tier |
| Domain `lupinwear.store` | Stays registered at Hostinger; its DNS moves to Cloudflare | Free |

Rules for the whole guide:

- Never paste a password, key or token into a chat or into a file in the project. Type them only into
  the provider's own page or terminal prompt.
- The domain is switched **last** (Phase 5). Until then the live address keeps showing what it shows today.

---

## Phase 1 — Database (Neon), about 5 minutes

1. Go to https://neon.tech, sign up, and create a project.
   - Name: `lupin`
   - PostgreSQL version: **17**
   - Region: **AWS Europe (Frankfurt)**
2. On the project dashboard press **Connect**. Switch **Connection pooling off** (the app keeps its own
   small pool and the database migrations need a direct connection).
3. Note three things for Phase 2 (keep the page open; do not paste them anywhere else):
   - **Host**, e.g. `ep-something-123456.eu-central-1.aws.neon.tech`
   - **User**, e.g. `neondb_owner`
   - **Password**
   - The database name is `neondb` unless you changed it.

Check: the Neon dashboard shows the project as **Active**.

---

## Phase 2 — Back end on Render (free, no card), about 15 minutes

What "free" means here, so there are no surprises:

- The back end **sleeps after 15 minutes without visitors**. The next visitor waits while it wakes:
  Render says about a minute; a Java application on the free plan's small CPU share can take longer.
  During that wait the store shows "not reachable".
- 512 MB of memory (the settings in `render.yaml` are sized and measured for it) and 750 hours a month.
- Render's own documentation says **not to run production applications on the free plan**. Use it to see
  the store live and to test. Before real customers depend on it, switch `plan` in `render.yaml` to a
  paid one, or move to Cloud Run.

Steps:

1. Go to https://render.com and sign up **with GitHub** (as `clever-adel`). No card is asked for.
2. Press **New → Blueprint**, connect the `clever-adel/lupin` repository when asked, and select it.
   Render reads `render.yaml` from the repository and shows one service, `lupin-api`.
3. Render asks for three values. Type them into Render's form only:
   - `DATABASE_URL` — Neon's connection string exactly as Neon shows it
     (`postgresql://user:password@host/neondb?sslmode=require`), with connection pooling switched
     off so the host has no `-pooler` in it. On this computer the same value is in `.env.local`
     (git-ignored) as `DATABASE_URL_UNPOOLED`; copy it from there with
     `(Get-Content D:\lupin\.env.local | Select-String '^DATABASE_URL_UNPOOLED=').Line.Split('=',2)[1].Trim('"') | Set-Clipboard`
   - `LUPIN_BOOTSTRAP_OWNER_EMAIL` — the email you will sign in to the dashboard with
   - `LUPIN_BOOTSTRAP_OWNER_PASSWORD` — a new password you choose, 12 characters or more
4. Press **Apply** (or **Deploy Blueprint**). The first build takes 10 to 15 minutes. When the service
   shows **Live**, copy its address from the top of the page, like `https://lupin-api-xxxx.onrender.com`.

Check, in your browser:

- `https://YOUR-RENDER-ADDRESS/actuator/health` shows `{"status":"UP"` …
- `https://YOUR-RENDER-ADDRESS/api/v1/catalog/departments` shows a short "FORBIDDEN" message. That is
  correct: the API refuses anything that does not come through the storefront.

If it does not go Live, open the service's **Logs** tab and send the last 30 lines (they contain no secrets).

For Phase 3 you need two things from Render:

- the service address (not a secret);
- the edge key: service → **Environment** → `LUPIN_EDGE_SECRET` → reveal and copy. You paste it once into
  a terminal prompt in Phase 3; do not put it anywhere else.

---

## Phase 2, alternative — Google Cloud Run (needs a billing account), about 20 minutes

Skip this if you used Render. Everything in this phase is typed into **Cloud Shell**, a terminal inside the Google Cloud website.
Nothing is installed on your computer.

1. Go to https://console.cloud.google.com, create a project named `lupin-store`, and attach a
   **billing account** to it when asked (Google requires this even for free-tier use).
2. Open **Cloud Shell** (the `>_` icon, top right) and run these one at a time.

```bash
gcloud config set project lupin-store
```

```bash
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com
```

3. Create the secrets. The first two are generated and stored without ever appearing on screen:

```bash
openssl rand -base64 48 | tr -d '\n' | gcloud secrets create lupin-jwt-secret --data-file=-
```

```bash
openssl rand -base64 48 | tr -d '\n=+/' | gcloud secrets create lupin-edge-secret --data-file=-
```

   The next two you type yourself. After each command, type the value, press Enter, then Ctrl+D.
   The database password is the one from Neon; the owner password is a new one you choose
   (12 characters or more) for your first staff login:

```bash
gcloud secrets create lupin-db-password --data-file=-
```

```bash
gcloud secrets create lupin-owner-password --data-file=-
```

4. Let Cloud Run read those secrets:

```bash
gcloud projects add-iam-policy-binding lupin-store --member="serviceAccount:$(gcloud projects describe lupin-store --format='value(projectNumber)')-compute@developer.gserviceaccount.com" --role=roles/secretmanager.secretAccessor
```

5. Get the code and deploy. Replace the three CAPITAL placeholders with your Neon host, Neon user and
   the email you want for the owner login:

```bash
git clone https://github.com/clever-adel/lupin.git && cd lupin/backend
```

```bash
gcloud run deploy lupin-api --source . --region europe-west1 --allow-unauthenticated --memory 1Gi --cpu 1 --min-instances 0 --max-instances 2 --set-env-vars "SPRING_PROFILES_ACTIVE=production,DATABASE_URL=jdbc:postgresql://NEON_HOST/neondb?sslmode=require,DATABASE_USERNAME=NEON_USER,DATABASE_POOL_SIZE=5,LUPIN_PUBLIC_BASE_URL=https://lupinwear.store,LUPIN_BOOTSTRAP_OWNER_EMAIL=YOUR_EMAIL" --set-secrets "DATABASE_PASSWORD=lupin-db-password:latest,LUPIN_JWT_SECRET=lupin-jwt-secret:latest,LUPIN_EDGE_SECRET=lupin-edge-secret:latest,LUPIN_BOOTSTRAP_OWNER_PASSWORD=lupin-owner-password:latest"
```

   The first build takes 5 to 10 minutes. At the end it prints a **Service URL** like
   `https://lupin-api-xxxxxxxx-ew.a.run.app`. Copy it; Phase 3 needs it.

Check (use your own Service URL):

```bash
curl -s https://YOUR-SERVICE-URL/actuator/health
```

It must answer `{"status":"UP"...}`. Then:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://YOUR-SERVICE-URL/api/v1/catalog/departments
```

It must answer **403**. That is correct: the API refuses anything that does not come through the storefront.

About `--min-instances 0`: it is free, but after the store has been idle the first visitor waits
about 15 to 25 seconds while the back end wakes up. `--min-instances 1` removes the wait and costs
roughly the price of a small always-on server each month. Decide before real launch; it can be changed
any time with `gcloud run services update lupin-api --region europe-west1 --min-instances 1`.

---

## Phase 3 — Storefront (Cloudflare Workers), about 15 minutes

This phase runs on your own computer, in PowerShell.

1. Sign up at https://dash.cloudflare.com.
2. Tell me the back end's address from Phase 2 (it is an address, not a secret). I put it into
   `frontend/wrangler.jsonc` as the production `API_ORIGIN` and commit it.
3. Sign in to Cloudflare from the terminal (a browser window opens; press Allow):

```bash
cd D:\lupin\frontend; npx wrangler login
```

4. Build and deploy (the build was checked with a dry run on 2026-11-11; the real upload has not been done):

```bash
$env:CLOUDFLARE_ENV="production"; npm run build; npx wrangler deploy
```

   It prints an address like `https://lupin-storefront-production.YOUR-NAME.workers.dev`.

5. Give the storefront the same edge key the API has. On Render it is the `LUPIN_EDGE_SECRET` value on
   the service's Environment page. (On Cloud Run: `gcloud secrets versions access latest --secret=lupin-edge-secret`.)

   In PowerShell, run the next command and paste that value when it asks. Until this is done
   the store shows "not reachable", because the API refuses the storefront:

```bash
npx wrangler secret put EDGE_SHARED_SECRET --name lupin-storefront-production
```

Check: open that address. The store appears, with **no products yet** (the live database starts
empty: no demo data). Open `/admin`, sign in with the owner email and the owner password from
Phase 2, and the dashboard opens.

---

## Phase 4 — First setup in the dashboard (before any customer sees it)

1. **Remove the bootstrap login settings** now that the owner exists. On Render: service →
   Environment → delete `LUPIN_BOOTSTRAP_OWNER_EMAIL` and `LUPIN_BOOTSTRAP_OWNER_PASSWORD` → Save.
   On Cloud Run (Cloud Shell):

```bash
gcloud run services update lupin-api --region europe-west1 --remove-env-vars LUPIN_BOOTSTRAP_OWNER_EMAIL --remove-secrets LUPIN_BOOTSTRAP_OWNER_PASSWORD
```

2. In `/admin`:
   - **Settings → Delivery options**: add your real delivery options and fees.
   - **Settings → Payment methods**: switch on cash on delivery and/or InstaPay (with your real
     InstaPay address). Card, wallet and Fawry stay off until Paymob is set up.
   - **Products & stock → New product**: add real products, then **Put on sale**. Photos are not
     available yet; products show a "Photo coming soon" panel.
   - **Content → Policies**: write and publish your real policies. **Content → Contact details**.
   - **Products & stock → Departments**: `Men`, `Women`, `Kids` all start as "coming soon". Press
     **Open Men** (and any other you sell) or customers will see no products at all.
3. Place a real test order yourself, end to end, and walk it to "delivered" in the dashboard.

### Bosta courier (optional, when you have a Bosta business account)

1. In Bosta's dashboard (business.bosta.co): **Settings → API integration → Create API key**, with
   Read/Write permission. Copy it there; never paste it into chat, email or this repository.
2. On Render: service `lupin-api` → **Environment**:
   - add `BOSTA_API_KEY` = the key from step 1;
   - check `BOSTA_WEBHOOK_SECRET` exists (the Blueprint generates it). If not, add one of 24+ random
     characters (any password generator);
   - `LUPIN_PUBLIC_BASE_URL` must be the address Bosta can reach. Until Phase 5 is done that is the
     workers.dev address (`https://lupin-storefront-production.lupinwear.workers.dev`), afterwards
     `https://lupinwear.store`. Bosta sends delivery updates to `<that address>/api/v1/shipping/webhooks/bosta`;
   - optional `BOSTA_BUSINESS_LOCATION_ID` if your Bosta account has more than one pickup location.
   - **Save, rebuild and deploy.**
3. In `/admin`, open an order that is **Being prepared**: the **Send with Bosta** box appears. Choose
   the district, check the cash to collect, send. The order becomes Shipped with Bosta's tracking number.
4. Book the pickup from Bosta's dashboard as usual.
5. First time only: check the delivery in Bosta's dashboard (address, phone, COD amount), and when Bosta
   updates it, check the order page shows the new courier status.

---

## Phase 5 — The domain (the moment the public address changes)

Do this only when Phase 4 looks right. It replaces whatever `lupinwear.store` shows today.

1. In Cloudflare: **Add a domain** → `lupinwear.store` → Free plan. Cloudflare shows two nameservers.
2. In Hostinger: Domains → `lupinwear.store` → **Nameservers** → Change → enter Cloudflare's two.
   This can take from minutes to a few hours.
3. When Cloudflare shows the domain as **Active**, tell me. I add the two addresses
   (`lupinwear.store` and `www.lupinwear.store`) to the storefront's configuration, you run the deploy
   command from Phase 3 step 4 again, and Cloudflare issues the HTTPS certificate automatically.
   `www.lupinwear.store` redirects to `lupinwear.store`.
4. In the Vercel project, remove the two `lupinwear.store` domains (or delete the project); it is not used.

Check: `https://lupinwear.store` shows the store with a padlock; `https://lupinwear.store/robots.txt`
lists the private pages and the sitemap (on any other address it says "Disallow: /" on purpose).

---

## After launch

- **Updates**: back end = `git pull` in Cloud Shell, then the `gcloud run deploy` command again;
  storefront = Phase 3 step 4.
- **Backups**: Neon keeps point-in-time history on the free plan for a short window only. Decide on a
  backup routine before taking real orders.
- **Not live yet**: card / wallet / Fawry (needs Paymob keys and a test-mode run), product photos
  (needs Cloudinary), password reset by email (needs an email provider), the unpaid-order clean-up
  timer (only runs while a back-end instance is awake).
