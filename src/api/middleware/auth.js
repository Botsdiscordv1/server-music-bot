const jwt = require("jsonwebtoken");
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-in-production";

function resolveProviderUserId(payload) {
  const provider = payload.provider || "android";
  const userId = (provider === "discord" && payload.discordId) ? payload.discordId : payload.sub;
  return { provider, userId, mongoId: payload.sub };
}

function requireApiKey(req, res, next) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    try {
      const payload = jwt.verify(authHeader.slice(7), JWT_SECRET);
      Object.assign(req, resolveProviderUserId(payload));
      return next();
    } catch {}
  }

  const apiKey = process.env.API_KEY;
  if (!apiKey) return next();

  const provided = req.headers["x-api-key"] || req.query.api_key;
  if (!provided || provided !== apiKey) {
    return res.status(401).json({ error: "Unauthorized: invalid or missing API key" });
  }
  next();
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized: missing or invalid token" });
  }

  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    Object.assign(req, resolveProviderUserId(payload));
    next();
  } catch {
    return res.status(401).json({ error: "Unauthorized: invalid or expired token" });
  }
}

module.exports = { requireApiKey, requireAuth };
