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
};

let blobStore;
async function store() {
  if (process.env.TURNOS_MEMORY === "1") return memStore;
  if (!blobStore) {
    const { getStore } = await import("@netlify/blobs"); // solo se carga en Netlify
    blobStore = getStore({ name: "turnos", consistency: "strong" });
  }
  return blobStore;
}

export const readJSON = async (key) => ((await store()).get(key, { type: "json" })).then((v) => v ?? null);
export const writeJSON = async (key, value) => (await store()).setJSON(key, value);
export const removeKey = async (key) => (await store()).delete(key);
