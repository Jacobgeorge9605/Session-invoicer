/* ics.js - Google Calendar (.ics) parser with recurrence expansion. Works in browser and Node. */
(function (root) {
    const FIX = {
        "Asia/Kolkata": 330,
        "Asia/Calcutta": 330,
        UTC: 0,
        "Etc/UTC": 0,
        GMT: 0,
    };
    const dtfs = {},
        offC = new Map();
    function offMin(ms, tz) {
        if (tz in FIX) return FIX[tz];
        const k = tz + "|" + Math.floor(ms / 36e5);
        if (offC.has(k)) return offC.get(k);
        let o = 0;
        try {
            const f =
                dtfs[tz] ||
                (dtfs[tz] = new Intl.DateTimeFormat("en-US", {
                    timeZone: tz,
                    hourCycle: "h23",
                    year: "numeric",
                    month: "numeric",
                    day: "numeric",
                    hour: "numeric",
                    minute: "numeric",
                    second: "numeric",
                }));
            const p = {};
            for (const x of f.formatToParts(ms)) p[x.type] = +x.value;
            o =
                (Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second) -
                    Math.floor(ms / 1000) * 1000) /
                6e4;
        } catch (e) {
            o = 330;
        }
        offC.set(k, o);
        return o;
    }
    function wallToUtc(y, mo, d, h, mi, tz) {
        const g = Date.UTC(y, mo - 1, d, h, mi);
        let o = offMin(g, tz),
            u = g - o * 6e4;
        const o2 = offMin(u, tz);
        if (o2 !== o) u = g - o2 * 6e4;
        return u;
    }
    function pdt(v, params, defTz) {
        const m = String(v)
            .trim()
            .match(/^(\d{4})(\d\d)(\d\d)(?:T(\d\d)(\d\d)(\d\d)?)?(Z?)$/);
        if (!m) return null;
        const y = +m[1],
            mo = +m[2],
            d = +m[3];
        if (m[4] === undefined) return { allday: true, u: Date.UTC(y, mo - 1, d) };
        const h = +m[4],
            mi = +m[5];
        if (m[7]) {
            const u = Date.UTC(y, mo - 1, d, h, mi),
                w = new Date(u + offMin(u, defTz) * 6e4);
            return {
                u,
                tz: defTz,
                y: w.getUTCFullYear(),
                mo: w.getUTCMonth() + 1,
                d: w.getUTCDate(),
                h: w.getUTCHours(),
                mi: w.getUTCMinutes(),
            };
        }
        const tz = params.TZID || defTz;
        return { u: wallToUtc(y, mo, d, h, mi, tz), tz, y, mo, d, h, mi };
    }
    function parseRule(s, tz) {
        const r = {};
        s.split(";").forEach((p) => {
            const i = p.indexOf("=");
            r[p.slice(0, i)] = p.slice(i + 1);
        });
        r.iv = +r.INTERVAL || 1;
        r.count = r.COUNT ? +r.COUNT : 0;
        if (r.UNTIL) {
            const m = r.UNTIL.match(
                /^(\d{4})(\d\d)(\d\d)(?:T(\d\d)(\d\d)(\d\d)?)?(Z?)$/,
            );
            if (m) {
                r.until =
                    m[4] === undefined
                        ? wallToUtc(+m[1], +m[2], +m[3], 23, 59, tz)
                        : m[7]
                            ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5])
                            : wallToUtc(+m[1], +m[2], +m[3], +m[4], +m[5], tz);
            }
        }
        const D = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
        r.wkst = D[r.WKST] !== undefined ? D[r.WKST] : 1;
        r.days = r.BYDAY
            ? r.BYDAY.split(",").map((x) => ({
                n: parseInt(x) || 0,
                d: D[x.slice(-2)],
            }))
            : null;
        return r;
    }
    function occurrences(m, horizon, stats) {
        const s = m.s,
            out = [];
        if (!m.rr) {
            out.push(s.u);
        } else {
            const r = m.rr,
                dn0 = Date.UTC(s.y, s.mo - 1, s.d) / 864e5,
                lim = Math.min(r.until !== undefined ? r.until : Infinity, horizon),
                limDn = Math.floor(lim / 864e5) + 2;
            const wk = (dn) => dn - ((((dn + 4) % 7) - r.wkst + 7) % 7),
                wk0 = wk(dn0);
            const set = r.days ? new Set(r.days.map((x) => x.d)) : null;
            if (
                (r.FREQ === "MONTHLY" && r.days && r.days.some((x) => x.n)) ||
                r.BYSETPOS
            ) {
                stats.unsupported++;
            }
            let cnt = 0;
            for (let dn = dn0; dn <= limDn; dn++) {
                const dt = new Date(dn * 864e5),
                    y = dt.getUTCFullYear(),
                    mo = dt.getUTCMonth() + 1,
                    d = dt.getUTCDate(),
                    dow = dt.getUTCDay();
                let ok = false;
                if (r.FREQ === "DAILY") ok = (dn - dn0) % r.iv === 0;
                else if (r.FREQ === "WEEKLY")
                    ok =
                        ((wk(dn) - wk0) / 7) % r.iv === 0 &&
                        (set ? set.has(dow) : dow === (dn0 + 4) % 7);
                else if (r.FREQ === "MONTHLY")
                    ok =
                        ((y - s.y) * 12 + mo - s.mo) % r.iv === 0 &&
                        (r.BYMONTHDAY
                            ? r.BYMONTHDAY.split(",").map(Number).includes(d)
                            : d === s.d);
                else if (r.FREQ === "YEARLY")
                    ok = (y - s.y) % r.iv === 0 && mo === s.mo && d === s.d;
                else {
                    if (dn === dn0) out.push(s.u);
                    stats.unsupported++;
                    break;
                }
                if (!ok) continue;
                if (r.count && ++cnt > r.count) break;
                const u = wallToUtc(y, mo, d, s.h, s.mi, s.tz);
                if (u > lim) break;
                out.push(u);
            }
        }
        for (const u of m.rd) out.push(u);
        return out;
    }
    function parseICS(text, opt) {
        opt = opt || {};
        const defTz = opt.tz || "Asia/Kolkata",
            horizon = opt.horizon || Date.now() + 90 * 864e5;
        const lines = text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/),
            masters = [],
            ovr = {},
            stats = {
                events: 0,
                recurring: 0,
                allday: 0,
                unsupported: 0,
                overrides: 0,
            };
        let cur = null;
        for (const ln of lines) {
            if (ln === "BEGIN:VEVENT") {
                cur = { ex: new Set(), rd: [] };
                continue;
            }
            if (ln === "END:VEVENT") {
                if (cur && cur.s) {
                    stats.events++;
                    if (cur.s.allday) stats.allday++;
                    else {
                        cur.dur =
                            cur.e && !cur.e.allday
                                ? Math.max(0, Math.round((cur.e.u - cur.s.u) / 6e4))
                                : cur.dur || 0;
                        if (cur.rid) {
                            stats.overrides++;
                            (ovr[cur.uid] = ovr[cur.uid] || []).push(cur);
                        } else masters.push(cur);
                    }
                }
                cur = null;
                continue;
            }
            if (!cur) continue;
            const i = ln.indexOf(":");
            if (i < 0) continue;
            const parts = ln.slice(0, i).split(";"),
                k = parts[0],
                params = {};
            parts.slice(1).forEach((p) => {
                const j = p.indexOf("=");
                params[p.slice(0, j)] = p.slice(j + 1).replace(/"/g, "");
            });
            const v = ln.slice(i + 1);
            if (k === "SUMMARY")
                cur.title = v
                    .replace(/\\n/gi, " ")
                    .replace(/\\([,;\\])/g, "$1")
                    .replace(/\s+/g, " ")
                    .trim();
            else if (k === "DTSTART") cur.s = pdt(v, params, defTz);
            else if (k === "DTEND") cur.e = pdt(v, params, defTz);
            else if (k === "DURATION") {
                const m = v.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/);
                if (m) cur.dur = (+m[1] || 0) * 1440 + (+m[2] || 0) * 60 + (+m[3] || 0);
            } else if (k === "UID") cur.uid = v;
            else if (k === "STATUS") cur.cancel = v === "CANCELLED";
            else if (k === "RRULE") cur.rrs = v;
            else if (k === "RECURRENCE-ID") cur.rid = pdt(v, params, defTz);
            else if (k === "EXDATE")
                v.split(",").forEach((x) => {
                    const t = pdt(x, params, defTz);
                    if (t) cur.ex.add(t.u);
                });
            else if (k === "RDATE")
                v.split(",").forEach((x) => {
                    const t = pdt(x, params, defTz);
                    if (t && !t.allday) cur.rd.push(t.u);
                });
        }
        const out = [],
            seen = new Set(),
            add = (u, dur, title) => {
                const key = u + "|" + title;
                if (seen.has(key)) return;
                seen.add(key);
                out.push({ start: u, dur, title: title || "(no title)" });
            };
        const usedO = new Set();
        for (const m of masters) {
            if (m.cancel) continue;
            if (m.rrs) {
                m.rr = parseRule(m.rrs, m.s.tz);
                stats.recurring++;
            }
            const ov = new Map();
            (ovr[m.uid] || []).forEach((o) => ov.set(o.rid.u, o));
            for (const u of occurrences(m, horizon, stats)) {
                if (m.ex.has(u)) continue;
                const o = ov.get(u);
                if (o) {
                    usedO.add(o);
                    if (!o.cancel) add(o.s.u, o.dur, o.title || m.title);
                } else add(u, m.dur, m.title);
            }
        }
        for (const uid in ovr)
            for (const o of ovr[uid])
                if (
                    !usedO.has(o) &&
                    !o.cancel &&
                    !masters.some((m) => m.uid === uid && !m.rrs && false)
                )
                    add(o.s.u, o.dur, o.title);
        out.sort((a, b) => a.start - b.start);
        return { events: out, stats };
    }
    const api = { parseICS, offMin, wallToUtc };
    if (typeof module !== "undefined") module.exports = api;
    else root.ICS = api;
})(typeof window !== "undefined" ? window : globalThis);
