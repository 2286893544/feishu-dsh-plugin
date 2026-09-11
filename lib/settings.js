// Host half of the settings-UI configuration: registers the `feishu-bridge`
// settings namespace so the Plugins → Plugin configuration page can serve it.
//
// The client half (client/client.js) draws the card that keys itself to the same
// namespace; the settings page lists a namespace only when both halves exist.
//
// Deliberately depends on the SERVICE and nothing else: `ctx.inject(['settings'])`
// degrades quietly on a host without a settings service (older dsh), and no
// named helper is imported, because upstream is free to move those wrappers.

import z from "@deepseek-ai/schemastery";

/** Namespace the browser-side card keys itself to. */
export const SETTINGS_NS = "feishu-bridge";

/** The namespace pattern the harness enforces for settings namespaces. */
const NAMESPACE_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
if (!NAMESPACE_PATTERN.test(SETTINGS_NS)) {
  throw new TypeError(`settings namespace "${SETTINGS_NS}" must match ${String(NAMESPACE_PATTERN)}`);
}

/** Editable fields, in the order the card renders them. */
export const SETTINGS_FIELDS = ["appId", "appSecret", "tenantDomain", "defaultChatId", "grantOpenId", "wikiSpaceId", "wikiParentNodeToken"];

/**
 * Schema for the namespace. `appSecret` carries `role("secret")` so the settings
 * service strips it from remote reads and the UI shows a password control whose
 * value is never echoed back.
 */
export const FeishuSettings = z.object({
  appId: z.string().description("Feishu app ID of your self-built app (cli_...)."),
  appSecret: z.string().role("secret").description("Feishu app secret; stored locally and never echoed back to the page."),
  tenantDomain: z.string().description("Optional tenant domain such as acme.feishu.cn; auto-detected when empty."),
  defaultChatId: z.string().description("Optional default chat_id (oc_...) used when a chat tool omits chat_id."),
  grantOpenId: z.string().description("Optional open_id (ou_...) granted full_access on every document/bitable the plugin creates."),
  wikiSpaceId: z.string().description("Optional knowledge-base space id; new documents are created inside it."),
  wikiParentNodeToken: z.string().description("Optional default parent node token for new wiki documents."),
});

/**
 * Wire the namespace so a saved change reaches the running plugin immediately.
 *
 * @param ctx - the plugin context owning the wiring.
 * @param resolved - the live credentials object the tools read on every call.
 * @param onChange - invoked after every applied change (rebuilds the REST client).
 */
export function installFeishuSettings(ctx, resolved, onChange = () => {}) {
  const entry = {};
  for (const field of SETTINGS_FIELDS) entry[field] = resolved[field] ?? "";
  let source = () => entry;

  const apply = () => {
    const value = source() || {};
    for (const field of SETTINGS_FIELDS) {
      const next = value[field];
      if (typeof next === "string" && next !== resolved[field]) resolved[field] = next;
    }
    onChange();
  };

  // `inject` is the graceful-degradation boundary: on a host without a settings
  // service the callback never runs and the composed configuration stands.
  ctx.inject(["settings"], (scoped) => {
    const scope = scoped.settings.register(SETTINGS_NS, FeishuSettings, { base: entry });
    source = () => scope.get();
    scoped.effect(() => () => {
      source = () => entry;
      apply();
    });
    apply();
    scope.watch(apply);
  });
}
