// 事件格式金样：把来源抽成插件时，交给消息中心的事件一个字都不能变。
// 快照是在抽插件之前、用原来的代码生成的；之后每一步都要和它一致。
import { describe, expect, it } from "vitest";
import { buildSources, eventOfItem, eventOfSlack } from "../src/engine";
import { MemorySecretStore } from "../src/secrets";
import type { InboundMessage } from "../src/slack/types";
import { findAcli } from "../src/sources/jira";
import { findGh } from "../src/sources/github";
import type { SourceItem } from "../src/sources/types";

const item = (over: Partial<SourceItem>): SourceItem => ({
  externalId: "x@1", kind: "k", title: "t", url: "https://example.com", summary: "s", at: "2026-11-19T00:00:00Z", payload: {}, mine: true, asks: ["mention"], ...over,
});

const slack = (over: Partial<InboundMessage> = {}): InboundMessage => ({
  channel: "slack", deliveryId: "C1:1.0:created", kind: "message.received", role: "message", relevance: "mention",
  conversation: { key: "slack:C1", threadKey: "slack:C1:1.0", label: "#dev", audience: "channel" },
  sender: { id: "U1", name: "Carol", bot: false },
  text: "<@U0ME> 看下 <https://github.com/acme/shop/pull/12|PR> 和 PROJ-479 <@U22> <!here> <#C9|ops>",
  occurredAt: "2026-11-19T00:00:00.000Z", replyTarget: { channel: "C1", ts: "1.0" },
  mentions: [{ id: "U22", name: "Alice" }], ...over,
});

describe("金样：外部来源的动态 → 事件", () => {
  const cases: [string, Parameters<typeof eventOfItem>[0], SourceItem][] = [
    ["github PR 请我 review", "github", item({ kind: "github.pr", title: "acme/shop#12 加字段 PROJ-479", url: "https://github.com/acme/shop/pull/12", summary: "PR 开着；新评论：bob：看 OPS-7", payload: { repo: "acme/shop", number: 12 }, asks: ["review"] })],
    ["github issue @我", "github", item({ kind: "github.issue", title: "Acme/Shop#3 bug", url: "https://github.com/Acme/Shop/issues/3", payload: { repo: "Acme/Shop", number: 3 }, asks: ["mention", "comment"] })],
    ["github 认不出地址", "github", item({ url: "https://example.com/x", payload: { repo: "a/b", number: 1 } })],
    ["jira 指派给我", "jira", item({ kind: "jira.issue", title: "PROJ-479 加字段", url: "https://x.atlassian.net/browse/PROJ-479", summary: "Jira PROJ-479 提到 github.com/acme/shop/pull/12", payload: { key: "PROJ-479" }, asks: ["assigned"] })],
    ["jira 没有工单号", "jira", item({ kind: "jira.issue", payload: {} })],
    ["notion 新评论", "notion", item({ kind: "notion.page", title: "Notion「周报」", url: "https://www.notion.so/x-0123456789abcdef0123456789abcdef", payload: { pageId: "0123456789abcdef0123456789abcdef" }, asks: ["comment"] })],
  ];
  for (const [name, source, it_] of cases) {
    it(name, () => expect(eventOfItem(source, it_)).toMatchSnapshot());
  }
  it("没人找你的不交", () => {
    expect(eventOfItem("github", item({ asks: [] }))).toBeNull();
    const { asks: _none, ...noAsks } = item({});
    expect(eventOfItem("jira", noAsks)).toBeNull();
  });
});

describe("金样：Slack 消息 → 事件", () => {
  const cases: [string, InboundMessage][] = [
    ["频道里 @我", slack()],
    ["私信", slack({ relevance: "dm", conversation: { key: "slack:D1", threadKey: "slack:D1:2.0", label: "Carol 的私信", audience: "direct" }, replyTarget: { channel: "D1", ts: "2.0" } })],
    ["我在的 thread", slack({ relevance: "thread", replyTarget: { channel: "C1", ts: "3.0", thread_ts: "1.0" } })],
    ["给自己发的", slack({ relevance: "self", conversation: { key: "slack:D0", threadKey: "slack:D0:4.0", label: "我自己", audience: "direct" } })],
  ];
  for (const [name, m] of cases) {
    it(name, () => expect(eventOfSlack(m, "U0ME")).toMatchSnapshot());
  }
  it("不交的", () => {
    expect(eventOfSlack(slack({ sender: { id: "B1", name: "bot", bot: true } }))).toBeNull();
    expect(eventOfSlack(slack({ kind: "message.edited" }))).toBeNull();
    expect(eventOfSlack(slack({ role: "self", relevance: null }))).toBeNull();
    expect(eventOfSlack(slack({ relevance: null }))).toBeNull();
  });
});

describe("按开关建来源", () => {
  it("顺序固定 github、jira、notion；缺工具、缺令牌的跳过", async () => {
    const tools = [findGh() ? "github" : null, findAcli() ? "jira" : null].filter((x): x is string => x !== null);
    const secrets = new MemorySecretStore();
    const all = { slack: true, github: true, jira: true, notion: true };
    expect((await buildSources({}, secrets)).map((s) => s.id)).toEqual([]);
    expect((await buildSources(all, secrets)).map((s) => s.id)).toEqual(tools);
    await secrets.set("notion.token", "secret_x");
    expect((await buildSources(all, secrets)).map((s) => s.id)).toEqual([...tools, "notion"]);
    expect((await buildSources({ notion: true }, secrets)).map((s) => s.id)).toEqual(["notion"]);
  });
});
