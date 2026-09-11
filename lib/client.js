// Feishu (Lark) Open Platform REST client — pure Node (global fetch), no external deps.
// Security: never logs appSecret or tenant_access_token.

const BASE_URL = "https://open.feishu.cn";
const TOKEN_EXPIRY_BUFFER_MS = 60_000;

export class FeishuError extends Error {
  constructor(code, msg, raw) {
    super(`Feishu API error ${code}: ${msg}`);
    this.code = code;
    this.msg = msg;
    this.raw = raw;
  }
}

function assertString(value, name) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

export class FeishuClient {
  constructor({ appId, appSecret, tenantDomain, timeoutMs = 30_000 } = {}) {
    // Credentials may be empty at construction time: the plugin loads before the
    // user configures it (the settings card must exist to be filled in), and every
    // request validates them.
    this.appId = typeof appId === "string" ? appId : "";
    this.appSecret = typeof appSecret === "string" ? appSecret : "";
    this.tenantDomain = tenantDomain || null;
    this.timeoutMs = timeoutMs;
    this.token = null;
    this.tokenExpiresAt = 0;
  }

  /** Apply changed credentials (a settings-UI edit) without recreating the client. */
  updateCredentials({ appId, appSecret, tenantDomain } = {}) {
    const appIdChanged = typeof appId === "string" && appId !== this.appId;
    const secretChanged = typeof appSecret === "string" && appSecret !== this.appSecret;
    if (appIdChanged) this.appId = appId;
    if (secretChanged) this.appSecret = appSecret;
    if (typeof tenantDomain === "string" && tenantDomain !== this.tenantDomain) {
      this.tenantDomain = tenantDomain || null;
      this._domain = undefined;
    }
    if (appIdChanged || secretChanged) {
      this.token = null;
      this.tokenExpiresAt = 0;
    }
  }

  // ---------- transport ----------
  async _token() {
    if (this.token && Date.now() < this.tokenExpiresAt) return this.token;
    if (!this.appId || !this.appSecret) {
      throw new Error(
        "feishu-bridge is not configured: set appId and appSecret in " +
        "Settings → Plugins → Plugin configuration (or provide FEISHU_APP_ID / FEISHU_APP_SECRET)."
      );
    }
    const data = await this._request("POST", "/open-apis/auth/v3/tenant_access_token/internal", {
      app_id: this.appId,
      app_secret: this.appSecret,
    }, { auth: false });
    if (data.code !== 0) throw new FeishuError(data.code, data.msg || "token exchange failed", data);
    this.token = data.tenant_access_token;
    this.tokenExpiresAt = Date.now() + (Number(data.expire) || 7200) * 1000 - TOKEN_EXPIRY_BUFFER_MS;
    return this.token;
  }

  async _request(method, path, body, { auth = true } = {}) {
    const headers = { "Content-Type": "application/json; charset=utf-8" };
    if (auth) headers.Authorization = `Bearer ${await this._token()}`;
    const init = { method, headers, signal: AbortSignal.timeout(this.timeoutMs) };
    if (body !== undefined) init.body = JSON.stringify(body);
    let res;
    try {
      res = await fetch(BASE_URL + path, init);
    } catch (err) {
      throw new Error(`network error calling ${path}: ${err.message}`);
    }
    const text = await res.text();
    let parsed = {};
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error(`unexpected response from ${path}: ${text.slice(0, 200)}`);
      }
    }
    if (!res.ok && parsed.code === undefined) {
      throw new Error(`HTTP ${res.status} from ${path}: ${text.slice(0, 200)}`);
    }
    return parsed;
  }

  async _api(method, path, body) {
    let data = await this._request(method, path, body);
    if ([99991663, 99991664, 99991668].includes(data.code)) {
      this.token = null;
      this.tokenExpiresAt = 0;
      data = await this._request(method, path, body);
    }
    if (data.code !== 0) throw new FeishuError(data.code, data.msg || "request failed", data);
    return data.data !== undefined ? data.data : data;
  }

  async _upload(path, formData) {
    const res = await fetch(BASE_URL + path, {
      method: "POST",
      headers: { Authorization: `Bearer ${await this._token()}` },
      body: formData,
      signal: AbortSignal.timeout(120_000),
    });
    const text = await res.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`unexpected upload response: ${text.slice(0, 200)}`);
    }
    if (data.code !== 0) throw new FeishuError(data.code, data.msg || "upload failed", data);
    return data.data ?? data;
  }

  // ---------- tenant ----------
  /** Tenant facts (name, domain) — obtaining them also proves the credentials work. */
  async tenantInfo() {
    const data = await this._api("GET", "/open-apis/tenant/v2/tenant/query");
    return data?.tenant ?? null;
  }

  /** The bot's own identity, for a human-readable "which app is this" check. */
  async botInfo() {
    const data = await this._api("GET", "/open-apis/bot/v3/info");
    return data?.bot ?? data ?? null;
  }

  /** Resolve the tenant domain (e.g. "acme.feishu.cn") once, for building share URLs. */
  async resolveTenantDomain() {
    if (this.tenantDomain) return this.tenantDomain;
    if (this._domain === undefined) {
      try {
        const data = await this._api("GET", "/open-apis/tenant/v2/tenant/query");
        this._domain = data?.tenant?.domain || null;
      } catch {
        this._domain = null;
      }
    }
    return this._domain;
  }

  async documentUrl(documentId) {
    const domain = await this.resolveTenantDomain();
    return domain ? `https://${domain}/docx/${documentId}` : null;
  }

  async bitableUrl(appToken) {
    const domain = await this.resolveTenantDomain();
    return domain ? `https://${domain}/base/${appToken}` : null;
  }

  /** Wiki URL for a knowledge-space node (the link a human opens). */
  async wikiUrl(nodeToken) {
    const domain = await this.resolveTenantDomain();
    return domain ? `https://${domain}/wiki/${nodeToken}` : null;
  }

  /** Resolve a knowledge-space node token to the underlying cloud-document token. */
  async getWikiNode(nodeToken) {
    const data = await this._api("GET", `/open-apis/wiki/v2/spaces/get_node?token=${encodeURIComponent(nodeToken)}&obj_type=wiki`);
    return data?.node ?? null;
  }

  /**
   * Create a docx inside a knowledge space.
   * `obj_token` is the document id every other docx call needs; `node_token` is
   * the segment that appears in the /wiki/ URL the user sees.
   */
  async createWikiDocument(spaceId, title, paragraphs = [], parentNodeToken = "") {
    const body = { obj_type: "docx", node_type: "origin", title };
    if (parentNodeToken) body.parent_node_token = parentNodeToken;
    const data = await this._api("POST", `/open-apis/wiki/v2/spaces/${encodeURIComponent(spaceId)}/nodes`, body);
    const node = data?.node ?? {};
    const documentId = assertString(node.obj_token, "obj_token");
    if (paragraphs.length > 0) {
      await this.appendBlocks(documentId, paragraphs.map((p) => ({ kind: "text", text: p })));
    }
    return {
      document_id: documentId,
      node_token: node.node_token,
      space_id: spaceId,
      url: await this.wikiUrl(node.node_token),
    };
  }

  // ---------- IM ----------
  async listChats() {
    const items = [];
    let pageToken;
    do {
      const path = "/open-apis/im/v1/chats?page_size=100" + (pageToken ? `&page_token=${pageToken}` : "");
      const data = await this._api("GET", path);
      items.push(...(data.items || []));
      pageToken = data.has_more ? data.page_token : null;
    } while (pageToken);
    return items.map((c) => ({ chat_id: c.chat_id, name: c.name }));
  }

  async listChatMembers(chatId, limit = 100) {
    const members = [];
    let pageToken;
    do {
      const path = `/open-apis/im/v1/chats/${encodeURIComponent(chatId)}/members?page_size=100`
        + (pageToken ? `&page_token=${pageToken}` : "");
      const data = await this._api("GET", path);
      members.push(...(data.items || []));
      pageToken = data.has_more ? data.page_token : null;
    } while (pageToken && members.length < limit);
    return members.slice(0, limit).map((m) => ({
      member_id: m.member_id,
      member_id_type: m.member_id_type,
      name: m.name,
    }));
  }

  async sendText(chatId, text) {
    const body = {
      receive_id: chatId,
      msg_type: "text",
      content: JSON.stringify({ text }),
    };
    const data = await this._api("POST", "/open-apis/im/v1/messages?receive_id_type=chat_id", body);
    return { message_id: data.message_id, create_time: data.create_time };
  }

  async sendPost(chatId, title, lines) {
    const content = {
      zh_cn: {
        title: title || "",
        content: (lines || []).map((line) => [{ tag: "text", text: String(line) }]),
      },
    };
    const body = { receive_id: chatId, msg_type: "post", content: JSON.stringify(content) };
    const data = await this._api("POST", "/open-apis/im/v1/messages?receive_id_type=chat_id", body);
    return { message_id: data.message_id, create_time: data.create_time };
  }

  async recallMessage(messageId) {
    await this._api("DELETE", `/open-apis/im/v1/messages/${encodeURIComponent(messageId)}`);
    return { message_id: messageId, recalled: true };
  }

  async readChatHistory(chatId, limit = 30) {
    const size = Math.min(Math.max(Number(limit) || 30, 1), 100);
    const path = `/open-apis/im/v1/messages?container_id_type=chat&container_id=${encodeURIComponent(chatId)}&page_size=${size}&sort_type=ByCreateTimeAsc`;
    const data = await this._api("GET", path);
    const out = [];
    for (const m of data.items || []) {
      const sender = m.sender || {};
      let text = "";
      try {
        const obj = JSON.parse((m.body || {}).content || "{}");
        if (m.msg_type === "text") text = obj.text || "";
        else if (m.msg_type === "post") text = postToPlainText(obj);
        else text = typeof obj === "string" ? obj : JSON.stringify(obj);
      } catch { /* keep empty */ }
      out.push({
        message_id: m.message_id,
        msg_type: m.msg_type,
        create_time: m.create_time,
        sender_type: sender.sender_type,
        sender_id: sender.id,
        text,
      });
    }
    return out;
  }

  // ---------- docx ----------
  async createDocument(title, paragraphs = []) {
    const data = await this._api("POST", "/open-apis/docx/v1/documents", { title });
    const doc = data.document || data;
    const documentId = assertString(doc.document_id, "document_id");
    if (paragraphs.length > 0) {
      await this.appendBlocks(documentId, paragraphs.map((p) => ({ kind: "text", text: p })));
    }
    return {
      document_id: documentId,
      url: await this.documentUrl(documentId),
      revision_id: doc.revision_id,
    };
  }

  async readDocument(documentId) {
    const data = await this._api("GET", `/open-apis/docx/v1/documents/${documentId}/raw_content`);
    return { document_id: documentId, content: data.content || "" };
  }

  async readDocumentBlocks(documentId) {
    const items = [];
    let pageToken;
    do {
      const path = `/open-apis/docx/v1/documents/${documentId}/blocks?page_size=500`
        + (pageToken ? `&page_token=${pageToken}` : "");
      const data = await this._api("GET", path);
      items.push(...(data.items || []));
      pageToken = data.has_more ? data.page_token : null;
    } while (pageToken);
    return items.map((b) => ({
      block_id: b.block_id,
      parent_id: b.parent_id,
      block_type: b.block_type,
      text: blockPlainText(b),
      image_token: b.image?.token,
      table_size: b.table?.property
        ? { rows: b.table.property.row_size, columns: b.table.property.column_size }
        : undefined,
    }));
  }

  async appendBlocks(documentId, blocks) {
    const children = [];
    for (const b of blocks) {
      const kind = b.kind || "text";
      children.push(blockOf(kind, b.text));
    }
    const path = `/open-apis/docx/v1/documents/${documentId}/blocks/${documentId}/children`;
    const data = await this._api("POST", path, { children });
    return { added: (data.children || []).length };
  }

  async updateBlockText(documentId, blockId, text, kind = "text") {
    const path = `/open-apis/docx/v1/documents/${documentId}/blocks/${blockId}?document_revision_id=-1`;
    const key = kind === "heading1" ? "update_heading1_elements" : "update_text_elements";
    await this._api("PATCH", path, { [key]: { elements: [{ text_run: { content: text } }] } });
    return { block_id: blockId, updated: true };
  }

  async deleteBlock(documentId, blockId) {
    const info = await this._api("GET", `/open-apis/docx/v1/documents/${documentId}/blocks/${blockId}`);
    const parentId = info?.block?.parent_id || documentId;
    const children = await this._api(
      "GET",
      `/open-apis/docx/v1/documents/${documentId}/blocks/${parentId}/children?page_size=500`,
    );
    const items = children.items || [];
    const index = items.findIndex((b) => b.block_id === blockId);
    if (index < 0) throw new Error(`block ${blockId} not found under parent ${parentId}`);
    await this._api(
      "DELETE",
      `/open-apis/docx/v1/documents/${documentId}/blocks/${parentId}/children/batch_delete`,
      { start_index: index, end_index: index + 1 },
    );
    return { block_id: blockId, deleted: true };
  }

  async insertTable(documentId, rows, columns) {
    const body = {
      children: [{
        block_type: 31,
        table: { property: { row_size: Number(rows), column_size: Number(columns) } },
      }],
    };
    const path = `/open-apis/docx/v1/documents/${documentId}/blocks/${documentId}/children?document_revision_id=-1`;
    const data = await this._api("POST", path, body);
    const table = (data.children || []).find((b) => b.block_type === 31);
    return { table_block_id: table?.block_id, rows: Number(rows), columns: Number(columns) };
  }

  /**
   * Insert an image buffer into a document.
   * Feishu requires three steps: create an empty image block, upload the media with
   * that block as parent_node, then patch the block with the returned file token.
   */
  async insertImage(documentId, buffer, filename = "image.png") {
    const created = await this._api(
      "POST",
      `/open-apis/docx/v1/documents/${documentId}/blocks/${documentId}/children?document_revision_id=-1`,
      { children: [{ block_type: 27, image: {} }], index: -1 },
    );
    const blockId = (created.children || []).find((b) => b.block_type === 27)?.block_id;
    if (!blockId) throw new Error("failed to create an empty image block");

    const form = new FormData();
    form.append("file_name", filename);
    form.append("parent_type", "docx_image");
    form.append("parent_node", blockId);
    form.append("size", String(buffer.length));
    form.append("extra", JSON.stringify({ drive_route_token: documentId }));
    form.append("file", new Blob([buffer]), filename);
    const uploaded = await this._upload("/open-apis/drive/v1/medias/upload_all", form);
    const token = uploaded.file_token;
    if (!token) throw new Error("image upload returned no file_token");

    await this._api(
      "PATCH",
      `/open-apis/docx/v1/documents/${documentId}/blocks/${blockId}?document_revision_id=-1`,
      { replace_image: { token } },
    );
    return { block_id: blockId, file_token: token, bytes: buffer.length };
  }

  // ---------- bitable ----------
  async createBitable(name) {
    const data = await this._api("POST", "/open-apis/bitable/v1/apps", { name });
    const app = data.app || data;
    const appToken = assertString(app.app_token, "app_token");
    return { app_token: appToken, name: app.name, url: await this.bitableUrl(appToken) };
  }

  async listBitableTables(appToken) {
    const data = await this._api("GET", `/open-apis/bitable/v1/apps/${appToken}/tables?page_size=100`);
    return (data.items || []).map((t) => ({ table_id: t.table_id, name: t.name }));
  }

  async listBitableFields(appToken, tableId) {
    const data = await this._api(
      "GET",
      `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/fields?page_size=100`,
    );
    return (data.items || []).map((f) => ({ field_id: f.field_id, field_name: f.field_name, type: f.type }));
  }

  async createBitableRecord(appToken, tableId, fields) {
    const data = await this._api(
      "POST",
      `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records`,
      { fields },
    );
    const record = data.record || data;
    return { record_id: record.record_id, fields: record.fields };
  }

  async listBitableRecords(appToken, tableId, limit = 20) {
    const size = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const data = await this._api(
      "GET",
      `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records?page_size=${size}`,
    );
    return (data.items || []).map((r) => ({ record_id: r.record_id, fields: r.fields }));
  }

  // ---------- sheets (classic v2 range API) ----------
  async readSheetRange(spreadsheetToken, range) {
    const data = await this._api(
      "GET",
      `/open-apis/sheets/v2/spreadsheets/${spreadsheetToken}/values/${encodeURIComponent(range)}`,
    );
    return { range: data.valueRange?.range ?? range, values: data.valueRange?.values ?? [] };
  }

  async writeSheetRange(spreadsheetToken, range, values) {
    const data = await this._api(
      "PUT",
      `/open-apis/sheets/v2/spreadsheets/${spreadsheetToken}/values`,
      { valueRange: { range, values } },
    );
    return { updated: data.updatedCells ?? null, range: data.updatedRange ?? range };
  }

  // ---------- drive permission ----------
  /**
   * Set link sharing for a document or bitable owned by the app, so that people
   * with the link (in the tenant, or anyone) can open it.
   */
  async setLinkSharing(token, type, linkShareEntity = "tenant_readable", linkSharePerm = "view") {
    const body = { link_share_entity: linkShareEntity, link_share_perm: linkSharePerm };
    const path = `/open-apis/drive/v1/permissions/${token}/public?type=${encodeURIComponent(type)}`;
    const data = await this._api("PATCH", path, body);
    return {
      ok: true,
      token,
      type,
      link_share_entity: data?.permission_public?.link_share_entity ?? linkShareEntity,
    };
  }

  async grantAccess(token, type, openId, perm = "full_access") {
    const body = { member_type: "openid", member_id: openId, perm };
    const path = `/open-apis/drive/v1/permissions/${token}/members?type=${encodeURIComponent(type)}`;
    await this._api("POST", path, body);
    return { ok: true, token, type, open_id: openId, perm };
  }
}

// ---------- helpers ----------
function blockOf(kind, text) {
  const elements = [{ text_run: { content: text ?? "", text_element_style: {} } }];
  if (kind === "heading1") return { block_type: 3, heading1: { elements } };
  if (kind === "heading2") return { block_type: 4, heading2: { elements } };
  if (kind === "bullet") return { block_type: 12, bullet: { elements } };
  if (kind === "quote") return { block_type: 15, quote: { elements } };
  return { block_type: 2, text: { elements } };
}

function blockPlainText(block) {
  const containers = [block.text, block.heading1, block.heading2, block.bullet, block.quote, block.code];
  for (const c of containers) {
    if (c?.elements) {
      return c.elements
        .map((e) => e.text_run?.content ?? "")
        .join("");
    }
  }
  return "";
}

function postToPlainText(post) {
  const lines = post?.zh_cn?.content || post?.en_us?.content || [];
  const out = [];
  for (const row of lines) {
    out.push((row || []).map((e) => e.text ?? e.href ?? "").join(""));
  }
  const title = post?.zh_cn?.title || post?.en_us?.title;
  return (title ? title + "\n" : "") + out.join("\n");
}
