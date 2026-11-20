// 照搬 aide 的 engine/src/sources/github.ts（只留拉动态和评论）。
// GitHub：用你本机已经登录的 gh（chief 不存任何 GitHub 令牌）。
// 拉跟你有关的 PR 和 issue（involves:@me，加上请你 review 的）在 since 之后的变化：状态、合并、新评论。拉动态只发 GET。
// 写（PR / issue 上评论）只在你对消息中心说了「发 N」之后由 `chief reply send` 调用。
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { runProgram } from "../program";
import type { SecretCheck } from "../slack/types";
import { SourceError, escapeRe, plain, type Ask, type Source, type SourceItem } from "./types";

const GH_PATHS = ["/opt/homebrew/bin/gh", "/usr/local/bin/gh", "/usr/bin/gh"];
const MAX_ITEMS = 50;
const MAX_COMMENTS = 5;
// owner/repo#123 或 GitHub 上 PR / issue 的地址。
const REF = /^(?:https?:\/\/github\.com\/)?([\w.-]{1,100})\/([\w.-]{1,100})(?:\/(?:pull|issues)\/|#)(\d{1,9})\/?$/;

export type GhRunner = (args: readonly string[], signal: AbortSignal) => Promise<string>;

// owner/repo#123 或地址 → 三段；认不出是 null。
export function prRef(ref: string): { owner: string; repo: string; number: number } | null {
  const m = REF.exec(ref.trim());
  return m ? { owner: m[1]!, repo: m[2]!, number: Number(m[3]) } : null;
}

// 找 gh：launchd 下 PATH 很短，先看常见的安装位置。
export function findGh(): string | null {
  for (const p of GH_PATHS) if (existsSync(p)) return p;
  return null;
}

export function ghRunner(bin: string): GhRunner {
  return async (args, signal) => {
    const out = await runProgram(bin, args, { cwd: homedir(), timeoutMs: 30_000, network: true, signal, maxOutput: 8 * 1024 * 1024 });
    if (out.aborted) throw new SourceError("取消了");
    if (out.timedOut) throw new SourceError("gh 30 秒没回应");
    if (out.code !== 0) {
      const why = out.stderr.trim().split("\n").at(-1)?.slice(0, 200) ?? "";
      throw new SourceError(/auth|login|token/i.test(why) ? "gh 没登录，到终端里跑 gh auth login" : `gh 出错了：${why}`);
    }
    return out.stdout;
  };
}

interface SearchItem {
  html_url: string; number: number; title: string; state: string; updated_at: string; comments: number;
  repository_url: string; user?: { login?: string }; pull_request?: { merged_at?: string | null };
  assignees?: { login?: string }[];
}
interface Comment { user?: { login?: string; type?: string }; body?: string; created_at?: string }

// 机器人（sonarqube、CI、dependabot……）的评论不算动态。
function isBot(c: Comment): boolean {
  return c.user?.type === "Bot" || /\[bot\]$|-bot$|^bot-/i.test(c.user?.login ?? "");
}

export class GitHubSource implements Source {
  readonly id = "github" as const;
  readonly label = "GitHub";

  // 每个 PR / issue 上次报过的状态：没变、又只有机器人评论的，不再报。
  private readonly seen = new Map<string, string>();

  // 你在 GitHub 上的账号（检查、第一次拉取时记下）。主会话用它认出哪些 PR 是你的。
  private login: string | null = null;

  constructor(private readonly gh: GhRunner) {}

  whoami(): string | null {
    return this.login;
  }

  async check(signal: AbortSignal): Promise<SecretCheck[]> {
    try {
      const me = JSON.parse(await this.gh(["api", "user"], signal)) as { login?: string };
      this.login = me.login && /^[\w-]{1,39}$/.test(me.login) ? me.login : this.login;
      return [{ label: "gh 已登录", pass: true, detail: `账号 ${me.login ?? "?"}` }];
    } catch (error) {
      return [{ label: "gh 已登录", pass: false, detail: error instanceof Error ? error.message : "没成功" }];
    }
  }

  async poll(since: Date, signal: AbortSignal): Promise<SourceItem[]> {
    if (!this.login) await this.check(signal);
    const day = since.toISOString().replace(/\.\d{3}Z$/, "Z");
    const found = new Map<string, SearchItem>();
    // 两个搜索分开算：一个偶尔被 GitHub 拒（11/16 遇到过一次 422），另一个照样拉；都失败才算这次拉取出错。
    const failed: string[] = [];
    const queries = [`involves:@me updated:>=${day}`, `review-requested:@me is:open updated:>=${day}`];
    // 第二个搜索搜到的：在请你 review。
    const requested = new Set<string>();
    for (const q of queries) {
      try {
        const raw = await this.gh(["api", "-X", "GET", "search/issues", "-f", `q=${q}`, "-f", "sort=updated", "-f", "order=desc", "-f", `per_page=${MAX_ITEMS}`], signal);
        for (const it of (JSON.parse(raw) as { items?: SearchItem[] }).items ?? []) {
          if (Date.parse(it.updated_at) > since.getTime()) found.set(it.html_url, it);
          if (q.startsWith("review-requested")) requested.add(it.html_url);
        }
      } catch (error) {
        if (signal.aborted) throw error;
        failed.push(`「${q}」：${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (failed.length === queries.length) throw new SourceError(`GitHub 搜索都没成功：${failed.join("；").slice(0, 300)}`);
    const items: SourceItem[] = [];
    for (const it of [...found.values()].sort((a, b) => a.updated_at.localeCompare(b.updated_at))) {
      const repo = it.repository_url.split("/repos/")[1] ?? "?";
      const pr = it.pull_request !== undefined;
      let comments: Comment[] = [];
      if (it.comments > 0) {
        // 一条拿不到评论（GitHub 偶尔回 422、没权限）不影响别的：这条先不带评论。
        try {
          const raw = await this.gh(["api", "-X", "GET", `repos/${repo}/issues/${it.number}/comments`, "-f", `since=${day}`, "-f", "per_page=30"], signal);
          comments = (JSON.parse(raw) as Comment[]).filter((c) => !isBot(c)).slice(-MAX_COMMENTS);
        } catch (error) {
          if (signal.aborted) throw error;
        }
      }
      const state = pr ? (it.pull_request?.merged_at ? "已合并" : it.state === "open" ? "开着" : "已关闭（没合并）") : it.state === "open" ? "开着" : "已关闭";
      // 状态没变、也没有人（不是机器人）的新评论：只是 CI、机器人、推了新提交，不报。第一次见到的照报。
      const before = this.seen.get(it.html_url);
      this.seen.set(it.html_url, state);
      if (before === state && comments.length === 0) continue;
      const said = comments.map((c) => `${c.user?.login ?? "某人"}：${plain(c.body ?? "", 200)}`).join("；");
      const me = this.login;
      const atMe = me !== null ? new RegExp(`@${escapeRe(me)}\\b`, "i") : null;
      const mine = me !== null && (it.user?.login === me
        || comments.some((c) => c.user?.login === me || atMe!.test(c.body ?? "")));
      // 有人找你：请你 review（第一次见到时）、别人的评论里 @ 了你、别人评论了你开的。
      const others = me === null ? [] : comments.filter((c) => c.user?.login !== me);
      const asks: Ask[] = [];
      if (requested.has(it.html_url) && it.state === "open" && before === undefined) asks.push("review");
      if (others.some((c) => atMe?.test(c.body ?? ""))) asks.push("mention");
      else if (me !== null && it.user?.login === me && others.length > 0) asks.push("comment");
      items.push({
        externalId: `${it.html_url}@${it.updated_at}`,
        kind: pr ? "github.pr" : "github.issue",
        title: `${repo}#${it.number} ${plain(it.title, 120)}`,
        url: it.html_url,
        summary: `${pr ? "PR" : "issue"} ${repo}#${it.number}「${plain(it.title, 120)}」${state}${it.user?.login ? `，作者 ${it.user.login}` : ""}${said ? `；新评论：${said}` : ""}`,
        at: it.updated_at,
        payload: { repo, number: it.number, state: it.state, merged: Boolean(it.pull_request?.merged_at), mergedAt: it.pull_request?.merged_at ?? null, author: it.user?.login ?? null, comments: comments.length },
        mine,
        asks,
      });
    }
    return items;
  }

  // 导入用：你开着的 PR、等你 review 的 PR（查询写死）。
  async open(signal: AbortSignal): Promise<{ ref: string; title: string; url: string; mine: boolean; updated: string }[]> {
    const out: { ref: string; title: string; url: string; mine: boolean; updated: string }[] = [];
    // 只要最近 30 天动过的：很久没动的开着的 PR 多半不是「现在在做的事」。
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    for (const [q, mine] of [[`is:open is:pr author:@me updated:>=${since}`, true], [`is:open is:pr review-requested:@me updated:>=${since}`, false]] as const) {
      const raw = await this.gh(["api", "-X", "GET", "search/issues", "-f", `q=${q}`, "-f", "sort=updated", "-f", "order=desc", "-f", "per_page=30"], signal);
      for (const it of (JSON.parse(raw) as { items?: SearchItem[] }).items ?? []) {
        const repo = it.repository_url.split("/repos/")[1] ?? "?";
        out.push({ ref: `${repo}#${it.number}`, title: plain(it.title, 120), url: it.html_url, mine, updated: it.updated_at });
      }
    }
    return out;
  }

  // —— 写：只在你确认了（或规矩允许、过了 5 秒撤回期）之后由引擎调用 ——

  // approve 一个 PR（以你本人的身份）。
  async approve(ref: string, body: string, signal: AbortSignal): Promise<{ url: string | null; ref: string }> {
    const r = prRef(ref);
    if (!r) throw new SourceError(`PR 写成 owner/repo#123：${ref}`);
    const out = JSON.parse(await this.gh(["api", "-X", "POST", `repos/${r.owner}/${r.repo}/pulls/${r.number}/reviews`, "-f", "event=APPROVE", ...(body.trim() ? ["-f", `body=${body.trim()}`] : [])], signal)) as { html_url?: string };
    return { url: out.html_url ?? null, ref: `${r.owner}/${r.repo}#${r.number}` };
  }

  // 在 PR / issue 下面评论。
  async comment(ref: string, body: string, signal: AbortSignal): Promise<{ url: string | null; ref: string }> {
    const r = prRef(ref);
    if (!r) throw new SourceError(`PR 写成 owner/repo#123：${ref}`);
    if (!body.trim()) throw new SourceError("评论是空的");
    const out = JSON.parse(await this.gh(["api", "-X", "POST", `repos/${r.owner}/${r.repo}/issues/${r.number}/comments`, "-f", `body=${body.trim()}`], signal)) as { html_url?: string };
    return { url: out.html_url ?? null, ref: `${r.owner}/${r.repo}#${r.number}` };
  }

}
