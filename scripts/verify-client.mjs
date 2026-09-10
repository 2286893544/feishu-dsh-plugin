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
      if (name !== "settings.plugin.item" && name !== "settings.section") {
        throw new Error(`unexpected slot "${name}"`);
      }
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
if (registrations.length !== 2) {
  console.error("expected a settings section and a plugin card, got", registrations.length, "registration(s)");
  process.exit(1);
}
const section = registrations.find((entry) => entry.meta.name === "settings.section");
const card = registrations.find((entry) => entry.meta.name === "settings.plugin.item");
if (!section || !card) {
  console.error("missing registration:", registrations.map((entry) => entry.meta.name).join(","));
  process.exit(1);
}
if (section.meta.key !== undefined && section.meta.key !== "feishu-bridge") {
  console.error("section is keyed to an unexpected namespace:", section.meta.key);
  process.exit(1);
}
if (typeof section.meta.label !== "function" || section.meta.label().length === 0) {
  console.error("section has no label resolver (the settings sidebar entry needs one)");
  process.exit(1);
}
if (card.meta.key !== "feishu-bridge") {
  console.error("plugin card key does not match the settings namespace:", card.meta.key);
  process.exit(1);
}

// ---- render both surfaces ----
/** Evaluate function components so nested elements (the shared form) are expanded. */
function expand(node, depth = 0) {
  if (!node || typeof node !== "object" || depth > 8) return node;
  if (Array.isArray(node)) return node.map((child) => expand(child, depth));
  if (typeof node.type === "function") return expand(node.type(node.props), depth + 1);
  return { ...node, props: { ...node.props, children: expand(node.props?.children, depth) } };
}

function renderTree(entry) {
  const element = entry.render();
  if (!element || typeof element.type !== "function") {
    console.error(`${entry.meta.name} render did not return a component element`);
    process.exit(1);
  }
  return expand(element);
}

function collectInputs(node, found) {
  if (!node || typeof node !== "object") return found;
  if (Array.isArray(node)) {
    for (const child of node) collectInputs(child, found);
    return found;
  }
  if (node.type === "input") found.push(node.props);
  collectInputs(node.props?.children, found);
  return found;
}

const sectionInputs = collectInputs(renderTree(section), []);
const cardInputs = collectInputs(renderTree(card), []);
const inputs = cardInputs;

for (const [surface, found] of [["settings.section", sectionInputs], ["settings.plugin.item", cardInputs]]) {
  if (found.length !== 4) {
    console.error(`${surface}: expected 4 configuration inputs, got`, found.length);
    process.exit(1);
  }
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
if (!/留空表示不修改/.test(String(secret.placeholder))) {
  console.error("secret placeholder does not explain that a blank field keeps the stored key:", secret.placeholder);
  process.exit(1);
}
const appIdInput = inputs.find((props) => props.type === "text");
if (appIdInput?.value !== "cli_from_settings") {
  console.error("appId input is not populated from the settings snapshot");
  process.exit(1);
}

console.log("module id:", loaded.id);
console.log("namespace:", boundNamespace);
console.log("registrations:", registrations.map((entry) => entry.meta.name).join(" + "));
console.log("section label:", section.meta.label(), "| card key:", card.meta.key);
console.log("inputs per surface:", sectionInputs.length, "/", cardInputs.length, "(1 password each)");
console.log("CLIENT BUNDLE OK");
