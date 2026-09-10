// Client half of the settings-UI configuration: a card on
// Settings → Plugins → Plugin configuration, keyed to the `feishu-bridge`
// settings namespace the host half registers (lib/settings.js).
//
// Plain browser bundle — no build step. The harness loads client plugins through
// the module loader below and calls `apply(ctx)` with the client context.

window.__ModuleLoader__.load({
  id: "dsh-plugin-feishu",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    const React = require("react");
    const h = React.createElement;

    /** Must match lib/settings.js. */
    const NS = "feishu-bridge";

    const FIELDS = [
      { key: "appId", label: "应用 ID（appId）", placeholder: "cli_xxxxxxxxxxxx" },
      { key: "appSecret", label: "应用密钥（appSecret）", secret: true, placeholder: "未配置" },
      { key: "tenantDomain", label: "企业域名（可选）", placeholder: "留空自动探测，例如 your-tenant.feishu.cn" },
      { key: "defaultChatId", label: "默认群 chat_id（可选）", placeholder: "oc_xxxxxxxxxxxx（会话工具不传 chat_id 时使用）" },
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

    /** Editable drafts: non-secret fields start from the stored values, secrets never do. */
    function draftsFrom(value) {
      const next = {};
      for (const field of FIELDS) {
        next[field.key] = field.secret ? "" : (typeof value?.[field.key] === "string" ? value[field.key] : "");
      }
      return next;
    }

    /** Read the current settings snapshot (host-backed, secrets redacted). */
    function useSettingsSnapshot(scope) {
      const subscribe = React.useCallback((listener) => scope.subscribe(listener), [scope]);
      const getSnapshot = React.useCallback(() => scope.getSnapshot(), [scope]);
      return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    }

    function FeishuSettingsCard(props) {
      const scope = props.scope;
      const snapshot = useSettingsSnapshot(scope);
      const value = snapshot?.value ?? {};
      const secrets = Array.isArray(snapshot?.secrets) ? snapshot.secrets : [];
      const secretSet = secrets.some((entry) => entry?.set && entry.path?.[0] === "appSecret");
      const writable = snapshot?.writable !== false;
      const ready = snapshot?.status === "ready" || snapshot?.status === "loaded";

      const [drafts, setDrafts] = React.useState(() => draftsFrom(value));
      const [busy, setBusy] = React.useState(false);
      const [message, setMessage] = React.useState("");

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

      return h(
        "div",
        { style: { display: "flex", flexDirection: "column", gap: "12px", padding: "16px" } },
        h(
          "div",
          { style: { display: "flex", flexDirection: "column", gap: "4px" } },
          h("div", { style: { fontSize: "15px", fontWeight: 600 } }, "飞书（Feishu）机器人"),
          h(
            "div",
            { style: { fontSize: "12px", color: "var(--dsw-alias-label-secondary)", lineHeight: "19px" } },
            "feishu_* 工具使用的企业自建应用凭据。修改后立即生效，无需重启。",
          ),
        ),
        ...FIELDS.map((field) =>
          h(
            "label",
            { key: field.key, style: { display: "flex", flexDirection: "column", gap: "5px" } },
            h("span", { style: { fontSize: "12px", color: "var(--dsw-alias-label-secondary)" } }, field.label),
            h("input", {
              type: field.secret ? "password" : "text",
              value: drafts[field.key] ?? "",
              placeholder: field.secret && secretSet ? "已配置（留空表示不修改）" : field.placeholder,
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
          h(
            "button",
            { type: "button", style: buttonStyle(true), disabled: !writable || busy, onClick: () => { save(); } },
            busy ? "保存中…" : "保存",
          ),
          h(
            "button",
            { type: "button", style: buttonStyle(false), disabled: busy, onClick: discard },
            "重置",
          ),
          message ? h("span", { style: { fontSize: "12px", color: "var(--dsw-alias-label-secondary)" } }, message) : null,
        ),
        h("div", { style: { fontSize: "12px", color: "var(--dsw-alias-label-tertiary)", lineHeight: "19px" } }, statusText),
      );
    }

    /** Client plugin entry: claim the namespace on the plugin configuration page. */
    function apply(ctx) {
      const scope = ctx.settingsScope.bind({ namespace: NS });
      ctx.slots.inject("settings.plugin.item", () =>
        ctx.slots.register(
          {
            name: "settings.plugin.item",
            key: NS,
            inject: () => ({ scope }),
          },
          () => h(FeishuSettingsCard, { scope }),
        ),
      );
    }

    const inject = ["@deepseek-ai/dsh-client-ui-settings"];

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
