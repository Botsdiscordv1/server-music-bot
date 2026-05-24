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

const blockedDomain = "yvlqtyt.mongodb.net";

function isBlocked(hostname) {
  return typeof hostname === "string" && hostname.endsWith("." + blockedDomain);
}

// --- Patch dns.promises.resolve (MongoDB driver uses this with rrtype) ---
const origPromisesResolve = dnsPromises.resolve;
dnsPromises.resolve = (hostname, rrtype) => {
  if (isBlocked(hostname)) {
    return resolveViaGoogle(hostname, rrtype);
  }
  return origPromisesResolve(hostname, rrtype);
};

console.log("[DNS-PATCH] Google DNS resolver enabled for " + blockedDomain);
