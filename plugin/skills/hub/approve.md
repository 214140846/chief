# approve PR

规矩让你 approve 的（通常是用户加的情况「Slack 里有人发 PR 链接让我看 / approve」）：

1. 从 `keys` 里找 `github.com/<owner>/<repo>/pull/<号>`，写成 `<owner>/<repo>#<号>`。找不到 PR 就当派活办。
2. `gh pr view <PR 链接> --json state,author,isDraft,statusCheckRollup`：已合并、已关闭、草稿、作者是用户本人 → 不 approve，只记下；CI 没过 → 不 approve，`chief ask add` 问用户。
3. `chief reply approve --event N --ref <owner>/<repo>#<号> --custom <号> [--thing T]`（`--ref` 必须是这条消息里的 PR，`--custom` 带上对上的那条情况）。返回 `policy` 是 `auto` → `chief reply queue R --policy`；是 `ask` → 放着等用户点。
4. 规矩里要回对方一句的（比如「approve 了 ✅」），照 `reply.md` 另写一条。
5. `chief mark N noted --thing T`，理由「approve 了 <PR>」或「没 approve：<原因>」。

PR、approve 的结果都按 SKILL.md 里的铁规矩写：外部编号后面紧跟括号说清是什么事。
