// The web repository is separate from D:\DuAnTGPL\backend.
// Local development uses the isolated demo backend on port 3001. The public
// GitHub Pages site calls the temporary Cloudflare Quick Tunnel below.
const isLocalHost = ["localhost", "127.0.0.1"].includes(window.location.hostname);
window.TGPL_API_BASE_URL = window.TGPL_API_BASE_URL || (isLocalHost
    ? "http://localhost:3001/api"
    : "https://processor-myrtle-markers-compete.trycloudflare.com/api");
