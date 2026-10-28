// Almacenamiento: Netlify Blobs en producción, memoria en pruebas locales (TURNOS_MEMORY=1).
const mem = new Map();
const memStore = {
  async get(key) {
    return mem.has(key) ? structuredClone(mem.get(key)) : null;
  },
  async setJSON(key, value) {
    mem.set(key, structuredClone(value));
  },
  async delete(key) {
    mem.delete(key);
  },
  async list({ prefix = "" } = {}) {
    return { blobs: [...mem.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) };
  },
};

async function store() {
  if (process.env.TURNOS_MEMORY === "1") return memStore;
  const { getStore } = await import("@netlify/blobs"); // solo se carga en Netlify
  // Sin caché: el token de Blobs caduca, hay que crear el acceso en cada petición.
  return getStore({ name: "turnos", consistency: "strong" });
}

export const readJSON = async (key) => ((await store()).get(key, { type: "json" })).then((v) => v ?? null);
export const writeJSON = async (key, value) => (await store()).setJSON(key, value);
export const removeKey = async (key) => (await store()).delete(key);
export const listKeys = async (prefix) => ((await (await store()).list({ prefix })).blobs || []).map((b) => b.key);
