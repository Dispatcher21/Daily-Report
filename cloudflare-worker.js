// Cloudflare (test site only, see wrangler.jsonc). Files are served as-is
// by the static assets layer; this only runs for requests that match no
// file. With html_handling "none" that includes "/" and any "folder/"
// address, which here mean that folder's index.html, the way a regular web
// server would serve them.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/')) {
      url.pathname += 'index.html';
      return env.ASSETS.fetch(new Request(url, request));
    }
    return env.ASSETS.fetch(request);
  },
};
