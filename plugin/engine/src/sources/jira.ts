// 照搬 aide 的 engine/src/sources/jira.ts（只留拉动态和评论）。
// Jira：用你本机已经登录的 acli（Atlassian 官方命令行，acli jira auth login --web 用浏览器 OAuth 登录）。chief 不存任何 Jira 令牌。
// 拉指派给你、你报的、你关注的工单在 since 之后的变化：状态、截止时间、新评论。拉动态、给 agent 看的工具都只读（search、view、auth status）。
// 写（建单、评论、改状态、指派）只在你点了「发出」之后由 Outbox 调用（见 outbox.ts），agent 自己调不到。
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { runProgram } from "../program";
import type { SecretCheck } from "../slack/types";
import { SourceError, plain, type Ask, type Source, type SourceItem } from "./types";

const ACLI_PATHS = ["/opt/homebrew/bin/acli", "/usr/local/bin/acli"];
const KEY = /^[A-Z][A-Z0-9]{1,9}-\d{1,7}$/;
const MAX_ITEMS = 50;
// parent：父单（史诗或上一级的单），同一个父单下的单多半是同一件事，拿来提议「合进去」。
const VIEW_FIELDS = "summary,status,assignee,reporter,duedate,updated,priority,comment,parent";

export type AcliRunner = (args: readonly string[], signal: AbortSignal) => Promise<string>;

export function findAcli(): string | null {
  for (const p of ACLI_PATHS) if (existsSync(p)) return p;
  return null;
}

export function acliRunner(bin: string): AcliRunner {
  return async (args, signal) => {
    const out = await runProgram(bin, args, { cwd: homedir(), timeoutMs: 30_000, network: true, signal, maxOutput: 16 * 1024 * 1024 });
    if (out.aborted) throw new SourceError("取消了");
    if (out.timedOut) throw new SourceError("acli 30 秒没回应");
    if (out.code !== 0) {
      const why = `${out.stdout}\n${out.stderr}`.trim().split("\n").at(-1)?.slice(0, 200) ?? "";
      throw new SourceError(/unauthorized|auth login/i.test(why) ? "acli 没登录 Jira，到终端里跑 acli jira auth login --web" : `acli 出错了：${why}`);
    }
    return out.stdout;
  };
}

// Jira 的富文本（ADF）→ 纯文字。
export function adfText(node: unknown): string {
  if (typeof node !== "object" || node === null) return "";
  const n = node as { type?: string; text?: string; content?: unknown[]; attrs?: { text?: string } };
  if (n.type === "text") return n.text ?? "";
  if (n.type === "mention") return n.attrs?.text ?? "@某人";
  const inner = (n.content ?? []).map(adfText).join("");
  return n.type === "paragraph" || n.type === "listItem" || n.type === "heading" ? `${inner}\n` : inner;
}

interface Person { displayName?: string; accountType?: string; accountId?: string }

// 写操作（--json）的结果：每张单一条，FAILURE 带原因。acli 失败时退出码也是 0，只能看这个。
interface WriteResult { results?: { status?: string; message?: string; id?: string }[]; totalCount?: number; successCount?: number }
interface Issue {
  key: string;
  fields: {
    summary?: string; status?: { name?: string }; assignee?: Person | null; reporter?: Person | null;
    duedate?: string | null; updated?: string; priority?: { name?: string } | null;
    comment?: { comments?: { author?: Person; body?: unknown; created?: string }[] };
    description?: unknown;
    issuetype?: { name?: string }; labels?: string[];
    parent?: { key?: string; fields?: { summary?: string } } | null;
  };
}

export class JiraSource implements Source {
  readonly id = "jira" as const;
  readonly label = "Jira";
  private site: string | null = null;
  // 每个工单上次报过的状态：没变、也没有人的新评论的，不再报。
  private readonly seen = new Map<string, string>();
  // 上次看到的指派人（认出「新指派给你」）。
  private readonly assignees = new Map<string, string | null>();

  // 你在 Jira 上的显示名（从指派给你的工单里认出来，认一次就记住）。
  private me: string | null = null;

  constructor(private readonly acli: AcliRunner) {}

  whoami(): string | null {
    return this.me;
  }

  // 查询是写死的（不带任何外来的字），只看指派给你的一张工单上的指派人。
  private async learnMe(signal: AbortSignal): Promise<void> {
    if (this.me) return;
    try {
      const found = JSON.parse(await this.acli(["jira", "workitem", "search", "--jql", "assignee = currentUser() ORDER BY updated DESC", "--fields", "key,summary,status", "--limit", "1", "--json"], signal)) as Issue[];
      const key = found[0]?.key;
      if (!key || !KEY.test(key)) return;
      const name = (await this.view(key, "assignee", signal)).fields.assignee?.displayName;
      if (name && name.length <= 80) this.me = name;
    } catch (error) {
      if (signal.aborted) throw error;
    }
  }

  async check(signal: AbortSignal): Promise<SecretCheck[]> {
    try {
      const out = await this.acli(["jira", "auth", "status"], signal);
      this.site = /Site:\s*([a-z0-9-]+\.atlassian\.net)/i.exec(out)?.[1]?.toLowerCase() ?? null;
      const email = /Email:\s*(\S+)/.exec(out)?.[1] ?? "?";
      return [{ label: "acli 已登录 Jira", pass: this.site !== null, detail: this.site ? `${this.site}，${email}` : "没认出站点" }];
    } catch (error) {
      return [{ label: "acli 已登录 Jira", pass: false, detail: error instanceof Error ? error.message : "没成功" }];
    }
  }

  // 导入用：指派给你、还没做完的单（查询写死，不带外来的字）。
  async open(signal: AbortSignal): Promise<{ key: string; title: string; status: string; url: string; updated: string; due: string | null }[]> {
    const site = await this.siteOf(signal);
    const jql = "assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC";
    const found = JSON.parse(await this.acli(["jira", "workitem", "search", "--jql", jql, "--fields", "key,summary,status", "--limit", "30", "--json"], signal)) as Issue[];
    const items = found.filter((it) => KEY.test(it.key));
    // 搜索不给截止日期，一张张看（五张一起）。
    const due = new Map<string, string | null>();
    for (let i = 0; i < items.length; i += 5) {
      await Promise.all(items.slice(i, i + 5).map(async (it) => {
        try {
          due.set(it.key, (await this.view(it.key, "duedate", signal)).fields.duedate ?? null);
        } catch (error) {
          if (signal.aborted) throw error;
        }
      }));
    }
    return items.map((it) => ({
      key: it.key, title: plain(it.fields.summary ?? "", 120), status: it.fields.status?.name ?? "?", url: `https://${site}/browse/${it.key}`, updated: "", due: due.get(it.key) ?? null,
    }));
  }

  private async view(key: string, fields: string, signal: AbortSignal): Promise<Issue> {
    return JSON.parse(await this.acli(["jira", "workitem", "view", key, "--fields", fields, "--json"], signal)) as Issue;
  }

  // —— 写：只在你说了「发 N」之后由 chief reply send 调用 ——

  private written(out: string, what: string): void {
    let res: WriteResult;
    try {
      res = JSON.parse(out) as WriteResult;
    } catch {
      if (/✗|failure|error/i.test(out)) throw new SourceError(`${what}没成功：${out.trim().split("\n").at(-1)?.slice(0, 200) ?? ""}`);
      return;
    }
    const bad = (res.results ?? []).find((r) => r.status !== "SUCCESS");
    if (bad || (res.totalCount !== undefined && res.successCount !== res.totalCount)) {
      throw new SourceError(`${what}没成功：${(bad?.message ?? "Jira 没说为什么").slice(0, 200)}`);
    }
  }

  async comment(key: string, body: string, signal: AbortSignal): Promise<{ url: string; ref: string }> {
    if (!KEY.test(key)) throw new SourceError(`工单号不对：${key}`);
    if (!body.trim()) throw new SourceError("评论是空的");
    const site = await this.siteOf(signal);
    this.written(await this.acli(["jira", "workitem", "comment", "create", `--key=${key}`, `--body=${body}`, "--json"], signal), "评论");
    return { url: `https://${site}/browse/${key}`, ref: key };
  }

  private async siteOf(signal: AbortSignal): Promise<string> {
    if (!this.site) await this.check(signal);
    if (!this.site) throw new SourceError("acli 没登录 Jira，到终端里跑 acli jira auth login --web");
    return this.site;
  }

  async poll(since: Date, signal: AbortSignal): Promise<SourceItem[]> {
    const site = await this.siteOf(signal);
    await this.learnMe(signal);
    const minutes = Math.max(1, Math.ceil((Date.now() - since.getTime()) / 60_000) + 1);
    const jql = `(assignee = currentUser() OR reporter = currentUser() OR watcher = currentUser()) AND updated >= "-${minutes}m" ORDER BY updated ASC`;
    const found = JSON.parse(await this.acli(["jira", "workitem", "search", "--jql", jql, "--fields", "key,summary,status", "--limit", String(MAX_ITEMS), "--json"], signal)) as Issue[];
    const items: SourceItem[] = [];
    for (const hit of found) {
      if (!KEY.test(hit.key)) continue;
      const it = await this.view(hit.key, VIEW_FIELDS, signal);
      const f = it.fields;
      const updated = f.updated ?? "";
      if (Date.parse(updated) <= since.getTime()) continue;
      const status = f.status?.name ?? "?";
      // 人写的新评论（集成、机器人的不算）。
      const fresh = (f.comment?.comments ?? []).filter((c) => Date.parse(c.created ?? "") > since.getTime() && c.author?.accountType !== "app").slice(-5);
      const before = this.seen.get(it.key);
      this.seen.set(it.key, status);
      if (before === status && fresh.length === 0) continue;
      const said = fresh.map((c) => `${c.author?.displayName ?? "某人"}：${plain(adfText(c.body), 200)}`).join("；");
      const me = this.me;
      const assignee = f.assignee?.displayName ?? null;
      const was = this.assignees.get(it.key);
      this.assignees.set(it.key, assignee);
      const mine = me !== null && (assignee === me
        || fresh.some((c) => c.author?.displayName === me || adfText(c.body).includes(me)));
      // 有人找你：新指派给你（之前不是你；第一次见到的也算，同一条只报一次由记录去重）、别人的评论里提到你、别人评论了指派给你 / 你报的单。
      const others = me === null ? [] : fresh.filter((c) => c.author?.displayName !== me);
      const asks: Ask[] = [];
      if (me !== null && assignee === me && was !== me) asks.push("assigned");
      if (others.some((c) => adfText(c.body).includes(me!))) asks.push("mention");
      else if (me !== null && others.length > 0 && (assignee === me || f.reporter?.displayName === me)) asks.push("comment");
      items.push({
        externalId: `${it.key}@${updated}`,
        kind: "jira.issue",
        title: `${it.key} ${plain(f.summary ?? "", 120)}`,
        url: `https://${site}/browse/${it.key}`,
        summary: `Jira ${it.key}「${plain(f.summary ?? "", 120)}」现在是 ${status}，指派给 ${f.assignee?.displayName ?? "没人"}`
          + `${f.priority?.name ? `，优先级 ${f.priority.name}` : ""}${f.duedate ? `，截止 ${f.duedate}` : ""}${said ? `；新评论：${said}` : ""}`,
        at: new Date(Date.parse(updated)).toISOString(),
        payload: {
          key: it.key, status, assignee, due: f.duedate ?? null, comments: fresh.length, ...(was !== undefined && was !== assignee ? { assigneeChanged: true } : {}),
          ...(f.parent?.key && KEY.test(f.parent.key) ? { parent: f.parent.key, parentTitle: plain(f.parent.fields?.summary ?? "", 120) || null } : {}),
        },
        mine,
        asks,
      });
    }
    return items;
  }

}
