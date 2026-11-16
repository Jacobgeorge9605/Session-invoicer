/* Session Invoicer - app logic. Calendar parsing: ics.js. Server: api/calendar.js (calendar), api/data.js (cloud storage) */
const KEY = "session-invoicer-v2",
  DEF = { cur: "₹", me: "", pay: "", tz: "Asia/Kolkata", rate: 250, pw: "" };
let S = {
  clients: [],
  map: {},
  set: { ...DEF },
  inv: 1,
  rows: [],
  titles: [],
  off: [],
  synced: 0,
  invoices: [],
  updated: 0,
};
try {
  const d = JSON.parse(localStorage.getItem(KEY) || "null");
  if (d) {
    S = Object.assign(S, d);
    S.set = { ...DEF, ...(d.set || {}) };
  }
} catch (e) {}
let tab = "sessions",
  F = { cl: "", from: "", to: "", q: "", n: 100, fut: false, pending: false },
  C = { q: "", min: 5, l: "", open: "", sug: undefined },
  H = { f: "all", q: "" },
  I = {
    cn: "",
    cid: "",
    mo: "",
    from: "",
    to: "",
    rate: "",
    no: "",
    note: "",
    sid: "",
  },
  msg = "",
  EV = [],
  CC = new Map(),
  GR = null,
  syncing = false,
  cloud = { on: false, base: 0, st: "", at: 0, busy: false };
const $ = (s) => document.querySelector(s),
  uid = () =>
    Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
const esc = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );
function save() {
  CC.clear();
  GR = null;
  try {
    localStorage.setItem(KEY, JSON.stringify(S));
  } catch (e) {
    msg = "⚠️ Browser storage is full. Download a backup from Setup.";
  }
}
function commit() {
  S.updated = Date.now();
  save();
  cloudPush();
}

/* ---------- dates (always in your chosen time zone) ---------- */
const MO = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ],
  p2 = (n) => String(n).padStart(2, "0");
const loc = (t) => new Date(t + ICS.offMin(t, S.set.tz) * 6e4);
const iso = (t) => {
  const d = loc(t);
  return (
    d.getUTCFullYear() +
    "-" +
    p2(d.getUTCMonth() + 1) +
    "-" +
    p2(d.getUTCDate())
  );
};
const fd = (t) => {
  const d = loc(t);
  return (
    p2(d.getUTCDate()) + " " + MO[d.getUTCMonth()] + " " + d.getUTCFullYear()
  );
};
const ft = (t) => {
  const d = loc(t);
  const h = d.getUTCHours();
  return (
    (h % 12 || 12) + ":" + p2(d.getUTCMinutes()) + " " + (h >= 12 ? "PM" : "AM")
  );
};
const fds = (s) =>
  s ? p2(+s.slice(8)) + " " + MO[+s.slice(5, 7) - 1] + " " + s.slice(0, 4) : "";
const addDay = (s, n) => {
  const d = new Date(
    Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10) + n),
  );
  return (
    d.getUTCFullYear() +
    "-" +
    p2(d.getUTCMonth() + 1) +
    "-" +
    p2(d.getUTCDate())
  );
};
const ymd = (y, m, d) => y + "-" + p2(m + 1) + "-" + p2(d);
const fdur = (m) =>
  m <= 0
    ? "—"
    : (
        (m >= 60 ? Math.floor(m / 60) + "h " : "") +
        (m % 60 ? (m % 60) + "m" : "")
      ).trim();
const money = (n) =>
  S.set.cur + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const ago = (t) => {
  if (!t) return "never";
  const m = Math.round((Date.now() - t) / 6e4);
  return m < 1
    ? "just now"
    : m < 60
      ? m + " min ago"
      : m < 1440
        ? Math.round(m / 60) + " h ago"
        : fd(t);
};

/* ---------- name matching ---------- */
const STOP = new Set(
  "session sessions class classes lesson lessons with online tutoring call meeting and the for mr mrs ms sir chechi chettan chetta aunty uncle madam mam maam sis bro".split(
    " ",
  ),
);
const norm = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9\u00c0-\uffff]+/g, " ")
    .split(" ")
    .filter((w) => w && !STOP.has(w))
    .join(" ");
function lev(a, b) {
  const m = a.length,
    n = b.length,
    d = Array.from({ length: m + 1 }, (_, i) => [i]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + (a[i - 1] == b[j - 1] ? 0 : 1),
      );
  return d[m][n];
}
function score(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const ta = a.split(" "),
    tb = b.split(" ");
  if (ta.every((t) => tb.includes(t)) || tb.every((t) => ta.includes(t)))
    return 0.9;
  if (Math.abs(a.length - b.length) > 0.2 * Math.max(a.length, b.length))
    return 0;
  const sa = ta.slice().sort().join(" "),
    sb = tb.slice().sort().join(" ");
  return Math.max(
    1 - lev(a, b) / Math.max(a.length, b.length),
    1 - lev(sa, sb) / Math.max(sa.length, sb.length),
  );
}
function clientOf(title) {
  const n = norm(title);
  if (CC.has(n)) return CC.get(n);
  let id = null;
  if (S.map[n] && S.clients.some((c) => c.id === S.map[n])) id = S.map[n];
  else {
    let best = 0;
    for (const c of S.clients)
      for (const nm of [c.name, ...(c.aliases || "").split(",")]) {
        const sc = score(n, norm(nm));
        if (sc > best) {
          best = sc;
          id = c.id;
        }
      }
    if (best < 0.8) id = null;
  }
  CC.set(n, id);
  return id;
}
const cl = (id) => S.clients.find((c) => c.id === id),
  effRate = (c) => (c && c.rate > 0 ? +c.rate : +S.set.rate || 0);

/* ---------- calendar data ---------- */
function buildEV() {
  const off = new Set(S.off);
  EV = S.rows.map((r) => {
    const t = S.titles[r[2]];
    return {
      id: r[0] + "|" + t,
      title: t,
      start: r[0],
      dur: r[1],
      day: iso(r[0]),
      off: off.has(r[0] + "|" + t),
    };
  });
  CC.clear();
  GR = null;
}
function loadICS(txt) {
  const { events } = ICS.parseICS(txt, { tz: S.set.tz });
  if (!events.length) {
    msg = "No events found in that calendar data.";
    return false;
  }
  const ti = new Map(),
    titles = [];
  S.rows = events.map((e) => {
    let i = ti.get(e.title);
    if (i === undefined) {
      i = titles.length;
      titles.push(e.title);
      ti.set(e.title, i);
    }
    return [e.start, e.dur, i];
  });
  S.titles = titles;
  S.synced = Date.now();
  save();
  buildEV();
  msg = `Loaded ${events.length} events from your calendar.`;
  return true;
}
async function sync(manual, retry) {
  if (syncing) return;
  syncing = true;
  render();
  try {
    const r = await fetch("/api/calendar", {
      cache: "no-store",
      headers: { "x-app-password": S.set.pw || "" },
    });
    if (r.status === 401) {
      if (!retry) {
        const p = prompt("Enter your access password");
        if (p) {
          S.set.pw = p;
          save();
          syncing = false;
          return sync(manual, true);
        }
      }
      msg = "Wrong or missing access password.";
    } else if (r.status === 404) {
      if (manual)
        msg =
          "Live sync is not set up on this site yet. See the README, or upload a .ics file in Setup.";
    } else if (!r.ok) {
      msg = "Sync failed: " + (await r.text()).slice(0, 150);
    } else loadICS(await r.text());
  } catch (e) {
    if (manual) msg = "Could not reach the sync service. Are you offline?";
  }
  syncing = false;
  render();
}
function importFile(f) {
  if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    loadICS(String(r.result));
    render();
  };
  r.readAsText(f);
}

/* ---------- cloud storage (clients, invoices, settings shared across devices) ---------- */
const payload = () => {
  const set = { ...S.set };
  delete set.pw;
  return {
    clients: S.clients,
    map: S.map,
    set,
    inv: S.inv,
    off: S.off,
    invoices: S.invoices,
    updated: S.updated,
  };
};
const mergeInv = (a, b) => {
  const m = new Map();
  [...(a || []), ...(b || [])].forEach((r) => {
    const o = m.get(r.id);
    if (!o || (r.mod || 0) > (o.mod || 0)) m.set(r.id, r);
  });
  return [...m.values()];
};
function adopt(d) {
  const mine = S.updated || 0;
  if (d.updated > mine) {
    S.clients = d.clients || [];
    S.map = d.map || {};
    S.set = { ...DEF, ...(d.set || {}), pw: S.set.pw };
    S.off = d.off || [];
  }
  S.inv = Math.max(d.inv || 1, S.inv);
  S.invoices = mergeInv(d.invoices, S.invoices);
  S.updated = Math.max(mine, d.updated || 0);
  cloud.base = d.updated || 0;
  save();
  buildEV();
}
let pt = null;
function cloudPush() {
  if (!cloud.on) return;
  clearTimeout(pt);
  pt = setTimeout(() => push(), 800);
}
async function push(retry) {
  try {
    const r = await fetch("/api/data", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "x-app-password": S.set.pw || "",
      },
      body: JSON.stringify({ data: payload(), base: cloud.base }),
    });
    if (r.status === 409) {
      const j = await r.json();
      if (!retry && j.current) {
        adopt(j.current);
        S.updated = Date.now();
        save();
        await push(true);
        render();
      }
      return;
    }
    if (r.ok) {
      const j = await r.json();
      cloud.base = j.updated;
      cloud.at = Date.now();
      cloud.st = "ok";
    } else cloud.st = "error";
  } catch (e) {
    cloud.st = "offline";
  }
  const s = $("#cst");
  if (s) s.textContent = cloudTxt();
}
async function cloudPull(retry) {
  if (cloud.busy) return;
  cloud.busy = true;
  try {
    const r = await fetch("/api/data", {
      cache: "no-store",
      headers: { "x-app-password": S.set.pw || "" },
    });
    if (r.status === 401) {
      cloud.st = "password";
      if (!retry) {
        const p = prompt("Enter your access password");
        if (p) {
          S.set.pw = p;
          save();
          cloud.busy = false;
          return cloudPull(true);
        }
      }
    } else if (r.status === 404 || r.status === 501) cloud.st = "off";
    else if (!r.ok) cloud.st = "error";
    else {
      const { data } = await r.json();
      cloud.on = true;
      cloud.st = "ok";
      cloud.at = Date.now();
      if (data) {
        const had = S.invoices.length,
          remoteN = (data.invoices || []).length;
        adopt(data);
        if (S.invoices.length > remoteN || S.updated > data.updated) {
          await push();
        }
      } else if (S.clients.length || S.invoices.length) {
        cloud.base = 0;
        S.updated = Date.now();
        save();
        await push();
      } else cloud.base = 0;
    }
  } catch (e) {
    cloud.st = "offline";
  }
  cloud.busy = false;
  render();
}
const cloudTxt = () =>
  ({
    ok: "☁ Connected · saved " + ago(cloud.at),
    off: "Not connected (storage not set up on the website yet)",
    password: "Wrong or missing password",
    offline: "Offline, will retry",
    error: "Error talking to storage",
  })[cloud.st] || "Checking…";
document.addEventListener("visibilitychange", () => {
  if (
    document.visibilityState === "visible" &&
    cloud.on &&
    Date.now() - cloud.at > 3e4
  )
    cloudPull();
});

/* ---------- layout ---------- */
const TABS = [
  ["sessions", "🗓", "Sessions"],
  ["clients", "👥", "Clients"],
  ["invoice", "🧾", "Invoice"],
  ["history", "📂", "History"],
  ["setup", "⚙️", "Setup"],
];
function go(t) {
  tab = t;
  msg = "";
  render();
  scrollTo(0, 0);
  if (t === "invoice" && Date.now() - S.synced > 12e4) sync(false);
}
function render() {
  $("#st").innerHTML =
    `<span class="mu">${syncing ? "Syncing…" : "Synced " + ago(S.synced)}${cloud.on ? " · ☁" : ""}</span> <button class="btn s sm" onclick="sync(true)">⟳ Sync</button>`;
  $("#nav").innerHTML = TABS.map(
    ([k, i, l]) =>
      `<button class="${tab === k ? "on" : ""}" onclick="go('${k}')"><span class="ic">${i}</span><span>${l}</span></button>`,
  ).join("");
  $("#v").innerHTML = {
    sessions: vSessions,
    clients: vClients,
    invoice: vInvoice,
    history: vHistory,
    setup: vSetup,
  }[tab]();
  if (tab === "invoice") drawInv();
  labelTables();
}
function labelTables() {
  document.querySelectorAll("table.rt").forEach((t) => {
    const h = [...t.querySelectorAll("th")].map((x) => x.textContent);
    t.querySelectorAll("tr").forEach((r) =>
      [...r.querySelectorAll("td")].forEach((c, i) =>
        c.setAttribute("data-label", h[i] || ""),
      ),
    );
  });
}
function keep(id) {
  const el = $("#" + id),
    p = el.selectionStart;
  render();
  const n = $("#" + id);
  n.focus();
  n.setSelectionRange(p, p);
}
const copts = (sel, all) =>
  (all ? `<option value="">${all}</option>` : "") +
  [...S.clients]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(
      (c) =>
        `<option value="${c.id}" ${sel === c.id ? "selected" : ""}>${esc(c.name)}</option>`,
    )
    .join("");

/* ---------- invoice history helpers ---------- */
const invs = () => S.invoices.filter((r) => !r.del);
const lastInv = (cid) =>
  invs()
    .filter((r) => r.cid === cid)
    .sort((a, b) => b.to.localeCompare(a.to) || b.created - a.created)[0];
function firstDay(cid) {
  for (const e of EV) {
    if (!e.off && clientOf(e.title) === cid) return e.day;
  }
  return "";
}
const pendFrom = (cid) => {
  const l = lastInv(cid);
  return l ? addDay(l.to, 1) : firstDay(cid);
};
const resetNo = () => {
  if (I.sid) {
    I.sid = "";
    I.no = "";
  }
};

/* ---------- date presets (Sessions and Invoice) ---------- */
function preset(o, k) {
  const n = loc(Date.now()),
    y = n.getUTCFullYear(),
    m = n.getUTCMonth(),
    today = iso(Date.now());
  if (o === I && (k === "hist" || k === "pend") && !I.cid) {
    alert("Choose a client first.");
    return;
  }
  if (o === F) F.pending = false;
  if (k === "thisMonth") {
    o.from = ymd(y, m, 1);
    o.to = ymd(y, m, new Date(y, m + 1, 0).getDate());
  } else if (k === "lastMonth") {
    const d = new Date(y, m - 1, 1);
    o.from = ymd(d.getFullYear(), d.getMonth(), 1);
    o.to = ymd(d.getFullYear(), d.getMonth(), new Date(y, m, 0).getDate());
  } else if (k === "last30") {
    o.from = iso(Date.now() - 29 * 864e5);
    o.to = today;
  } else if (k === "hist") {
    if (o === I) {
      o.from = firstDay(I.cid);
      o.to = today;
    } else {
      o.from = "";
      o.to = "";
      F.fut = false;
    }
  } else if (k === "pend") {
    if (o === I) {
      o.from = pendFrom(I.cid);
      o.to = today;
    } else {
      o.from = "";
      o.to = "";
      F.pending = true;
      F.fut = false;
    }
  } else {
    o.from = "";
    o.to = "";
  }
  if (o === I) {
    I.mo = k === "thisMonth" || k === "lastMonth" ? o.from.slice(0, 7) : "";
    resetNo();
  }
  if (o === F) F.n = 100;
  render();
}
const presets = (o) =>
  `<div class="pre">${[
    ["thisMonth", "This month"],
    ["lastMonth", "Last month"],
    ["last30", "Last 30 days"],
    ["hist", "All history"],
    ["pend", "Next pending"],
    ["all", "Clear"],
  ]
    .map(
      ([k, l]) =>
        `<button class="btn s sm" onclick="preset(${o},'${k}')">${l}</button>`,
    )
    .join("")}</div>`;

/* ---------- sessions ---------- */
function filt() {
  const now = Date.now(),
    LT = {};
  if (F.pending)
    invs().forEach((r) => {
      if (!LT[r.cid] || r.to > LT[r.cid]) LT[r.cid] = r.to;
    });
  return EV.filter((e) => {
    if (!F.fut && !F.to && e.start > now) return false;
    if (F.from && e.day < F.from) return false;
    if (F.to && e.day > F.to) return false;
    if (F.q && !e.title.toLowerCase().includes(F.q.toLowerCase())) return false;
    const c = clientOf(e.title);
    if (F.cl && (F.cl === "__none" ? c : c !== F.cl)) return false;
    if (F.pending && (!c || e.start > now || (LT[c] && e.day <= LT[c])))
      return false;
    return true;
  });
}
function vSessions() {
  if (!EV.length)
    return `<div class="card"><b>No calendar data yet.</b><p class="mu">${msg || "Tap ⟳ Sync, or upload a .ics file in Setup."}</p></div>`;
  const r = filt().reverse(),
    act = r.filter((e) => !e.off),
    shown = r.slice(0, F.n);
  return `<div class="card">${msg ? `<div class="warn">${esc(msg)}</div>` : ""}<div class="grid"><div><label>Client</label><select onchange="F.cl=this.value;F.n=100;render()">${copts(F.cl, "All clients")}<option value="__none" ${F.cl === "__none" ? "selected" : ""}>Not matched</option></select></div>
<div><label>From date</label><input type="date" value="${F.from}" onchange="F.from=this.value;F.pending=false;F.n=100;render()"></div><div><label>To date</label><input type="date" value="${F.to}" onchange="F.to=this.value;F.pending=false;F.n=100;render()"></div>
<div><label>Search title</label><input value="${esc(F.q)}" onchange="F.q=this.value;F.n=100;render()"></div></div>
<label class="chk"><input type="checkbox" ${F.fut ? "checked" : ""} onchange="F.fut=this.checked;F.n=100;render()">Include upcoming sessions (not yet taken)</label>${presets("F")}
${F.pending ? '<div class="info">Showing events that come <b>after each client’s last saved invoice</b> (not yet invoiced).</div>' : ""}
<p class="mu"><b>${act.length}</b> events${r.length > act.length ? ` (${r.length - act.length} excluded)` : ""}. Newest first, up to today. Untick "Count" to leave an event out.</p>
<div class="tw"><table class="rt"><tr><th>Count</th><th>Date</th><th>Time</th><th>Length</th><th>Client</th><th>Calendar title</th></tr>
${shown
  .map((e) => {
    const c = clientOf(e.title);
    return `<tr class="${e.off ? "off" : ""}"><td><input type="checkbox" class="cbx" ${e.off ? "" : "checked"} onchange="tog('${esc(e.id)}')"></td><td>${fd(e.start)}</td><td>${ft(e.start)}</td><td>${fdur(e.dur)}</td><td>${c ? esc(cl(c).name) : '<span class="mu">not matched</span>'}</td><td class="mu">${esc(e.title)}</td></tr>`;
  })
  .join("")}</table></div>
${r.length > shown.length ? `<div class="btns"><button class="btn s" onclick="F.n+=200;render()">Show 200 more (${r.length - shown.length} left)</button></div>` : ""}</div>`;
}
function tog(id) {
  const i = S.off.indexOf(id);
  i < 0 ? S.off.push(id) : S.off.splice(i, 1);
  commit();
  buildEV();
  render();
}

/* ---------- clients ---------- */
function groups() {
  if (GR) return GR;
  const T = new Map();
  for (const e of EV) {
    if (clientOf(e.title)) continue;
    const n = norm(e.title);
    let t = T.get(n);
    if (!t) {
      t = { n, c: 0, raw: new Map() };
      T.set(n, t);
    }
    t.c++;
    t.raw.set(e.title, (t.raw.get(e.title) || 0) + 1);
  }
  const G = [];
  for (const t of [...T.values()].sort((a, b) => b.c - a.c)) {
    let hit = null;
    for (const g of G) {
      if (g.m.some((m) => score(t.n, m.n) >= 0.8)) {
        hit = g;
        break;
      }
    }
    if (hit) {
      hit.m.push(t);
      hit.c += t.c;
    } else G.push({ m: [t], c: t.c });
  }
  G.forEach((g) => {
    let b = null,
      bc = 0;
    g.m.forEach((m) =>
      m.raw.forEach((c, r) => {
        if (c > bc) {
          bc = c;
          b = r;
        }
      }),
    );
    g.name = b.trim();
  });
  return (GR = G.sort((a, b) => b.c - a.c));
}
const visG = () =>
  groups().filter(
    (g) =>
      g.c >= C.min && (!C.l || g.name.trim().toLowerCase().startsWith(C.l)),
  );
function azbar() {
  const has = new Set(
    [...S.clients.map((c) => c.name), ...groups().map((g) => g.name)].map(
      (n) => n.trim()[0] && n.trim()[0].toLowerCase(),
    ),
  );
  return `<div class="az"><button class="btn s sm ${C.l ? "" : "on"}" onclick="C.l='';render()">All</button>${"abcdefghijklmnopqrstuvwxyz"
    .split("")
    .map(
      (l) =>
        `<button class="btn s sm ${C.l === l ? "on" : ""}" ${has.has(l) ? "" : "disabled"} onclick="C.l=C.l==='${l}'?'':'${l}';render()">${l.toUpperCase()}</button>`,
    )
    .join("")}</div>`;
}
const matchC = (c, q) => {
  q = q.trim().toLowerCase();
  if (!q) return true;
  const n = c.name.toLowerCase();
  return (
    n.startsWith(q) ||
    (q.length > 1 &&
      (n.includes(q) || (c.aliases || "").toLowerCase().includes(q)))
  );
};
function vClients() {
  const cnt = {};
  EV.forEach((e) => {
    if (e.off) return;
    const c = clientOf(e.title);
    if (c) cnt[c] = (cnt[c] || 0) + 1;
  });
  const G = visG(),
    list = S.clients
      .filter(
        (c) =>
          matchC(c, C.q) &&
          (!C.l || c.name.trim().toLowerCase().startsWith(C.l)),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  const sugOpen = C.sug === undefined ? !S.clients.length : C.sug;
  return `${msg ? `<div class="warn">${esc(msg)}</div>` : ""}
<div class="card"><label>Search clients</label><input id="csq" value="${esc(C.q)}" placeholder="Type a letter or name, e.g. M" oninput="C.q=this.value;keep('csq')">${azbar()}
<div class="btns" style="margin-top:8px"><button class="btn s sm" onclick="addClient()">+ Add client manually</button></div>
<p class="mu" style="margin:10px 0 0">Showing <b>${list.length}</b> of ${S.clients.length} clients. A single letter shows names that start with it.</p></div>
${
  G.length
    ? `<details class="card sug" ${sugOpen ? "open" : ""} ontoggle="C.sug=this.open"><summary><b>Suggested clients (${G.length})</b> <span class="mu">from your calendar, not created yet</span></summary>
<p class="mu">Similar calendar titles are already grouped. Edit a name if needed, untick anything that is not a client, then create. Typing the name of an existing client merges the group into it.</p>
<div class="grid"><div><label>Show groups with at least this many events</label><select onchange="C.min=+this.value;render()">${[1, 3, 5, 10, 25].map((n) => `<option ${C.min === n ? "selected" : ""}>${n}</option>`).join("")}</select></div></div>
<div class="btns" style="margin:10px 0"><button class="btn" onclick="createGroups()">Create selected clients</button><button class="btn s" onclick="document.querySelectorAll('.gc').forEach(x=>x.checked=!x.checked)">Toggle all</button></div>
${G.slice(0, 150)
  .map(
    (g, i) =>
      `<div class="g"><input type="checkbox" class="gc cbx" id="gc${i}" checked><div style="flex:1"><input id="gn${i}" value="${esc(g.name)}"><div class="mu">${g.c} events · ${g.m
        .slice(0, 4)
        .map(
          (m) =>
            `<span class="chip">${esc([...m.raw.keys()][0].trim())}</span>`,
        )
        .join(
          "",
        )}${g.m.length > 4 ? ` +${g.m.length - 4} more` : ""}</div></div></div>`,
  )
  .join("")}
${G.length > 150 ? `<p class="mu">Showing the 150 biggest groups. Create these, then the rest will appear.</p>` : ""}</details>`
    : ""
}
<div class="card" style="padding:4px 14px">${
    list
      .map((c) => {
        const li = lastInv(c.id);
        return `<details class="cl" ${C.open === c.id ? "open" : ""} ontoggle="if(this.open)C.open='${c.id}'"><summary><span class="nm">${esc(c.name)}</span><span class="mu">${cnt[c.id] || 0} events · ${money(effRate(c))}${li ? " · last invoiced to " + fds(li.to) : ""}</span></summary>
<div class="grid"><div class="s2"><label>Name</label><input value="${esc(c.name)}" onchange="upd('${c.id}','name',this.value)"></div><div><label>Rate / event</label><input type="number" inputmode="decimal" value="${c.rate > 0 ? c.rate : ""}" placeholder="${S.set.rate}" onchange="upd('${c.id}','rate',+this.value)"></div></div>
<label>Other names in calendar (comma-separated)</label><input value="${esc(c.aliases || "")}" onchange="upd('${c.id}','aliases',this.value)">
<div class="btns"><button class="btn s sm" onclick="F.cl='${c.id}';F.n=100;go('sessions')">View sessions</button><button class="btn s sm" onclick="pickId('${c.id}');go('invoice')">Make invoice</button><button class="btn d" onclick="if(confirm('Delete this client?')){S.clients=S.clients.filter(x=>x.id!=='${c.id}');commit();render()}">Delete</button></div></details>`;
      })
      .join("") || '<p class="mu" style="padding:10px 0">No clients match.</p>'
  }</div>`;
}
function createGroups() {
  const G = visG().slice(0, 150);
  let n = 0;
  G.forEach((g, i) => {
    if (!$("#gc" + i).checked) return;
    const name = $("#gn" + i).value.trim();
    if (!name) return;
    let c = S.clients.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (!c) {
      c = { id: uid(), name, rate: 0, aliases: "" };
      S.clients.push(c);
      n++;
    }
    c.aliases = [
      ...new Set([
        ...(c.aliases ? c.aliases.split(",").map((s) => s.trim()) : []),
        ...g.m.flatMap((m) => [...m.raw.keys()].map((s) => s.trim())),
      ]),
    ]
      .filter((s) => s && s.toLowerCase() !== c.name.toLowerCase())
      .join(", ");
    g.m.forEach((m) => (S.map[m.n] = c.id));
  });
  commit();
  msg = `Created ${n} clients. Set a different rate on any client if needed; the rest use ${money(S.set.rate)}.`;
  render();
}
function addClient() {
  const n = prompt("Client name?");
  if (!n) return;
  S.clients.push({ id: uid(), name: n.trim(), rate: 0, aliases: "" });
  commit();
  C.q = n.trim();
  render();
}
function upd(id, k, v) {
  cl(id)[k] = v;
  commit();
  render();
}

/* ---------- invoice ---------- */
function cbShow(q) {
  const b = $("#cb");
  if (!b) return;
  q = q.trim().toLowerCase();
  const all = [...S.clients].sort((a, b) => a.name.localeCompare(b.name));
  const w = (n) =>
    n
      .toLowerCase()
      .split(/\s+/)
      .some((x) => x.startsWith(q));
  const m = q
    ? [
        ...all.filter((c) => c.name.toLowerCase().startsWith(q)),
        ...all.filter((c) => !c.name.toLowerCase().startsWith(q) && w(c.name)),
      ]
    : all;
  b.innerHTML =
    m
      .slice(0, 60)
      .map(
        (c) =>
          `<div class="cbi" onpointerdown="pickId('${c.id}');render()">${esc(c.name)}</div>`,
      )
      .join("") +
      (m.length > 60
        ? `<div class="cbi mu">…${m.length - 60} more, keep typing</div>`
        : "") || '<div class="cbi mu">No client found</div>';
  b.hidden = false;
}
const cbHide = () => {
  const b = $("#cb");
  if (b) b.hidden = true;
};
function pickId(id) {
  const c = cl(id);
  I.cid = id;
  I.cn = c ? c.name : "";
  I.rate = "";
  I.from = "";
  I.to = "";
  I.mo = "";
  I.sid = "";
  I.no = "";
}
function pickClient(v) {
  const c = S.clients.find(
    (x) => x.name.toLowerCase() === v.trim().toLowerCase(),
  );
  if (c && c.id !== I.cid) {
    pickId(c.id);
    render();
  } else if (!c) {
    I.cn = v;
    I.cid = "";
    drawInv();
  }
}
function setMonth(v) {
  I.mo = v;
  resetNo();
  if (v) {
    const [y, m] = v.split("-").map(Number);
    I.from = ymd(y, m - 1, 1);
    I.to = ymd(y, m - 1, new Date(y, m, 0).getDate());
  }
  render();
}
function lastBox(c) {
  const l = lastInv(c.id);
  return l
    ? `<div class="info"><div><b>Last invoice:</b> ${esc(l.no)} · ${fds(l.from)} to ${fds(l.to)} · ${money(l.amt)} · <span class="tag ${l.paid ? "ok" : "wait"}">${l.paid ? "Paid" : "Pending"}</span></div><div style="margin-top:6px"><b>Next period starts:</b> ${fds(addDay(l.to, 1))} <button class="btn s sm" style="margin-left:8px" onclick="preset(I,'pend')">Use next period</button></div></div>`
    : `<div class="info">No saved invoices for <b>${esc(c.name)}</b> yet. First event: ${fds(firstDay(c.id)) || "none found"}. <button class="btn s sm" style="margin-left:8px" onclick="preset(I,'hist')">Use all history</button></div>`;
}
function vInvoice() {
  if (!S.clients.length)
    return `<div class="card">Create your clients first (Clients tab).</div>`;
  if (!I.no) I.no = "INV-" + String(S.inv).padStart(4, "0");
  const c = cl(I.cid);
  return `<div class="card"><h2>Create invoice</h2><div class="grid"><div class="s2"><label>Client / family</label><div class="cbw"><input id="cin" autocomplete="off" placeholder="Type a letter or name…" value="${esc(I.cn)}" oninput="cbShow(this.value)" onfocus="cbShow(this.value)" onblur="setTimeout(cbHide,250)" onchange="pickClient(this.value)"><div id="cb" class="cb" hidden></div></div></div>
<div><label>Invoice no.</label><input value="${esc(I.no)}" onchange="I.no=this.value;drawInv()"></div></div>
${c ? lastBox(c) : ""}
<div class="grid" style="margin-top:6px"><div><label>Month</label><input type="month" value="${I.mo}" onchange="setMonth(this.value)"></div><div><label>From date</label><input type="date" value="${I.from}" onchange="I.from=this.value;I.mo='';resetNo();drawInv()"></div><div><label>To date (included)</label><input type="date" value="${I.to}" onchange="I.to=this.value;I.mo='';resetNo();drawInv()"></div>
<div><label>Rate per event</label><input type="number" inputmode="decimal" value="${I.rate}" placeholder="${effRate(c)}" onchange="I.rate=this.value;drawInv()"></div></div>
${presets("I")}<label>Extra note (optional)</label><input value="${esc(I.note)}" onchange="I.note=this.value;drawInv()" placeholder="e.g. Please pay by the 10th"></div><div id="inv"></div>`;
}
function build() {
  const c = cl(I.cid);
  if (!c || !I.from || !I.to) return null;
  const ev = EV.filter(
      (e) =>
        !e.off &&
        e.day >= I.from &&
        e.day <= I.to &&
        clientOf(e.title) === c.id,
    ),
    rate = I.rate !== "" ? +I.rate : effRate(c);
  return { c, ev, n: ev.length, rate, amt: ev.length * rate };
}
function lines(d) {
  const L = ["INVOICE " + I.no];
  if (S.set.me) L.push("From: " + S.set.me);
  L.push(
    "To: " + d.c.name,
    "Date: " + fd(Date.now()),
    `Period: ${fds(I.from)} to ${fds(I.to)}`,
    "",
    "Events:",
  );
  d.ev.forEach((e, i) =>
    L.push(`${i + 1}. ${fd(e.start)}, ${ft(e.start)} (${fdur(e.dur)})`),
  );
  L.push(
    "",
    `Total events: ${d.n}`,
    `Rate: ${money(d.rate)} per event`,
    `AMOUNT DUE: ${money(d.amt)}`,
  );
  if (I.note) L.push("", I.note);
  if (S.set.pay) L.push("", "Payment details:", S.set.pay);
  L.push("", "Thank you!");
  return L;
}
function saveInv() {
  const d = build();
  if (!d || !d.n) return null;
  let r = S.invoices.find((x) => x.id === I.sid);
  if (!r) {
    r = {
      id: uid(),
      cid: d.c.id,
      paid: false,
      paidOn: "",
      created: Date.now(),
    };
    S.invoices.push(r);
    I.sid = r.id;
    S.inv = Math.max(
      S.inv,
      (parseInt(String(I.no).replace(/\D/g, "")) || 0) + 1,
    );
  }
  Object.assign(r, {
    no: I.no,
    cn: d.c.name,
    from: I.from,
    to: I.to,
    n: d.n,
    rate: d.rate,
    amt: d.amt,
    note: I.note,
    mod: Date.now(),
    del: false,
  });
  commit();
  return r;
}
const auto = () => {
  if (!I.sid && build() && build().n) {
    saveInv();
    drawInv();
  }
};
function togglePaid(id) {
  const r = S.invoices.find((x) => x.id === id);
  if (!r) return;
  r.paid = !r.paid;
  r.paidOn = r.paid ? iso(Date.now()) : "";
  r.mod = Date.now();
  commit();
  render();
}
function drawInv() {
  const el = $("#inv");
  if (!el) return;
  const d = build();
  if (!d) {
    el.innerHTML = `<div class="card mu">${I.cn && !I.cid ? "No client with that name. Pick one from the list." : "Choose a client and a period to see the invoice."}</div>`;
    return;
  }
  if (I.from > I.to) {
    el.innerHTML = `<div class="card">Nothing pending: everything up to <b>${fds(addDay(I.from, -1))}</b> is already invoiced.</div>`;
    return;
  }
  if (!d.n) {
    el.innerHTML =
      '<div class="card">No events for this client in that period.</div>';
    return;
  }
  const saved = S.invoices.find((r) => r.id === I.sid && !r.del),
    ov = invs().filter(
      (r) =>
        r.cid === d.c.id && r.id !== I.sid && r.from <= I.to && r.to >= I.from,
    ),
    un = EV.filter(
      (e) => !e.off && e.day >= I.from && e.day <= I.to && !clientOf(e.title),
    ).length;
  el.innerHTML = `<div class="card">${un ? `<div class="warn">${un} events in this period are not matched to any client, so they are not included. Check the Clients tab.</div>` : ""}
${ov.length ? `<div class="warn">⚠️ These dates overlap an earlier invoice: ${ov.map((r) => `${esc(r.no)} (${fds(r.from)} to ${fds(r.to)})`).join(", ")}. Some sessions may be billed twice.</div>` : ""}
<div class="tw"><table class="rt"><tr><th>#</th><th>Date</th><th>Time</th><th>Length</th></tr>${d.ev.map((e, i) => `<tr><td>${i + 1}</td><td>${fd(e.start)}</td><td>${ft(e.start)}</td><td>${fdur(e.dur)}</td></tr>`).join("")}</table></div>
<p>${d.n} events × ${money(d.rate)} = <span class="tot">${money(d.amt)}</span></p><p class="mu">Calendar last synced ${ago(S.synced)}.</p>
${
  saved
    ? `<div class="info">✓ Saved in History as <b>${esc(saved.no)}</b> · <span class="tag ${saved.paid ? "ok" : "wait"}">${saved.paid ? "Paid" : "Pending"}</span> <button class="btn s sm" style="margin-left:8px" onclick="togglePaid('${saved.id}')">${saved.paid ? "Undo paid" : "✓ Mark as paid"}</button>
${saved.n !== d.n || saved.rate !== d.rate ? `<div style="margin-top:6px">The calendar now gives ${d.n} events / ${money(d.amt)} (saved: ${saved.n} / ${money(saved.amt)}). <button class="btn s sm" onclick="saveInv();drawInv()">Update saved invoice</button></div>` : ""}</div>`
    : ""
}
<details><summary class="mu">Text version</summary><pre id="txt">${esc(lines(d).join("\n"))}</pre></details>
<div class="btns"><button class="btn" onclick="pdf()">⬇ Download PDF</button><button class="btn wa" onclick="wa()">WhatsApp</button><button class="btn s" onclick="cp()">Copy text</button><button class="btn s" onclick="shr()">Share…</button>${saved ? "" : '<button class="btn s" onclick="saveInv();drawInv()">💾 Save to history</button>'}</div>
<p class="mu" id="fb">${saved ? "" : "Sending an invoice also saves it in History."}</p></div>`;
  labelTables();
}
const fb = (t) => {
    const e = $("#fb");
    if (e) e.textContent = t;
  },
  txt = () => lines(build()).join("\n");
function wa() {
  auto();
  window.open("https://wa.me/?text=" + encodeURIComponent(txt()), "_blank");
}
async function cp() {
  auto();
  try {
    await navigator.clipboard.writeText(txt());
    fb("Copied. Paste it anywhere.");
  } catch (e) {
    fb("Select the text version above and copy it.");
  }
}
async function shr() {
  auto();
  if (navigator.share) {
    try {
      await navigator.share({ title: "Invoice " + I.no, text: txt() });
    } catch (e) {}
  } else cp();
}
async function pdf() {
  const d = build();
  if (!window.jspdf) {
    fb("PDF library did not load. Use Copy text instead.");
    return;
  }
  auto();
  const doc = new window.jspdf.jsPDF({ unit: "mm", format: "a4" }),
    cur = S.set.cur.replace("₹", "Rs. "),
    m = (v) =>
      cur + Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 });
  let y = 22;
  const W = 210,
    nl = (h) => {
      y += h;
      if (y > 275) {
        doc.addPage();
        y = 20;
      }
    };
  doc.setFontSize(22).setFont("helvetica", "bold").text("INVOICE", 20, y);
  doc
    .setFontSize(11)
    .setFont("helvetica", "normal")
    .text(I.no, W - 20, y, { align: "right" });
  nl(10);
  if (S.set.me) {
    doc.setFont("helvetica", "bold").text(S.set.me, 20, y);
    doc.setFont("helvetica", "normal");
    nl(6);
  }
  doc.text("Billed to: " + d.c.name, 20, y);
  doc.text("Date: " + fd(Date.now()), W - 20, y, { align: "right" });
  nl(6);
  doc.text(`Period: ${fds(I.from)} to ${fds(I.to)}`, 20, y);
  nl(10);
  const head = () => {
    doc.setFillColor(15, 118, 110).rect(20, y - 5, W - 40, 8, "F");
    doc.setTextColor(255).setFont("helvetica", "bold");
    doc.text("#", 23, y);
    doc.text("Date", 35, y);
    doc.text("Time", 85, y);
    doc.text("Length", 125, y);
    doc.text("Amount", W - 23, y, { align: "right" });
    doc.setTextColor(0).setFont("helvetica", "normal");
    nl(9);
  };
  head();
  d.ev.forEach((e, i) => {
    if (y > 268) {
      doc.addPage();
      y = 20;
      head();
    }
    doc.text(String(i + 1), 23, y);
    doc.text(fd(e.start), 35, y);
    doc.text(ft(e.start), 85, y);
    doc.text(fdur(e.dur), 125, y);
    doc.text(m(d.rate), W - 23, y, { align: "right" });
    doc.setDrawColor(220).line(20, y + 2, W - 20, y + 2);
    nl(7);
  });
  nl(4);
  doc.setFont("helvetica", "bold").setFontSize(12);
  doc.text(`${d.n} events x ${m(d.rate)}`, 20, y);
  doc.text("Amount due: " + m(d.amt), W - 20, y, { align: "right" });
  nl(12);
  doc.setFont("helvetica", "normal").setFontSize(10);
  if (I.note) {
    doc.text(doc.splitTextToSize(I.note, W - 40), 20, y);
    nl(8);
  }
  if (S.set.pay) {
    doc.setFont("helvetica", "bold").text("Payment details", 20, y);
    nl(6);
    doc.setFont("helvetica", "normal");
    doc.splitTextToSize(S.set.pay, W - 40).forEach((l) => {
      doc.text(l, 20, y);
      nl(5);
    });
  }
  nl(6);
  doc.text("Thank you!", 20, y);
  const blob = doc.output("blob"),
    fn = `${I.no}-${d.c.name.replace(/\W+/g, "_")}.pdf`;
  try {
    const f = new File([blob], fn, { type: "application/pdf" });
    if (
      navigator.canShare &&
      navigator.canShare({ files: [f] }) &&
      /Android|iPhone|iPad/i.test(navigator.userAgent)
    ) {
      await navigator.share({ files: [f], title: fn });
      return;
    }
  } catch (e) {}
  try {
    const u = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = u;
    a.download = fn;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 4000);
    fb("PDF downloaded.");
  } catch (e) {
    fb("Could not save the PDF. Use WhatsApp or Copy text.");
  }
}

/* ---------- history (paid / pending) ---------- */
function openInv(id) {
  const r = S.invoices.find((x) => x.id === id);
  if (!r) return;
  const c = cl(r.cid);
  I = {
    cn: c ? c.name : r.cn,
    cid: r.cid,
    mo: "",
    from: r.from,
    to: r.to,
    rate: String(r.rate),
    no: r.no,
    note: r.note || "",
    sid: r.id,
  };
  go("invoice");
}
function delInv(id) {
  if (!confirm("Delete this invoice from history?")) return;
  const r = S.invoices.find((x) => x.id === id);
  r.del = true;
  r.mod = Date.now();
  commit();
  render();
}
function vHistory() {
  const all = invs().sort(
      (a, b) => b.to.localeCompare(a.to) || b.created - a.created,
    ),
    q = H.q.trim().toLowerCase();
  const byQ = all.filter(
      (r) =>
        !q ||
        r.cn.toLowerCase().startsWith(q) ||
        (q.length > 1 && r.cn.toLowerCase().includes(q)),
    ),
    pend = byQ.filter((r) => !r.paid),
    paid = byQ.filter((r) => r.paid),
    show = H.f === "paid" ? paid : H.f === "pending" ? pend : byQ,
    sum = (a) => a.reduce((s, r) => s + r.amt, 0);
  return `<div class="card"><div class="stats"><div class="stat wait"><span>Pending</span><b>${money(sum(pend))}</b><span>${pend.length} invoices</span></div><div class="stat ok"><span>Paid</span><b>${money(sum(paid))}</b><span>${paid.length} invoices</span></div></div>
<div class="grid"><div class="s2"><label>Search by client</label><input id="hq" value="${esc(H.q)}" placeholder="Type a letter or name" oninput="H.q=this.value;keep('hq')"></div></div>
<div class="pre" style="margin-top:10px">${[
    ["all", "All (" + byQ.length + ")"],
    ["pending", "Pending (" + pend.length + ")"],
    ["paid", "Paid (" + paid.length + ")"],
  ]
    .map(
      ([k, l]) =>
        `<button class="btn s sm ${H.f === k ? "on" : ""}" onclick="H.f='${k}';render()">${l}</button>`,
    )
    .join("")}</div></div>
${
  show
    .map(
      (
        r,
      ) => `<div class="card inv"><div class="top2"><b>${esc(r.no)} · ${esc(r.cn)}</b><span class="tag ${r.paid ? "ok" : "wait"}">${r.paid ? "Paid " + fds(r.paidOn) : "Pending"}</span></div>
<div class="mu">${fds(r.from)} to ${fds(r.to)} · ${r.n} events × ${money(r.rate)} = <b style="color:var(--tx)">${money(r.amt)}</b> · made ${fd(r.created)}</div>
<div class="btns"><button class="btn ${r.paid ? "s" : ""} sm" onclick="togglePaid('${r.id}')">${r.paid ? "Undo paid" : "✓ Mark as paid"}</button><button class="btn s sm" onclick="openInv('${r.id}')">Open / resend</button><button class="btn d" onclick="delInv('${r.id}')">Delete</button></div></div>`,
    )
    .join("") ||
  `<div class="card mu">${S.invoices.length ? "No invoices match." : "No saved invoices yet. Invoices are saved when you send them, or with “Save to history”."}</div>`
}`;
}

/* ---------- setup ---------- */
function setSet(k, v) {
  S.set[k] = v;
  commit();
  if (k === "tz") buildEV();
  render();
}
function backup() {
  const d = {
    clients: S.clients,
    map: S.map,
    set: { ...S.set, pw: "" },
    inv: S.inv,
    off: S.off,
    invoices: S.invoices,
  };
  const u = URL.createObjectURL(
      new Blob([JSON.stringify(d)], { type: "application/json" }),
    ),
    a = document.createElement("a");
  a.href = u;
  a.download = "session-invoicer-backup-" + iso(Date.now()) + ".json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 4000);
}
function restore(f) {
  if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const d = JSON.parse(r.result);
      if (!Array.isArray(d.clients)) throw 0;
      if (!confirm("Replace clients, invoices and settings with the backup?"))
        return;
      S.clients = d.clients;
      S.map = d.map || {};
      S.set = { ...DEF, ...(d.set || {}), pw: S.set.pw };
      S.inv = d.inv || 1;
      S.off = d.off || [];
      S.invoices = d.invoices || [];
      commit();
      buildEV();
      msg = "Backup restored.";
    } catch (e) {
      msg = "That file is not a valid backup.";
    }
    render();
  };
  r.readAsText(f);
}
function vSetup() {
  const s = S.set;
  return `${msg ? `<div class="warn">${esc(msg)}</div>` : ""}
<div class="card"><h2>Rates &amp; invoice details</h2><div class="grid"><div><label>Default rate per event</label><input type="number" inputmode="decimal" value="${s.rate}" onchange="setSet('rate',+this.value)"></div><div><label>Currency symbol</label><input value="${esc(s.cur)}" onchange="setSet('cur',this.value)"></div><div><label>Time zone</label><input value="${esc(s.tz)}" onchange="setSet('tz',this.value.trim()||'Asia/Kolkata')"></div><div><label>Next invoice number</label><input type="number" value="${S.inv}" onchange="S.inv=Math.max(1,+this.value||1);I.no='';commit();render()"></div></div>
<label>Your name / business (on invoice)</label><input value="${esc(s.me)}" onchange="setSet('me',this.value)">
<label>Payment details (UPI ID, bank account…)</label><textarea onchange="setSet('pay',this.value)">${esc(s.pay)}</textarea>
<p class="mu">Every event is charged the same rate, whatever its length. A client can have its own rate in the Clients tab, and you can change the rate on any single invoice.</p></div>
<div class="card"><h2>Calendar</h2><p class="mu">Synced ${ago(S.synced)} · ${EV.length} events loaded. The app re-syncs when you open it and before invoicing. Cancelled sessions disappear from Google Calendar, so they never reach the invoice.</p>
<div class="btns"><button class="btn" onclick="sync(true)">⟳ Sync now</button></div>
<label>No live sync? Upload a Google Calendar export (.ics) instead</label><input type="file" accept=".ics,text/calendar" onchange="importFile(this.files[0])"></div>
<div class="card"><h2>Sync across devices</h2><p class="mu">Clients, invoice history, paid status and settings are shared between your PC and phone.</p><p id="cst"><b>${cloudTxt()}</b></p><div class="btns"><button class="btn s" onclick="cloudPull()">⟳ Check now</button></div></div>
<div class="card"><h2>Backup</h2><p class="mu">A safety copy of clients, invoices and settings.</p><div class="btns"><button class="btn" onclick="backup()">⬇ Download backup</button></div><label>Restore from a backup file</label><input type="file" accept=".json,application/json" onchange="restore(this.files[0])">
<div class="btns"><button class="btn d" onclick="if(confirm('Delete ALL saved data in this browser?')){localStorage.removeItem(KEY);location.reload()}">Reset this browser</button></div></div>`;
}

buildEV();
render();
Promise.resolve(
  !S.synced || Date.now() - S.synced > 3e5 ? sync(false) : 0,
).then(cloudPull);
