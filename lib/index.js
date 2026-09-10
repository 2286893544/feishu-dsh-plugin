// dsh-plugin-feishu — Feishu tools + bundled skill provider for DeepSeek Harness.
// Registers model-facing `feishu_*` tools (inject: tools) and a bundled
// `feishu` skill (inject: skills), backed by a pure-Node Feishu REST client.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { BUNDLED_SKILL_RANK } from "@deepseek-ai/dsh-skill";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { FeishuClient } from "./client.js";

export const name = "feishu-bridge";
export const inject = ["tools", "skills"];

// ---------- bundled skill ----------
const SKILL_NAME = "feishu";
const ASSET_DIR_URL = new URL("../assets/", import.meta.url);
const SKILL_BODY_URL = new URL("../assets/feishu.md", import.meta.url);
const RESOURCE_BASE = { kind: "directory", path: fileURLToPath(ASSET_DIR_URL) };

const skillCandidate = {
  name: SKILL_NAME,
  description:
    "Interact with Feishu (Lark): send text messages to a chat, read recent chat history, create or read Feishu documents, append content to a document, and grant document access. Use whenever the user asks to operate their Feishu docs, chat records, or send a message through the configured Feishu app.",
  invocation: { modelInvocable: true, userInvocable: true },
  provider: "feishu-bridge",
  source: "bundled",
  resourceBase: RESOURCE_BASE,
  rank: BUNDLED_SKILL_RANK,
  locator: SKILL_BODY_URL,
};

const skillProvider = {
  name: "feishu-bridge",
  list: () => Promise.resolve([skillCandidate]),
  async get(_candidate) {
    return {
      name: skillCandidate.name,
      description: skillCandidate.description,
      invocation: skillCandidate.invocation,
      provider: skillCandidate.provider,
      source: skillCandidate.source,
      resourceBase: RESOURCE_BASE,
      content: await readFile(SKILL_BODY_URL, "utf8"),
    };
  },
};

// ---------- tool output contract ----------
// Every tool returns { result: <human-readable text> }; render forwards it to the model.
const textOutput = {
  schema: {
    type: "object",
    additionalProperties: false,
    properties: { result: { type: "string", required: true } },
  },
  render: (_args, value) => [{ type: "text", text: String(value?.result ?? "") }],
};

function fmtTime(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return String(ms ?? "");
  return new Date(n).toISOString().replace("T", " ").replace(".000Z", "Z");
}

// ---------- tools ----------
function toolsOf(client) {
  return [
    defineTool({
      name: "feishu_list_chats",
      description: "List the Feishu chats (groups / p2p sessions) the configured bot is in, with chat_id and name.",
      parameters: {},
      output: textOutput,
      async execute() {
        const chats = await client.listChats();
        const result = chats.length === 0
          ? "(no chats: the bot is not in any group, or the app lacks chat read scope)"
          : chats.map((c) => `chat_id=${c.chat_id}  name=${c.name}`).join("\n");
        return { result };
      },
    }),
    defineTool({
      name: "feishu_send_text",
      description: "Send a plain-text message to a Feishu chat (group or p2p) as the configured bot.",
      parameters: {
        chat_id: { type: "string", required: true, description: "The Feishu chat_id (oc_...) to send to." },
        text: { type: "string", required: true, description: "The message text to send." },
      },
      output: textOutput,
      async execute(args) {
        const sent = await client.sendText(args.chat_id, args.text);
        return { result: `sent message_id=${sent.message_id} create_time=${fmtTime(sent.create_time)}` };
      },
    }),
    defineTool({
      name: "feishu_read_chat_history",
      description: "Read recent messages of a Feishu chat the bot is in, in chronological order. Requires the app scope for reading group history.",
      parameters: {
        chat_id: { type: "string", required: true, description: "The Feishu chat_id (oc_...)." },
        limit: { type: "number", description: "How many of the most recent messages to return (default 30, max 100)." },
      },
      output: textOutput,
      async execute(args) {
        const messages = await client.readChatHistory(args.chat_id, args.limit);
        const result = messages.length === 0
          ? "(no messages)"
          : messages
              .map((m) => `[${fmtTime(m.create_time)}] ${m.sender_type || "unknown"} <${m.msg_type}>: ${m.text}`)
              .join("\n");
        return { result };
      },
    }),
    defineTool({
      name: "feishu_create_document",
      description: "Create a new Feishu cloud document (docx) with a title and optional plain-text paragraphs, returning its document_id and, when a tenantDomain is configured, a share URL.",
      parameters: {
        title: { type: "string", required: true, description: "Document title." },
        paragraphs: {
          type: "array",
          items: { type: "string" },
          description: "Optional plain-text paragraphs to write into the document.",
        },
      },
      output: textOutput,
      async execute(args) {
        const doc = await client.createDocument(args.title, args.paragraphs || []);
        const url = doc.url ? `  url=${doc.url}` : "";
        return { result: `created document_id=${doc.document_id}${url}` };
      },
    }),
    defineTool({
      name: "feishu_read_document",
      description: "Read the plain-text content of an existing Feishu cloud document (docx) the app can access.",
      parameters: {
        document_id: { type: "string", required: true, description: "The docx document_id." },
      },
      output: textOutput,
      async execute(args) {
        const doc = await client.readDocument(args.document_id);
        return { result: doc.content };
      },
    }),
    defineTool({
      name: "feishu_append_document_blocks",
      description: "Append text blocks (plain paragraphs, or heading1) to an existing Feishu cloud document.",
      parameters: {
        document_id: { type: "string", required: true, description: "The docx document_id." },
        blocks: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              kind: { type: "string", enum: ["text", "heading1"], description: "Block kind; defaults to text." },
              text: { type: "string" },
            },
          },
          description: "Blocks to append, in order.",
        },
      },
      output: textOutput,
      async execute(args) {
        const added = await client.appendBlocks(args.document_id, args.blocks || []);
        return { result: `appended ${added.added} block(s) to document_id=${args.document_id}` };
      },
    }),
    defineTool({
      name: "feishu_grant_document_access",
      description: "Grant a Feishu user (open_id) full access to a document or bitable the app owns, so it appears in that user's drive.",
      parameters: {
        token: { type: "string", required: true, description: "The drive token: a docx document_id." },
        type: { type: "string", required: true, enum: ["docx", "bitable"], description: "The asset type." },
        open_id: { type: "string", required: true, description: "The recipient user's open_id." },
      },
      output: textOutput,
      async execute(args) {
        const granted = await client.grantAccess(args.token, args.type, args.open_id);
        return { result: `granted ${granted.perm} on ${granted.type} ${granted.token} to ${granted.open_id}` };
      },
    }),
  ];
}

// ---------- plugin ----------
function resolveCredentials(config = {}) {
  const env = process.env;
  const appId = config.appId ?? env.FEISHU_APP_ID;
  const appSecret = config.appSecret ?? env.FEISHU_APP_SECRET;
  if (!appId || !appSecret) {
    throw new Error(
      "feishu-bridge: missing Feishu credentials. Set plugin config { appId, appSecret } " +
      "(optionally tenantDomain) in the profile patch, or set the FEISHU_APP_ID / " +
      "FEISHU_APP_SECRET environment variables."
    );
  }
  return {
    appId,
    appSecret,
    tenantDomain: config.tenantDomain ?? env.FEISHU_TENANT_DOMAIN ?? null,
  };
}

function apply(ctx, config = {}) {
  const creds = resolveCredentials(config);
  const client = new FeishuClient(creds);
  for (const tool of toolsOf(client)) ctx.tools.register(tool);
  ctx.skills.registerProvider(() => skillProvider);
}

export { apply };
