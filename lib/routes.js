// Host HTTP route behind the settings page's "test connection" button.
//
// The browser card cannot read the stored secret (the settings service redacts
// `role("secret")` fields on every read), so the check has to run on the host and
// report back only non-secret facts: which app answered, which tenant, and a
// masked fingerprint of the key that was actually used.

/** Serialize a JSON body. */
export function sendJson(response, status, body) {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(text),
  });
  response.end(text);
}

/** Same-origin check: the route must not be reachable from another page. */
export function isSameOrigin(request) {
  const origin = request.headers?.origin;
  if (typeof origin !== "string" || origin.length === 0) {
    // Non-browser clients (curl) have no Origin; Host must still be present.
    return typeof request.headers?.host === "string";
  }
  try {
    return new URL(origin).host === request.headers?.host;
  } catch {
    return false;
  }
}

/** Masked fingerprint: enough to recognize a key, not enough to use it. */
export function fingerprint(secret) {
  if (typeof secret !== "string" || secret.length === 0) return null;
  if (secret.length <= 8) return `${"*".repeat(secret.length)} (len ${secret.length})`;
  return `${secret.slice(0, 4)}…${secret.slice(-3)} (len ${secret.length})`;
}

export const TEST_CONNECTION_PATH = "/dsh-plugin-feishu/test-connection";

/**
 * Mount the route.
 * @param host - host context exposing `webServer` (and optionally `effect`).
 * @param deps - `testConnection()` returning the non-secret report.
 * @returns disposer removing the route.
 */
export function mountFeishuRoutes(host, { testConnection }) {
  const dispose = host.webServer.register({
    kind: "exact",
    path: TEST_CONNECTION_PATH,
    handler: async (request, response) => {
      if (request.method !== "POST") {
        response.writeHead(405, { allow: "POST" });
        response.end();
        return;
      }
      if (!isSameOrigin(request)) {
        sendJson(response, 403, { ok: false, error: "cross-origin request refused" });
        return;
      }
      try {
        const report = await testConnection();
        sendJson(response, 200, { ok: true, ...report });
      } catch (err) {
        sendJson(response, 200, {
          ok: false,
          error: err?.message ?? String(err),
          ...(err?.code === undefined ? {} : { code: err.code }),
        });
      }
    },
  });
  return () => {
    if (typeof dispose === "function") dispose();
  };
}
