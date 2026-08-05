import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

const root = resolve(".");
const port = Number(process.env.LARDER_REPORT_PORT || 4173);
const host = process.env.LARDER_REPORT_HOST || "0.0.0.0";
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

const server = createServer(async (request, response) => {
  const requestPath = new URL(request.url || "/", "http://localhost").pathname;
  const fileName = requestPath === "/" ? "index.html" : requestPath.replace(/^\/+/, "");
  const fullPath = normalize(join(root, fileName));

  if (!fullPath.startsWith(root)) {
    response.writeHead(403).end("Forbidden");
    return;
  }

  try {
    const info = await stat(fullPath);
    if (!info.isFile()) throw new Error("Not a file");
    response.writeHead(200, {
      "Content-Type": mimeTypes[extname(fullPath)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    createReadStream(fullPath).pipe(response);
  } catch {
    response.writeHead(404).end("Not found");
  }
});

server.listen(port, host, () => {
  console.log(`Larder report is available at http://localhost:${port}`);
});
