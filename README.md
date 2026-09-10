# dsh-plugin-feishu

Feishu (Lark) tools for DeepSeek Harness: send messages, read chat history,
create / read / append Feishu cloud documents, and grant document access —
all through your enterprise self-built Feishu app. Pure Node, no Python needed.

## Install

Requires DeepSeek Harness with plugin support (`dsh plugin`).

```sh
dsh plugin --profile web add dsh-plugin-feishu     # once published to npm
# or from source / GitHub:
dsh plugin --profile web add github:<owner>/feishu-dsh-plugin
```

Restart / reload the profile, then set plugin configuration
(Settings → Plugins → Plugin configuration, or profile patch):

```yaml
- insert:
    - id: feishu-bridge
      name: dsh-plugin-feishu
      config:
        appId: cli_xxxxxxxx
        appSecret: xxxxxxxxxxxxxxxx
        tenantDomain: your-tenant.feishu.cn   # optional: used to build shareable doc links
```

Environment variable fallback: `FEISHU_APP_ID`, `FEISHU_APP_SECRET`, `FEISHU_TENANT_DOMAIN`.

## Tools

- `feishu_list_chats` — chats the bot is in
- `feishu_send_text` — send a text message to a chat
- `feishu_read_chat_history` — recent messages of a chat
- `feishu_create_document` — create a docx with title + paragraphs
- `feishu_read_document` — read docx plain text
- `feishu_append_document_blocks` — append paragraphs / headings
- `feishu_grant_document_access` — grant a user full access (docx / bitable)

A bundled `feishu` skill documents workflows and configuration.

## Prerequisites (Feishu side)

- Enterprise self-built app with bot enabled (developer console).
- Published scopes: reading group history (`im:message.group_msg` etc.),
  docx document read/write, drive permission management — plus the bot added
  to target chats and docs/bitables it must read.
- Credentials stay local; never share `appSecret` in chat or documents.

## Development

```sh
node scripts/smoke.mjs            # exercises lib/client.js against real API
```

Roadmap: bitable record read/write, sheets, in-doc chart/image blocks,
proactive scheduled messages.

## License

MIT
