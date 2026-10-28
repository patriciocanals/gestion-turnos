// Gestor de turnos — frontend sin dependencias.
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------- fichas ----------
const FICHAS = {
  O: { label: "9–18", sub: "L–V", short: "9-18", key: "1" },
  M: { label: "Mañana", sub: "6–15", short: "M", key: "2" },
  T: { label: "Tarde", sub: "14–23", short: "T", key: "3" },
  N: { label: "Noche", sub: "22–7", short: "N", key: "4" },
  L: { label: "Libre", sub: "", short: "L", key: "5" },
  V: { label: "Vacaciones", sub: "", short: "V", key: "6" },
  A: { label: "Asuntos propios", sub: "", short: "AP", key: "7" },
  X: { label: "Otros", sub: "", short: "Ot", key: "8" },
};
const ORDER = Object.keys(FICHAS);
const SHIFTS = ["M", "T", "N"];
const ABSENT = new Set(["V", "A", "X"]);
const ALLOWED = {
  office: new Set(ORDER),
  rotating: new Set(["M", "T", "N", "L", "V", "A", "X"]),
  boss: new Set(["L", "V", "A", "X"]),
};
const ROLE_LABEL = { office: "Oficina 9–18", rotating: "Turno rotativo", boss: "Jefatura" };
const ROLE_GROUP = { office: "Oficina · 9–18", rotating: "Turnos rotativos", boss: "Jefatura" };
const ROLE_ORDER = ["office", "rotating", "boss"];
const WD = ["L", "M", "X", "J", "V", "S", "D"];

// ---------- fechas (YYYY-MM-DD, aritmética en UTC para evitar problemas de horario de verano) ----------
const pad = (n) => String(n).padStart(2, "0");
const ymd = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
const parse = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const fmt = (dt) => ymd(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate());
const addDays = (s, n) => { const dt = parse(s); dt.setUTCDate(dt.getUTCDate() + n); return fmt(dt); };
const dow = (s) => (parse(s).getUTCDay() + 6) % 7; // 0 = lunes
const daysIn = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
const diffDays = (a, b) => Math.round((parse(b) - parse(a)) / 86400000);
const todayStr = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Madrid" }).format(new Date());
const L = (s, o) => parse(s).toLocaleDateString("es-ES", { timeZone: "UTC", ...o });
const monthStart = (s) => s.slice(0, 8) + "01";
const range = (a, b) => { const out = []; for (let d = a; d <= b; d = addDays(d, 1)) out.push(d); return out; };
const mondayOf = (s) => addDays(s, -dow(s));

// ---------- estado ----------
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
};
const state = {
  token: store.get("turnos.token"),
  me: null,
  users: [],
  data: {}, // data[año][uid][fecha] = código
  view: store.get("turnos.view") || "grid",
  cursor: todayStr(),
  brush: null, // null | código | "CLEAR"
  meta: null,
  undo: [],
  pending: 0,
  syncError: false,
  yearUid: null,
};
const userById = (id) => state.users.find((u) => u.id === id);
const sortedUsers = () =>
  [...state.users].sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || state.users.indexOf(a) - state.users.indexOf(b));
const staff = () => state.users.filter((u) => u.role !== "boss");
const firstWord = (u) => u.name.split(" ")[0];
// Si dos personas empiezan igual ("Turno 1", "Turno 2") se usa el nombre completo / iniciales para distinguirlas.
const dupFirst = (u) => state.users.filter((x) => firstWord(x) === firstWord(u)).length > 1;
const shortName = (u) => (dupFirst(u) ? u.name : firstWord(u));
const covTag = (u) => (dupFirst(u) ? u.name.split(/\s+/).map((p) => (/^\d+$/.test(p) ? p : p[0])).join("") : firstWord(u).slice(0, 5));
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);

// ---------- API ----------
async function api(path, { method = "GET", body } = {}) {
  const r = await fetch("/api/" + path, {
    method,
    headers: { "content-type": "application/json", ...(state.token ? { authorization: "Bearer " + state.token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401 && path !== "login") {
    logout();
    throw new Error("Sesión caducada");
  }
  if (!r.ok) throw new Error(data.error || "Error de conexión");
  return data;
}

async function loadYear(year, { force = false } = {}) {
  if (state.data[year] && !force) return false;
  const s = await api(`state?year=${year}`);
  state.users = s.users;
  state.meta = s.meta;
  const changed = JSON.stringify(state.data[year]) !== JSON.stringify(s.data);
  state.data[year] = s.data;
  return changed;
}
const visibleYears = () => {
  const [a, b] = visibleRange();
  return [...new Set([+a.slice(0, 4), +b.slice(0, 4)])];
};
async function ensureVisible() {
  await Promise.all(visibleYears().map((y) => loadYear(y)));
}

// ---------- acceso a datos ----------
const getRaw = (uid, d) => state.data[d.slice(0, 4)]?.[uid]?.[d];
function setRaw(uid, d, c) {
  const y = d.slice(0, 4);
  state.data[y] ??= {};
  state.data[y][uid] ??= {};
  if (c === null) delete state.data[y][uid][d];
  else state.data[y][uid][d] = c;
}
const rawOf = (uid, d, ov) => (ov && ov.has(uid + "|" + d) ? ov.get(uid + "|" + d) ?? undefined : getRaw(uid, d));

function cellInfo(u, d, raw) {
  if (raw) return { code: raw, cls: `c-${raw}${FICHAS[raw].short.length > 2 ? " sm" : ""}`, text: FICHAS[raw].short };
  if (u.role === "office") {
    const c = dow(d) < 5 ? "O" : "L";
    return { code: c, cls: `c-${c} derived${c === "O" ? " sm" : ""}`, text: FICHAS[c].short };
  }
  if (u.role === "rotating") return { code: "L", cls: "empty", text: "·" };
  return { code: "", cls: "empty", text: "" };
}
const eff = (u, d, ov) => cellInfo(u, d, rawOf(u.id, d, ov)).code;

function coverageOf(d, ov) {
  const res = { M: [], T: [], N: [] };
  for (const u of staff()) {
    const c = eff(u, d, ov);
    if (res[c]) res[c].push(u);
  }
  return res;
}
function gapsIn(dates, ov) {
  const out = [];
  for (const d of dates) {
    if (!state.data[d.slice(0, 4)]) continue;
    const cov = coverageOf(d, ov);
    for (const s of SHIFTS) if (!cov[s].length) out.push({ d, shift: s });
  }
  return out;
}

// ---------- cambios (con deshacer y guardado en cola) ----------
let chain = Promise.resolve();
function send(changes) {
  for (let i = 0; i < changes.length; i += 5000) {
    const part = changes.slice(i, i + 5000);
    state.pending++;
    setSync();
    chain = chain
      .then(() => api("cells", { method: "PUT", body: { changes: part } }))
      .then((r) => { state.meta = r.meta; state.syncError = false; })
      .catch(async (err) => {
        state.syncError = true;
        toast("No se pudo guardar: " + err.message);
        try { await Promise.all(Object.keys(state.data).map((y) => loadYear(y, { force: true }))); render(); } catch {}
      })
      .finally(() => { state.pending--; setSync(); renderFoot(); });
  }
}
function applyChanges(changes, { undoable = true, silent = false } = {}) {
  const real = [];
  const inverse = [];
  let skipped = 0;
  for (const ch of changes) {
    const u = userById(ch.u);
    if (!u) continue;
    if (ch.c !== null && !ALLOWED[u.role].has(ch.c)) { skipped++; continue; }
    const prev = getRaw(ch.u, ch.d) ?? null;
    if (prev === ch.c) continue;
    real.push(ch);
    inverse.push({ u: ch.u, d: ch.d, c: prev });
    setRaw(ch.u, ch.d, ch.c);
  }
  if (skipped && !silent) toast(skipped === 1 ? "Esa ficha no se puede usar en este puesto." : `${skipped} cambios omitidos: ficha no válida para ese puesto.`);
  if (!real.length) return 0;
  if (undoable) { state.undo.push(inverse.reverse()); if (state.undo.length > 60) state.undo.shift(); }
  send(real);
  render();
  return real.length;
}
function undo() {
  const last = state.undo.pop();
  if (!last) return toast("No hay nada que deshacer");
  applyChanges(last, { undoable: false });
  toast("Cambio deshecho");
}

// ---------- cobertura ----------
const countCovers = (u) => Object.values(state.data).reduce((n, y) => n + Object.values(y[u.id] || {}).filter((c) => SHIFTS.includes(c)).length, 0);
function canCover(u, d, shift, ov) {
  const c = eff(u, d, ov);
  if (SHIFTS.includes(c)) return { ok: false, why: `ya hace ${FICHAS[c].label.toLowerCase()}` };
  if (ABSENT.has(c)) return { ok: false, why: FICHAS[c].label.toLowerCase() };
  if (shift === "M" && eff(u, addDays(d, -1), ov) === "N") return { ok: false, why: "sale de noche" };
  if (shift === "N" && eff(u, addDays(d, 1), ov) === "M") return { ok: false, why: "mañana entra a las 6" };
  return { ok: true, weekend: c === "L", why: c === "L" ? "día libre" : "su día de 9–18" };
}
function autoCover(dates, ov = new Map()) {
  const office = state.users.filter((u) => u.role === "office");
  const counts = new Map(office.map((u) => [u.id, countCovers(u)]));
  const changes = [];
  for (const d of dates) {
    for (const sh of ["N", "T", "M"]) {
      if (coverageOf(d, ov)[sh].length) continue;
      const cands = office
        .map((u) => ({ u, r: canCover(u, d, sh, ov) }))
        .filter((x) => x.r.ok)
        .sort((a, b) => counts.get(a.u.id) - counts.get(b.u.id) || a.r.weekend - b.r.weekend);
      if (!cands.length) continue;
      const pick = cands[0].u;
      ov.set(pick.id + "|" + d, sh);
      counts.set(pick.id, counts.get(pick.id) + 1);
      changes.push({ u: pick.id, d, c: sh });
    }
  }
  return changes;
}

// ---------- rangos visibles ----------
function visibleRange() {
  const c = state.cursor;
  if (state.view === "week") { const m = mondayOf(c); return [m, addDays(m, 6)]; }
  if (state.view === "year") return [c.slice(0, 4) + "-01-01", c.slice(0, 4) + "-12-31"];
  const [y, m] = [+c.slice(0, 4), +c.slice(5, 7) - 1];
  const a = monthStart(c);
  const b = ymd(y, m, daysIn(y, m));
  return state.view === "calendar" ? [mondayOf(a), addDays(mondayOf(b), 6)] : [a, b];
}
const periodDates = () => {
  const c = state.cursor;
  if (state.view === "week" || state.view === "year") return range(...visibleRange());
  const [y, m] = [+c.slice(0, 4), +c.slice(5, 7) - 1];
  return range(ymd(y, m, 1), ymd(y, m, daysIn(y, m)));
};

// ---------- UI base ----------
let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3800);
}
function setSync() {
  const el = $("#sync");
  if (!el) return;
  el.classList.toggle("err", state.syncError);
  el.textContent = state.syncError ? "⚠ Sin guardar" : state.pending ? "Guardando…" : "✓ Guardado";
}
function renderHeader() {
  $$("#tabs button").forEach((b) => b.setAttribute("aria-current", String(b.dataset.view === state.view)));
  const c = state.cursor;
  $("#period-label").textContent = cap(
    state.view === "year" ? c.slice(0, 4)
    : state.view === "week" ? `${L(mondayOf(c), { day: "numeric", month: "short" })} – ${L(addDays(mondayOf(c), 6), { day: "numeric", month: "short", year: "numeric" })}`
    : L(c, { month: "long", year: "numeric" }));
  $("#user-btn").textContent = state.me ? state.me.name + " ▾" : "";
  $("#m-team").hidden = !state.me?.admin;
  $("#m-reset").hidden = !state.me?.admin;
  $("#undo").disabled = !state.undo.length;
  setSync();
}
function renderPalette() {
  const btn = (code) => {
    const f = FICHAS[code];
    return `<button class="ficha c-${code}" data-brush="${code}" aria-pressed="${state.brush === code}" title="${f.label} (tecla ${f.key})">${f.label}${f.sub ? ` <small>${f.sub}</small>` : ""}<kbd>${f.key}</kbd></button>`;
  };
  $("#palette").innerHTML =
    ["O", "M", "T", "N"].map(btn).join("") +
    `<span class="sep"></span>` +
    ["L", "V", "A", "X"].map(btn).join("") +
    `<span class="sep"></span><button class="ficha clear" data-brush="CLEAR" aria-pressed="${state.brush === "CLEAR"}" title="Borrar (tecla 0)">Borrar <kbd>0</kbd></button>` +
    `<span class="hint">${state.brush ? "Pincel activo: pulsa o arrastra sobre los días · Esc para soltar" : "Toca un día para cambiarlo, o elige una ficha y pinta varios días"}</span>`;
  document.body.classList.toggle("brush", !!state.brush);
}
function renderFoot() {
  const m = state.meta;
  $("#foot").textContent = m ? `Última modificación: ${m.by} · ${new Date(m.at).toLocaleString("es-ES", { timeZone: "Europe/Madrid", dateStyle: "short", timeStyle: "short" })}` : "";
}
function renderAlert() {
  const el = $("#alert");
  const dates = periodDates();
  const gaps = gapsIn(dates);
  const label = state.view === "year" ? "este año" : state.view === "week" ? "esta semana" : "este mes";
  if (!state.users.length) return (el.hidden = true);
  const hasRot = dates.some((d) => state.users.some((u) => u.role === "rotating" && SHIFTS.includes(getRaw(u.id, d))));
  el.hidden = false;
  if (!gaps.length) {
    el.className = "alert ok";
    el.innerHTML = `✓ Todos los turnos (mañana, tarde y noche) están cubiertos ${label}.`;
    return;
  }
  el.className = "alert";
  if (!hasRot) {
    el.innerHTML = `<span>Los turnos rotativos de ${label} aún no están rellenados.</span><button class="btn small" data-act="fill">Rellenar año</button>`;
    return;
  }
  const first = gaps.slice(0, 6).map((g) => `<button class="btn small" data-act="gap" data-d="${g.d}" data-s="${g.shift}">${L(g.d, { day: "numeric", month: "short" })} · ${FICHAS[g.shift].label}</button>`).join("");
  el.innerHTML = `<strong>⚠ ${gaps.length} turno${gaps.length > 1 ? "s" : ""} sin cubrir ${label}</strong>${first}${gaps.length > 6 ? `<span>… y ${gaps.length - 6} más</span>` : ""}<button class="btn small" data-act="autocover">Cubrir con 9–18 automáticamente</button>`;
}

// ---------- vistas ----------
function cellHtml(u, d) {
  const i = cellInfo(u, d, getRaw(u.id, d));
  const t = `${u.name} · ${L(d, { weekday: "short", day: "numeric", month: "short" })}${i.code ? " · " + FICHAS[i.code].label : ""}`;
  return `<div class="cell ${i.cls}" role="button" aria-label="${esc(t)}" title="${esc(t)}" data-u="${u.id}" data-d="${d}">${i.text}</div>`;
}
function covHtml(d, shift) {
  const names = coverageOf(d)[shift];
  const title = `${FICHAS[shift].label} · ${L(d, { weekday: "short", day: "numeric", month: "short" })}: ${names.map((u) => u.name).join(", ") || "SIN CUBRIR"}`;
  if (!names.length) return `<div class="cov gap" role="button" title="${esc(title)}" data-d="${d}" data-s="${shift}">!</div>`;
  const txt = names.length === 1 ? esc(covTag(names[0])) : `${names.length}×`;
  return `<div class="cov c-${shift}${names.length > 1 ? " multi" : ""}" role="button" title="${esc(title)}" data-d="${d}" data-s="${shift}">${txt}</div>`;
}

function viewGrid() {
  const c = state.cursor, y = +c.slice(0, 4), m = +c.slice(5, 7) - 1;
  const dates = range(ymd(y, m, 1), ymd(y, m, daysIn(y, m)));
  const t = todayStr();
  const n = dates.length;
  const we = (d) => (dow(d) > 4 ? "we" : "");
  let h = `<div class="grid-wrap"><table class="grid"><thead><tr><th class="name">Equipo</th>${dates.map((d) => `<th class="${we(d)} ${d === t ? "today" : ""}" data-date="${d}" title="Ver el día completo"><b>${+d.slice(8)}</b>${WD[dow(d)]}</th>`).join("")}</tr></thead><tbody>`;
  let last = "";
  for (const u of sortedUsers()) {
    if (u.role !== last) { h += `<tr class="group"><td colspan="${n + 1}"><span class="glabel">${ROLE_GROUP[u.role]}</span></td></tr>`; last = u.role; }
    h += `<tr><td class="name">${esc(u.name)}</td>${dates.map((d) => `<td class="${we(d)}">${cellHtml(u, d)}</td>`).join("")}</tr>`;
  }
  h += `<tr class="group"><td colspan="${n + 1}"><span class="glabel">Cobertura de turnos</span></td></tr>`;
  for (const s of SHIFTS) h += `<tr class="cov-row"><td class="name">${FICHAS[s].label} <small>${FICHAS[s].sub}</small></td>${dates.map((d) => `<td class="${we(d)}">${covHtml(d, s)}</td>`).join("")}</tr>`;
  return h + `</tbody></table></div>` + legend();
}
const legend = () => `<p class="legend">${ORDER.map((c) => `<span class="c-${c}"><i></i>${FICHAS[c].short} = ${FICHAS[c].label}${FICHAS[c].sub ? " " + FICHAS[c].sub : ""}</span>`).join("")}<span>· = sin rellenar · fondo tenue = automático (9–18 L–V)</span></p>`;

function viewCalendar() {
  const [a, b] = visibleRange();
  const t = todayStr();
  const month = state.cursor.slice(0, 7);
  let h = `<div class="cal">${WD.map((w) => `<div class="dh">${w}</div>`).join("")}`;
  for (const d of range(a, b)) {
    const cov = coverageOf(d);
    const lines = SHIFTS.map((s) =>
      cov[s].length
        ? `<div class="line c-${s}"><b>${FICHAS[s].short}</b><span>${esc(cov[s].map(shortName).join(", "))}</span></div>`
        : `<div class="line gap"><b>${FICHAS[s].short}</b><span>¡Sin cubrir!</span></div>`
    ).join("");
    const abs = staff().concat(state.users.filter((u) => u.role === "boss")).filter((u) => ABSENT.has(eff(u, d)));
    const absLine = abs.length ? `<div class="line abs"><b>Aus.</b><span>${esc(abs.map((u) => `${shortName(u)} (${FICHAS[eff(u, d)].short})`).join(", "))}</span></div>` : "";
    const gap = SHIFTS.some((s) => !cov[s].length);
    h += `<button class="day ${d.slice(0, 7) !== month ? "out" : ""} ${d === t ? "today" : ""} ${dow(d) > 4 ? "we" : ""}" data-date="${d}"><span class="num">${+d.slice(8)}${gap ? '<span class="gap-tag">⚠</span>' : ""}</span>${lines}${absLine}</button>`;
  }
  return h + `</div>` + legend();
}

function viewWeek() {
  const m = mondayOf(state.cursor);
  const days = range(m, addDays(m, 6));
  const t = todayStr();
  const lanes = [["O", "9–18", "L–V"], ["M", "Mañana", "6–15"], ["T", "Tarde", "14–23"], ["N", "Noche", "22–7"], ["AUS", "Ausencias", "libres · vac. · otros"]];
  let h = `<div class="week"><div class="corner"></div>${days.map((d) => `<button class="col-h ${d === t ? "today" : ""}" data-date="${d}"><b>${L(d, { weekday: "short" })}</b><br>${+d.slice(8)} ${L(d, { month: "short" })}</button>`).join("")}`;
  for (const [code, name, sub] of lanes) {
    h += `<div class="lane-h ${code !== "AUS" ? "c-" + code : ""}">${name}<small>${sub}</small></div>`;
    for (const d of days) {
      const people = code === "AUS" ? state.users.filter((u) => ["L", "V", "A", "X"].includes(eff(u, d)) && !(u.role === "rotating" && !getRaw(u.id, d))) : state.users.filter((u) => eff(u, d) === code);
      const gap = SHIFTS.includes(code) && !people.length;
      const inner = gap ? `<span class="none">¡Sin cubrir!</span>` : people.map((u) => `<button class="chip c-${eff(u, d)}" data-u="${u.id}" data-d="${d}" title="${esc(u.name)}">${esc(u.name)}${code === "AUS" ? ` · ${FICHAS[eff(u, d)].short}` : ""}</button>`).join("");
      h += `<div class="slot ${dow(d) > 4 ? "we" : ""} ${gap ? "gap" : ""}" ${gap ? `data-d="${d}" data-s="${code}"` : ""}>${inner}</div>`;
    }
  }
  return h + `</div>` + legend();
}

function viewYear() {
  const y = +state.cursor.slice(0, 4);
  const uid = state.yearUid && userById(state.yearUid) ? state.yearUid : state.me?.role === "boss" ? sortedUsers()[0]?.id : state.me?.id;
  const u = userById(uid);
  const t = todayStr();
  const opts = sortedUsers().map((x) => `<option value="${x.id}" ${x.id === uid ? "selected" : ""}>${esc(x.name)}</option>`).join("");
  let h = `<div class="year-top"><label>Persona<select id="year-person">${opts}</select></label><span class="muted">Pulsa un día para cambiarlo · pulsa el mes para abrirlo en el cuadrante</span></div><div class="months">`;
  for (let m = 0; m < 12; m++) {
    const first = ymd(y, m, 1);
    const cells = Array(dow(first)).fill(`<span class="md blank">0</span>`);
    for (let d = 1; d <= daysIn(y, m); d++) {
      const ds = ymd(y, m, d);
      const i = cellInfo(u, ds, getRaw(u.id, ds));
      cells.push(`<button class="md ${i.cls.replace(" sm", "")}" data-u="${u.id}" data-d="${ds}" title="${esc(L(ds, { weekday: "long", day: "numeric", month: "long" }) + (i.code ? " · " + FICHAS[i.code].label : ""))}" ${ds === t ? 'style="outline:2px solid var(--today)"' : ""}>${d}</button>`);
    }
    h += `<div class="mini"><h3 data-month="${first}">${L(first, { month: "long" })}</h3><div class="mg">${WD.map((w) => `<span>${w}</span>`).join("")}${cells.join("")}</div></div>`;
  }
  h += `</div><table class="sum"><thead><tr><th>Resumen ${y}</th><th>Vacaciones</th><th>Asuntos propios</th><th>Otros</th><th>Mañanas</th><th>Tardes</th><th>Noches</th></tr></thead><tbody>`;
  for (const p of sortedUsers()) {
    const doc = state.data[y]?.[p.id] || {};
    const cnt = (c) => Object.values(doc).filter((x) => x === c).length;
    h += `<tr><td>${esc(p.name)}</td>${["V", "A", "X", "M", "T", "N"].map((c) => `<td>${cnt(c) || "–"}</td>`).join("")}</tr>`;
  }
  return h + `</tbody></table>` + legend();
}
const VIEWS = { grid: viewGrid, calendar: viewCalendar, week: viewWeek, year: viewYear };

let firstGridRender = true;
function render() {
  if (!state.me) return;
  const view = $("#view");
  const wrap = $(".grid-wrap", view);
  const sl = wrap?.scrollLeft;
  const st = window.scrollY;
  renderHeader();
  view.innerHTML = VIEWS[state.view]();
  const nw = $(".grid-wrap", view);
  if (nw) {
    if (sl != null && !firstGridRender) nw.scrollLeft = sl;
    else {
      const th = $("th.today", nw);
      nw.scrollLeft = th ? Math.max(0, th.offsetLeft - 220) : 0;
    }
    firstGridRender = false;
  }
  window.scrollTo(0, st);
  renderAlert();
  renderFoot();
}

// ---------- popover ----------
const pop = () => $("#popover");
function closePopover() { pop().hidden = true; pop().innerHTML = ""; }
function placePopover(anchor) {
  const p = pop();
  p.hidden = false;
  const r = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : anchor;
  const w = p.offsetWidth, h = p.offsetHeight;
  let x = r.left + r.width / 2 - w / 2;
  let y = r.bottom + 6;
  if (y + h > window.innerHeight - 8) y = Math.max(8, r.top - h - 6);
  x = Math.min(Math.max(8, x), window.innerWidth - w - 8);
  p.style.left = x + "px";
  p.style.top = y + "px";
}
function openCellPopover(anchor, uid, d) {
  const u = userById(uid);
  const cur = getRaw(uid, d) ?? null;
  const items = ORDER.filter((c) => ALLOWED[u.role].has(c));
  pop().innerHTML = `<h4>${esc(u.name)} · ${L(d, { weekday: "long", day: "numeric", month: "long" })}</h4><div class="pgrid">${items
    .map((c) => `<button class="ficha c-${c}" data-pick="${c}" aria-pressed="${cur === c}">${FICHAS[c].label}${FICHAS[c].sub ? ` <small>${FICHAS[c].sub}</small>` : ""}</button>`)
    .join("")}<button class="ficha clear" data-pick="CLEAR">Borrar</button></div>`;
  placePopover(anchor);
  pop().onclick = (e) => {
    const b = e.target.closest("[data-pick]");
    if (!b) return;
    const rect = anchor.getBoundingClientRect();
    const c = b.dataset.pick === "CLEAR" ? null : b.dataset.pick;
    closePopover();
    applyChanges([{ u: uid, d, c }]);
    // Si deja un turno sin cubrir, se ofrece cubrirlo al instante.
    if (u.role === "rotating") {
      const g = gapsIn([d])[0];
      if (g) openCoverPopover(rect, d, g.shift);
    }
  };
}
function openCoverPopover(anchor, d, shift) {
  const office = state.users.filter((u) => u.role === "office");
  const opts = office
    .map((u) => ({ u, r: canCover(u, d, shift), n: countCovers(u) }))
    .map(({ u, r, n }) => `<button class="cover-opt" data-cover="${u.id}" ${r.ok ? "" : "disabled"}><span>${esc(u.name)}</span><small>${esc(r.why)}${r.ok ? ` · ${n} cubiertos` : ""}</small></button>`)
    .join("");
  pop().innerHTML = `<h4>${FICHAS[shift].label} ${FICHAS[shift].sub} · ${L(d, { weekday: "long", day: "numeric", month: "long" })}<br><strong style="color:var(--danger)">Turno sin cubrir — ¿quién lo cubre?</strong></h4>${opts || '<p class="muted">No hay personas de 9–18 en el equipo.</p>'}<button class="cover-opt" data-cover="">Dejarlo sin cubrir</button>`;
  placePopover(anchor);
  pop().onclick = (e) => {
    const b = e.target.closest("[data-cover]");
    if (!b || b.disabled) return;
    closePopover();
    if (b.dataset.cover) {
      applyChanges([{ u: b.dataset.cover, d, c: shift }]);
      toast(`${userById(b.dataset.cover).name} cubre ${FICHAS[shift].label.toLowerCase()} el ${L(d, { day: "numeric", month: "short" })}`);
    }
  };
}

// ---------- pintar con pincel ----------
let drag = null;
function paintCell(el) {
  const u = userById(el.dataset.u);
  const code = state.brush === "CLEAR" ? null : state.brush;
  if (code !== null && !ALLOWED[u.role].has(code)) {
    if (!drag.warned) { toast(`${u.name} (${ROLE_LABEL[u.role].toLowerCase()}) no puede usar la ficha ${FICHAS[code].label}.`); drag.warned = true; }
    return;
  }
  const key = el.dataset.u + "|" + el.dataset.d;
  if (drag.changes.has(key)) return;
  drag.changes.set(key, { u: el.dataset.u, d: el.dataset.d, c: code });
  const i = cellInfo(u, el.dataset.d, code);
  el.className = `cell ${i.cls}`;
  el.textContent = i.text;
}
function endDrag() {
  if (!drag) return;
  const changes = [...drag.changes.values()];
  drag = null;
  if (changes.length) applyChanges(changes);
}

// ---------- diálogos ----------
function openDialog(html, { closable = true } = {}) {
  const dlg = document.createElement("dialog");
  dlg.innerHTML = html;
  $("#dialogs").appendChild(dlg);
  dlg.addEventListener("close", () => dlg.remove());
  if (!closable) dlg.addEventListener("cancel", (e) => e.preventDefault());
  dlg.showModal();
  $$("[data-close]", dlg).forEach((b) => b.addEventListener("click", () => dlg.close()));
  return dlg;
}
const dialogOpen = () => !!$("dialog[open]");

// -- día completo
function openDay(date) {
  closePopover();
  let d = date;
  const dlg = openDialog(`<div class="dlg"></div>`);
  const paint = () => {
    const cov = coverageOf(d);
    const rows = sortedUsers().map((u) => {
      const cur = eff(u, d);
      const raw = getRaw(u.id, d);
      return `<div class="person-row"><span>${esc(u.name)}</span><span class="pr-f">${ORDER.filter((c) => ALLOWED[u.role].has(c)).map((c) => `<button class="ficha c-${c}" data-u="${u.id}" data-c="${c}" aria-pressed="${raw === c}" title="${FICHAS[c].label}" style="${cur === c && !raw ? "opacity:.6" : ""}">${FICHAS[c].short}</button>`).join("")}<button class="ficha clear" data-u="${u.id}" data-c="CLEAR" title="Borrar">✕</button></span></div>`;
    }).join("");
    $(".dlg", dlg).innerHTML = `<div class="row" style="align-items:center"><button class="icon-btn" data-nav="-1" aria-label="Día anterior" style="flex:none">‹</button><h2 style="flex:1 1 auto;text-align:center">${cap(L(d, { weekday: "long", day: "numeric", month: "long", year: "numeric" }))}</h2><button class="icon-btn" data-nav="1" aria-label="Día siguiente" style="flex:none">›</button></div>
      <div class="week" style="grid-template-columns:1fr">${SHIFTS.map((s) => `<div class="line ${cov[s].length ? "c-" + s : "gap"}" style="padding:6px 10px;font-size:14px"><b>${FICHAS[s].label} ${FICHAS[s].sub}</b><span>${cov[s].length ? esc(cov[s].map((u) => u.name).join(", ")) : "¡Sin cubrir!"}</span></div>`).join("")}</div>
      <div>${rows}</div><div class="actions"><button class="btn primary" data-close>Hecho</button></div>`;
    $$("[data-close]", dlg).forEach((b) => (b.onclick = () => dlg.close()));
  };
  dlg.addEventListener("click", (e) => {
    const nav = e.target.closest("[data-nav]");
    if (nav) { d = addDays(d, +nav.dataset.nav); loadYear(+d.slice(0, 4)).then(paint); return paint(); }
    const b = e.target.closest("[data-u][data-c]");
    if (b) { applyChanges([{ u: b.dataset.u, d, c: b.dataset.c === "CLEAR" ? null : b.dataset.c }]); paint(); }
  });
  paint();
}

// -- contraseña
function openPassword(forced = false) {
  const dlg = openDialog(`<form method="dialog" id="pw-form"><h2>${forced ? "Elige tu contraseña" : "Cambiar contraseña"}</h2>${forced ? `<p class="muted">Es tu primer acceso (o te la han restablecido). Elige una contraseña nueva para continuar.</p>` : ""}
    <label>Contraseña actual<input type="password" name="current" autocomplete="current-password" required></label>
    <label>Contraseña nueva (mín. 6 caracteres)<input type="password" name="next" autocomplete="new-password" minlength="6" required></label>
    <label>Repite la contraseña nueva<input type="password" name="again" autocomplete="new-password" minlength="6" required></label>
    <p class="error" role="alert"></p><div class="actions">${forced ? "" : `<button class="btn" type="button" data-close>Cancelar</button>`}<button class="btn primary" type="submit">Guardar</button></div></form>`, { closable: !forced });
  $("#pw-form", dlg).addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const err = $(".error", dlg);
    if (f.get("next") !== f.get("again")) return (err.textContent = "Las contraseñas nuevas no coinciden");
    try {
      const r = await api("password", { method: "POST", body: { current: f.get("current"), next: f.get("next") } });
      state.token = r.token;
      store.set("turnos.token", r.token);
      dlg.close();
      toast("Contraseña cambiada");
    } catch (ex) { err.textContent = ex.message; }
  });
}

// -- ausencia rápida
function openAbsence(preDate) {
  const start = preDate || state.cursor;
  const people = sortedUsers();
  const dlg = openDialog(`<form method="dialog" id="abs-form"><h2>Añadir ausencia</h2>
    <div class="row"><label>Persona<select name="u">${people.map((u) => `<option value="${u.id}">${esc(u.name)}</option>`).join("")}</select></label>
    <label>Tipo<select name="c"><option value="V">Vacaciones</option><option value="A">Asuntos propios</option><option value="X">Otros</option><option value="L">Libre</option></select></label></div>
    <div class="row"><label>Desde<input type="date" name="from" value="${start}" required></label><label>Hasta<input type="date" name="to" value="${start}" required></label></div>
    <label class="check"><input type="checkbox" name="workonly" checked> Solo días que le tocaba trabajar (no marcar sus libres ni fines de semana)</label>
    <label class="check"><input type="checkbox" name="cover" checked> Cubrir los turnos que queden vacíos con alguien de 9–18</label>
    <p class="error" role="alert"></p><div class="actions"><button class="btn" type="button" data-close>Cancelar</button><button class="btn primary" type="submit">Aplicar</button></div></form>`);
  $("#abs-form", dlg).addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const err = $(".error", dlg);
    const from = f.get("from"), to = f.get("to");
    if (to < from) return (err.textContent = "La fecha final es anterior a la inicial");
    if (diffDays(from, to) > 400) return (err.textContent = "El rango es demasiado largo");
    await Promise.all([...new Set([+from.slice(0, 4), +to.slice(0, 4)])].map((y) => loadYear(y)));
    const u = userById(f.get("u"));
    const code = f.get("c");
    const days = range(from, to).filter((d) => !f.get("workonly") || (u.role === "boss" ? true : eff(u, d) !== "L"));
    if (!days.length) return (err.textContent = "En esas fechas no tenía que trabajar: desmarca la casilla para forzarlo");
    const changes = days.map((d) => ({ u: u.id, d, c: code }));
    let covered = 0, left = 0;
    if (f.get("cover") && u.role === "rotating" && code !== "L") {
      const ov = new Map(changes.map((c) => [c.u + "|" + c.d, c.c]));
      const extra = autoCover(range(from, to), ov);
      covered = extra.length;
      changes.push(...extra);
      left = gapsIn(range(from, to), ov).length;
    }
    dlg.close();
    applyChanges(changes);
    state.cursor = from;
    await ensureVisible();
    render();
    toast(`${FICHAS[code].label}: ${days.length} día${days.length > 1 ? "s" : ""}` + (covered ? ` · ${covered} turno${covered > 1 ? "s" : ""} cubierto${covered > 1 ? "s" : ""}` : "") + (left ? ` · ${left} sin cubrir` : ""));
  });
}

// -- rellenar año con la rotación
const PATTERN_ORDER = ["M", "T", "N", "L"];
function openFill() {
  const year = +state.cursor.slice(0, 4);
  const rot = state.users.filter((u) => u.role === "rotating");
  if (!rot.length) return toast("No hay personas con turno rotativo en el equipo");
  const cfg = {
    pattern: ["M", "M", "M", "M", "M", "M", "L", "L", "L", "L"],
    rotate: true, keep: true, overwrite: true, cover: true,
    start: rot.map((_, i) => `${year}-01-${pad(1 + 2 * (i % 5))}`),
    first: rot.map((_, i) => [0, 2, 1, 0, 2][i % 5]),
  };
  const dlg = openDialog(`<form method="dialog" id="fill-form"><h2>Rellenar el año ${year}</h2>
    <p class="muted">Genera automáticamente los turnos rotativos de todo el año. Las personas de 9–18 ya tienen su horario L–V por defecto. Después podrás retocar cualquier día.</p>
    <h3>1 · Ciclo de 10 días (pulsa un día para cambiarlo)</h3><div class="pattern" id="pat"></div>
    <label class="check"><input type="checkbox" id="f-rot" checked> En cada ciclo, el turno avanza Mañana → Tarde → Noche</label>
    <h3>2 · Cuándo empieza el ciclo de cada persona</h3>
    <table class="rot"><thead><tr><th>Persona</th><th>Primer día de trabajo</th><th>Primer turno</th></tr></thead><tbody>${rot.map((u, i) => `<tr><td>${esc(u.name)}</td><td><input type="date" data-i="${i}" class="f-start" value="${cfg.start[i]}"></td><td><select data-i="${i}" class="f-first"><option value="0">Mañana</option><option value="1">Tarde</option><option value="2">Noche</option></select></td></tr>`).join("")}</tbody></table>
    <h3>3 · Opciones</h3>
    <label class="check"><input type="checkbox" id="f-keep" checked> Respetar vacaciones, asuntos propios y otras ausencias ya marcadas</label>
    <label class="check"><input type="checkbox" id="f-over" checked> Sustituir los turnos rotativos que ya hubiera puestos</label>
    <label class="check"><input type="checkbox" id="f-cover" checked> Cubrir huecos con las personas de 9–18</label>
    <div class="sticky-foot"><div class="preview" id="preview"></div><p class="error" role="alert"></p>
    <div class="actions"><button class="btn" type="button" data-close>Cancelar</button><button class="btn primary" type="submit">Rellenar año</button></div></div></form>`);
  $$(".f-first", dlg).forEach((s) => (s.value = cfg.first[+s.dataset.i]));

  const build = () => {
    const ov = new Map();
    const changes = [];
    const dates = range(`${year}-01-01`, `${year}-12-31`);
    rot.forEach((u, i) => {
      const s = $$(".f-start", dlg)[i].value;
      if (!s) return;
      const f0 = +$$(".f-first", dlg)[i].value;
      for (const d of dates) {
        const raw = getRaw(u.id, d);
        if (cfg.keep && raw && ABSENT.has(raw)) continue;
        if (!cfg.overwrite && raw) continue;
        const idx = diffDays(s, d);
        const cyc = Math.floor(idx / 10), pos = ((idx % 10) + 10) % 10;
        const p = cfg.pattern[pos];
        const code = p === "L" ? "L" : SHIFTS[(((SHIFTS.indexOf(p) + f0 + (cfg.rotate ? cyc : 0)) % 3) + 3) % 3];
        changes.push({ u: u.id, d, c: code });
        ov.set(u.id + "|" + d, code);
      }
    });
    const gapsBefore = gapsIn(dates, ov).length;
    let extra = [];
    if (cfg.cover) extra = autoCover(dates, ov);
    return { changes: changes.concat(extra), gapsBefore, covered: extra.length, gapsAfter: gapsIn(dates, ov).length };
  };
  const refresh = () => {
    $("#pat", dlg).innerHTML = cfg.pattern.map((c, i) => `<button type="button" class="c-${c}" data-p="${i}" title="Día ${i + 1} del ciclo">${c === "L" ? "L" : c}</button>`).join("");
    const r = build();
    const p = $("#preview", dlg);
    p.className = "preview" + (r.gapsAfter ? " bad" : "");
    p.innerHTML = `Se escribirán <b>${r.changes.length}</b> días. Con esta configuración quedan <b>${r.gapsBefore}</b> turnos sin cubrir por los rotativos` + (cfg.cover ? `; <b>${r.covered}</b> los cubrirá gente de 9–18 y <b>${r.gapsAfter}</b> seguirán vacíos.` : ".") + (r.gapsAfter ? " Ajusta las fechas de inicio hasta que no queden vacíos." : " ✓");
  };
  dlg.addEventListener("click", (e) => {
    const b = e.target.closest("[data-p]");
    if (b) { const i = +b.dataset.p; cfg.pattern[i] = PATTERN_ORDER[(PATTERN_ORDER.indexOf(cfg.pattern[i]) + 1) % 4]; refresh(); }
  });
  dlg.addEventListener("input", () => {
    cfg.rotate = $("#f-rot", dlg).checked; cfg.keep = $("#f-keep", dlg).checked; cfg.overwrite = $("#f-over", dlg).checked; cfg.cover = $("#f-cover", dlg).checked;
    refresh();
  });
  $("#fill-form", dlg).addEventListener("submit", async (e) => {
    e.preventDefault();
    await loadYear(year);
    const r = build();
    dlg.close();
    const n = applyChanges(r.changes);
    render();
    toast(`Año ${year} rellenado (${n} días). ${r.gapsAfter ? r.gapsAfter + " turnos siguen sin cubrir." : "Todos los turnos cubiertos ✓"}`);
  });
  refresh();
}

// -- equipo (solo administración)
async function openTeam() {
  await loadYear(+state.cursor.slice(0, 4), { force: true });
  const dlg = openDialog(`<div class="dlg" id="team"></div>`);
  dlg.style.width = "min(780px, calc(100vw - 24px))";
  const paint = (note = "") => {
    const row = (u) => `<form class="team-row" data-id="${u?.id || ""}">
      <input name="name" placeholder="Nombre" value="${esc(u?.name || "")}" required aria-label="Nombre">
      <input name="username" placeholder="usuario" value="${esc(u?.username || "")}" required aria-label="Usuario" autocapitalize="none">
      <select name="role" aria-label="Puesto">${ROLE_ORDER.map((r) => `<option value="${r}" ${u?.role === r ? "selected" : ""}>${ROLE_LABEL[r]}</option>`).join("")}</select>
      <label class="check"><input type="checkbox" name="admin" ${u?.admin ? "checked" : ""}> Admin</label>
      <span style="display:flex;gap:4px;flex-wrap:wrap"><button class="btn small primary" type="submit">${u ? "Guardar" : "Añadir"}</button>${u ? `<button class="btn small" type="button" data-reset>Nueva contraseña</button><button class="btn small danger" type="button" data-del>Eliminar</button>` : ""}</span></form>`;
    $("#team", dlg).innerHTML = `<h2>Gestionar equipo</h2><p class="muted">Aquí puedes poner el nombre real de cada persona, cambiar su usuario o su puesto, y dar una contraseña nueva a quien la olvide.</p>${note}${sortedUsers().map(row).join("")}<h3>Añadir persona</h3>${row(null)}<div class="actions"><button class="btn primary" data-close>Cerrar</button></div>`;
    $$("[data-close]", dlg).forEach((b) => (b.onclick = () => dlg.close()));
  };
  const secret = (who, pw) => `<div class="preview">Contraseña temporal de <b>${esc(who)}</b> (se mostrará solo ahora; deberá cambiarla al entrar):<br><span class="secret">${esc(pw)}</span></div>`;
  dlg.addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    const f = new FormData(form);
    try {
      const r = await api("admin/users", { method: "POST", body: { id: form.dataset.id || undefined, name: f.get("name"), username: f.get("username"), role: f.get("role"), admin: !!f.get("admin") } });
      await loadYear(+state.cursor.slice(0, 4), { force: true });
      state.me = state.users.find((u) => u.id === state.me.id) || state.me;
      render();
      paint(r.tempPassword ? secret(r.user.name, r.tempPassword) : `<div class="preview">Guardado ✓</div>`);
    } catch (ex) { toast(ex.message); }
  });
  dlg.addEventListener("click", async (e) => {
    const form = e.target.closest(".team-row");
    if (!form) return;
    const u = userById(form.dataset.id);
    try {
      if (e.target.closest("[data-reset]")) {
        const r = await api("admin/reset", { method: "POST", body: { id: u.id } });
        paint(secret(u.name, r.tempPassword));
      } else if (e.target.closest("[data-del]")) {
        if (!confirm(`¿Eliminar a ${u.name}? Sus turnos dejarán de verse.`)) return;
        await api(`admin/users/${u.id}`, { method: "DELETE" });
        await loadYear(+state.cursor.slice(0, 4), { force: true });
        render();
        paint(`<div class="preview">${esc(u.name)} eliminada/o</div>`);
      }
    } catch (ex) { toast(ex.message); }
  });
  paint();
}

// -- restablecer de fábrica (solo administración, con contraseña)
function openFactoryReset() {
  const dlg = openDialog(`<form method="dialog" id="reset-form"><h2 style="color:var(--danger)">Restablecer la app de fábrica</h2>
    <div class="preview bad"><b>Esta acción no se puede deshacer.</b><br>Se borrarán <b>todos los turnos de todos los años</b>, todas las vacaciones y <b>todas las cuentas</b> (nombres, usuarios y contraseñas).<br>La app volverá a empezar con las 8 cuentas genéricas (<code>jefa</code>, <code>oficina1</code>, <code>oficina2</code>, <code>turno1</code>…<code>turno5</code>) y la contraseña inicial, y se cerrará la sesión de todo el mundo.</div>
    <label>Tu contraseña de administración<input type="password" name="password" autocomplete="current-password" required></label>
    <label>Para confirmar, escribe <b>RESTABLECER</b><input name="confirm" autocomplete="off" autocapitalize="characters" required></label>
    <p class="error" role="alert"></p>
    <div class="actions"><button class="btn" type="button" data-close>Cancelar</button><button class="btn danger" type="submit" id="reset-go" disabled>Borrar todo y restablecer</button></div></form>`);
  const form = $("#reset-form", dlg);
  const ready = () => ($("#reset-go", dlg).disabled = form.confirm.value !== "RESTABLECER" || !form.password.value);
  form.addEventListener("input", ready);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $(".error", dlg);
    $("#reset-go", dlg).disabled = true;
    try {
      await api("admin/factory-reset", { method: "POST", body: { password: form.password.value, confirm: form.confirm.value } });
      dlg.close();
      logout();
      $("#login-error").textContent = "App restablecida. Entra con jefa y la contraseña inicial.";
    } catch (ex) { err.textContent = ex.message; ready(); }
  });
}

// ---------- eventos ----------
function bind() {
  $("#tabs").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-view]");
    if (!b) return;
    state.view = b.dataset.view;
    store.set("turnos.view", state.view);
    firstGridRender = true;
    await ensureVisible();
    render();
  });
  const step = async (dir) => {
    const c = state.cursor;
    if (state.view === "week") state.cursor = addDays(c, 7 * dir);
    else if (state.view === "year") state.cursor = ymd(+c.slice(0, 4) + dir, 0, 1);
    else { const dt = parse(monthStart(c)); dt.setUTCMonth(dt.getUTCMonth() + dir); state.cursor = fmt(dt); }
    firstGridRender = true;
    await ensureVisible();
    render();
  };
  $("#prev").onclick = () => step(-1);
  $("#next").onclick = () => step(1);
  $("#today").onclick = async () => { state.cursor = todayStr(); firstGridRender = true; await ensureVisible(); render(); };
  $("#undo").onclick = undo;
  $("#fill-year").onclick = openFill;
  $("#absence-btn").onclick = () => openAbsence();
  $("#user-btn").onclick = (e) => { e.stopPropagation(); $("#user-menu").hidden = !$("#user-menu").hidden; };
  $("#m-pass").onclick = () => { $("#user-menu").hidden = true; openPassword(); };
  $("#m-team").onclick = () => { $("#user-menu").hidden = true; openTeam(); };
  $("#m-reset").onclick = () => { $("#user-menu").hidden = true; openFactoryReset(); };
  $("#m-logout").onclick = () => logout();
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".menu-wrap")) $("#user-menu").hidden = true;
    if (!e.composedPath().includes(pop()) && !e.target.closest("[data-u],[data-s]")) closePopover();
  });

  $("#palette").addEventListener("click", (e) => {
    const b = e.target.closest("[data-brush]");
    if (!b) return;
    state.brush = state.brush === b.dataset.brush ? null : b.dataset.brush;
    renderPalette();
  });

  $("#alert").addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    if (b.dataset.act === "fill") return openFill();
    if (b.dataset.act === "gap") return openCoverPopover(b, b.dataset.d, b.dataset.s);
    if (b.dataset.act === "autocover") {
      const dates = periodDates();
      const ov = new Map();
      const ch = autoCover(dates, ov);
      if (!ch.length) return toast("Nadie de 9–18 está disponible para esos huecos");
      applyChanges(ch);
      const left = gapsIn(dates).length;
      toast(`${ch.length} turno${ch.length > 1 ? "s" : ""} cubierto${ch.length > 1 ? "s" : ""}` + (left ? ` · ${left} siguen sin cubrir` : " ✓"));
    }
  });

  const view = $("#view");
  view.addEventListener("pointerdown", (e) => {
    const cell = e.target.closest(".cell");
    if (!cell || !state.brush || e.button > 0) return;
    e.preventDefault();
    drag = { changes: new Map(), warned: false, touch: e.pointerType === "touch" };
    // Mayús + clic: pinta todo el tramo desde la última casilla de esa fila
    if (e.shiftKey && lastCell && lastCell.dataset.u === cell.dataset.u) {
      const [a, b] = [lastCell.dataset.d, cell.dataset.d].sort();
      for (const c of $$(`.cell[data-u="${cell.dataset.u}"]`, view)) if (c.dataset.d >= a && c.dataset.d <= b) paintCell(c);
    } else paintCell(cell);
    lastCell = cell;
  });
  let lastCell = null;
  view.addEventListener("pointerover", (e) => {
    if (!drag || drag.touch) return;
    const cell = e.target.closest(".cell");
    if (cell) paintCell(cell);
  });
  window.addEventListener("pointerup", endDrag);
  window.addEventListener("pointercancel", endDrag);

  view.addEventListener("click", (e) => {
    const cell = e.target.closest(".cell, .chip, .md:not(.blank)");
    if (cell) {
      if (state.brush) {
        if (cell.classList.contains("cell")) return; // ya pintado en pointerdown
        const u = userById(cell.dataset.u);
        const code = state.brush === "CLEAR" ? null : state.brush;
        if (code && !ALLOWED[u.role].has(code)) return toast(`${u.name} no puede usar esa ficha.`);
        return applyChanges([{ u: u.id, d: cell.dataset.d, c: code }]);
      }
      return openCellPopover(cell, cell.dataset.u, cell.dataset.d);
    }
    const cov = e.target.closest(".cov, .slot.gap");
    if (cov) {
      if (cov.classList.contains("gap")) return openCoverPopover(cov, cov.dataset.d, cov.dataset.s);
      return openDay(cov.dataset.d);
    }
    const day = e.target.closest("[data-date]");
    if (day) return openDay(day.dataset.date);
    const mh = e.target.closest("[data-month]");
    if (mh) { state.view = "grid"; state.cursor = mh.dataset.month; store.set("turnos.view", "grid"); firstGridRender = true; return ensureVisible().then(render); }
  });
  view.addEventListener("change", (e) => {
    if (e.target.id === "year-person") { state.yearUid = e.target.value; render(); }
  });

  document.addEventListener("keydown", (e) => {
    if (dialogOpen() || /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) || !state.me) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); return undo(); }
    if (e.key === "Escape") { closePopover(); if (state.brush) { state.brush = null; renderPalette(); } return; }
    const code = e.key === "0" ? "CLEAR" : ORDER.find((c) => FICHAS[c].key === e.key);
    if (code && !e.ctrlKey && !e.metaKey && !e.altKey) { state.brush = state.brush === code ? null : code; renderPalette(); }
  });

  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    $("#login-error").textContent = "";
    try {
      const r = await api("login", { method: "POST", body: { username: f.get("username"), password: f.get("password") } });
      state.token = r.token;
      store.set("turnos.token", r.token);
      e.target.reset();
      await start(r.user, r.mustChange);
    } catch (ex) { $("#login-error").textContent = ex.message; }
  });
}

// ---------- ciclo de vida ----------
let pollTimer;
async function poll() {
  if (!state.me || document.hidden || state.pending || drag || state.syncError) return;
  try {
    const years = Object.keys(state.data);
    const changed = (await Promise.all(years.map((y) => loadYear(y, { force: true })))).some(Boolean);
    if (changed && !state.pending) render();
    else renderFoot();
  } catch {}
}
async function start(user, mustChange) {
  state.me = user;
  $("#login").hidden = true;
  $("#app").hidden = false;
  firstGridRender = true;
  await ensureVisible();
  state.me = state.users.find((u) => u.id === user.id) || user;
  renderPalette();
  render();
  clearInterval(pollTimer);
  pollTimer = setInterval(poll, 15000);
  if (mustChange) openPassword(true);
}
function logout() {
  state.token = null;
  state.me = null;
  state.data = {};
  state.users = [];
  state.undo = [];
  store.set("turnos.token", null);
  clearInterval(pollTimer);
  closePopover();
  $$("dialog").forEach((d) => d.close());
  $("#app").hidden = true;
  $("#login").hidden = false;
}

async function init() {
  bind();
  if (state.token) {
    try {
      const r = await api("me");
      return await start(r.user, r.mustChange);
    } catch {}
  }
  $("#login").hidden = false;
}
init();
