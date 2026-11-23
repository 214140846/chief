// 你在面板上回答「要你定」：马上记下，再留一条事件给主会话去转告；主会话自己记的回答不留事件（它当场就转告了）。
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..");
const TSX = join(ROOT, "node_modules", "tsx", "dist", "esm", "index.mjs");
const CLI = join(ROOT, "src", "cli.ts");

function run(h: string, input: string, ...args: string[]): string {
  return execFileSync(process.execPath, ["--import", TSX, CLI, ...args], { env: { ...process.env, CHIEF_HOME: h }, encoding: "utf8", input });
}

const events = (h: string) => readFileSync(join(h, "events.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);

it("面板上答的留一条 ask.answered 事件，主会话答的不留", () => {
  const h = mkdtempSync(join(tmpdir(), "chief-answer-"));
  run(h, "开了会话", "thing", "add", "--title", "接口加字段", "--session", "local_x");
  run(h, JSON.stringify({ question: "本周能上线吗", suggest: "下周二" }), "ask", "add", "--thing", "1");
  run(h, JSON.stringify({ question: "要不要加测试", suggest: "加" }), "ask", "add", "--thing", "1");
  expect(JSON.parse(run(h, "照建议办：下周二", "ask", "answer", "1", "--from-panel"))).toMatchObject({ ask: 1, thing: 1, session: "local_x" });
  const [e] = events(h);
  expect(e).toMatchObject({ source: "session", kind: "ask.answered", from: "你", keys: ["local_x"], reply: { ask: "1", thing: "1" } });
  expect(e!.text).toBe("问题：本周能上线吗\n你的回答：照建议办：下周二");
  run(h, "加", "ask", "answer", "2");
  expect(events(h)).toHaveLength(1);
  expect(JSON.parse(run(h, "", "thing", "list"))[0]).toMatchObject({ status: "doing" });
  run(h, JSON.stringify({ next: "等你定要不要存", blocker: "等你回话" }), "thing", "update", "1");
  run(h, "做完了", "thing", "update", "1", "--status", "done");
  const done = JSON.parse(run(h, "", "thing", "list", "--all"))[0];
  expect(done).toMatchObject({ status: "done", progress: "做完了" });
  expect(done.next).toBeUndefined();
  expect(done.blocker).toBeUndefined();
});
