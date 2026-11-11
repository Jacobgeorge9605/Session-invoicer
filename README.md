# Session Invoicer

A simple web app for online teachers. Import your Google Calendar sessions, match messy client names to the right client, and generate invoices (PDF, WhatsApp text, copy/share) for any date range.

Built with plain HTML, CSS and JavaScript. There is no build step and no backend.

## Features
- Import sessions from a Google Calendar `.ics` export (re-import any time, no duplicates)
- Smart client matching: different spellings of the same client are treated as one
- Sessions table with filters by client, date range and title
- Invoice = number of sessions x rate, for any date range
- Download a PDF, send via WhatsApp, copy text, or use the phone share sheet
- Responsive: bottom tab bar and card-style lists on phones, full tables on PC
- Quick date presets (This month, Last month, Last 30 days)
- Backup and restore (download a .json file to move data between PC and phone)
- Works on PC and phone; data is stored in the browser (localStorage)

## Files
| File | Purpose |
|---|---|
| `index.html` | Page structure |
| `style.css` | Styling (light and dark mode) |
| `app.js` | All logic: import, matching, invoice, PDF |
| `vercel.json` | Vercel settings |

## Run locally
Open `index.html` in a browser, or run `npx serve .`

## How to use
1. Google Calendar > Settings > Import & export > Export, unzip, keep the `.ics` file.
2. Import tab: upload the `.ics` file and fill in your name and payment details.
3. Clients tab: add clients with a rate; assign any unmatched calendar names.
4. Invoice tab: choose client and dates, then download or share.

## Deploy
1. Push this folder to a GitHub repository.
2. On vercel.com choose Add New > Project, import the repository, leave all build settings empty and press Deploy.
3. Every `git push` to `main` redeploys automatically.

## Known limits
- Recurring calendar events count only their first date.
- Data lives in each browser separately (PC and phone do not sync).
- PDFs show "Rs." in place of the rupee symbol.
