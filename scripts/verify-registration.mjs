// Offline registration test: loads the plugin with a stub cordis context and asserts
// that it registers the expected tools, the bundled skill provider, the settings
// namespace (for the configuration page) and a valid chart PNG.
// Run: node scripts/verify-registration.mjs
import { apply, inject, name, Config } from "../lib/index.js";
import { SETTINGS_NS, FeishuSettings } from "../lib/settings.js";
import { renderBarChart } from "../lib/png.js";

const registeredTools = [];
const registeredProviders = [];
const registeredNamespaces = [];

// Stub cordis context. `inject` mirrors the real contract: it runs the callback
// with a scoped context only when the named service exists.
const ctx = {
  tools: { register: (tool) => { registeredTools.push(tool); return () => {}; } },
  skills: { registerProvider: (fn) => { registeredProviders.push(fn()); return () => {}; } },
  inject: (services, callback) => {
    if (!services.includes("settings")) return;
    callback({
      settings: {
        register: (ns, schema, options) => {
          registeredNamespaces.push({ ns, schema, options });
          return { get: () => options?.base ?? {}, watch: () => () => {} };
        },
      },
      effect: () => () => {},
    });
  },
};

apply(ctx, { appId: "cli_test_only", appSecret: "secret_test_only", tenantDomain: "example.feishu.cn" });

const toolNames = registeredTools.map((t) => t?.name ?? "(unnamed)").sort();
const expected = [
  "feishu_append_document_blocks",
  "feishu_create_bitable",
  "feishu_create_document",
  "feishu_delete_document_block",
  "feishu_grant_document_access",
  "feishu_insert_chart_into_document",
  "feishu_insert_image_into_document",
  "feishu_insert_table_into_document",
  "feishu_list_bitable_fields",
  "feishu_list_bitable_tables",
  "feishu_list_chat_members",
  "feishu_list_chats",
  "feishu_read_bitable_records",
  "feishu_read_chat_history",
  "feishu_read_document",
  "feishu_read_document_blocks",
  "feishu_read_sheet_range",
  "feishu_recall_message",
  "feishu_send_post_message",
  "feishu_send_text",
  "feishu_update_document_block",
  "feishu_write_bitable_record",
  "feishu_write_sheet_range",
].sort();

console.log("plugin name:", name);
console.log("inject:", JSON.stringify(inject));
console.log("tools registered:", toolNames.length);
console.log("skill providers:", registeredProviders.length);
console.log("settings namespaces:", registeredNamespaces.map((entry) => entry.ns).join(",") || "(none)");

const missing = expected.filter((e) => !toolNames.includes(e));
const extra = toolNames.filter((t) => !expected.includes(t));
if (missing.length || extra.length) {
  console.error("MISMATCH missing=", missing, "extra=", extra);
  process.exit(1);
}
for (const t of registeredTools) {
  if (typeof t.output?.render !== "function" || !t.output?.schema) {
    console.error("tool lacks the output contract:", t.name);
    process.exit(1);
  }
  if (!t.description || t.description.length < 20) {
    console.error("tool lacks a usable description:", t.name);
    process.exit(1);
  }
}

const skills = registeredProviders[0];
const candidates = skills ? await skills.list() : [];
const skillBody = skills && candidates.length ? await skills.get(candidates[0]) : null;
if (registeredProviders.length !== 1 || candidates.length !== 1) {
  console.error("skill provider mismatch");
  process.exit(1);
}
const undocumented = expected.filter((toolName) => !skillBody?.content?.includes(toolName));
if (undocumented.length) {
  console.error("skill body does not document:", undocumented.join(", "));
  process.exit(1);
}

const png = renderBarChart({ title: "SALES TEST", categories: ["A", "B"], values: [1, 2] });
const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
if (png.length < 500 || !png.subarray(0, 4).equals(signature)) {
  console.error("chart renderer did not produce a valid PNG");
  process.exit(1);
}

// loader-level config schema (profile patch / bundle config)
if (!Config || typeof Config !== "function") {
  console.error("plugin does not export a Config schema");
  process.exit(1);
}
const parsedConfig = Config({ appId: "cli_test", appSecret: "secret", tenantDomain: "", defaultChatId: "oc_test" });
if (parsedConfig?.appId !== "cli_test" || parsedConfig?.defaultChatId !== "oc_test") {
  console.error("Config did not round-trip the sample value:", JSON.stringify(parsedConfig));
  process.exit(1);
}
const sendText = registeredTools.find((t) => t.name === "feishu_send_text");
if (sendText?.parameters?.required?.includes("chat_id")) {
  console.error("feishu_send_text still requires chat_id; the defaultChatId fallback would never apply");
  process.exit(1);
}

// settings-UI namespace (the card in client/client.js keys itself to this)
if (SETTINGS_NS !== "feishu-bridge") {
  console.error("unexpected settings namespace:", SETTINGS_NS);
  process.exit(1);
}
if (registeredNamespaces.length !== 1 || registeredNamespaces[0].ns !== SETTINGS_NS) {
  console.error("plugin did not register its settings namespace:", JSON.stringify(registeredNamespaces.map((e) => e.ns)));
  process.exit(1);
}
const entry = registeredNamespaces[0].options?.base ?? {};
if (entry.appId !== "cli_test_only") {
  console.error("settings base value is not the composed configuration:", JSON.stringify(entry));
  process.exit(1);
}
const settingsText = JSON.stringify(FeishuSettings?.toString?.() ?? "");
if (!settingsText.includes("appSecret")) {
  console.error("settings schema does not declare appSecret");
  process.exit(1);
}

// ---------- host HTTP route behind the settings page's 测试连接 button ----------
const routeRegistrations = [];
const hostCtx = {
  tools: { register: () => () => {} },
  skills: { registerProvider: () => () => {} },
  inject: (services, callback) => {
    if (services.includes("settings")) {
      callback({
        settings: { register: () => ({ get: () => ({}), watch: () => () => {} }) },
        effect: () => () => {},
      });
    }
    if (services.includes("webServer")) {
      callback({
        webServer: { register: (route) => { routeRegistrations.push(route); return () => {}; } },
        effect: (factory) => { factory(); return () => {}; },
      });
    }
  },
};

// Canned Feishu responses so the route can be exercised offline.
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  const path = new URL(String(url)).pathname;
  const body = path.endsWith("/tenant_access_token/internal")
    ? { code: 0, tenant_access_token: "test-token", expire: 7200 }
    : path.includes("/tenant/v2/tenant/query")
      ? { code: 0, data: { tenant: { name: "测试企业", domain: "acme.feishu.cn" } } }
      : path.includes("/bot/v3/info")
        ? { code: 0, bot: { app_name: "测试机器人", activate_status: 2 } }
        : { code: 0, data: {} };
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
};

function fakeResponse() {
  return {
    status: 0,
    headers: {},
    text: "",
    writeHead(status, headers) { this.status = status; this.headers = headers ?? {}; },
    end(text) { this.text = text ?? ""; },
  };
}

try {
  apply(hostCtx, { appId: "cli_test_only", appSecret: "secret_test_only", tenantDomain: "example.feishu.cn" });

  if (routeRegistrations.length !== 1) {
    console.error("expected exactly one HTTP route, got", routeRegistrations.length);
    process.exit(1);
  }
  const route = routeRegistrations[0];
  if (route.path !== "/dsh-plugin-feishu/test-connection") {
    console.error("unexpected route path:", route.path);
    process.exit(1);
  }

  const getResponse = fakeResponse();
  await route.handler({ method: "GET", headers: { host: "127.0.0.1:9784" } }, getResponse);
  if (getResponse.status !== 405) {
    console.error("GET must be refused with 405, got", getResponse.status);
    process.exit(1);
  }

  const crossOrigin = fakeResponse();
  await route.handler(
    { method: "POST", headers: { origin: "https://evil.example", host: "127.0.0.1:9784" } },
    crossOrigin,
  );
  if (crossOrigin.status !== 403) {
    console.error("cross-origin POST must be refused with 403, got", crossOrigin.status);
    process.exit(1);
  }

  const okResponse = fakeResponse();
  await route.handler(
    { method: "POST", headers: { origin: "http://127.0.0.1:9784", host: "127.0.0.1:9784" } },
    okResponse,
  );
  const report = JSON.parse(okResponse.text || "{}");
  if (okResponse.status !== 200 || report.ok !== true) {
    console.error("same-origin test connection failed:", okResponse.status, okResponse.text);
    process.exit(1);
  }
  if (report.botName !== "测试机器人" || report.tenantDomain !== "acme.feishu.cn") {
    console.error("report is missing app/tenant facts:", JSON.stringify(report));
    process.exit(1);
  }
  if (!/^secr…nly \(len 16\)$/.test(String(report.secretFingerprint))) {
    console.error("fingerprint is not the expected masked form:", report.secretFingerprint);
    process.exit(1);
  }
  if (okResponse.text.includes("secret_test_only")) {
    console.error("the report leaked the raw secret");
    process.exit(1);
  }
  console.log("route report:", JSON.stringify({ botName: report.botName, tenantDomain: report.tenantDomain, fingerprint: report.secretFingerprint }));
} finally {
  globalThis.fetch = realFetch;
}

console.log("config schema:", Object.keys(parsedConfig).join(","));
console.log("skill:", candidates[0].name, "| body bytes:", skillBody.content.length);
console.log("chart png bytes:", png.length);
console.log("REGISTRATION OK");
