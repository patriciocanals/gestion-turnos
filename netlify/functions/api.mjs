// API única del Gestor de turnos. Ruta: /api/*
import { randomBytes } from "node:crypto";
import { readJSON, writeJSON, removeKey, listKeys } from "../lib/store.mjs";
import {
  hashPassword,
  checkPassword,
  randomPassword,
  signToken,
  verifyToken,
} from "../lib/auth.mjs";

export const config = { path: "/api/*" };

const CODES = new Set(["O", "M", "T", "N", "L", "V", "A", "X"]);
const ROLE_CODES = {
  office: CODES,
  rotating: new Set(["M", "T", "N", "L", "V", "A", "X"]),
  boss: new Set(["L", "V", "A", "X"]),
};
const ROLES = Object.keys(ROLE_CODES);
const MAX_CHANGES = 6000;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
const fail = (status, error) => json({ error }, status);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- usuarios ----------
async function loadUsers() {
  let users = await readJSON("users");
  if (users) return users;
  // Primera ejecución: se crea el equipo base. El jefe (admin) lo renombra desde la app.
  const initial = process.env.INITIAL_PASSWORD || "turnos2026";
  const seed = [
    ["jefa", "Jefa", "boss", true],
    ["oficina1", "Oficina 1", "office", false],
    ["oficina2", "Oficina 2", "office", false],
    ["turno1", "Turno 1", "rotating", false],
    ["turno2", "Turno 2", "rotating", false],
    ["turno3", "Turno 3", "rotating", false],
    ["turno4", "Turno 4", "rotating", false],
    ["turno5", "Turno 5", "rotating", false],
  ];
  users = [];
  for (const [i, [username, name, role, admin]] of seed.entries()) {
    users.push({
      id: "u" + (i + 1),
      username,
      name,
      role,
      admin,
      mustChange: true,
      ...(await hashPassword(initial)),
    });
  }
  await writeJSON("users", users);
  return users;
}
const saveUsers = (users) => writeJSON("users", users);
const publicUser = (u) => ({ id: u.id, username: u.username, name: u.name, role: u.role, admin: !!u.admin });

async function authenticate(req) {
  const h = req.headers.get("authorization") || "";
  const payload = await verifyToken(h.startsWith("Bearer ") ? h.slice(7) : "");
  if (!payload) return null;
  const users = await loadUsers();
  const user = users.find((u) => u.id === payload.uid);
  if (!user || user.hash.slice(0, 10) !== payload.pv) return null;
  return { user, users };
}

const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
const validYear = (y) => Number.isInteger(y) && y >= 2000 && y <= 2100;

async function body(req) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

// ---------- rutas ----------
async function login(req) {
  const { username, password } = await body(req);
  const users = await loadUsers();
  const user = users.find((u) => u.username === String(username || "").trim().toLowerCase());
  const ok = user && typeof password === "string" && (await checkPassword(password, user));
  if (!ok) {
    await sleep(500);
    return fail(401, "Usuario o contraseña incorrectos");
  }
  return json({ token: await signToken(user), user: publicUser(user), mustChange: !!user.mustChange });
}

async function changePassword(req, { user, users }) {
  const { current, next } = await body(req);
  if (typeof next !== "string" || next.length < 6) return fail(400, "La contraseña nueva debe tener al menos 6 caracteres");
  if (!(await checkPassword(String(current || ""), user))) return fail(403, "La contraseña actual no es correcta");
  Object.assign(user, await hashPassword(next), { mustChange: false });
  await saveUsers(users);
  return json({ token: await signToken(user) });
}

async function getState(url, { users }) {
  const year = Number(url.searchParams.get("year"));
  if (!validYear(year)) return fail(400, "Año no válido");
  const data = {};
  await Promise.all(
    users.map(async (u) => {
      data[u.id] = (await readJSON(`sched-${year}-${u.id}`)) || {};
    })
  );
  return json({ year, users: users.map(publicUser), data, meta: (await readJSON("meta")) || null });
}

async function putCells(req, { user, users }) {
  const { changes } = await body(req);
  if (!Array.isArray(changes) || !changes.length) return fail(400, "Sin cambios");
  if (changes.length > MAX_CHANGES) return fail(413, "Demasiados cambios a la vez");
  const byKey = new Map(); // `${year}/${uid}` -> cambios
  for (const ch of changes) {
    const target = users.find((u) => u.id === ch?.u);
    if (!target) return fail(400, "Usuario desconocido");
    if (!isDate(ch.d)) return fail(400, "Fecha no válida");
    if (ch.c !== null && !ROLE_CODES[target.role].has(ch.c)) {
      return fail(400, `El código ${ch.c} no es válido para ${target.name}`);
    }
    const key = `${ch.d.slice(0, 4)}-${target.id}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(ch);
  }
  await Promise.all(
    [...byKey].map(async ([key, list]) => {
      const doc = (await readJSON(`sched-${key}`)) || {};
      for (const ch of list) {
        if (ch.c === null) delete doc[ch.d];
        else doc[ch.d] = ch.c;
      }
      await writeJSON(`sched-${key}`, doc);
    })
  );
  const meta = { by: user.name, at: Date.now() };
  await writeJSON("meta", meta);
  return json({ ok: true, meta });
}

async function adminSaveUser(req, { users }) {
  const b = await body(req);
  const name = String(b.name || "").trim().slice(0, 40);
  const username = String(b.username || "").trim().toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 30);
  if (!name || !username) return fail(400, "Nombre y usuario son obligatorios");
  if (!ROLES.includes(b.role)) return fail(400, "Tipo de puesto no válido");
  if (users.some((u) => u.username === username && u.id !== b.id)) return fail(409, "Ese usuario ya existe");
  let tempPassword = null;
  let user = users.find((u) => u.id === b.id);
  if (user) {
    if (user.admin && !b.admin && users.filter((u) => u.admin).length === 1) {
      return fail(400, "Debe quedar al menos una persona administradora");
    }
    Object.assign(user, { name, username, role: b.role, admin: !!b.admin });
  } else {
    tempPassword = randomPassword();
    user = {
      id: "u" + randomBytes(3).toString("hex"),
      name,
      username,
      role: b.role,
      admin: !!b.admin,
      mustChange: true,
      ...(await hashPassword(tempPassword)),
    };
    users.push(user);
  }
  await saveUsers(users);
  return json({ user: publicUser(user), tempPassword });
}

async function adminReset(req, { users }) {
  const { id } = await body(req);
  const user = users.find((u) => u.id === id);
  if (!user) return fail(404, "Usuario no encontrado");
  const tempPassword = randomPassword();
  Object.assign(user, await hashPassword(tempPassword), { mustChange: true });
  await saveUsers(users);
  return json({ tempPassword });
}

async function adminDelete(id, { user, users }) {
  if (id === user.id) return fail(400, "No puedes eliminarte a ti misma/o");
  const idx = users.findIndex((u) => u.id === id);
  if (idx < 0) return fail(404, "Usuario no encontrado");
  users.splice(idx, 1);
  await saveUsers(users);
  return json({ ok: true });
}

// Restablecer de fábrica: borra todos los turnos y usuarios. Los usuarios se recrean solos
// (con INITIAL_PASSWORD) en la siguiente petición. Exige contraseña de la persona administradora.
async function factoryReset(req, { user }) {
  const { password, confirm } = await body(req);
  if (confirm !== "RESTABLECER") return fail(400, "Escribe RESTABLECER para confirmar");
  if (typeof password !== "string" || !(await checkPassword(password, user))) {
    await sleep(800);
    return fail(403, "La contraseña no es correcta");
  }
  const keys = [...(await listKeys("sched-")), ...(await listKeys("sched/"))];
  for (const k of keys) await removeKey(k);
  await removeKey("meta");
  await removeKey("users"); // al final: si algo falla antes, la sesión sigue siendo válida
  return json({ ok: true, deleted: keys.length });
}

// ---------- router ----------
export async function handle(req) {
  const url = new URL(req.url);
  const route = url.pathname.replace(/^\/api\/?/, "").replace(/\/$/, "");
  const m = req.method;
  try {
    if (route === "login" && m === "POST") return await login(req);

    const auth = await authenticate(req);
    if (!auth) return fail(401, "Sesión no válida");

    if (route === "me" && m === "GET") return json({ user: publicUser(auth.user), mustChange: !!auth.user.mustChange });
    if (route === "password" && m === "POST") return await changePassword(req, auth);
    if (route === "state" && m === "GET") return await getState(url, auth);
    if (route === "cells" && m === "PUT") return await putCells(req, auth);

    if (route.startsWith("admin/")) {
      if (!auth.user.admin) return fail(403, "Solo la administración puede hacer esto");
      if (route === "admin/users" && m === "POST") return await adminSaveUser(req, auth);
      if (route === "admin/factory-reset" && m === "POST") return await factoryReset(req, auth);
      if (route === "admin/reset" && m === "POST") return await adminReset(req, auth);
      if (route.startsWith("admin/users/") && m === "DELETE") return await adminDelete(route.split("/")[2], auth);
    }
    return fail(404, "No encontrado");
  } catch (err) {
    console.error(err);
    return fail(500, "Error del servidor: " + err.message);
  }
}

export default async (req) => handle(req);
