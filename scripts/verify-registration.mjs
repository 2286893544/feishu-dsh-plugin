// Offline registration test: loads the plugin with a stub cordis context and
// asserts that it registers the expected tools and the bundled skill provider.
// Run from the repo root:  node scripts/verify-registration.mjs
import { apply, inject, name } from "../lib/index.js";

const registeredTools = [];
const registeredProviders = [];
const ctx = {
  tools: { register: (tool) => { registeredTools.push(tool); return () => {}; } },
  skills: { registerProvider: (fn) => { registeredProviders.push(fn()); return () => {}; } },
};

apply(ctx, { appId: "cli_test_only", appSecret: "secret_test_only", tenantDomain: "example.feishu.cn" });

const toolNames = registeredTools.map((t) => t?.name ?? "(unnamed)").sort();
const expected = [
  "feishu_append_document_blocks",
  "feishu_create_document",
  "feishu_grant_document_access",
  "feishu_list_chats",
  "feishu_read_chat_history",
  "feishu_read_document",
  "feishu_send_text",
].sort();

console.log("plugin name:", name);
console.log("inject:", JSON.stringify(inject));
console.log("tools registered:", toolNames.length, JSON.stringify(toolNames));
console.log("skill providers:", registeredProviders.length, "->", registeredProviders.map((p) => p.name).join(","));

const missing = expected.filter((e) => !toolNames.includes(e));
const extra = toolNames.filter((t) => !expected.includes(t));
const skills = registeredProviders[0];
const candidates = skills ? await skills.list() : [];
const skillBody = skills && candidates.length ? await skills.get(candidates[0]) : null;

if (missing.length || extra.length) {
  console.error("MISMATCH missing=", missing, "extra=", extra);
  process.exit(1);
}
if (registeredProviders.length !== 1 || candidates.length !== 1) {
  console.error("skill provider mismatch");
  process.exit(1);
}
if (!skillBody?.content?.includes("feishu_send_text")) {
  console.error("skill body missing tool documentation");
  process.exit(1);
}
console.log("skill:", candidates[0].name, "| body bytes:", skillBody.content.length);
console.log("REGISTRATION OK");
