# Grade Pilot — setup (do these once)

## 1. Publish the database rules  (REQUIRED — without this, nothing saves)
Firebase console → **Firestore Database → Rules** → delete everything → paste the contents of
`firestore.rules` → **Publish**.

## 2. Allow your website for Google sign-in
Firebase console → **Authentication → Settings → Authorized domains → Add domain**
Add your Vercel address (example: `your-app.vercel.app`) and any custom domain.

## 3. Put your bank name in
Open `js/config.js`, find `BANK_NAME: ""` and type your bank, e.g. `BANK_NAME: "Opay"`.
(Account name, number and WhatsApp number are already filled in.)

## 4. Upload to Vercel
Push this whole folder to your GitHub repo (replace the old files), Vercel redeploys on its own.
`vercel.json` makes `/admin` open the admin panel.

## 5. Try it
1. Open your site → sign in with Google → add a level and some courses → refresh the page. They stay.
2. Open `your-site/admin` → sign in with **augusdavik@gmail.com** → you'll see yourself in the list.
3. Click **+1 year** next to your own email → open Result Library → upload a photo → it saves to your account.

## How you give someone premium
1. They tap "I've paid" → their WhatsApp message arrives with their email.
2. Check your bank alert + screenshot.
3. Open `/admin` → find their email (it shows **paid?** in amber) → **+1 year**.
4. Tell them to open *Your account → Refresh my status* (it also updates when they reopen the app).
No code editing needed.

## Settings you can change (js/config.js)
Price, free file limit, premium per-semester limit, max file size, WhatsApp number, and
`REQUIRE_LOGIN` (set `false` to let people use the calculator without signing in).

## Free-plan limits to watch (Firebase Spark)
Database storage 1 GB, 50,000 reads/day, 20,000 writes/day. Photos are compressed (~450 KB) and
PDF/Word capped at 2 MB, so roughly 50+ active premium users fit. Check usage in
Firebase console → Firestore → Usage.
