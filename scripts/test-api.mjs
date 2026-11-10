import assert from "node:assert/strict";
process.env.TURNOS_MEMORY = "1";
const { handle } = await import("../netlify/functions/api.mjs");

const call = async (method, path, { token, body } = {}) => {
  const r = await handle(
    new Request("http://x" + path, {
      method,
      headers: { ...(token ? { authorization: "Bearer " + token } : {}), "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    })
  );
  return { status: r.status, data: await r.json() };
};

// login
assert.equal((await call("POST", "/api/login", { body: { username: "jefa", password: "mal" } })).status, 401);
const jefa = await call("POST", "/api/login", { body: { username: "jefa", password: "turnos2026" } });
assert.equal(jefa.status, 200);
assert.equal(jefa.data.mustChange, true);
let tj = jefa.data.token;

// sin token
assert.equal((await call("GET", "/api/state?year=2026")).status, 401);

// cambio de contraseña (invalida el token anterior)
assert.equal((await call("POST", "/api/password", { token: tj, body: { current: "x", next: "nueva123" } })).status, 403);
assert.equal((await call("POST", "/api/password", { token: tj, body: { current: "turnos2026", next: "123" } })).status, 400);
const ch = await call("POST", "/api/password", { token: tj, body: { current: "turnos2026", next: "nueva123" } });
assert.equal(ch.status, 200);
assert.equal((await call("GET", "/api/me", { token: tj })).status, 401);
tj = ch.data.token;
assert.equal((await call("GET", "/api/me", { token: tj })).data.mustChange, false);

// estado y edición
let st = await call("GET", "/api/state?year=2026", { token: tj });
assert.equal(st.data.users.length, 8);
const rot = st.data.users.find((u) => u.role === "rotating");
const off = st.data.users.find((u) => u.role === "office");
const boss = st.data.users.find((u) => u.role === "boss");
let r = await call("PUT", "/api/cells", { token: tj, body: { changes: [
  { u: rot.id, d: "2026-03-02", c: "N" },
  { u: off.id, d: "2026-03-02", c: "M" },
  { u: rot.id, d: "2027-01-01", c: "V" },
] } });
assert.equal(r.status, 200);
st = await call("GET", "/api/state?year=2026", { token: tj });
assert.equal(st.data.data[rot.id]["2026-03-02"], "N");
assert.equal(st.data.data[off.id]["2026-03-02"], "M");
assert.equal(st.data.meta.by, "Jefa");
assert.equal((await call("GET", "/api/state?year=2027", { token: tj })).data.data[rot.id]["2027-01-01"], "V");
// borrar
await call("PUT", "/api/cells", { token: tj, body: { changes: [{ u: rot.id, d: "2026-03-02", c: null }] } });
st = await call("GET", "/api/state?year=2026", { token: tj });
assert.equal(st.data.data[rot.id]["2026-03-02"], undefined);

// validaciones
assert.equal((await call("PUT", "/api/cells", { token: tj, body: { changes: [{ u: boss.id, d: "2026-03-02", c: "M" }] } })).status, 400);
assert.equal((await call("PUT", "/api/cells", { token: tj, body: { changes: [{ u: rot.id, d: "2026-03-02", c: "O" }] } })).status, 400);
assert.equal((await call("PUT", "/api/cells", { token: tj, body: { changes: [{ u: rot.id, d: "mañana", c: "M" }] } })).status, 400);
assert.equal((await call("PUT", "/api/cells", { token: tj, body: { changes: [{ u: "zzz", d: "2026-03-02", c: "M" }] } })).status, 400);

// administración
const newU = await call("POST", "/api/admin/users", { token: tj, body: { name: "Marta", username: "Marta", role: "rotating" } });
assert.equal(newU.status, 200);
assert.ok(newU.data.tempPassword);
const lm = await call("POST", "/api/login", { body: { username: "marta", password: newU.data.tempPassword } });
assert.equal(lm.status, 200);
assert.equal(lm.data.mustChange, true);
// una persona no admin no puede administrar
assert.equal((await call("POST", "/api/admin/users", { token: lm.data.token, body: { name: "X", username: "x", role: "office" } })).status, 403);
// pero sí editar
assert.equal((await call("PUT", "/api/cells", { token: lm.data.token, body: { changes: [{ u: newU.data.user.id, d: "2026-05-05", c: "V" }] } })).status, 200);
// reset y borrado
const rs = await call("POST", "/api/admin/reset", { token: tj, body: { id: newU.data.user.id } });
assert.equal((await call("POST", "/api/login", { body: { username: "marta", password: rs.data.tempPassword } })).status, 200);
assert.equal((await call("DELETE", "/api/admin/users/" + newU.data.user.id, { token: tj })).status, 200);
assert.equal((await call("POST", "/api/login", { body: { username: "marta", password: rs.data.tempPassword } })).status, 401);
assert.equal((await call("DELETE", "/api/admin/users/" + boss.id, { token: tj })).status, 400);

// restablecer de fábrica
const plain = await call("POST", "/api/login", { body: { username: "oficina1", password: "turnos2026" } });
assert.equal((await call("POST", "/api/admin/factory-reset", { token: plain.data.token, body: { password: "turnos2026", confirm: "RESTABLECER" } })).status, 403); // no admin
assert.equal((await call("POST", "/api/admin/factory-reset", { token: tj, body: { password: "nueva123", confirm: "si" } })).status, 400);
assert.equal((await call("POST", "/api/admin/factory-reset", { token: tj, body: { password: "mala", confirm: "RESTABLECER" } })).status, 403);
st = await call("GET", "/api/state?year=2026", { token: tj });
assert.ok(Object.values(st.data.data).some((d) => Object.keys(d).length)); // aún hay datos
const rr = await call("POST", "/api/admin/factory-reset", { token: tj, body: { password: "nueva123", confirm: "RESTABLECER" } });
assert.equal(rr.status, 200);
assert.equal((await call("GET", "/api/me", { token: tj })).status, 401); // sesión anterior invalidada
const fresh = await call("POST", "/api/login", { body: { username: "jefa", password: "turnos2026" } });
assert.equal(fresh.status, 200);
assert.equal(fresh.data.mustChange, true);
st = await call("GET", "/api/state?year=2026", { token: fresh.data.token });
assert.equal(st.data.users.length, 8);
assert.ok(Object.values(st.data.data).every((d) => Object.keys(d).length === 0)); // calendario vacío

console.log("✔ API: todas las pruebas correctas");
