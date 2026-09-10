// dsh-plugin-feishu — Feishu tools + bundled skill provider for DeepSeek Harness.
// Registers model-facing `feishu_*` tools (inject: tools) and a bundled
// `feishu` skill (inject: skills), backed by a pure-Node Feishu REST client.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import z from "@deepseek-ai/schemastery";
import { BUNDLED_SKILL_RANK } from "@deepseek-ai/dsh-skill";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { FeishuClient } from "./client.js";
import { renderBarChart } from "./png.js";
import { installFeishuSettings } from "./settings.js";
import { fingerprint, mountFeishuRoutes } from "./routes.js";

export const name = "feishu-bridge";
export const inject = ["tools", "skills"];

/**
 * Plugin configuration, rendered by the harness settings UI
 * (Settings → Plugins → Plugin configuration). The secret field is marked with
 * `role("secret")` so the settings service redacts it from remote reads and the
 * UI renders a password input.
 */
export const Config = z.object({
  appId: z.string().description("Feishu app ID of your self-built app (cli_...)."),
  appSecret: z.string().role("secret").description("Feishu app secret. Stored in the local profile and masked in the UI."),
  tenantDomain: z.string().description("Optional tenant domain such as acme.feishu.cn; auto-detected from the tenant API when omitted."),
  defaultChatId: z.string().description("Optional default chat_id (oc_...) used by chat tools when the call omits chat_id."),
});

// ---------- bundled skill ----------
const SKILL_NAME = "feishu";
const ASSET_DIR_URL = new URL("../assets/", import.meta.url);
const SKILL_BODY_URL = new URL("../assets/feishu.md", import.meta.url);
const RESOURCE_BASE = { kind: "directory", path: fileURLToPath(ASSET_DIR_URL) };

const skillCandidate = {
  name: SKILL_NAME,
  description:
    "Operate Feishu (Lark) through the configured self-built app: send text or rich-text messages, read chat history and members, recall messages, create/read/edit documents (including tables, images and generated charts), manage bitable records, and read or write spreadsheet ranges. Use whenever the user asks to work with their Feishu docs, chat records, multi-dimensional tables or spreadsheets.",
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

// ---------- shared tool plumbing ----------
// Every tool returns { result: <text> }; the renderer forwards it to the model.
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

function json(value) {
  return JSON.stringify(value, null, 1);
}

function tool(spec, run) {
  return defineTool({
    name: spec.name,
    description: spec.description,
    parameters: spec.parameters ?? {},
    output: textOutput,
    async execute(args) {
      return { result: await run(args) };
    },
  });
}

async function loadImageBytes({ image_path, image_url, image_base64 }) {
  if (image_path) {
    const buffer = await readFile(image_path);
    return { buffer, filename: path.basename(image_path) };
  }
  if (image_url) {
    const res = await fetch(image_url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`failed to download image: HTTP ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    const name = path.basename(new URL(image_url).pathname) || "image.png";
    return { buffer, filename: name };
  }
  if (image_base64) {
    const cleaned = image_base64.replace(/^data:[^;]+;base64,/, "");
    return { buffer: Buffer.from(cleaned, "base64"), filename: "image.png" };
  }
  throw new Error("provide one of image_path, image_url or image_base64");
}

// ---------- tools ----------
function toolsOf(client, config = {}) {
  const chatId = (value) => {
    const id = value || config.defaultChatId;
    if (!id) {
      throw new Error("chat_id is required (or set defaultChatId in the plugin configuration)");
    }
    return id;
  };
  return [
    // ----- chat / messages -----
    tool({
      name: "feishu_list_chats",
      description: "List the Feishu chats (groups / p2p sessions) the configured bot is in, with chat_id and name.",
    }, async () => {
      const chats = await client.listChats();
      return chats.length === 0
        ? "(no chats: the bot is not in any group, or the app lacks chat read scope)"
        : chats.map((c) => `chat_id=${c.chat_id}  name=${c.name}`).join("\n");
    }),

    tool({
      name: "feishu_list_chat_members",
      description: "List members of a Feishu chat with their open_id and display name (use the open_id to grant document access).",
      parameters: {
        chat_id: { type: "string", description: "The Feishu chat_id (oc_...); defaults to the configured defaultChatId." },
        limit: { type: "number", description: "Maximum members to return (default 100)." },
      },
    }, async (args) => {
      const members = await client.listChatMembers(chatId(args.chat_id), args.limit ?? 100);
      return members.length === 0
        ? "(no members returned)"
        : members.map((m) => `open_id=${m.member_id}  name=${m.name ?? "(unknown)"}`).join("\n");
    }),

    tool({
      name: "feishu_send_text",
      description: "Send a plain-text message to a Feishu chat (group or p2p) as the configured bot.",
      parameters: {
        chat_id: { type: "string", description: "The Feishu chat_id (oc_...) to send to; defaults to the configured defaultChatId." },
        text: { type: "string", required: true, description: "The message text to send." },
      },
    }, async (args) => {
      const sent = await client.sendText(chatId(args.chat_id), args.text);
      return `sent message_id=${sent.message_id} create_time=${fmtTime(sent.create_time)}`;
    }),

    tool({
      name: "feishu_send_post_message",
      description: "Send a rich-text (post) message with an optional title and multi-line body to a Feishu chat. Full-width colons and emoji are fine; the body is sent as plain text paragraphs.",
      parameters: {
        chat_id: { type: "string", description: "The Feishu chat_id (oc_...); defaults to the configured defaultChatId." },
        title: { type: "string", description: "Optional message title." },
        lines: {
          type: "array",
          items: { type: "string" },
          description: "Body lines, each rendered as its own paragraph.",
        },
      },
    }, async (args) => {
      const sent = await client.sendPost(chatId(args.chat_id), args.title, args.lines || []);
      return `sent post message_id=${sent.message_id} create_time=${fmtTime(sent.create_time)}`;
    }),

    tool({
      name: "feishu_read_chat_history",
      description: "Read recent messages of a Feishu chat the bot is in, in chronological order. Requires the app scope for reading group history.",
      parameters: {
        chat_id: { type: "string", description: "The Feishu chat_id (oc_...); defaults to the configured defaultChatId." },
        limit: { type: "number", description: "How many of the most recent messages to return (default 30, max 100)." },
      },
    }, async (args) => {
      const messages = await client.readChatHistory(chatId(args.chat_id), args.limit);
      return messages.length === 0
        ? "(no messages)"
        : messages
            .map((m) => `[${fmtTime(m.create_time)}] ${m.sender_type || "unknown"} <${m.msg_type}>: ${m.text}`)
            .join("\n");
    }),

    tool({
      name: "feishu_recall_message",
      description: "Recall (withdraw) a message the bot has sent. Only messages sent by this bot can be recalled.",
      parameters: {
        message_id: { type: "string", required: true, description: "The message_id (om_...) returned when the bot sent the message." },
      },
    }, async (args) => {
      const done = await client.recallMessage(args.message_id);
      return `recalled message_id=${done.message_id}`;
    }),

    // ----- documents -----
    tool({
      name: "feishu_create_document",
      description: "Create a new Feishu cloud document (docx) with a title and optional plain-text paragraphs, returning its document_id and share URL.",
      parameters: {
        title: { type: "string", required: true, description: "Document title." },
        paragraphs: {
          type: "array",
          items: { type: "string" },
          description: "Optional plain-text paragraphs to write into the document.",
        },
      },
    }, async (args) => {
      const doc = await client.createDocument(args.title, args.paragraphs || []);
      return `created document_id=${doc.document_id}${doc.url ? `  url=${doc.url}` : ""}`;
    }),

    tool({
      name: "feishu_read_document",
      description: "Read the plain-text content of an existing Feishu cloud document (docx) the app can access.",
      parameters: {
        document_id: { type: "string", required: true, description: "The docx document_id." },
      },
    }, async (args) => {
      const doc = await client.readDocument(args.document_id);
      return doc.content;
    }),

    tool({
      name: "feishu_read_document_blocks",
      description: "Read a document's block structure (block_id, type, text, image token, table size) instead of plain text — needed to locate images, tables, or a specific block before editing it.",
      parameters: {
        document_id: { type: "string", required: true, description: "The docx document_id." },
      },
    }, async (args) => {
      const blocks = await client.readDocumentBlocks(args.document_id);
      const counts = {};
      for (const b of blocks) counts[b.block_type] = (counts[b.block_type] || 0) + 1;
      const lines = blocks.map((b) => {
        const extra = b.table_size ? ` table=${b.table_size.rows}x${b.table_size.columns}` : b.image_token ? " image" : "";
        return `${b.block_id} type=${b.block_type}${extra}${b.text ? `: ${b.text.slice(0, 80)}` : ""}`;
      });
      return `total blocks: ${blocks.length}  by type: ${json(counts)}\n${lines.join("\n")}`;
    }),

    tool({
      name: "feishu_append_document_blocks",
      description: "Append text blocks to an existing Feishu cloud document. Supported kinds: text, heading1, heading2, bullet, quote.",
      parameters: {
        document_id: { type: "string", required: true, description: "The docx document_id." },
        blocks: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              kind: { type: "string", enum: ["text", "heading1", "heading2", "bullet", "quote"], description: "Block kind; defaults to text." },
              text: { type: "string" },
            },
          },
          description: "Blocks to append, in order.",
        },
      },
    }, async (args) => {
      const added = await client.appendBlocks(args.document_id, args.blocks || []);
      return `appended ${added.added} block(s) to document_id=${args.document_id}`;
    }),

    tool({
      name: "feishu_update_document_block",
      description: "Replace the text of one existing document block (text or heading1 block) by block_id.",
      parameters: {
        document_id: { type: "string", required: true, description: "The docx document_id." },
        block_id: { type: "string", required: true, description: "Target block_id (see feishu_read_document_blocks)." },
        text: { type: "string", required: true, description: "New text content." },
        kind: { type: "string", enum: ["text", "heading1"], description: "Block kind; defaults to text." },
      },
    }, async (args) => {
      await client.updateBlockText(args.document_id, args.block_id, args.text, args.kind || "text");
      return `updated block_id=${args.block_id}`;
    }),

    tool({
      name: "feishu_delete_document_block",
      description: "Delete one document block by block_id.",
      parameters: {
        document_id: { type: "string", required: true, description: "The docx document_id." },
        block_id: { type: "string", required: true, description: "Target block_id." },
      },
    }, async (args) => {
      await client.deleteBlock(args.document_id, args.block_id);
      return `deleted block_id=${args.block_id}`;
    }),

    tool({
      name: "feishu_insert_table_into_document",
      description: "Insert an empty table with the given number of rows and columns into a document, returning its table block_id.",
      parameters: {
        document_id: { type: "string", required: true, description: "The docx document_id." },
        rows: { type: "number", required: true, description: "Row count." },
        columns: { type: "number", required: true, description: "Column count." },
      },
    }, async (args) => {
      const table = await client.insertTable(args.document_id, args.rows, args.columns);
      return `inserted table ${table.rows}x${table.columns} table_block_id=${table.table_block_id}`;
    }),

    tool({
      name: "feishu_insert_image_into_document",
      description: "Insert an image into a document. Supply the image as a local path (image_path), a public https URL (image_url), or base64 (image_base64).",
      parameters: {
        document_id: { type: "string", required: true, description: "The docx document_id." },
        image_path: { type: "string", description: "Local file path of the image." },
        image_url: { type: "string", description: "https URL of the image." },
        image_base64: { type: "string", description: "Base64 image data (data URI accepted)." },
      },
    }, async (args) => {
      const { buffer, filename } = await loadImageBytes(args);
      const inserted = await client.insertImage(args.document_id, buffer, filename);
      return `inserted image block_id=${inserted.block_id} bytes=${inserted.bytes}`;
    }),

    tool({
      name: "feishu_insert_chart_into_document",
      description: "Render a bar chart locally (no dependencies) and insert it into a document. Title and category labels are drawn with an uppercase ASCII 5x7 font; non-ASCII characters are dropped, so keep labels ASCII or omit them.",
      parameters: {
        document_id: { type: "string", required: true, description: "The docx document_id." },
        title: { type: "string", description: "Chart title (ASCII)." },
        categories: { type: "array", items: { type: "string" }, description: "Bar labels (ASCII), one per value." },
        values: { type: "array", items: { type: "number" }, description: "Bar values, one per category." },
      },
    }, async (args) => {
      const values = (args.values || []).map((v) => Number(v) || 0);
      if (values.length === 0) throw new Error("values is required (one number per bar)");
      const png = renderBarChart({
        title: args.title || "",
        categories: args.categories || [],
        values,
      });
      const inserted = await client.insertImage(args.document_id, png, "chart.png");
      return `inserted chart block_id=${inserted.block_id} bars=${values.length} bytes=${inserted.bytes}`;
    }),

    // ----- bitable -----
    tool({
      name: "feishu_create_bitable",
      description: "Create a new Feishu bitable (multi-dimensional table) and return its app_token, plus a share URL.",
      parameters: {
        name: { type: "string", required: true, description: "Bitable name." },
      },
    }, async (args) => {
      const app = await client.createBitable(args.name);
      return `created bitable app_token=${app.app_token}${app.url ? `  url=${app.url}` : ""}`;
    }),

    tool({
      name: "feishu_list_bitable_tables",
      description: "List the data tables inside a bitable.",
      parameters: { app_token: { type: "string", required: true, description: "The bitable app_token." } },
    }, async (args) => {
      const tables = await client.listBitableTables(args.app_token);
      return tables.length === 0
        ? "(no tables)"
        : tables.map((t) => `table_id=${t.table_id}  name=${t.name}`).join("\n");
    }),

    tool({
      name: "feishu_list_bitable_fields",
      description: "List the fields (columns) of a bitable data table, with field_id, name and numeric type.",
      parameters: {
        app_token: { type: "string", required: true, description: "The bitable app_token." },
        table_id: { type: "string", required: true, description: "The table_id (tbl...)." },
      },
    }, async (args) => {
      const fields = await client.listBitableFields(args.app_token, args.table_id);
      return fields.length === 0
        ? "(no fields)"
        : fields.map((f) => `field_id=${f.field_id}  name=${f.field_name}  type=${f.type}`).join("\n");
    }),

    tool({
      name: "feishu_write_bitable_record",
      description: "Create one record in a bitable data table. Field keys are field names (call feishu_list_bitable_fields first); values must match each field's type.",
      parameters: {
        app_token: { type: "string", required: true, description: "The bitable app_token." },
        table_id: { type: "string", required: true, description: "The table_id (tbl...)." },
        fields: {
          type: "object",
          additionalProperties: true,
          description: "Field name to value map, e.g. {\"文本\":\"hello\"}.",
        },
      },
    }, async (args) => {
      const rec = await client.createBitableRecord(args.app_token, args.table_id, args.fields || {});
      return `created record_id=${rec.record_id}\nfields=${json(rec.fields)}`;
    }),

    tool({
      name: "feishu_read_bitable_records",
      description: "Read records from a bitable data table.",
      parameters: {
        app_token: { type: "string", required: true, description: "The bitable app_token." },
        table_id: { type: "string", required: true, description: "The table_id (tbl...)." },
        limit: { type: "number", description: "Maximum records to return (default 20, max 100)." },
      },
    }, async (args) => {
      const records = await client.listBitableRecords(args.app_token, args.table_id, args.limit ?? 20);
      return records.length === 0
        ? "(no records)"
        : records.map((r) => `${r.record_id} ${json(r.fields)}`).join("\n");
    }),

    // ----- sheets -----
    tool({
      name: "feishu_read_sheet_range",
      description: "Read a spreadsheet range (classic sheets v2 API), e.g. range \"sheetId!A1:C5\".",
      parameters: {
        spreadsheet_token: { type: "string", required: true, description: "The spreadsheet token from the sheet URL." },
        range: { type: "string", required: true, description: "Range such as \"<sheetId>!A1:C5\"." },
      },
    }, async (args) => {
      const data = await client.readSheetRange(args.spreadsheet_token, args.range);
      return `range=${data.range}\n${json(data.values)}`;
    }),

    tool({
      name: "feishu_write_sheet_range",
      description: "Write values into a spreadsheet range (classic sheets v2 API). values is a 2D array of rows.",
      parameters: {
        spreadsheet_token: { type: "string", required: true, description: "The spreadsheet token from the sheet URL." },
        range: { type: "string", required: true, description: "Range such as \"<sheetId>!A1:B2\"." },
        values: {
          type: "array",
          items: {
            type: "array",
            items: {
              oneOf: [
                { type: "string" },
                { type: "number" },
                { type: "boolean" },
              ],
            },
          },
          description: "2D array of cell values, e.g. [[\"a\",1],[\"b\",2]].",
        },
      },
    }, async (args) => {
      const done = await client.writeSheetRange(args.spreadsheet_token, args.range, args.values || []);
      return `written cells=${done.updated} range=${done.range}`;
    }),

    // ----- drive permission -----
    tool({
      name: "feishu_grant_document_access",
      description: "Grant a Feishu user (open_id) full access to a document or bitable the app owns, so it appears in that user's drive.",
      parameters: {
        token: { type: "string", required: true, description: "The drive token: a docx document_id or a bitable app_token." },
        type: { type: "string", required: true, enum: ["docx", "bitable"], description: "The asset type." },
        open_id: { type: "string", required: true, description: "The recipient user's open_id." },
      },
    }, async (args) => {
      const granted = await client.grantAccess(args.token, args.type, args.open_id);
      return `granted ${granted.perm} on ${granted.type} ${granted.token} to ${granted.open_id}`;
    }),
  ];
}

// ---------- plugin ----------
function resolveConfiguration(config = {}) {
  const env = process.env;
  return {
    appId: config.appId ?? env.FEISHU_APP_ID ?? "",
    appSecret: config.appSecret ?? env.FEISHU_APP_SECRET ?? "",
    tenantDomain: config.tenantDomain ?? env.FEISHU_TENANT_DOMAIN ?? "",
    defaultChatId: config.defaultChatId ?? env.FEISHU_DEFAULT_CHAT_ID ?? "",
  };
}

/**
 * Non-secret connection report for the settings page. Runs on the host, because
 * the stored secret never reaches the browser.
 * @param client - live REST client (uses the current credentials).
 * @param resolved - live credentials object.
 * @param config - the composed loader configuration, for source reporting.
 * @returns human-verifiable facts: which app answered, which tenant, masked key.
 */
async function testConnection(client, resolved, config = {}) {
  const tenant = await client.tenantInfo();
  const bot = await client.botInfo().catch(() => null);
  return {
    appId: resolved.appId || null,
    secretFingerprint: fingerprint(resolved.appSecret),
    botName: bot?.app_name ?? null,
    botActivateStatus: bot?.activate_status ?? null,
    tenantName: tenant?.name ?? null,
    tenantDomain: tenant?.domain ?? null,
    sources: {
      environment: Boolean(process.env.FEISHU_APP_ID || process.env.FEISHU_APP_SECRET),
      profileConfig: Object.values(config ?? {}).some((value) => typeof value === "string" && value.length > 0),
    },
  };
}

function apply(ctx, config = {}) {
  const resolved = resolveConfiguration(config);
  const client = new FeishuClient(resolved);
  // The settings card writes into this namespace; each change lands on the live
  // credentials object and is pushed straight into the REST client, so a saved
  // edit takes effect without a restart.
  installFeishuSettings(ctx, resolved, () => client.updateCredentials(resolved));
  for (const tool of toolsOf(client, resolved)) ctx.tools.register(tool);
  ctx.skills.registerProvider(() => skillProvider);

  // HTTP route behind the settings page's "test connection" button.
  ctx.inject(["webServer"], (host) => {
    host.effect?.(
      () => mountFeishuRoutes(host, { testConnection: () => testConnection(client, resolved, config) }),
      "feishu-bridge: test-connection route",
    );
  });
}

export { apply };
