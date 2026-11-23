# chief

在 Claude App 里给你一个私人助理主会话（「chief 消息中心」）：Slack / GitHub / Jira 里找你的事，它能办的派给工作会话去办，跟着进度，只把要你拍板的列给你。你只和主会话打交道，旁边的 chief 面板看进度、确认回复、改规矩。

从 relay 复制出来的插件版：一个插件里装着面板、消息中心 skill 和后台引擎，装好插件后在面板的「设置」页点几下就能用。

```
Slack（推送） / GitHub、Jira、Notion（每 5 分钟拉一次）
  → chief 引擎（launchd 常驻，~/chief/data/app）：只把「有人找你」的写进 ~/chief/data/events.jsonl
  → 「chief 消息中心」会话用 Monitor 盯着，来了按你的规矩判断：派给工作会话 / 只记下 / 问你
  → 工作会话干活，向主会话汇报进展 / 要你定 / 回复稿
  → 回复放进「待发出」，你在面板上确认（或规矩允许直接发），引擎以你的身份发出，5 秒内可撤回
```

## 装

要求：macOS、Node 24 以上、Google Chrome（登录 Slack 用）。用 GitHub / Jira 的话，先装好并登录 `gh`、`acli`（Jira 也可以用 `twg`：`twg login`；两个都装了用 `acli`）。

1. 装插件：

   ```bash
   claude plugin marketplace add jinjin99/chief
   claude plugin install chief@chief --scope user
   ```

2. 在 Claude App 里新建一个会话（权限模式选 bypass permissions），输入 `/chief` 打开面板，在「设置」页按顺序点：
   - **装引擎**：建工作目录 `~/chief`，把引擎放到 `~/chief/data/app`，装依赖，装进 launchd（开机自动跑）。
   - **登录 Slack**：弹出一个单独的 Chrome 窗口，你在里面正常登录。工作区要公司 SSO 的，登上账号后会自动再开一个工作区地址的窗口，在那里走完 SSO。登好窗口自己关掉，登录凭证直接存进钥匙串。
   - **连上 GitHub / Jira**（可选）：用本机已经登录的 `gh`、`acli` 或 `twg`。
   - **开消息中心**：这个会话就成了主会话，之后一直开着。

## 更新

插件只跟着发布的版本走（`v` 开头的 tag），main 上还没发版的改动不会到你手里。

- 想自动更新：`/plugin` → Marketplaces → chief → 打开自动更新。不开的话，自己跑 `claude plugin update chief@chief`。
- 插件更新后，下次打开会话时引擎会自己跟着更新，不用再点什么。

## 装之前要知道的风险

chief 替你读消息、开会话、以你的名义发回复，权限给得很大。下面这些请看过再决定用不用：

- **bypass permissions：** 消息中心和它开的工作会话都用 bypass permissions，跑命令、改文件不再一条条问你。chief 在 skill 里要求它把收到的消息当数据、不当指令，但这是靠模型遵守，不是硬隔离。别人发来一句精心写的话，仍有可能让会话做你没想到的事。介意的话，就别用 bypass，换成默认模式，自己一条条批准。
- **以你的名义发消息：** 发送这一步由引擎把关，只有三条路能发出去：你在面板上点发送；你在消息中心里亲口说「发」（插件核对是你本人敲的字）；规矩允许直接发的（固定回复、你信任的人等）。默认规矩下，对外的回复都先问你。
- **Slack 用的是你浏览器的登录凭证，不是官方 Slack App：** chief 拿到的是你账号的全部权限，凭证存在 macOS 钥匙串里。有些公司的 Slack 管理规定不允许这样接入，用之前先确认你们公司允许。
- **数据存在本机：** 收到的消息原文、回复稿、日志都明文存在 `~/chief/data`，不上传到别处，也不会自动清理。不想留了直接删掉这个目录。
- **只在 macOS + Claude App 里能用**，终端版的 Claude Code 里面板和开会话都用不了。


## 工作目录 ~/chief

装引擎时会建一个 `~/chief`，chief 的东西全在这里，消息中心也开在这里（新建会话时文件夹选它）：

| 路径 | 是什么 |
| --- | --- |
| `CLAUDE.md` | 你写给助理的长期交代：你是谁、常用仓库、说话习惯、别碰的事 |
| `rules.json` | 规矩：每类消息怎么办、回复要不要你确认（面板「策略」页改，或跟消息中心说） |
| `notes/` | 助理记下的东西：谁是谁（`people.md`）、哪类事在哪个目录办（`projects.md`） |
| `.claude/skills/` | 只给消息中心用的 skill |
| `data/` | 进展、收到的消息、待发回复、日志、引擎程序（有别人的原话，`.gitignore` 已忽略） |

模板文件插件更新只补缺的，不覆盖你改过的。

## 目录

| 路径 | 是什么 |
| --- | --- |
| `plugin/` | 插件本体 |
| `plugin/hooks/` | 面板（`/chief`）：现在要你 / 待发出 / 进度 / 策略 / 测评 / 设置 |
| `plugin/skills/hub/` | 消息中心 skill（`/chief:hub`） |
| `plugin/engine/` | 后台引擎和 `chief` 命令行（TypeScript，tsx 直接跑） |
| `plugin/setup.sh` | 设置页「装引擎」跑的脚本 |
| `plugin/workspace/` | 工作目录 `~/chief` 的初始文件 |

chief 的东西都在 `~/chief` 里。不在里面的只有三样，都是系统规定的位置：密钥在 macOS 钥匙串（`chief:slack.cookie_d`、`chief:notion.token`），开机自启的配置在 `~/Library/LaunchAgents/dev.chief.engine.plist`，插件本身装在 Claude 的插件目录。

## 命令行

装好引擎后有 `~/chief/data/bin/chief`（想在终端直接打 `chief`，自己加个 alias）：

```bash
chief status            # 引擎、来源、进度
chief doctor            # 设置页用的检查（JSON）
chief connect slack     # 开浏览器窗口登录（要 SSO 的会自己跳到工作区地址）；--workspace acme 直接从工作区登；--stdin 改成从标准输入贴 Cookie
chief connect github    # 用本机登录的 gh
chief logs
chief uninstall         # 从 launchd 卸掉（~/chief 的数据不删）
```

## 开发

```bash
cd plugin/engine && npm install
npm test                # 引擎和命令行（vitest，*.spec.ts）
npm run typecheck
claude plugin validate plugin
claude plugin test plugin   # 面板（plugin/tests）
```

本地开发用 `plugin/` 里的开发版 marketplace，插件直接从这个目录读，改了在会话里 `/reload-plugins`（先卸掉正式版，两个别同时装）：

```bash
claude plugin uninstall chief@chief
claude plugin marketplace add ./plugin        # 名字是 chief-dev
claude plugin install chief@chief-dev --scope user
```

推到 GitHub 后，CI 会跑同样的测试。

## 发版

```bash
# 先把 plugin/.claude-plugin/plugin.json 的 version 改成新版本号并提交
scripts/release.sh 0.3.1     # 跑测试、打 tag、把 marketplace.json 指到这个 tag，提交在本地
git push origin main v0.3.1  # 确认没问题再推
```

## License

MIT
