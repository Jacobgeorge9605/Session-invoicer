# Session Invoicer

Creates client invoices from your Google Calendar. Plain HTML, CSS and JavaScript, plus one small Vercel serverless function for live calendar sync.

## How billing works
- **One calendar event = one charge** (default 250), whatever its length or title.
- Cancelled sessions are deleted from the calendar, so they never appear on an invoice.
- Moved sessions, repeating sessions and skipped dates are handled correctly.
- One invoice per client or family. The calendar title identifies the client; spelling variants are grouped.
- The rate can be changed in Setup (default), per client, or on a single invoice.
- Invoices always use the latest calendar: the app re-syncs when opened and before invoicing.

## Files
| File | Purpose |
|---|---|
| `index.html`, `style.css` | Page and styling (phone and PC) |
| `app.js` | Sessions, clients, invoice, PDF, WhatsApp |
| `ics.js` | Calendar parser (recurring events, exceptions, time zones) |
| `api/calendar.js` | Vercel function: fetches your private calendar link, password protected |
| `vercel.json`, `package.json` | Vercel settings |

## Deploy
1. Push this folder to GitHub (the `.gitignore` already blocks `.ics` files; never commit calendar exports).
2. vercel.com > Add New > Project > import the repo > Deploy.
3. Enable live sync:
   - Google Calendar (on a PC) > Settings > click your work calendar > **Integrate calendar** > copy **Secret address in iCal format**.
   - Vercel > Project > Settings > Environment Variables, add:
     - `CALENDAR_ICS_URL` = the secret address you copied
     - `APP_PASSWORD` = a password you choose
   - Redeploy (Deployments > ... > Redeploy).
4. Open the site, tap Sync, enter the password once.

Treat the secret address like a password. Anyone who has it can read your calendar. If it leaks, reset it in Google Calendar.

## First-time setup
1. Setup tab: set your name, payment details and default rate.
2. Clients tab: review the suggested client groups, then Create.
3. Invoice tab: type a client name, pick a month, then PDF, WhatsApp or copy.

## Notes
- Clients and settings are stored in the browser; use Setup > Backup to move them between devices.
- Without live sync you can upload a `.ics` export in Setup instead.
- Run locally with `npx vercel dev` (the sync function needs Vercel).