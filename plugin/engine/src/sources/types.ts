// 照搬 aide 的 engine/src/sources/types.ts（去掉给 agent 的工具和对账）。
// 外部来源（GitHub、Jira、Notion）：定时拉跟你有关的新动态。都只读。
import type { SecretCheck } from "../slack/types";

export type SourceId = "github" | "jira" | "notion";

export interface SourceItem {
  // 同一个来源里，同一个编号只记一次（一般是「东西的地址@更新时间」）。
  externalId: string;
  kind: string;
  // 给你看的一行：「acme/shop#10318 xxx」。
  title: string;
  url: string;
  // 给主会话看的一句：发生了什么（状态、谁评论了什么）。原文是别人写的，当材料。
  summary: string;
  at: string;
  payload: Record<string, unknown>;
  // 跟你本人直接有关：你开的、你评论了、评论里 @了你（GitHub）；指派给你、你评论了、评论里提到你（Jira）。
  // 只是被一起请了 review、你在关注列表里的，不算。没归到事情、又不跟你直接有关的动态只记下，不交给主会话。
  mine: boolean;
  // 这条动态里有人找你：请你 review、新指派给你、别人的评论里 @ 了你、别人评论了你的 PR / 工单、
  // 你开的 PR 被 approve 了（approved）、被要求修改（changes）。
  // 没有就是只变了状态，或者只是你自己的动作（你开的、你评论的）——这种交给代码对账，不一定要跑一轮主会话。
  asks?: Ask[];
}

export type Ask = "review" | "assigned" | "mention" | "comment" | "approved" | "changes";

export interface Source {
  readonly id: SourceId;
  readonly label: string;
  // 拉 since 之后跟你有关的动态，旧的在前。
  poll(since: Date, signal: AbortSignal): Promise<SourceItem[]>;
  // 检查能不能用（连接时、你点「检查」时）。
  check(signal: AbortSignal): Promise<SecretCheck[]>;
}

export class SourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceError";
  }
}

// 拼进正则的文字（账号名、人名）：特殊字符转义。
export function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// 给模型看的文字：去掉尖括号，免得冒充提示词里的标签；太长截断。
export function plain(text: string, max = 600): string {
  const one = text.replace(/[<>]/g, (c) => (c === "<" ? "&lt;" : "&gt;")).replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max)}…` : one;
}

// 带超时的 JSON 请求。出错信息不带响应正文（可能有内部信息），只说状态码。
export async function getJson(fetchFn: typeof fetch, url: string, init: RequestInit, signal: AbortSignal, what: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchFn(url, { ...init, signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]) });
  } catch (error) {
    if (signal.aborted) throw new SourceError("取消了");
    throw new SourceError(`连不上 ${what}${error instanceof Error && error.name === "TimeoutError" ? "（20 秒没回应）" : ""}`);
  }
  if (res.status === 401 || res.status === 403) throw new SourceError(`${what} 拒绝了（${res.status}）：令牌不对或没权限`);
  if (!res.ok) throw new SourceError(`${what} 出错了（${res.status}）`);
  return res.json();
}
