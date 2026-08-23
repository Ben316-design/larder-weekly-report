# Larder weekly performance report

A secure, phone-first viewer for the single-sheet Larder weekly report. Everyone signs in with their email address, and the app only sends them the report sections their account is allowed to see.

## What each role can do

- **Viewer** — sees only the report-ending weeks, overview cards, report sections, headings, and figures selected for them. Each permitted report still includes its 13-week comparison.
- **Owner** — sees every section, can update the weekly report, and can manage Viewer accounts after confirming their own password.
- **Admin** — has the same full access, and can also create and manage Owner accounts.

Owners must confirm their own account password before publishing a report or changing people’s access. The confirmation expires after five minutes. Admins do not need to reconfirm.

## One-time Netlify setup

1. In Netlify, open **Project configuration → Identity** and select **Enable Identity**.
2. In **Identity → Registration preferences**, turn off public registrations. Accounts are then created from the app’s Admin Control Centre.
3. In **Project configuration → Environment variables**, add `INITIAL_ADMIN_EMAILS` with the email address you will use as the first Admin. Multiple Admin emails can be separated with commas.
4. In **Identity → Users**, invite the first user with that same email address. Open the invitation email and choose a strong password. Because the email is listed in `INITIAL_ADMIN_EMAILS`, that account becomes the initial Admin after signing in.
5. Deploy the `main` branch. Open the HTTPS Netlify address, sign in, then use **Report menu → Admin control centre** to add people and choose their permitted report dates, visible overview cards, sections, and individual figures. Each person’s card also has a **View …’s report** preview button.

You can remove the older `REPORT_UPDATE_KEY` environment variable after this version is deployed; it is no longer used.

## Weekly update workflow

1. Sign in as an Admin or Owner.
2. Choose **Update report** from the menu.
3. If you are an Owner, confirm your own account password.
4. Drop in the full Master Performance Sheet (`.xlsx`, `.xlsm`, or `.xls`) after selecting the current report-ending week in its **Generate Report** tab.

The app stores the report centrally and automatically refreshes open reports within one minute. The workbook must contain the **Generate Report** sheet (or have the report as its first sheet). On master-workbook uploads, the reader keeps only the source columns needed by the report and generates the selected 13-week report securely on demand. Viewers can be limited to the current report week, every available week, or a custom date range. Their card, section, heading, and figure selections apply consistently across every week they are allowed to open. Added or renamed report tables appear in the Admin Control Centre automatically; newly added fields start hidden for Viewers until you select them.

## Project files

- `app.js` — protected report interface and workbook reader.
- `netlify/functions/report.mjs` — serves a filtered report and publishes weekly uploads.
- `netlify/functions/auth.mjs` — verifies identity and sensitive-action confirmation.
- `netlify/functions/admin.mjs` — Admin Control Centre user and permission management.
- `netlify/functions/access.mjs` — stores section permissions and roles.

The weekly Excel file and exported report data are intentionally excluded from Git. This keeps the report behind authenticated access instead of publishing it as a static file.
