const BACKEND = "proyectosbosantigravity-evqo.onrender.com";

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const backendUrl = `https://${BACKEND}${url.pathname}${url.search}`;

    if (request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
      const backendReq = new Request(backendUrl, {
        method: "GET",
        headers: request.headers,
      });
      return fetch(backendReq);
    }

    return fetch(backendUrl, {
      method: request.method,
      headers: request.headers,
      body: request.body,
    });
  },
};
