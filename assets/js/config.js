// Localhost and LAN use the local backend. GitHub Pages uses the active
// temporary Quick Tunnel for this public test session.
const isGitHubPages = window.location.hostname.endsWith(".github.io");
const localBackendHost = ["localhost", "127.0.0.1"].includes(window.location.hostname)
    ? "localhost"
    : window.location.hostname;
window.TGPL_API_BASE_URL = window.TGPL_API_BASE_URL || (isGitHubPages
    ? "https://classes-harder-conducting-desktop.trycloudflare.com/api"
    : `${window.location.protocol}//${localBackendHost}:3001/api`);
