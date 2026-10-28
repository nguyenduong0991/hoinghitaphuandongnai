const multer = require("multer");
const path = require("path");
const fs = require("fs");

const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, "..", "uploads");

function decodeOriginalFilename(filename) {
    const value = String(filename || "");
    if (!/[ÃÂÄÆÅ][\u0080-\u00bf]|á[»¼½]/u.test(value)) return value;
    try {
        const decoded = Buffer.from(value, "latin1").toString("utf8");
        return decoded.includes("\uFFFD") ? value : decoded;
    } catch {
        return value;
    }
}

if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },

    filename: (req, file, cb) => {
        const originalName = decodeOriginalFilename(file.originalname);
        file.originalname = originalName;
        const extension = path.extname(originalName).replace(/[^.a-zA-Z0-9_-]/g, "").slice(0, 20);
        const baseName = path
            .basename(originalName, path.extname(originalName))
            .replace(/[^a-zA-Z0-9_-]/g, "_");

        const uniqueName =
            `${Date.now()}-${Math.round(Math.random() * 1E9)}-${baseName}${extension}`;

        cb(null, uniqueName);
    }
});

const upload = multer({
    storage: storage,

    limits: {
        fileSize: 20 * 1024 * 1024
    }
});

upload.uploadDir = uploadDir;
module.exports = upload;
