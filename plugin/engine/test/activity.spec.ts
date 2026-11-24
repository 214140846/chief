import { describe, expect, it } from "vitest";
import { STALL_MS, stalled, stuckTool, waitingQuestion } from "../src/activity";

describe("会话在等你回答", () => {
  const ask = { type: "assistant", message: { content: [{ type: "tool_use", name: "AskUserQuestion", id: "t1", input: { questions: [{ question: "确认发布吗？" }] } }] } };
  it("最后一个问你的对话框没回答：在等你", () => {
    expect(waitingQuestion([{ type: "user" }, ask])).toBe("确认发布吗？");
  });
  it("回答过了：不算", () => {
    expect(waitingQuestion([ask, { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1" }] } }])).toBeNull();
  });
  it("没问过：不算", () => {
    expect(waitingQuestion([{ type: "assistant", message: { content: [{ type: "text", text: "好了" }] } }])).toBeNull();
  });
  const start = (id: string, title: string) => ({ type: "assistant", message: { content: [{ type: "tool_use", name: "mcp__ccd_session__start_session", id, input: { title } }] } });
  it("要开新会话、在等你点 Allow：也算在等你", () => {
    expect(waitingQuestion([{ type: "user" }, start("s1", "FE-02"), start("s2", "FE-05")])).toBe("它要开新会话 「FE-02」、「FE-05」，在等你点 Allow（App 每个都要你点）");
  });
  it("点过了：不算", () => {
    expect(waitingQuestion([start("s1", "FE-02"), { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "s1" }] } }])).toBeNull();
  });
});

describe("会话停在某个工具上", () => {
  const use = (id: string, name: string, input: Record<string, string> = {}) => ({ type: "assistant", message: { content: [{ type: "tool_use", name, id, input }] } });
  const result = (id: string) => ({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id }] } });
  it("工具还没结果：说是哪个，带上说明，不带命令", () => {
    expect(stuckTool([{ type: "user" }, use("b1", "Bash", { command: "rm -rf x", description: "清掉构建目录" })])).toBe("Bash：清掉构建目录");
  });
  it("有结果了：不算", () => {
    expect(stuckTool([use("b1", "Bash"), result("b1")])).toBeNull();
  });
  it("同一批里别的工具先回来了：还是认得出停着的那个", () => {
    expect(stuckTool([{ type: "user", message: { content: "开工" } }, use("s1", "mcp__ccd_session__start_session", { title: "FE-02" }), use("b1", "Bash"), result("b1")])).toBe("mcp__ccd_session__start_session：FE-02");
  });
  it("你后来又说了话：之前的不算", () => {
    expect(stuckTool([use("s1", "Bash"), { type: "user", message: { content: "算了" } }])).toBeNull();
  });
  it("对话记录里抄的请求不算", () => {
    expect(stuckTool([{ type: "user" }, { ...use("m1", "SendMessage"), type: "api-request-blob" }])).toBeNull();
  });
  it("子代理本来就跑得久：不算", () => {
    expect(stuckTool([{ type: "user" }, use("a1", "Agent", { description: "查代码" })])).toBeNull();
  });
});

describe("工具一直没结果", () => {
  it("过了 5 分钟才算可能在等你点；跳过权限的会话不弹框，工具没结果只是还在跑", () => {
    const now = Date.parse("2026-11-24T10:00:00Z");
    const old = now - STALL_MS - 1000;
    expect(stalled("Bash：截图", old, "default", now)).toContain("可能在等你点同意");
    expect(stalled("Bash：截图", now - 60_000, "default", now)).toBeNull();
    expect(stalled("Bash：截图", old, "bypassPermissions", now)).toBeNull();
    expect(stalled(null, old, "default", now)).toBeNull();
  });
});
