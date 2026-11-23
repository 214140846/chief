// 谁能让回复发出去。命令行（chief reply queue --policy）放行前算一遍，引擎发之前再算一遍（见 engine.ts 的 sendDue）。
import { isTrusted, scenarioOf, SCENARIOS, type ChiefEvent, type Policy, type Reply } from "./store";

// 一条事件自己的 PR（owner/repo#号，小写）：GitHub 的事件就是它回到的那个 PR；
// 别的（比如 Slack 里有人贴了 PR 链接）是引擎从原文里认出来的 PR 链接。
export function prsOf(event: Pick<ChiefEvent, "source" | "reply" | "keys">): string[] {
  if (event.source === "github") return event.reply.ref ? [event.reply.ref.toLowerCase()] : [];
  return event.keys.flatMap((k) => {
    const m = /^github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)$/i.exec(k);
    return m ? [`${m[1]}#${m[2]}`.toLowerCase()] : [];
  });
}

// 回复回到的地方是不是这条事件自己的：照抄事件的 reply，最多多一个 in（放 thread 还是直接回）。
function sameTarget(r: Reply, event: ChiefEvent): boolean {
  if (r.source !== event.source) return false;
  const want = Object.entries(event.reply);
  if (want.length === 0) return false;
  if (!want.every(([k, v]) => r.target[k] === v)) return false;
  return Object.keys(r.target).every((k) => k === "in" || k in event.reply);
}

// 规矩允许直接发（--policy）：引擎自己按规矩再算一遍，算出来要问你的发不出去，主会话怎么理解都没用。
// 返回放行的理由；null 是这条要你确认。只放行回答收到的消息、回到那条消息自己的地方；主动发的新消息（reply new）一律问你。
export function autoReason(r: Reply, pol: Policy, event: ChiefEvent | null): string | null {
  if (r.kind === "message" || event === null || r.event !== event.id) return null;
  if (r.kind === "approve") {
    // approve 的只能是这条消息自己的 PR，而且要按「直接 approve」的规矩。
    if (!prsOf(event).includes((r.target.ref ?? "").toLowerCase())) return null;
    if (r.custom !== undefined) {
      const c = pol.custom.find((x) => x.id === r.custom);
      return c?.handle === "approve" && c.reply === "auto" ? `你加的情况 custom:${c.id}` : null;
    }
    const s = pol.scenarios[scenarioOf(event)];
    return s.handle === "approve" && s.reply === "auto" ? `场景「${SCENARIOS[scenarioOf(event)]}」` : null;
  }
  if (!sameTarget(r, event)) return null;
  // 固定回复：一字不差才算，前后多一个字都不行。
  const body = r.body.trim();
  if (body !== "" && pol.quick.some((q) => q.trim() === body)) return "固定回复";
  if (isTrusted(pol.trusted, event.from, event.fromId)) return "白名单";
  if (r.custom !== undefined) {
    const c = pol.custom.find((x) => x.id === r.custom);
    return c?.reply === "auto" ? `你加的情况 custom:${c.id}` : null;
  }
  return pol.scenarios[scenarioOf(event)].reply === "auto" ? `场景「${SCENARIOS[scenarioOf(event)]}」` : null;
}
