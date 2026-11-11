const KEY = "session-invoicer-v1";
let S = {
  clients: [],
  events: [],
  map: {},
  set: { cur: "₹", me: "", pay: "" },
  inv: 1,
};
try {
  const r = localStorage.getItem(KEY);
  if (r) S = Object.assign(S, JSON.parse(r));
} catch (e) {}
const save = () => {
  try {
    localStorage.setItem(KEY, JSON.stringify(S));
  } catch (e) {}
};
let tab = "sessions",
  F = { cl: "", from: "", to: "", q: "" },
  I = { cid: "", from: "", to: "", no: "", note: "" },
  msg = "";
const $ = (s) => document.querySelector(s);
const esc = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );
const uid = () => Math.random().toString(36).slice(2, 9);
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
];
const fd = (t) => {
  const d = new Date(t);
  return (
    String(d.getDate()).padStart(2, "0") +
    " " +
    MO[d.getMonth()] +
    " " +
    d.getFullYear()
  );
};
const ft = (t) => {
  const d = new Date(t);
  let h = d.getHours(),
    m = String(d.getMinutes()).padStart(2, "0");
  const p = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return h + ":" + m + " " + p;
};
const fdur = (m) =>
  m <= 0
    ? "—"
    : (m >= 60 ? Math.floor(m / 60) + "h " : "") +
      (m % 60 ? (m % 60) + "m" : "").trim();
const iso = (t) => {
  const d = new Date(t);
  return (
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0")
  );
};
const money = (n) =>
  S.set.cur + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });

/* ---------- name matching ---------- */
const STOP = new Set([
  "session",
  "sessions",
  "class",
  "classes",
  "lesson",
  "lessons",
  "with",
  "online",
  "tutoring",
  "call",
  "meeting",
  "and",
  "the",
  "for",
  "mr",
  "mrs",
  "ms",
]);
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
  const sa = ta.slice().sort().join(" "),
    sb = tb.slice().sort().join(" ");
  return Math.max(
    1 - lev(a, b) / Math.max(a.length, b.length),
    1 - lev(sa, sb) / Math.max(sa.length, sb.length),
  );
}
function clientOf(title) {
  const n = norm(title);
  if (S.map[n] && S.clients.find((c) => c.id === S.map[n])) return S.map[n];
  let best = 0,
    id = null;
  for (const c of S.clients)
    for (const nm of [c.name, ...c.aliases.split(",")]) {
      const sc = score(n, norm(nm));
      if (sc > best) {
        best = sc;
        id = c.id;
      }
    }
  return best >= 0.8 ? id : null;
}
const cname = (id) => (S.clients.find((c) => c.id === id) || {}).name || "";

/* ---------- ICS import ---------- */
function pdt(v) {
  let m = v.match(/^(\d{4})(\d\d)(\d\d)(?:T(\d\d)(\d\d)(\d\d)?)?(Z?)$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, , z] = m;
  if (h === undefined)
    return { t: new Date(+y, +mo - 1, +d).getTime(), allday: true };
  return {
    t: z
      ? Date.UTC(+y, +mo - 1, +d, +h, +mi)
      : new Date(+y, +mo - 1, +d, +h, +mi).getTime(),
  };
}
function parseICS(txt) {
  const lines = txt.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
  const out = [];
  let cur = null,
    rec = 0,
    skip = 0;
  for (const ln of lines) {
    if (ln === "BEGIN:VEVENT") {
      cur = {};
      continue;
    }
    if (ln === "END:VEVENT") {
      if (cur && cur.s && cur.st !== "CANCELLED") {
        if (cur.s.allday) skip++;
        else {
          const e = cur.e && !cur.e.allday ? cur.e.t : cur.s.t;
          if (cur.rr) rec++;
          out.push({
            id: (cur.uid || uid()) + "|" + cur.s.t,
            title: cur.title || "(no title)",
            start: cur.s.t,
            end: e,
            off: false,
          });
        }
      }
      cur = null;
      continue;
    }
    if (!cur) continue;
    const i = ln.indexOf(":");
    if (i < 0) continue;
    const k = ln.slice(0, i).split(";")[0],
      v = ln.slice(i + 1);
    if (k === "SUMMARY")
      cur.title = v
        .replace(/\\n/g, " ")
        .replace(/\\([,;\\])/g, "$1")
        .trim();
    else if (k === "DTSTART") cur.s = pdt(v);
    else if (k === "DTEND") cur.e = pdt(v);
    else if (k === "UID") cur.uid = v;
    else if (k === "STATUS") cur.st = v;
    else if (k === "RRULE") cur.rr = 1;
  }
  return { out, rec, skip };
}
function importFile(f) {
  const r = new FileReader();
  r.onload = () => {
    const { out, rec, skip } = parseICS(String(r.result));
    const have = new Set(S.events.map((e) => e.id));
    let add = 0;
    for (const e of out)
      if (!have.has(e.id)) {
        S.events.push(e);
        add++;
      }
    S.events.sort((a, b) => a.start - b.start);
    save();
    msg =
      `Imported ${add} new sessions (${out.length - add} already present).` +
      (skip ? ` ${skip} all-day events skipped.` : "") +
      (rec
        ? ` ⚠️ ${rec} events repeat (recurring) – only the first date of each series is counted.`
        : "");
    render();
  };
  r.readAsText(f);
}

/* ---------- views ---------- */
const TABS = [
  ["sessions", "🗓", "Sessions"],
  ["clients", "👥", "Clients"],
  ["invoice", "🧾", "Invoice"],
  ["import", "⚙️", "Setup"],
];
function render() {
  $("#nav").innerHTML = TABS.map(
    ([k, i, l]) =>
      `<button class="${tab === k ? "on" : ""}" onclick="tab='${k}';msg='';render();scrollTo(0,0)"><span class="ic">${i}</span><span>${l}</span></button>`,
  ).join("");
  $("#v").innerHTML = {
    sessions: vSessions,
    clients: vClients,
    invoice: vInvoice,
    import: vImport,
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
function preset(o, k) {
  const n = new Date(),
    y = n.getFullYear(),
    m = n.getMonth();
  if (k === "thisMonth") {
    o.from = iso(new Date(y, m, 1));
    o.to = iso(new Date(y, m + 1, 0));
  } else if (k === "lastMonth") {
    o.from = iso(new Date(y, m - 1, 1));
    o.to = iso(new Date(y, m, 0));
  } else if (k === "last30") {
    o.from = iso(Date.now() - 29 * 864e5);
    o.to = iso(Date.now());
  } else {
    o.from = "";
    o.to = "";
  }
  render();
}
const presets = (o) =>
  `<div class="btns" style="margin:8px 0 0">${[
    ["thisMonth", "This month"],
    ["lastMonth", "Last month"],
    ["last30", "Last 30 days"],
    ["all", "Clear"],
  ]
    .map(
      ([k, l]) =>
        `<button class="btn s sm" onclick="preset(${o},'${k}')">${l}</button>`,
    )
    .join("")}</div>`;
function backup() {
  const u = URL.createObjectURL(
      new Blob([JSON.stringify(S)], { type: "application/json" }),
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
      if (!Array.isArray(d.clients) || !Array.isArray(d.events)) throw 0;
      if (!confirm("Replace the data in this browser with the backup?")) return;
      S = Object.assign(S, d);
      save();
      msg = "Backup restored.";
      render();
    } catch (e) {
      msg = "That file is not a valid backup.";
      render();
    }
  };
  r.readAsText(f);
}
const copts = (sel, all) =>
  (all ? `<option value="">${all}</option>` : "") +
  S.clients
    .map(
      (c) =>
        `<option value="${c.id}" ${sel === c.id ? "selected" : ""}>${esc(c.name)}</option>`,
    )
    .join("");

function vImport() {
  return `<div class="card"><h2>1. Get your calendar file</h2>
<p class="mu">On a PC: Google Calendar → ⚙ Settings → <b>Import &amp; export</b> → <b>Export</b>. You get a .zip; unzip it and pick the .ics file of the calendar that holds your sessions. (Phone users: do this once on a PC, or in a mobile browser's desktop site.)</p>
<label>Choose the .ics file</label><input type="file" accept=".ics,text/calendar" onchange="importFile(this.files[0])">
${msg ? `<div class="warn">${esc(msg)}</div>` : ""}
<p class="mu">Re-importing a newer export is safe – existing sessions are not duplicated.</p></div>
<div class="card"><h2>Backup &amp; move data</h2><p class="mu">Your data is saved only in this browser. Download a backup to keep it safe or to move it between your PC and phone.</p>
<div class="btns"><button class="btn" onclick="backup()">⬇ Download backup</button></div><label>Restore from a backup file</label><input type="file" accept=".json,application/json" onchange="restore(this.files[0])"></div>
<div class="card"><h2>Settings</h2><div class="row"><div><label>Your name / business (on invoice)</label><input value="${esc(S.set.me)}" onchange="S.set.me=this.value;save()"></div>
<div><label>Currency symbol</label><input value="${esc(S.set.cur)}" onchange="S.set.cur=this.value;save()"></div></div>
<label>Payment details (UPI ID, bank account, etc.)</label><textarea onchange="S.set.pay=this.value;save()">${esc(S.set.pay)}</textarea>
<div class="btns"><button class="btn d" onclick="if(confirm('Delete ALL saved data?')){S={clients:[],events:[],map:{},set:S.set,inv:1};save();render()}">Reset all data</button></div></div>`;
}

function vClients() {
  const un = [
    ...new Set(
      S.events
        .filter((e) => !e.off && !clientOf(e.title))
        .map((e) => norm(e.title)),
    ),
  ];
  return `<div class="card"><h2>Add client</h2><div class="row"><div><label>Name</label><input id="nn"></div><div><label>Rate per session</label><input id="nr" type="number" inputmode="decimal"></div></div>
<label>Other names used in calendar (comma-separated, optional)</label><input id="na" placeholder="e.g. Riya S, Riya sharma class">
<div class="btns"><button class="btn" onclick="addClient()">Add client</button></div></div>
${
  un.length
    ? `<div class="card"><h2>⚠️ Calendar names not matched to any client (${un.length})</h2><p class="mu">Pick the right client once; it is remembered for all similar entries.</p>
${un.map((n) => `<div class="row" style="align-items:center;margin-bottom:6px"><div><b>${esc(n)}</b> <span class="mu">(${S.events.filter((e) => norm(e.title) === n).length}×)</span></div><div><select onchange="assign('${esc(n)}',this.value)"><option value="">Assign to…</option>${copts("")}<option value="__new">+ New client</option></select></div></div>`).join("")}</div>`
    : ""
}
${
  S.clients
    .map(
      (
        c,
      ) => `<div class="card"><div class="row"><div><label>Name</label><input value="${esc(c.name)}" onchange="upd('${c.id}','name',this.value)"></div><div><label>Rate / session</label><input type="number" value="${c.rate}" onchange="upd('${c.id}','rate',+this.value)"></div></div>
<label>Alternate names</label><input value="${esc(c.aliases)}" onchange="upd('${c.id}','aliases',this.value)">
<div class="mu" style="margin-top:6px">${S.events.filter((e) => !e.off && clientOf(e.title) === c.id).length} sessions matched</div>
<button class="btn d" onclick="if(confirm('Delete client?')){S.clients=S.clients.filter(x=>x.id!=='${c.id}');save();render()}">Delete</button></div>`,
    )
    .join("") || '<p class="mu">No clients yet – add your first one above.</p>'
}`;
}
function addClient() {
  const n = $("#nn").value.trim();
  if (!n) return;
  S.clients.push({
    id: uid(),
    name: n,
    rate: +$("#nr").value || 0,
    aliases: $("#na").value,
  });
  save();
  render();
}
function upd(id, k, v) {
  S.clients.find((c) => c.id === id)[k] = v;
  save();
  render();
}
function assign(n, id) {
  if (!id) return;
  if (id === "__new") {
    const nm = prompt("Client name?", n);
    if (!nm) return;
    id = uid();
    S.clients.push({
      id,
      name: nm,
      rate: +prompt("Rate per session?", "0") || 0,
      aliases: "",
    });
  }
  S.map[n] = id;
  save();
  render();
}

function filt() {
  const a = F.from ? new Date(F.from + "T00:00").getTime() : -1e18,
    b = F.to ? new Date(F.to + "T00:00").getTime() + 864e5 : 1e18;
  return S.events
    .map((e) => ({ ...e, cid: clientOf(e.title) }))
    .filter(
      (e) =>
        e.start >= a &&
        e.start < b &&
        (!F.cl || (F.cl === "__none" ? !e.cid : e.cid === F.cl)) &&
        (!F.q || e.title.toLowerCase().includes(F.q.toLowerCase())),
    );
}
function vSessions() {
  if (!S.events.length)
    return `<div class="card">No sessions yet. Go to <b>Import</b> and load your Google Calendar file.</div>`;
  const r = filt(),
    act = r.filter((e) => !e.off);
  return `<div class="card"><div class="row"><div><label>Client</label><select onchange="F.cl=this.value;render()">${copts(F.cl, "All")}<option value="__none" ${F.cl === "__none" ? "selected" : ""}>Unmatched</option></select></div>
<div><label>From</label><input type="date" value="${F.from}" onchange="F.from=this.value;render()"></div><div><label>To</label><input type="date" value="${F.to}" onchange="F.to=this.value;render()"></div>
<div><label>Search title</label><input value="${esc(F.q)}" onchange="F.q=this.value;render()"></div></div>
${presets("F")}<p class="mu">${act.length} sessions · ${fdur(act.reduce((s, e) => s + (e.end - e.start) / 6e4, 0))} total. Untick "Count" for events that are not real sessions.</p>
<div class="tw"><table class="rt"><tr><th>Count</th><th>Date</th><th>Time</th><th>Length</th><th>Client</th><th>Calendar title</th></tr>
${r
  .map(
    (
      e,
    ) => `<tr class="${e.off ? "off" : ""}"><td><input type="checkbox" style="width:auto" ${e.off ? "" : "checked"} onchange="tog('${esc(e.id)}')"></td><td>${fd(e.start)}</td><td>${ft(e.start)}</td><td>${fdur((e.end - e.start) / 6e4)}</td>
<td>${e.cid ? esc(cname(e.cid)) : `<select onchange="assign('${esc(norm(e.title))}',this.value)"><option value="">Assign…</option>${copts("")}<option value="__new">+ New</option></select>`}</td><td class="mu">${esc(e.title)}</td></tr>`,
  )
  .join("")}</table></div></div>`;
}
function tog(id) {
  const e = S.events.find((x) => x.id === id);
  e.off = !e.off;
  save();
  render();
}

function vInvoice() {
  if (!S.clients.length)
    return `<div class="card">Add a client first (Clients tab).</div>`;
  if (!I.no) I.no = "INV-" + String(S.inv).padStart(4, "0");
  return `<div class="card"><h2>Create invoice</h2><div class="row"><div><label>Client</label><select onchange="I.cid=this.value;drawInv()">${copts(I.cid, "Select client…")}</select></div>
<div><label>Invoice no.</label><input value="${I.no}" onchange="I.no=this.value;drawInv()"></div></div>
<div class="row"><div><label>From date</label><input type="date" value="${I.from}" onchange="I.from=this.value;drawInv()"></div><div><label>To date</label><input type="date" value="${I.to}" onchange="I.to=this.value;drawInv()"></div></div>
${presets("I")}<label>Extra note (optional)</label><input value="${esc(I.note)}" onchange="I.note=this.value;drawInv()" placeholder="e.g. Please pay by 15th"></div>
<div id="inv"></div>`;
}
function build() {
  const c = S.clients.find((x) => x.id === I.cid);
  if (!c || !I.from || !I.to) return null;
  const a = new Date(I.from + "T00:00").getTime(),
    b = new Date(I.to + "T00:00").getTime() + 864e5;
  const ev = S.events.filter(
    (e) => !e.off && e.start >= a && e.start < b && clientOf(e.title) === c.id,
  );
  return { c, ev, n: ev.length, amt: ev.length * c.rate };
}
function lines(d) {
  const L = [];
  L.push("INVOICE " + I.no);
  if (S.set.me) L.push("From: " + S.set.me);
  L.push(
    "To: " + d.c.name,
    "Date: " + fd(Date.now()),
    `Period: ${fd(new Date(I.from + "T00:00"))} to ${fd(new Date(I.to + "T00:00"))}`,
    "",
    "Sessions:",
  );
  d.ev.forEach((e, i) =>
    L.push(
      `${i + 1}. ${fd(e.start)}, ${ft(e.start)} (${fdur((e.end - e.start) / 6e4)})`,
    ),
  );
  L.push(
    "",
    `Total sessions: ${d.n}`,
    `Rate: ${money(d.c.rate)} per session`,
    `AMOUNT DUE: ${money(d.amt)}`,
  );
  if (I.note) L.push("", I.note);
  if (S.set.pay) L.push("", "Payment details:", S.set.pay);
  L.push("", "Thank you!");
  return L;
}
function drawInv() {
  const el = $("#inv");
  if (!el) return;
  const d = build();
  if (!d) {
    el.innerHTML =
      '<div class="card mu">Select a client and both dates to preview the invoice.</div>';
    return;
  }
  if (!d.n) {
    el.innerHTML =
      '<div class="card">No sessions for this client in that period.</div>';
    return;
  }
  const un = S.events.filter((e) => !e.off && !clientOf(e.title)).length;
  el.innerHTML = `<div class="card">${un ? `<div class="warn">${un} calendar entries are not matched to any client and are not included. Check the Clients tab.</div>` : ""}
<div class="tw"><table class="rt"><tr><th>#</th><th>Date</th><th>Time</th><th>Length</th></tr>${d.ev.map((e, i) => `<tr><td>${i + 1}</td><td>${fd(e.start)}</td><td>${ft(e.start)}</td><td>${fdur((e.end - e.start) / 6e4)}</td></tr>`).join("")}</table></div>
<p>${d.n} sessions × ${money(d.c.rate)} = <span class="tot">${money(d.amt)}</span></p>
${d.c.rate ? "" : '<div class="warn">This client has no rate set – edit it in Clients.</div>'}
<details><summary class="mu">Text version</summary><pre id="txt">${esc(lines(d).join("\n"))}</pre></details>
<div class="btns"><button class="btn" onclick="pdf()">⬇ Download PDF</button><button class="btn wa" onclick="wa()">WhatsApp</button><button class="btn s" onclick="cp()">Copy text</button><button class="btn s" onclick="shr()">Share…</button><button class="btn s" onclick="S.inv++;I.no='';save();render()">Next invoice no.</button></div>
<p class="mu" id="fb"></p></div>`;
}
const fb = (t) => {
  const e = $("#fb");
  if (e) e.textContent = t;
};
const txt = () => lines(build()).join("\n");
function wa() {
  window.open("https://wa.me/?text=" + encodeURIComponent(txt()), "_blank");
}
async function cp() {
  try {
    await navigator.clipboard.writeText(txt());
    fb("Copied – paste it anywhere.");
  } catch (e) {
    const p = $("#txt");
    if (p) {
      const r = document.createRange();
      r.selectNode(p);
      getSelection().removeAllRanges();
      getSelection().addRange(r);
      fb("Select and copy the text above.");
    }
  }
}
async function shr() {
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
  doc.text(
    `Period: ${fd(new Date(I.from + "T00:00"))} to ${fd(new Date(I.to + "T00:00"))}`,
    20,
    y,
  );
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
    doc.text(fdur((e.end - e.start) / 6e4), 125, y);
    doc.text(m(d.c.rate), W - 23, y, { align: "right" });
    doc.setDrawColor(220).line(20, y + 2, W - 20, y + 2);
    nl(7);
  });
  nl(4);
  doc.setFont("helvetica", "bold").setFontSize(12);
  doc.text(`${d.n} sessions x ${m(d.c.rate)}`, 20, y);
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
    return;
  } catch (e) {}
  fb("Could not save the PDF here. Use WhatsApp or Copy text instead.");
}
render();
