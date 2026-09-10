# dsh-plugin-feishu

Feishu (Lark) tools for DeepSeek Harness: **23 `feishu_*` tools** covering chat
messages, cloud documents (including images, generated charts and tables),
bitable records, spreadsheet ranges and drive permissions — through your own
enterprise self-built Feishu app. Pure Node, no external dependencies, no Python.

## Install

Requires DeepSeek Harness with plugin support (`dsh plugin`).

```sh
dsh plugin --profile web add dsh-plugin-feishu                  # once published to npm
dsh plugin --profile web add github:2286893544/feishu-dsh-plugin # straight from GitHub
```

Reload the profile, then configure the plugin in the harness settings UI. The
client half (`client/client.js`) contributes **both** a dedicated page in the
settings sidebar (**Settings → 飞书（Feishu）**) and a card under
**Settings → Plugins → Plugin configuration**; both write into the `feishu-bridge`
settings namespace, so a saved change applies immediately:

| Field | Meaning |
|---|---|
| `appId` | Feishu app ID of your self-built app (`cli_...`) |
| `appSecret` | Feishu app secret — declared `role("secret")`, so it is redacted from every page read and shown as a password control that starts blank |
| `tenantDomain` | Optional (`acme.feishu.cn`); auto-detected from the tenant API when empty |
| `defaultChatId` | Optional (`oc_...`) used by the chat tools when a call omits `chat_id` |

On a host without a settings service the card is simply absent and the composed
configuration stands. Both fallbacks remain: the profile patch entry
(`config: { appId, appSecret, ... }`) and the environment variables
`FEISHU_APP_ID`, `FEISHU_APP_SECRET`, `FEISHU_TENANT_DOMAIN`.

## Tools (23)

**Chat & messages** — `feishu_list_chats`, `feishu_list_chat_members`,
`feishu_send_text`, `feishu_send_post_message`, `feishu_read_chat_history`,
`feishu_recall_message`

**Documents (docx)** — `feishu_create_document`, `feishu_read_document`,
`feishu_read_document_blocks`, `feishu_append_document_blocks`,
`feishu_update_document_block`, `feishu_delete_document_block`,
`feishu_insert_table_into_document`, `feishu_insert_image_into_document`,
`feishu_insert_chart_into_document`

**Bitable** — `feishu_create_bitable`, `feishu_list_bitable_tables`,
`feishu_list_bitable_fields`, `feishu_write_bitable_record`,
`feishu_read_bitable_records`

**Sheets (classic v2 range API)** — `feishu_read_sheet_range`,
`feishu_write_sheet_range`

**Permissions** — `feishu_grant_document_access`

A bundled `feishu` skill documents the workflows and known limits for the agent.

## Notes and limits

- Charts are rendered locally (pure Node PNG encoder + 5×7 ASCII font); chart
  titles and category labels are ASCII-only — non-ASCII characters are dropped.
  For Chinese labels, generate the image yourself and use
  `feishu_insert_image_into_document`.
- Spreadsheet tools use the classic sheets v2 range API.
- Only chats the bot belongs to can be read; other users' private chats are not
  accessible through the Feishu API.

## Prerequisites (Feishu side)

- Enterprise self-built app with the bot enabled.
- Published scopes for reading chat history (`im:message.group_msg` …), docx
  read/write, bitable, sheets and drive permission management; the bot must be a
  member of the target chats, and documents the app must read must be shared
  with it.
- Credentials stay local; never share `appSecret` in chat or documents.

## Development

```sh
node scripts/verify-registration.mjs   # offline: registers 23 tools + skill, renders a chart
node scripts/smoke.mjs                 # live API check (needs credentials; optional doc id)
```

## License

MIT
