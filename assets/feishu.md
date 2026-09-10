# feishu — Feishu (Lark) 云文档 / 消息 / 群记录操作

本技能启用插件的 `feishu_*` 工具，通过企业自建应用操作飞书开放平台。
纯 Node 实现，不需要 Python 或本地脚本。

## 能力清单（工具即能力，与插件描述一致）

| 工具 | 作用 |
|---|---|
| `feishu_list_chats` | 列出机器人所在群/会话（chat_id + 名称） |
| `feishu_send_text` | 向群/会话发送文本消息 |
| `feishu_read_chat_history` | 读取群最近消息（按时间正序） |
| `feishu_create_document` | 新建云文档（标题 + 段落），返回 document_id 与 url（配了 tenantDomain 时） |
| `feishu_read_document` | 读取云文档纯文本 |
| `feishu_append_document_blocks` | 向已有文档追加段落/一级标题 |
| `feishu_grant_document_access` | 把文档/多维表格授权给指定用户（open_id，full_access） |

## 配置要求（安装插件时一次性完成）
在 profile 的插件配置中提供：
- `appId` / `appSecret`：飞书开放平台企业自建应用的凭据（可用环境变量 `FEISHU_APP_ID` / `FEISHU_APP_SECRET` 代替）
- `tenantDomain`（可选，形如 `xxx.feishu.cn`）：用于拼文档分享链接
- 权限前提：应用已开通相应 scope（读群历史 `im:message.group_msg`、docx 读写、drive 授权等）并发布；机器人需在目标群内。

## 常用流程
1. 「看看这个群里最近聊了什么」→ `feishu_read_chat_history`（chat_id 可从 `feishu_list_chats` 拿）。
2. 「把这段内容整理成文档发到群里」→ `feishu_create_document` →（如需用户可见）`feishu_grant_document_access` → `feishu_send_text` 把文档标题与 url 发进群。
3. 「读一下这篇文档」→ 从用户提供的链接中提取 document_id → `feishu_read_document`。
4. 「在文档末尾补一段」→ `feishu_append_document_blocks`。

## 安全约定
- App Secret 只放在本机插件配置/环境变量中，绝不写进对话或文档。
- 工具执行是“对话内按需”，不是常驻机器人；不做自动回复。
