// Vercel serverless function: fetches your private Google Calendar iCal link,
// keeps only the fields the app needs, and returns it. Protected by a password.
// Environment variables (set in Vercel > Project > Settings > Environment Variables):
//   CALENDAR_ICS_URL  = your "Secret address in iCal format"
//   APP_PASSWORD      = a password you choose
const KEEP = /^(BEGIN:VEVENT|END:VEVENT|DTSTART|DTEND|DURATION|RRULE|EXDATE|RDATE|RECURRENCE-ID|UID|STATUS|SUMMARY)[;:]?/;
module.exports = async (req, res) => {
  const url = process.env.CALENDAR_ICS_URL, pw = process.env.APP_PASSWORD;
  if (!url || !pw) { res.status(500).send('Set CALENDAR_ICS_URL and APP_PASSWORD in Vercel environment variables.'); return; }
  if (req.headers['x-app-password'] !== pw) { res.status(401).send('Wrong password'); return; }
  try {
    const r = await fetch(url);
    if (!r.ok) { res.status(502).send('Google returned ' + r.status); return; }
    const lines = (await r.text()).replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
    let inEv = false; const out = [];
    for (const l of lines) {
      if (l === 'BEGIN:VEVENT') inEv = true;
      if (inEv && KEEP.test(l)) out.push(l);
      if (l === 'END:VEVENT') inEv = false;
    }
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(out.join('\n'));
  } catch (e) { res.status(502).send('Could not fetch the calendar'); }
};