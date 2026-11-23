import { describe, expect, it } from "vitest";
import { chiefIds } from "../src/plain";

describe("给用户看的话里不许有 chief 自己的编号", () => {
  it("拦：单写的 #数字、chief 的说法加编号", () => {
    expect(chiefIds("建议先发 #98，再回 Joe")).toEqual(["#98"]);
    expect(chiefIds("问题 #63 已经答过了")).toEqual(["问题 #63"]);
    expect(chiefIds("回复 107 改好了")).toEqual(["回复 107"]);
    expect(chiefIds("事件 #552 漏掉了")).toEqual(["事件 #552"]);
    expect(chiefIds("和事情#3 是同一件事")).toEqual(["事情#3"]);
    expect(chiefIds("回复号 12 等你确认")).toEqual(["回复号 12"]);
    expect(chiefIds("待发出 #7 先别发")).toEqual(["待发出 #7"]);
    expect(chiefIds("PR #12 要改")).toEqual(["#12"]);
    expect(chiefIds("PR#12 要改")).toEqual(["PR#12"]);
    expect(chiefIds("全角的 ＃98 也算")).toEqual(["＃98"]);
    expect(chiefIds("shop#535 / #534 都能合")).toEqual(["#534"]);
    expect(chiefIds("先发 #98，问题 #63 关掉，#98 别忘")).toEqual(["#98", "问题 #63"]);
  });

  it("放：仓库名#号、链接（连同链接文字）、Jira 单号、数量和时间", () => {
    for (const ok of [
      "acme/shop#12 加字段，请你 review",
      "shop#535 改法对",
      "o/r#3 review",
      "PR 在这：https://github.com/acme/shop/pull/12",
      "看 https://github.com/acme/shop/pull/12#issuecomment-123 和 https://github.com/a/b/blob/main/x.ts#L42",
      "[PR #12](https://github.com/o/r/pull/12) 已合",
      "<https://github.com/o/r/pull/12|#12> 已合",
      "PROJ-35189 Jira 单要你定上线时间",
      "Jira 单在这 https://acme.example.net/browse/PROJ-35189",
      "Slack 链接 https://acme.slack.com/archives/C123/p1795079290188699",
      "两件事要你定：1. 要不要本周上线？2. 谁来回 Joe？",
      "问题 2 个，回复 3 条，事件 5 天前",
      "回复 10:30 前给",
      "事情 2026-11-30 截止",
      "颜色用 #fafafa，频道 <#C0123|dev>",
      "没问题",
    ]) expect(chiefIds(ok), ok).toEqual([]);
  });

  it("回 GitHub 的评论：单写的 #123 是 GitHub 自己的写法，放行；不带 # 的 chief 说法照样拦", () => {
    expect(chiefIds("和 #12 是同一个问题，已在 #13 修了", { github: true })).toEqual([]);
    expect(chiefIds("回复 107 已发", { github: true })).toEqual(["回复 107"]);
    expect(chiefIds("和 #12 是同一个问题")).toEqual(["#12"]);
  });
});
