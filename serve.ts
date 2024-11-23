import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import { HTTP_PORT } from "./consts";

const PORT: number = HTTP_PORT;
const FOLDER_TO_SERVE: string = path.resolve("./build");

const server: http.Server = http.createServer((req: http.IncomingMessage, res: http.ServerResponse) => {
    try {
        // Ensure the URL is properly decoded
        let url = new URL("http://example.com" + req.url || "");
        let reqPath = url.pathname;
        if (reqPath === "/") {
            reqPath = "/index.html";
        }
        const decodedUrl = decodeURIComponent(reqPath);

        // Resolve the full path
        const requestedPath = path.resolve(path.join(FOLDER_TO_SERVE, decodedUrl));
        console.log(`Requested path: ${requestedPath}`);

        // Check if the requested path is within FOLDER_TO_SERVE
        if (!requestedPath.startsWith(FOLDER_TO_SERVE)) {
            res.writeHead(403);
            res.end("403 Forbidden");
            return;
        }

        fs.readFile(requestedPath, (err: NodeJS.ErrnoException | null, content: Buffer) => {
            if (err) {
                if (err.code === "ENOENT") {
                    res.writeHead(404);
                    res.end("404 Not Found");
                } else {
                    console.error(err);
                    res.writeHead(500);
                    res.end("500 Internal Server Error");
                }
            } else {
                res.writeHead(200, { "Content-Type": getContentType(requestedPath) });
                res.end(content);
            }
        });
    } catch (e) {
        console.error(e);
        try {
            res.writeHead(500);
            res.end("500 Internal Server Error");
        } catch { }
    }
});

function getContentType(filePath: string): string {
    const extname = path.extname(filePath).toLowerCase();
    const contentTypes: { [key: string]: string } = {
        ".html": "text/html",
        ".js": "text/javascript",
        ".cjs": "text/javascript",
        ".css": "text/css",
        ".json": "application/json",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".gif": "image/gif",
        ".svg": "image/svg+xml",
        ".wav": "audio/wav",
        ".mp4": "video/mp4",
        ".woff": "application/font-woff",
        ".ttf": "application/font-ttf",
        ".eot": "application/vnd.ms-fontobject",
        ".otf": "application/font-otf",
        ".wasm": "application/wasm"
    };
    return contentTypes[extname] || "application/octet-stream";
}

server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}/`);
    console.log(`Serving files from: ${FOLDER_TO_SERVE}`);
});