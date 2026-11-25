import { describe, expect, it } from "vitest";
import { autoReason } from "../src/gate";
import type { Mode } from "../src/shared/types";
import { defaultPolicy } from "../src/store";

const ev = (source: "slack" | "github") => ({
  id: 1, at: "t", source, kind: "message.received", title: "x", url: null, from: "Bob Lee", fromId: "U0BOB1234", text: "x https://github.com/o/r/pull/4",
  why: source === "slack" ? ["dm"] : ["review_requested"], keys: ["github.com/o/r/pull/4"],
  reply: source === "slack" ? { channel: "D0BOB1234", ts: "1.1" } : { ref: "o/r#4" },
});
const reply = (source: "slack" | "github", target: Record<string, string>, extra: Record<string, unknown> = {}) => ({
  id: 1, event: 1, source, target, context: { who: null, where: "", said: "", url: null }, body: "下午给你", status: "pending" as const, at: "t", ...extra,
});
const pol = (mode: Mode, askAlways: string[] = []) => ({ ...defaultPolicy(), mode, askAlways });

describe("做事方式 normal / auto / yolo 对发送的影响", () => {
  const slack = ev("slack");
  const gh = ev("github");
  const slackReply = reply("slack", { channel: "D0BOB1234", ts: "1.1" });
  const ghReply = reply("github", { ref: "o/r#4" });
  const approve = reply("github", { ref: "o/r#4" }, { kind: "approve", body: "" });
  const message = reply("slack", { channel: "C0NEWCHAN1", user: "U0NEWUSER1" }, { kind: "message" });

  it("缺 mode 的旧规矩等于 normal：和以前一样，回复都要确认", () => {
    expect(defaultPolicy().mode).toBe("normal");
    expect(autoReason(slackReply as never, pol("normal"), slack as never)).toBeNull();
    expect(autoReason(ghReply as never, pol("normal"), gh as never)).toBeNull();
    expect(autoReason(message as never, pol("normal"), null)).toBeNull();
  });

  it("auto：Slack 以外的回复直接发，Slack 仍按规矩；新消息、approve 仍不放", () => {
    expect(autoReason(ghReply as never, pol("auto"), gh as never)).toBe("模式 auto");
    expect(autoReason(approve as never, pol("auto"), gh as never)).toBe("模式 auto");
    expect(autoReason(slackReply as never, pol("auto"), slack as never)).toBeNull();
    expect(autoReason(message as never, pol("auto"), null)).toBeNull();
  });

  it("yolo：回复、approve、主动发的新消息都直接发", () => {
    expect(autoReason(slackReply as never, pol("yolo"), slack as never)).toBe("模式 yolo");
    expect(autoReason(ghReply as never, pol("yolo"), gh as never)).toBe("模式 yolo");
    expect(autoReason(approve as never, pol("yolo"), gh as never)).toBe("模式 yolo");
    expect(autoReason(message as never, pol("yolo"), null)).toBe("模式 yolo");
  });

  it("「一定问我」名单任何模式都拦（人、对话、新消息的去处）", () => {
    for (const mode of ["auto", "yolo"] as const) {
      for (const entry of ["U0BOB1234", "bob lee", "D0BOB1234"]) {
        expect(autoReason(slackReply as never, pol(mode, [entry]), slack as never)).toBeNull();
        // 对话编号只管 Slack 的对话；GitHub 的事件按人拦。
        if (entry !== "D0BOB1234") expect(autoReason(ghReply as never, pol(mode, [entry]), gh as never)).toBeNull();
      }
    }
    expect(autoReason(message as never, pol("yolo", ["U0NEWUSER1"]), null)).toBeNull();
    expect(autoReason(message as never, pol("yolo", ["C0NEWCHAN1"]), null)).toBeNull();
  });

  it("模式不放宽去处：回复发到别的地方、approve 别的 PR，都不放", () => {
    expect(autoReason(reply("slack", { channel: "C0OTHER", ts: "9.9" }) as never, pol("yolo"), slack as never)).toBeNull();
    expect(autoReason(reply("github", { ref: "o/r#99" }, { kind: "approve", body: "" }) as never, pol("yolo"), gh as never)).toBeNull();
    expect(autoReason({ ...slackReply, event: 2 } as never, pol("yolo"), slack as never)).toBeNull();
  });
});
