// Local smoke test for lib/client.js (not part of the published package).
// Reads credentials from environment variables (FEISHU_APP_ID / FEISHU_APP_SECRET /
// FEISHU_TENANT_DOMAIN), or from _private/config.json next to the repo when present.
// Exercises: token -> list chats -> read history -> optionally read a document given
// by FEISHU_TEST_DOCUMENT_ID.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { FeishuClient } from "../lib/client.js";

const here = path.dirname(fileURLToPath(import.meta.url));
let cfg = { appId: process.env.FEISHU_APP_ID, appSecret: process.env.FEISHU_APP_SECRET,
            tenantDomain: process.env.FEISHU_TENANT_DOMAIN };
if (!cfg.appId || !cfg.appSecret) {
  try {
    const p = path.resolve(here, "../../_private/config.json");
    const raw = JSON.parse(await readFile(p, "utf8"));
    cfg.appId = raw.app_id; cfg.appSecret = raw.app_secret;
    try {
      const td = JSON.parse(await readFile(path.resolve(here, "../../_private/tenant_domain.json"), "utf8"));
      cfg.tenantDomain = td.domain;
    } catch {}
  } catch (e) {
    console.error("no credentials:", e.message);
    process.exit(2);
  }
}

const client = new FeishuClient(cfg);
const chats = await client.listChats();
console.log("chats:", JSON.stringify(chats));
if (chats.length) {
  const msgs = await client.readChatHistory(chats[0].chat_id, 5);
  console.log("history of", chats[0].chat_id, "->", msgs.length, "messages; first:", JSON.stringify(msgs[0] ?? null));
}
const testDocId = process.env.FEISHU_TEST_DOCUMENT_ID;
if (testDocId) {
  const doc = await client.readDocument(testDocId);
  console.log("doc content head:", doc.content.slice(0, 120).replace(/\n/g, " | "));
} else {
  console.log("skipping document read (set FEISHU_TEST_DOCUMENT_ID to enable)");
}
console.log("SMOKE OK");
