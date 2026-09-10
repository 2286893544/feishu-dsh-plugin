// Local smoke test for lib/client.js (not part of the published package).
// Reads credentials from ../feishu_private/config.json (dev-only) or env vars,
// then exercises: token -> list chats -> read history -> read a known document.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { FeishuClient } from "../lib/client.js";

const here = path.dirname(fileURLToPath(import.meta.url));
let cfg = { appId: process.env.FEISHU_APP_ID, appSecret: process.env.FEISHU_APP_SECRET,
            tenantDomain: process.env.FEISHU_TENANT_DOMAIN };
if (!cfg.appId || !cfg.appSecret) {
  try {
    const p = path.resolve(here, "../../feishu_private/config.json");
    const raw = JSON.parse(await readFile(p, "utf8"));
    cfg.appId = raw.app_id; cfg.appSecret = raw.app_secret;
    try {
      const td = JSON.parse(await readFile(path.resolve(here, "../../feishu_private/tenant_domain.json"), "utf8"));
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
const doc = await client.readDocument("NTotd7b71oZqDfxn0SEcpbt1nfg");
console.log("doc content head:", doc.content.slice(0, 120).replace(/\n/g, " | "));
console.log("SMOKE OK");
