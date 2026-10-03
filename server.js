const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const port = Number(process.env.PORT) || 8080;
const contentTypes = {
    ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".ico": "image/x-icon"
};

http.createServer((request, response) => {
    let pathname;
    try { pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname); }
    catch { response.writeHead(400).end("Yêu cầu không hợp lệ."); return; }
    if (pathname === "/") pathname = "/index.html";
    const filePath = path.resolve(root, `.${pathname}`);
    if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) {
        response.writeHead(403).end("Không được phép truy cập.");
        return;
    }
    fs.readFile(filePath, (error, content) => {
        if (error) {
            response.writeHead(error.code === "ENOENT" ? 404 : 500, { "Content-Type": "text/plain; charset=utf-8" });
            response.end(error.code === "ENOENT" ? "Không tìm thấy trang." : "Không thể đọc tệp.");
            return;
        }
        response.writeHead(200, { "Content-Type": contentTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream", "X-Content-Type-Options": "nosniff" });
        response.end(content);
    });
}).listen(port, "127.0.0.1", () => console.log(`TGPL giao diện đang chạy tại http://localhost:${port}`));
