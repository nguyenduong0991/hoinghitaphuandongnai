// Localhost and LAN access use the backend on the same computer. GitHub Pages
// keeps its separate public tunnel setting for the published demo.
const isGitHubPages = window.location.hostname.endsWith(".github.io");
const localBackendHost = ["localhost", "127.0.0.1"].includes(window.location.hostname)
    ? "localhost"
    : window.location.hostname;
window.TGPL_API_BASE_URL = window.TGPL_API_BASE_URL || (isGitHubPages
    ? "https://command-type-angeles-laptop.trycloudflare.com/api"
    : `${window.location.protocol}//${localBackendHost}:3001/api`);
