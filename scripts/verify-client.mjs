// Offline verification of the client half (client/client.js):
// loads the browser bundle under a stubbed module loader + React, runs apply()
// against a stubbed client context, and renders the settings card to make sure it
// produces the expected fields. Run: node scripts/verify-client.mjs
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const bundlePath = fileURLToPath(new URL("../client/client.js", import.meta.url));

// ---- minimal React stub ----
const React = {
  createElement: (type, props, ...children) => ({
    type,
    props: {
      ...(props || {}),
      children: children.length === 0 ? undefined : children.length === 1 ? children[0] : children,
    },
  }),
  useState: (initial) => [typeof initial === "function" ? initial() : initial, () => {}],
  useEffect: (fn) => {
    // Run the effect so its body is genuinely exercised; the stubbed setters are
    // no-ops, so this cannot loop.
    fn();
  },
  useCallback: (fn) => fn,
  useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
};

const requireStub = (id) => {
  if (id === "react") return React;
  throw new Error(`unexpected require("${id}")`);
};

// ---- module loader shim ----
let loaded = null;
globalThis.window = {
  __ModuleLoader__: {
    load: (definition) => {
      loaded = definition;
    },
  },
};

await import(pathToFileURL(bundlePath).href + `?t=${Date.now()}`);
if (!loaded) {
  console.error("client bundle did not call window.__ModuleLoader__.load");
  process.exit(1);
}
if (loaded.id !== "dsh-plugin-feishu") {
  console.error("unexpected client module id:", loaded.id);
  process.exit(1);
}
const exports = loaded.factory(requireStub);
if (typeof exports.apply !== "function") {
  console.error("client bundle has no apply()");
  process.exit(1);
}

// ---- client context stub ----
const registrations = [];
let boundNamespace = null;
const scope = {
  getSnapshot: () => ({
    status: "ready",
    writable: true,
    revision: 3,
    value: { appId: "cli_from_settings", tenantDomain: "acme.feishu.cn", defaultChatId: "oc_from_settings" },
    secrets: [{ path: ["appSecret"], set: true }],
  }),
  subscribe: () => () => {},
  set: async () => {},
};
const ctx = {
  settingsScope: {
    bind: (spec) => {
      boundNamespace = spec?.namespace ?? null;
      return scope;
    },
  },
  slots: {
    inject: (name, register) => {
      if (name !== "settings.plugin.item") throw new Error(`unexpected slot "${name}"`);
      register();
    },
    register: (meta, render) => {
      registrations.push({ meta, render });
      return () => {};
    },
  },
};

exports.apply(ctx);

if (boundNamespace !== "feishu-bridge") {
  console.error("card did not bind the feishu-bridge settings namespace:", boundNamespace);
  process.exit(1);
}
if (registrations.length !== 1) {
  console.error("expected exactly one settings card registration, got", registrations.length);
  process.exit(1);
}
const { meta, render } = registrations[0];
if (meta.name !== "settings.plugin.item" || meta.key !== "feishu-bridge") {
  console.error("card registration metadata is wrong:", JSON.stringify(meta));
  process.exit(1);
}

// ---- render the card ----
const element = render();
if (!element || typeof element.type !== "function") {
  console.error("card render did not return a component element");
  process.exit(1);
}
const tree = element.type(element.props);

const inputs = [];
const walk = (node) => {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) return node.forEach(walk);
  if (node.type === "input") inputs.push(node.props);
  walk(node.props?.children);
};
walk(tree);

if (inputs.length !== 4) {
  console.error("expected 4 configuration inputs, got", inputs.length);
  process.exit(1);
}
const secret = inputs.find((props) => props.type === "password");
if (!secret) {
  console.error("appSecret input is not a password field");
  process.exit(1);
}
if (secret.value !== "") {
  console.error("secret field must never be pre-filled with a stored value");
  process.exit(1);
}
if (!/已配置/.test(String(secret.placeholder))) {
  console.error("secret placeholder does not report the configured state:", secret.placeholder);
  process.exit(1);
}
const appIdInput = inputs.find((props) => props.type === "text");
if (appIdInput?.value !== "cli_from_settings") {
  console.error("appId input is not populated from the settings snapshot");
  process.exit(1);
}

console.log("module id:", loaded.id);
console.log("namespace:", boundNamespace, "| card key:", meta.key);
console.log("inputs:", inputs.length, "(1 password)");
console.log("CLIENT BUNDLE OK");
