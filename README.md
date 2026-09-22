# Corporate Ledger Manager

A single-page, offline-friendly tool for tracking corporate bookings, invoices, and payments across multiple corporate clients and currencies — with per-bill settlement tracking, downloadable PDF statements, and optional GitHub-based backup.

**Live demo (after you enable GitHub Pages — see below):** `https://<your-username>.github.io/<your-repo>/`

## Features

- **Multiple corporates** — add/edit/delete corporate clients with contact info.
- **Bookings** — record Bill Number, description, dates, pax, currency (INR/USD/AED/SGD/THB) and Invoice Amount per corporate.
- **Payments with allocation** — record a payment once and split it across one or more Bill Numbers (exactly like "USD 10,028 received against bill A and bill B"). Leftover, unallocated amounts are kept as an advance you can allocate later. An "Auto-allocate (oldest first)" button fills the oldest outstanding bills automatically.
- **Ledger** — per-corporate, per-currency view showing Invoiced / Received / Outstanding / Credit for every bill, with a clear **Settled / Partial / Outstanding / Overpaid** status badge.
- **Statements** — generate a downloadable PDF statement of account for any corporate (with your company letterhead), or preview it on screen first.
- **Data storage** — everything is stored locally in your browser (`localStorage`). No server, no database, no login required.
- **GitHub backup** — optionally connect a GitHub repository and personal access token to back up your data as a JSON file inside your repo (manually, or automatically after every change), and restore it on any device.

## Getting started (just using it)

Open `index.html` in any modern browser (Chrome, Edge, Firefox, Safari). That's it — no build step, no installation.

## Hosting this tool on GitHub Pages

1. Push this folder to a GitHub repository (see below for exact commands).
2. In the repo, go to **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**, pick the `main` branch and `/ (root)` folder, then **Save**.
4. After a minute, GitHub will show your live URL: `https://<your-username>.github.io/<your-repo>/`.

```bash
git init
git add .
git commit -m "Initial commit: Corporate Ledger Manager"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

## Setting up GitHub backup (inside the tool)

The tool can back up its data (`data/corporate-ledger-backup.json` by default) straight into your GitHub repo, so your data survives even if you clear your browser or switch computers.

1. On GitHub: **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. Scope it to **only this one repository**, and grant **Contents: Read and write** permission (nothing else).
3. Copy the generated token (starts with `github_pat_...`).
4. In the tool, go to **Settings & Backup → GitHub Hosting & Backup**, fill in your GitHub username, repository name, branch (`main`), and paste the token.
5. Click **Save Settings**, then **Backup Now**.
6. Optionally tick **Auto-backup after every change** so every add/edit/delete is pushed automatically.

Your token is stored only in your own browser's local storage. It is sent directly to `api.github.com` over HTTPS and nowhere else. Treat it like a password — don't share the browser profile, and revoke the token on GitHub if you ever suspect it leaked.

## Data model

All data lives in one JSON object (also what "Export JSON" downloads and what the GitHub backup file contains):

```json
{
  "corporates": [{ "id": "...", "name": "...", "code": "...", "contact": "...", "email": "...", "phone": "..." }],
  "bookings":   [{ "id": "...", "corporateId": "...", "billNumber": "...", "description": "...", "checkin": "YYYY-MM-DD", "checkout": "YYYY-MM-DD", "pax": "...", "currency": "USD", "invoiceAmount": 0, "salesPerson": "...", "invoiceDate": "YYYY-MM-DD" }],
  "payments":   [{ "id": "...", "corporateId": "...", "date": "YYYY-MM-DD", "currency": "USD", "totalAmount": 0, "notes": "...", "allocations": [{ "bookingId": "...", "amount": 0 }] }],
  "settings":   { "company": { "name": "", "address": "", "email": "", "phone": "" }, "github": { "owner": "", "repo": "", "branch": "main", "path": "data/corporate-ledger-backup.json", "autoBackup": false } }
}
```

A bill's **Balance** is always `invoiceAmount − (sum of all payment allocations pointing at that booking)`. A negative balance means the bill has been overpaid (shown as "Overpaid / Credit").

## Tech notes

- Pure HTML/CSS/vanilla JavaScript — no framework, no build tools.
- PDF generation uses [jsPDF](https://github.com/parallax/jsPDF) + [jspdf-autotable](https://github.com/simonbengtsson/jsPDF-AutoTable), vendored locally under `vendor/` so the tool works even without internet access once loaded.
- No backend: all logic runs in the browser. The only network calls are to `api.github.com`, and only when you click a backup/restore button (or have auto-backup enabled).

## File structure

```
index.html   — markup & styling
app.js       — all application logic (state, rendering, PDF, GitHub sync)
vendor/      — vendored jsPDF + autotable libraries
```
