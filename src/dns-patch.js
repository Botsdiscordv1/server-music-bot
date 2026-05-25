const dns = require("dns");
const dnsPromises = dns.promises;

const googleResolver = new dns.Resolver();
googleResolver.setServers(["8.8.8.8", "8.8.4.4"]);

function resolveViaGoogle(hostname, rrtype) {
  return new Promise((resolve, reject) => {
    googleResolver.resolve(hostname, rrtype, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

const blockedDomains = [
  "yvlqtyt.mongodb.net",
  "ygb0lfg.mongodb.net",
];

// Also scan env vars for any additional mongodb.net Atlas endpoints
const MONGODB_URI_VARS = ["ANDROID_MONGODB_URI", "DISCORD_MONGODB_URI", "MONGODB_URI"];
for (const v of MONGODB_URI_VARS) {
  const uri = process.env[v];
  if (!uri) continue;
  const match = uri.match(/@([^\/:\?]+)/);
  if (match) {
    const host = match[1].replace(/^.*?\./, "");
    if (host.endsWith("mongodb.net") && !blockedDomains.includes(host)) {
      blockedDomains.push(host);
    }
  }
}

function isBlocked(hostname) {
  return typeof hostname === "string" && blockedDomains.some(d => hostname === d || hostname.endsWith("." + d));
}

const origPromisesResolve = dnsPromises.resolve;
dnsPromises.resolve = (hostname, rrtype) => {
  if (isBlocked(hostname)) {
    return resolveViaGoogle(hostname, rrtype);
  }
  return origPromisesResolve(hostname, rrtype);
};

console.log("[DNS-PATCH] Google DNS resolver enabled for " + blockedDomains.join(", "));
