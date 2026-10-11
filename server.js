const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const port = Number(process.env.PORT) || 8080;
const host = process.env.HOST || "127.0.0.1";
const lanMode = process.env.TGPL_LAN_MODE === "1";
function isPrivateAddress(address = "") {
    const ip = address.replace(/^::ffff:/, "").split("%")[0];
    if (ip === "::1" || /^fc[0-9a-f]{2}:/i.test(ip) || /^fd[0-9a-f]{2}:/i.test(ip) || /^fe80:/i.test(ip)) return true;
    const parts = ip.split(".").map(Number);
    if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false;
    return parts[0] === 10 || parts[0] === 127 || (parts[0] === 192 && parts[1] === 168) ||
        (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 169 && parts[1] === 254);
}
const contentTypes = {
    ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".ico": "image/x-icon"
};

http.createServer((request, response) => {
    if (lanMode && !isPrivateAddress(request.socket.remoteAddress)) {
        response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" }).end("Chỉ cho phép truy cập từ mạng nội bộ.");
        return;
    }
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
}).listen(port, host, () => console.log(`TGPL giao diện đang chạy tại http://${host}:${port}`));
