// 事情和要你定的：chief thing / ask / board。
import { MAX_TEXT, SESSION, fail, flag, num, oneLine, oops, plainOnly, stdinText, title } from "../args";
import { KEY } from "../keys";
import { serviceState } from "../launchd";
import { loadDispatch, loadReplies, loadThings, paths, readEvents, updateJson, type Ask, type Thing, type ThingsFile } from "../store";
import { parseUntil } from "../snooze";
import { recordDrop } from "../undo";
import { eventById, hubAlive } from "./events";

// 给人看的本地时间：11/24 09:00。
function localTime(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export const THING_STATUSES = ["doing", "waiting_you", "waiting_others", "done", "dropped"] as const;

export const MAX_LOG = 30;

export function thingStatus(text: string | null): Thing["status"] | null {
  if (text === null) return null;
  if (!THING_STATUSES.includes(text as Thing["status"])) fail(`--status 是 ${THING_STATUSES.join("|")} 之一`);
  return text as Thing["status"];
}

export const EMPTY_THINGS: ThingsFile = { nextThing: 1, nextAsk: 1, things: [], asks: [] };

// 锁着改 things.json；fn 里出错 throw，出来再报。
export function updateThings<T>(fn: (t: ThingsFile) => T): T {
  return updateJson<ThingsFile, T>(paths().things, { ...EMPTY_THINGS, things: [], asks: [] }, fn);
}

export async function thing(args: string[]): Promise<void> {
  const sub = args.shift();
  if (sub === "list") {
    const all = args.includes("--all");
    process.stdout.write(`${JSON.stringify(loadThings().things.filter((x) => all || (x.status !== "done" && x.status !== "dropped")), null, 2)}\n`);
    return;
  }
  // chief thing find <键...>：还没做完的事情里，键对得上的（新消息归到哪件事用）。
  if (sub === "find") {
    const want = new Set(args);
    const hits = loadThings().things.filter((x) => x.status !== "done" && x.status !== "dropped" && (x.keys ?? []).some((k) => want.has(k)));
    process.stdout.write(`${JSON.stringify(hits)}\n`);
    return;
  }
  // chief thing snooze T --until <时间>：稍后再说，到点引擎叫醒它、交给主会话（见 snooze.ts）。chief thing wake T：现在就拿出来。
  if (sub === "snooze" || sub === "wake") {
    const id = num(args.shift(), "事情号");
    const untilText = sub === "snooze" ? flag(args, "--until") ?? fail("要 --until <时间>：2h、1d、tomorrow 09:00、明天9点、下周一、2026-11-30 15:00") : null;
    const until = untilText === null ? null : parseUntil(untilText) ?? fail(`--until 看不懂，或者不在以后：${oneLine(untilText, 60)}（写 2h、1d、tomorrow 09:00、明天9点、下周一、2026-11-30 15:00）`);
    const at = new Date().toISOString();
    const out = updateThings((t) => {
      const x = t.things.find((y) => y.id === id) ?? oops(`没有事情 ${id}`);
      if (until) {
        if (x.status === "done" || x.status === "dropped") oops(`事情 ${id} 已经${x.status === "done" ? "办完了" : "不做了"}，不用稍后再说`);
        x.snooze = { until: until.toISOString(), at };
        x.log = [...x.log, { at, text: `稍后再说：${localTime(until)} 再拿出来` }].slice(-MAX_LOG);
      } else {
        if (!x.snooze) oops(`事情 ${id} 没有在稍后再说`);
        delete x.snooze;
        x.log = [...x.log, { at, text: "提前拿出来了" }].slice(-MAX_LOG);
      }
      return { id: x.id, ...(until ? { until: until.toISOString(), local: localTime(until) } : { woke: true }) };
    });
    process.stdout.write(`${JSON.stringify(out)}\n`);
    return;
  }
  const session = flag(args, "--session");
  if (session !== null && !SESSION.test(session)) fail("会话编号只能是字母、数字、_ 和 -");
  const status = thingStatus(flag(args, "--status"));
  const eventFlag = flag(args, "--event");
  const event = eventFlag === null ? null : eventById(num(eventFlag, "--event ")).id;
  const titleText = title(flag(args, "--title"));
  const origin = args.includes("--import") ? "import" as const : "chief" as const;
  if (args.includes("--import")) args.splice(args.indexOf("--import"), 1);
  const keys: string[] = [];
  for (let k = flag(args, "--key"); k !== null; k = flag(args, "--key")) {
    if (!KEY.test(k)) fail(`键里有不支持的字符：${oneLine(k, 80)}`);
    keys.push(k);
  }
  const dueFlag = flag(args, "--due");
  if (dueFlag !== null && dueFlag !== "none" && !/^\d{4}-\d{2}-\d{2}$/.test(dueFlag)) fail("--due 写成 YYYY-MM-DD，清掉写 none");
  const id = sub === "update" ? num(args.shift(), "事情号") : null;
  // 先读完标准输入，再拿锁：锁只在读改写那一下。
  // 标准输入可以是一句进展，也可以是 JSON：{"progress": 做到哪了, "next": 下一步, "blocker": 卡在哪（空字符串 = 不卡了）, "result": 一条结果}。
  const raw = await stdinText();
  let report: { progress?: string; next?: string; blocker?: string; result?: string } = {};
  if (raw.startsWith("{")) {
    try {
      const j = JSON.parse(raw) as Record<string, unknown>;
      for (const k of ["progress", "next", "blocker", "result"] as const) if (typeof j[k] === "string") report[k] = (j[k] as string).trim().slice(0, MAX_TEXT);
    } catch {
      fail("标准输入的 JSON 看不懂：{\"progress\", \"next\", \"blocker\", \"result\"}");
    }
  } else if (raw) report = { progress: raw };
  plainOnly(titleText, "标题", { title: true });
  plainOnly(report.progress, "进展");
  plainOnly(report.next, "下一步");
  plainOnly(report.blocker, "卡在哪");
  plainOnly(report.result, "结果");
  const text = report.progress ?? "";
  const at = new Date().toISOString();
  if (sub === "add") {
    if (!titleText) fail("要 --title");
    const newId = updateThings((t) => {
      const x: Thing = {
        id: t.nextThing++, title: titleText, status: status ?? "doing", progress: text,
        events: event !== null ? [event] : [], updatedAt: at, log: text ? [{ at, text }] : [], origin,
        ...(report.next ? { next: report.next } : {}), ...(report.blocker ? { blocker: report.blocker } : {}),
        ...(report.result ? { results: [report.result] } : {}), ...(dueFlag && dueFlag !== "none" ? { due: dueFlag } : {}),
        ...(keys.length > 0 ? { keys } : {}), ...(session ? { session } : {}),
      };
      t.things.push(x);
      return x.id;
    });
    process.stdout.write(`${newId}\n`);
    return;
  }
  if (sub === "update" && id !== null) {
    const dropped = updateThings((t) => {
      const x = t.things.find((y) => y.id === id) ?? oops(`没有事情 ${id}`);
      // 标成不做了：记下原来的状态，能撤回（chief undo）。
      const was = status === "dropped" && x.status !== "dropped" ? x.status : null;
      if (status) x.status = status;
      if (status === "done" || status === "dropped") delete x.snooze;
      if (session) x.session = session;
      if (titleText) x.title = titleText;
      if (event !== null && !x.events.includes(event)) x.events.push(event);
      if (keys.length > 0) x.keys = [...new Set([...(x.keys ?? []), ...keys])];
      if (text) {
        x.progress = text;
        x.log = [...x.log, { at, text }].slice(-MAX_LOG);
      }
      if (report.next) x.next = report.next;
      else if (report.next === "") delete x.next;
      if (report.blocker !== undefined) {
        if (report.blocker) {
          x.blocker = report.blocker;
          x.log = [...x.log, { at, text: `卡住：${report.blocker}` }].slice(-MAX_LOG);
        } else delete x.blocker;
      }
      if (report.result) {
        x.results = [...(x.results ?? []), report.result].slice(-20);
        x.log = [...x.log, { at, text: `结果：${report.result}` }].slice(-MAX_LOG);
      }
      if (dueFlag === "none") delete x.due;
      else if (dueFlag) x.due = dueFlag;
      x.updatedAt = at;
      return was === null ? null : { thing: { id: x.id, title: x.title }, was };
    });
    if (dropped) recordDrop(at, dropped.thing, dropped.was);
    return;
  }
  fail("chief thing add|update|list|find|snooze|wake");
}

export async function ask(args: string[]): Promise<void> {
  const sub = args.shift();
  if (sub === "list") {
    process.stdout.write(`${JSON.stringify(loadThings().asks.filter((a) => a.status === "open"), null, 2)}\n`);
    return;
  }
  if (sub === "add") {
    const thingId = num(flag(args, "--thing") ?? undefined, "--thing ");
    const replyFlag = flag(args, "--reply");
    const replyId = replyFlag === null ? null : num(replyFlag, "--reply ");
    let body: { question?: unknown; suggest?: unknown };
    try {
      body = JSON.parse(await stdinText()) as typeof body;
    } catch {
      fail("标准输入要是 JSON：{\"question\": \"…\", \"suggest\": \"…\"}");
    }
    if (typeof body.question !== "string" || !body.question.trim()) fail("question 不能空");
    const question = body.question.trim().slice(0, MAX_TEXT);
    const suggest = typeof body.suggest === "string" ? body.suggest.trim().slice(0, MAX_TEXT) : "";
    // 要提待发出里的哪条回复：用 --reply 挂上，面板在卡片上显示那条的摘要，不用在问题里写回复号。
    const hint = "要提待发出里的某条回复，用 --reply R 把它挂在这个问题上，面板会在卡片上显示那条的摘要。";
    plainOnly(question, "问题（question）", {}, hint);
    plainOnly(suggest, "建议（suggest）", {}, hint);
    if (replyId !== null && !loadReplies().items.some((r) => r.id === replyId)) fail(`没有回复 ${replyId}`);
    const newId = updateThings((t) => {
      const x = t.things.find((y) => y.id === thingId) ?? oops(`没有事情 ${thingId}`);
      const a: Ask = { id: t.nextAsk++, thing: x.id, question, suggest, status: "open", at: new Date().toISOString(), ...(replyId !== null ? { reply: replyId } : {}) };
      t.asks.push(a);
      x.status = "waiting_you";
      // 稍后再说的事情来了新问题：要你定的不能等，拿出来。
      delete x.snooze;
      x.updatedAt = a.at;
      return a.id;
    });
    process.stdout.write(`${newId}\n`);
    return;
  }
  // chief ask show Q：一个问题，答没答过都看得到（面板上答了以后，主会话凭它转告会话）。
  if (sub === "show") {
    const id = num(args.shift(), "问题号");
    const a = loadThings().asks.find((y) => y.id === id) ?? oops(`没有问题 ${id}`);
    process.stdout.write(`${JSON.stringify(a, null, 2)}\n`);
    return;
  }
  if (sub === "answer") {
    const id = num(args.shift(), "问题号");
    const answer = await stdinText();
    if (!answer) fail("回答是空的");
    const out = updateThings((t) => {
      const a = t.asks.find((y) => y.id === id) ?? oops(`没有问题 ${id}`);
      if (a.status !== "open") oops(`问题 ${id} 已经答过了`);
      a.status = "answered";
      a.answer = answer;
      const x = t.things.find((y) => y.id === a.thing);
      if (x && x.status === "waiting_you" && !t.asks.some((y) => y.thing === x.id && y.status === "open")) x.status = "doing";
      return { ask: a.id, thing: a.thing, session: x?.session ?? null, reply: a.reply ?? null };
    });
    process.stdout.write(`${JSON.stringify(out)}\n`);
    return;
  }
  fail("chief ask add|list|show|answer");
}

// 面板也直接读文件；这个给消息中心和终端看一眼用。
export async function board(): Promise<void> {
  const svc = await serviceState();
  const dispatch = loadDispatch();
  const evts = readEvents();
  const t = loadThings();
  const unhandled = evts.filter((e) => !dispatch[e.id]);
  process.stdout.write(`${JSON.stringify({
    engine: svc.running ? "running" : svc.loaded ? "stopped" : "missing",
    hub: hubAlive(),
    unhandled: unhandled.length,
    unhandledMaxId: unhandled.reduce((m, e) => Math.max(m, e.id), 0),
    asks: t.asks.filter((a) => a.status === "open").length,
    live: t.things.filter((x) => x.status === "doing" || x.status === "waiting_you" || x.status === "waiting_others").length,
    snoozed: t.things.filter((x) => x.snooze && x.status !== "done" && x.status !== "dropped").length,
    replies: loadReplies().items.filter((r) => r.status === "pending" || r.status === "failed").length,
  })}\n`);
}
