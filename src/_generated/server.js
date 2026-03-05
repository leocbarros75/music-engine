// src/server.ts
import http from "node:http";
import process from "node:process";
import { parseMusicXMLToScoreModel } from "./parsers/musicxmlParser";
import { analyzeHarmony } from "./harmony/analyzeHarmony";
function sendJson(res, status, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(status, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
    });
    res.end(body);
}
function readBody(req) {
    return new Promise((resolve, reject) => {
        let data = "";
        req.on("data", (chunk) => (data += String(chunk)));
        req.on("end", () => resolve(data));
        req.on("error", reject);
    });
}
function isObject(x) {
    return typeof x === "object" && x !== null && !Array.isArray(x);
}
const server = http.createServer(async (req, res) => {
    try {
        if (req.method === "OPTIONS") {
            res.writeHead(204, {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "POST,OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type"
            });
            res.end();
            return;
        }
        if (req.method !== "POST") {
            sendJson(res, 405, { ok: false, error: "Method not allowed" });
            return;
        }
        const url = req.url ?? "/";
        const raw = await readBody(req);
        const body = raw ? JSON.parse(raw) : {};
        if (!isObject(body)) {
            sendJson(res, 400, { ok: false, error: "Invalid JSON body" });
            return;
        }
        // --- analyze harmony ---
        if (url === "/analyze_harmony") {
            const musicxml = typeof body.musicxml === "string" ? body.musicxml : null;
            const scoreModel = body.scoreModel ?? null;
            let score = null;
            if (scoreModel)
                score = scoreModel;
            if (!score && musicxml)
                score = parseMusicXMLToScoreModel(musicxml);
            if (!score) {
                sendJson(res, 400, { ok: false, error: "Provide either 'scoreModel' or 'musicxml' in the request body." });
                return;
            }
            const options = isObject(body.options) ? body.options : {};
            const out = analyzeHarmony({
                scoreModel: score,
                options
            });
            sendJson(res, 200, out);
            return;
        }
        // --- arrange pipeline (temporarily disabled) ---
        if (url === "/arrange_musicxml") {
            sendJson(res, 501, {
                ok: false,
                error: "Route /arrange_musicxml is temporarily disabled because pipelineMusicxmlToArrangedMusicxml is not wired to a valid file path."
            });
            return;
        }
        sendJson(res, 404, { ok: false, error: `Unknown route: ${url}` });
    }
    catch (e) {
        sendJson(res, 500, { ok: false, error: e?.message ?? String(e) });
    }
});
/**
 * Graceful shutdown for dev watcher:
 * - close HTTP server
 * - destroy keep-alive sockets
 * - then exit immediately so tsx watch doesn't force-kill
 */
const sockets = new Set();
server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
});
let shuttingDown = false;
function shutdown(signal) {
    if (shuttingDown)
        return;
    shuttingDown = true;
    // eslint-disable-next-line no-console
    console.log(`[server] received ${signal}, shutting down...`);
    // Stop accepting new connections
    server.close((err) => {
        if (err) {
            // eslint-disable-next-line no-console
            console.error("[server] error during server.close:", err);
            process.exit(1);
            return;
        }
        // eslint-disable-next-line no-console
        console.log("[server] http server closed");
        // Hard-exit for dev watcher reliability
        process.exit(0);
    });
    // End/destroy open sockets (keep-alive)
    for (const s of sockets) {
        try {
            s.end();
            s.destroy();
        }
        catch {
            // ignore
        }
    }
    // Fallback: if close callback never fires, exit soon
    setTimeout(() => {
        process.exit(0);
    }, 250).unref();
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
const PORT = Number(process.env.PORT ?? 3001);
server.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`music-engine server listening on http://localhost:${PORT}`);
});
//# sourceMappingURL=server.js.map