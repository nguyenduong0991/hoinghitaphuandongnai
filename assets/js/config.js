// The web repository is separate from D:\DuAnTGPL\backend.
// Locally, call the PostgreSQL backend on port 3000. Set the deployed HTTPS
// API URL here when the backend has a public, protected deployment.
const isLocalHost = ["localhost", "127.0.0.1"].includes(window.location.hostname);
window.TGPL_API_BASE_URL = window.TGPL_API_BASE_URL || (isLocalHost ? "http://localhost:3000/api" : "");
