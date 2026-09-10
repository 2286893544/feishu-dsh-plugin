# feishu — Feishu (Lark) 云文档 / 多维表格 / 电子表格 / 消息

本技能启用插件的 23 个 `feishu_*` 工具，通过企业自建应用操作飞书开放平台。
纯 Node 实现（无外部依赖），不需要 Python 或本地脚本。

## 工具清单（与插件描述、代码严格一致）

**会话与消息**
| 工具 | 作用 |
|---|---|
| `feishu_list_chats` | 列出机器人所在群/会话（chat_id + 名称） |
| `feishu_list_chat_members` | 列出群成员（open_id + 姓名），用于授权文档 |
| `feishu_send_text` | 发送文本消息 |
| `feishu_send_post_message` | 发送富文本（post）消息：标题 + 多行正文 |
| `feishu_read_chat_history` | 读取群最近消息（时间正序） |
| `feishu_recall_message` | 撤回机器人自己发出的消息 |

**云文档 docx**
| 工具 | 作用 |
|---|---|
| `feishu_create_document` | 新建文档（标题 + 段落），返回 document_id 与分享链接 |
| `feishu_read_document` | 读取文档纯文本 |
| `feishu_read_document_blocks` | 读取块结构（block_id / 类型 / 文本 / 图片 token / 表格尺寸） |
| `feishu_append_document_blocks` | 追加块：text / heading1 / heading2 / bullet / quote |
| `feishu_update_document_block` | 按 block_id 改写某个块的文本 |
| `feishu_delete_document_block` | 按 block_id 删除块 |
| `feishu_insert_table_into_document` | 插入 N×M 空表格 |
| `feishu_insert_image_into_document` | 插入图片：本地路径 / https URL / base64 |
| `feishu_insert_chart_into_document` | 本地渲染柱状图并插入文档（标题与分类标签仅支持 ASCII） |

**多维表格 bitable**
| 工具 | 作用 |
|---|---|
| `feishu_create_bitable` | 新建多维表格，返回 app_token 与链接 |
| `feishu_list_bitable_tables` | 列出数据表 |
| `feishu_list_bitable_fields` | 列出字段（field_id / 名称 / 类型） |
| `feishu_write_bitable_record` | 写入一条记录（字段名 → 值） |
| `feishu_read_bitable_records` | 读取记录 |

**电子表格 sheets（经典 v2 range API）**
| 工具 | 作用 |
|---|---|
| `feishu_read_sheet_range` | 读取区间，如 `<sheetId>!A1:C5` |
| `feishu_write_sheet_range` | 写入二维数组到区间 |

**权限**
| 工具 | 作用 |
|---|---|
| `feishu_grant_document_access` | 把文档/多维表格授权给用户（open_id，full_access） |

## 配置
在**设置 → 插件 → 插件配置 → 飞书（Feishu）机器人**中填写（卡片由插件客户端半边提供，保存后即时生效、无需重启）：
- `appId`：企业自建应用 App ID（`cli_...`）
- `appSecret`：应用密钥，标记为 `role("secret")`，界面用密码框显示，远程读取时会被脱敏
- `tenantDomain`：**可选**。留空时插件自动调企业信息接口获取域名，用于拼文档/表格分享链接
- `defaultChatId`：**可选**。会话类工具不传 `chat_id` 时使用该默认群
- 无界面场景可用环境变量 `FEISHU_APP_ID` / `FEISHU_APP_SECRET` / `FEISHU_TENANT_DOMAIN`
- 页面上的**「测试连接」**按钮会用已保存的凭据真实调一次飞书接口，返回应用名、企业域名、密钥掩码指纹与配置来源；失败时给出具体错误码（如 10003 = App ID 与密钥不匹配）。密钥不会离开宿主，也不会回显到页面。
- 权限前提：应用已开通并发布相应 scope（读群历史 `im:message.group_msg`、docx 读写、bitable、sheets、drive 授权等），机器人需在目标群内

## 常用流程
1. **聊天记录**：`feishu_list_chats` 拿 chat_id → `feishu_read_chat_history` 读取 → 需要时整理成结论。
2. **文档交付**：`feishu_create_document` → `feishu_append_document_blocks` / `feishu_insert_chart_into_document` → `feishu_list_chat_members` 取 open_id → `feishu_grant_document_access` → `feishu_send_post_message` 把标题与链接发进群。
3. **表格数据**：`feishu_create_bitable` → `feishu_list_bitable_tables` 取 table_id → `feishu_list_bitable_fields` 看字段 → `feishu_write_bitable_record` / `feishu_read_bitable_records`。
4. **电子表格**：直接从表格链接取 token，用 `feishu_read_sheet_range` / `feishu_write_sheet_range` 读写区间。
5. **误发补救**：`feishu_recall_message` 撤回机器人刚发的消息。

## 已知限制
- 柱状图的标题与分类标签使用内置 5×7 ASCII 字体，**非 ASCII 字符会被丢弃**；需要中文标签时改为用 `feishu_insert_image_into_document` 传入已生成好的图片。
- 电子表格工具使用经典 v2 range 接口；新版 sheets v3 接口未覆盖。
- 只能读取机器人所在群的消息；无法读取他人私聊（飞书平台限制）。

## 安全约定
- App Secret 只放在本机插件配置/环境变量，绝不写进对话或文档。
- 工具是「对话内按需调用」，不做常驻自动回复。
