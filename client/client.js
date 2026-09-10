// Client half of the Feishu plugin UI.
//
// Registers one slot: `settings.section`, the dedicated "飞书（Feishu）" page in the
// settings sidebar (the same slot community plugins such as the side card use).
// It writes into the `feishu-bridge` settings namespace registered by
// lib/settings.js, so a saved edit reaches the running plugin without a restart.
// The Plugins-tab card was deliberately dropped: one configuration surface, not two.
//
// Plain browser bundle — no build step. The harness loads client plugins through the
// module loader below and calls `apply(ctx)` with the client context.

window.__ModuleLoader__.load({
  id: "dsh-plugin-feishu",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    const React = require("react");
    const h = React.createElement;

    /** Must match lib/routes.js. */
    const TEST_PATH = "/dsh-plugin-feishu/test-connection";

    /** Must match lib/settings.js. */
    const NS = "feishu-bridge";

    const FIELDS = [
      { key: "appId", label: "应用 ID（appId）", placeholder: "cli_xxxxxxxxxxxx" },
      { key: "appSecret", label: "应用密钥（appSecret）", secret: true, placeholder: "未配置" },
      { key: "tenantDomain", label: "企业域名（可选）", placeholder: "留空自动探测，例如 your-tenant.feishu.cn" },
      { key: "defaultChatId", label: "默认群 chat_id（可选）", placeholder: "oc_xxxxxxxxxxxx（会话工具不传 chat_id 时使用）" },
    ];

    const TOOL_GROUPS = [
      { title: "会话与消息", count: 6, tools: "list_chats / list_chat_members / send_text / send_post_message / read_chat_history / recall_message" },
      { title: "云文档 docx", count: 9, tools: "create_document / read_document / read_document_blocks / append_document_blocks / update_document_block / delete_document_block / insert_table_into_document / insert_image_into_document / insert_chart_into_document" },
      { title: "多维表格 bitable", count: 5, tools: "create_bitable / list_bitable_tables / list_bitable_fields / write_bitable_record / read_bitable_records" },
      { title: "电子表格 sheets", count: 2, tools: "read_sheet_range / write_sheet_range（经典 v2 区间接口）" },
      { title: "权限", count: 2, tools: "grant_document_access / set_document_link_sharing" },
    ];

    const inputStyle = {
      boxSizing: "border-box",
      width: "100%",
      height: "32px",
      padding: "0 10px",
      borderRadius: "8px",
      border: "1px solid var(--dsw-alias-border-l2)",
      background: "var(--dsw-alias-bg-layer-1)",
      color: "var(--dsw-alias-label-primary)",
      font: "inherit",
      fontSize: "13px",
    };

    const buttonStyle = (primary) => ({
      boxSizing: "border-box",
      height: "32px",
      padding: "0 14px",
      borderRadius: "16px",
      border: primary ? "1px solid transparent" : "1px solid var(--dsw-alias-border-l3)",
      background: primary ? "var(--dsw-alias-button-primary-fill)" : "transparent",
      color: primary ? "var(--dsw-alias-label-primary-foreground)" : "var(--dsw-alias-label-primary)",
      font: "inherit",
      fontSize: "13px",
      cursor: "pointer",
    });

    const MUTED = { fontSize: "12px", color: "var(--dsw-alias-label-secondary)", lineHeight: "19px" };
    const FAINT = { fontSize: "12px", color: "var(--dsw-alias-label-tertiary)", lineHeight: "19px" };

    /** Drafts: non-secret fields start from the stored values; secrets never do. */
    function draftsFrom(value) {
      const next = {};
      for (const field of FIELDS) {
        next[field.key] = field.secret ? "" : (typeof value?.[field.key] === "string" ? value[field.key] : "");
      }
      return next;
    }

    /** Subscribe to the host-backed settings snapshot (secrets already redacted). */
    function useSettingsSnapshot(scope) {
      const subscribe = React.useCallback((listener) => scope.subscribe(listener), [scope]);
      const getSnapshot = React.useCallback(() => scope.getSnapshot(), [scope]);
      return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    }

    /** Credentials form: shared by the dedicated page and the plugin card. */
    function FeishuSettingsForm(props) {
      const scope = props.scope;
      const snapshot = useSettingsSnapshot(scope);
      const value = snapshot?.value ?? {};
      const writable = snapshot?.writable !== false;
      const ready = snapshot?.status === "ready" || snapshot?.status === "loaded";

      const [drafts, setDrafts] = React.useState(() => draftsFrom(value));
      const [busy, setBusy] = React.useState(false);
      const [message, setMessage] = React.useState("");
      const [testing, setTesting] = React.useState(false);
      const [testLines, setTestLines] = React.useState([]);

      React.useEffect(() => {
        setDrafts(draftsFrom(value));
      }, [snapshot?.revision, value.appId, value.tenantDomain, value.defaultChatId]);

      const setDraft = (key, text) => setDrafts((current) => ({ ...current, [key]: text }));

      const dirty = FIELDS.filter((field) => {
        const draft = (drafts[field.key] ?? "").trim();
        if (field.secret) return draft.length > 0;
        return draft !== ((value[field.key] ?? "").toString().trim());
      });

      async function save() {
        if (dirty.length === 0) {
          setMessage("没有需要保存的改动");
          return;
        }
        setBusy(true);
        setMessage("");
        try {
          for (const field of dirty) {
            await scope.set(field.key, (drafts[field.key] ?? "").trim());
          }
          setMessage(`已保存 ${dirty.length} 项（正在生效）`);
          if (dirty.some((field) => field.secret)) setDraft("appSecret", "");
        } catch (err) {
          setMessage(`保存失败：${err?.message ?? String(err)}`);
        } finally {
          setBusy(false);
        }
      }

      function discard() {
        setDrafts(draftsFrom(value));
        setMessage("已恢复为已保存的值");
      }

      const statusText = !ready
        ? "正在读取配置…"
        : writable
          ? "密钥保存在本机 profile 设置中，页面不会回显已存密钥。"
          : "当前部署不可写（配置由 profile 文件提供）。";

      /** Ask the host to exercise the stored credentials; only non-secret facts come back. */
      async function runTest() {
        setTesting(true);
        setTestLines(["正在连接飞书…"]);
        try {
          const response = await fetch(TEST_PATH, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{}",
            cache: "no-store",
          });
          const body = await response.json().catch(() => ({}));
          if (!response.ok || body.ok !== true) {
            setTestLines([
              "❌ 连接失败",
              String(body.error ?? `HTTP ${response.status}`),
              body.code === undefined ? "" : `错误码：${body.code}`,
            ].filter(Boolean));
            return;
          }
          const sources = [];
          if (body.sources?.environment) sources.push("环境变量");
          if (body.sources?.profileConfig) sources.push("profile 配置");
          setTestLines([
            "✅ 连接成功",
            `应用：${body.botName ?? "(未返回)"}`,
            `企业：${body.tenantName ?? "(未知)"}（${body.tenantDomain ?? "域名未知"}）`,
            `应用 ID：${body.appId ?? "(未设置)"}`,
            `密钥指纹：${body.secretFingerprint ?? "(未设置)"}`,
            `配置来源：${sources.length > 0 ? sources.join(" + ") : "设置界面"}`,
          ]);
        } catch (err) {
          setTestLines(["❌ 测试请求失败", String(err?.message ?? err)]);
        } finally {
          setTesting(false);
        }
      }

      return h(
        "div",
        { style: { display: "flex", flexDirection: "column", gap: "12px" } },
        ...FIELDS.map((field) =>
          h(
            "label",
            { key: field.key, style: { display: "flex", flexDirection: "column", gap: "5px" } },
            h("span", { style: MUTED }, field.label),
            h("input", {
              type: field.secret ? "password" : "text",
              value: drafts[field.key] ?? "",
              // The settings service never reports whether a secret is set through a
              // read (that would be a disclosure), so the placeholder stays neutral
              // rather than guessing "未配置".
              placeholder: field.secret ? "已保存的密钥不会回显；留空表示不修改" : field.placeholder,
              autoComplete: "off",
              spellCheck: false,
              disabled: !writable || busy,
              onChange: (event) => setDraft(field.key, event.target.value),
              style: inputStyle,
            }),
          ),
        ),
        h(
          "div",
          { style: { display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" } },
          h("button", { type: "button", style: buttonStyle(true), disabled: !writable || busy, onClick: () => { save(); } }, busy ? "保存中…" : "保存"),
          h("button", { type: "button", style: buttonStyle(false), disabled: busy, onClick: discard }, "重置"),
          h("button", { type: "button", style: buttonStyle(false), disabled: testing, onClick: () => { runTest(); } }, testing ? "测试中…" : "测试连接"),
          message ? h("span", { style: MUTED }, message) : null,
        ),
        testLines.length > 0
          ? h(
              "div",
              {
                style: {
                  display: "flex",
                  flexDirection: "column",
                  gap: "3px",
                  padding: "10px 12px",
                  borderRadius: "10px",
                  background: "var(--dsw-alias-bg-layer-1)",
                  border: "1px solid var(--dsw-alias-border-l2)",
                  fontSize: "12px",
                  lineHeight: "20px",
                  whiteSpace: "pre-wrap",
                },
              },
              ...testLines.map((line, index) => h("div", { key: index }, line)),
            )
          : null,
        h("div", { style: FAINT }, statusText),
      );
    }

    /** Dedicated settings page (sidebar entry): credentials form plus a plugin reference. */
    function FeishuSection(props) {
      return h(
        "div",
        { style: { boxSizing: "border-box", maxWidth: "720px", display: "flex", flexDirection: "column", gap: "20px" } },
        h(
          "div",
          { style: { display: "flex", flexDirection: "column", gap: "6px" } },
          h("h2", { style: { margin: 0, fontSize: "20px", fontWeight: 600, lineHeight: "30px" } }, "飞书（Feishu）"),
          h("p", { style: { margin: 0, ...MUTED } }, "通过企业自建应用操作飞书：群消息与聊天记录、云文档（含图表与图片）、多维表格、电子表格区间与文档授权。"),
        ),
        h(
          "div",
          { style: { border: "1px solid var(--dsw-alias-border-l2)", borderRadius: "14px", padding: "18px", display: "flex", flexDirection: "column", gap: "12px", background: "var(--dsw-alias-bg-module-platform)" } },
          h("div", { style: { fontSize: "14px", fontWeight: 600 } }, "应用凭据"),
          h(FeishuSettingsForm, { scope: props.scope }),
        ),
        h(
          "div",
          { style: { display: "flex", flexDirection: "column", gap: "8px" } },
          h("div", { style: { fontSize: "14px", fontWeight: 600 } }, "工具清单（共 24 个）"),
          ...TOOL_GROUPS.map((group) =>
            h(
              "div",
              { key: group.title, style: { display: "flex", flexDirection: "column", gap: "2px" } },
              h("div", { style: { fontSize: "13px" } }, `${group.title}（${group.count}）`),
              h("div", { style: FAINT }, group.tools),
            ),
          ),
        ),
        h(
          "div",
          { style: { ...FAINT, borderTop: "1px solid var(--dsw-alias-border-l2)", paddingTop: "12px" } },
          "前提：应用已开通并发布相应权限（读群历史、docx 读写、bitable、sheets、云文档授权等），机器人需在目标群内。图表标题与分类标签仅支持 ASCII；电子表格走经典 v2 区间接口。",
        ),
      );
    }

    /** Client plugin entry: the dedicated "飞书（Feishu）" page in the settings sidebar. */
    function apply(ctx) {
      const scope = ctx.settingsScope.bind({ namespace: NS });

      ctx.slots.inject("settings.section", () =>
        ctx.slots.register(
          {
            name: "settings.section",
            id: "feishu",
            order: 45,
            label: () => "飞书（Feishu）",
            inject: () => ({ scope }),
          },
          () => h(FeishuSection, { scope }),
        ),
      );
    }

    // Client-side services required before this bundle mounts (cordis fiber inject
    // uses service names, not module ids — see dsh-client-ui-settings-plugins).
    const inject = ["slots", "settingsScope"];

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
