import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

process.env.TURNOS_MEMORY = "1";
const { handle } = await import("../netlify/functions/api.mjs");

const root = join(fileURLToPath(new URL("..", import.meta.url)), "public");
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".json": "application/json" };
const port = Number(process.env.PORT) || 8888;

http
  .createServer(async (req, res) => {
    try {
      if (req.url.startsWith("/api/")) {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const r = await handle(
          new Request(`http://localhost:${port}${req.url}`, {
            method: req.method,
            headers: req.headers,
            body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks),
          })
        );
        res.writeHead(r.status, Object.fromEntries(r.headers));
        return res.end(Buffer.from(await r.arrayBuffer()));
      }
      const path = normalize(req.url.split("?")[0]).replace(/^(\.\.[/\\])+/, "");
      const file = join(root, path === "/" ? "index.html" : path);
      if (!file.startsWith(root)) throw new Error("fuera de raíz");
      const data = await readFile(file);
      res.writeHead(200, { "content-type": types[extname(file)] || "application/octet-stream" });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end("No encontrado");
    }
  })
  .listen(port, () => console.log(`Gestor de turnos en http://localhost:${port}  (usuario: jefa · contraseña: turnos2026)`));
