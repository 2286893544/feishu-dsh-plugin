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
    this.appId = assertString(appId, "appId");
    this.appSecret = assertString(appSecret, "appSecret");
    this.tenantDomain = tenantDomain || null;
    this.timeoutMs = timeoutMs;
    this.token = null;
    this.tokenExpiresAt = 0;
  }

  makeDocumentUrl(documentId) {
    if (!this.tenantDomain) return null;
    return `https://${this.tenantDomain}/docx/${documentId}`;
  }

  async _token() {
    if (this.token && Date.now() < this.tokenExpiresAt) return this.token;
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

  // ---- IM ----
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

  async sendText(chatId, text) {
    const body = {
      receive_id: chatId,
      msg_type: "text",
      content: JSON.stringify({ text }),
    };
    const data = await this._api("POST", "/open-apis/im/v1/messages?receive_id_type=chat_id", body);
    return { message_id: data.message_id, create_time: data.create_time };
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

  // ---- docx ----
  async createDocument(title, paragraphs = []) {
    const data = await this._api("POST", "/open-apis/docx/v1/documents", { title });
    const doc = data.document || data;
    const documentId = assertString(doc.document_id, "document_id");
    if (paragraphs.length > 0) {
      await this.appendBlocks(documentId, paragraphs.map((p) => ({ kind: "text", text: p })));
    }
    return {
      document_id: documentId,
      url: this.makeDocumentUrl(documentId),
      revision_id: doc.revision_id,
    };
  }

  async readDocument(documentId) {
    const data = await this._api("GET", `/open-apis/docx/v1/documents/${documentId}/raw_content`);
    return { document_id: documentId, content: data.content || "" };
  }

  async appendBlocks(documentId, blocks) {
    const children = [];
    for (const b of blocks) {
      const kind = b.kind || "text";
      if (kind === "heading1") {
        children.push({ block_type: 3, heading1: { elements: [{ text_run: { content: b.text, text_element_style: {} } }] } });
      } else {
        children.push({ block_type: 2, text: { elements: [{ text_run: { content: b.text, text_element_style: {} } }] } });
      }
    }
    const path = `/open-apis/docx/v1/documents/${documentId}/blocks/${documentId}/children`;
    const data = await this._api("POST", path, { children });
    return { added: (data.children || []).length };
  }

  // ---- drive permission ----
  async grantAccess(token, type, openId, perm = "full_access") {
    const body = { member_type: "openid", member_id: openId, perm };
    const path = `/open-apis/drive/v1/permissions/${token}/members?type=${encodeURIComponent(type)}`;
    await this._api("POST", path, body);
    return { ok: true, token, type, open_id: openId, perm };
  }
}
