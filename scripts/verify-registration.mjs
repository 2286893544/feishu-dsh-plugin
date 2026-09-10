// Offline registration test: loads the plugin with a stub cordis context and asserts
// that it registers the expected tools, the bundled skill provider, and that the
// built-in PNG/chart renderer produces a valid PNG. Run: node scripts/verify-registration.mjs
import { apply, inject, name } from "../lib/index.js";
import { renderBarChart } from "../lib/png.js";

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

console.log("skill:", candidates[0].name, "| body bytes:", skillBody.content.length);
console.log("chart png bytes:", png.length);
console.log("REGISTRATION OK");
