import { randomBytes, scrypt, createHmac, timingSafeEqual } from "node:crypto";
import { readJSON, writeJSON } from "./store.mjs";

const TOKEN_DAYS = 30;

function scryptAsync(password, salt) {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, 32, (err, key) => (err ? reject(err) : resolve(key)))
  );
}

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt);
  return { salt: salt.toString("hex"), hash: key.toString("hex") };
}

export async function checkPassword(password, user) {
  const key = await scryptAsync(password, Buffer.from(user.salt, "hex"));
  const expected = Buffer.from(user.hash, "hex");
  return key.length === expected.length && timingSafeEqual(key, expected);
}

export function randomPassword() {
  // Legible: sin caracteres ambiguos
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(10);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out.slice(0, 5) + "-" + out.slice(5);
}

let cachedSecret;
async function secret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (cachedSecret) return cachedSecret;
  let cfg = await readJSON("config");
  if (!cfg?.secret) {
    cfg = { secret: randomBytes(32).toString("hex") };
    await writeJSON("config", cfg);
  }
  cachedSecret = cfg.secret;
  return cachedSecret;
}

const b64 = (buf) => Buffer.from(buf).toString("base64url");

// pv = huella de la contraseña: al cambiarla, las demás sesiones dejan de valer.
export async function signToken(user) {
  const payload = {
    uid: user.id,
    pv: user.hash.slice(0, 10),
    exp: Date.now() + TOKEN_DAYS * 86400000,
  };
  const body = b64(JSON.stringify(payload));
  const sig = createHmac("sha256", await secret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export async function verifyToken(token) {
  if (!token || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  const expected = createHmac("sha256", await secret()).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString());
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}
