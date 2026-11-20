// 从文字里认出「这是哪件事」的键：PR / issue 地址、Jira 工单号、Notion 页面。
// 同一件事在不同来源里出现（Slack 里贴了 PR 链接、提了工单号），靠这些键归到同一个会话。

const GITHUB = /github\.com\/([\w.-]{1,100})\/([\w.-]{1,100})\/(pull|issues)\/(\d{1,9})/gi;
const TICKET = /\b([A-Z][A-Z0-9]{1,9})-(\d{1,7})\b/g;
const NOTION = /notion\.(?:so|site|com)\/[^\s>|)\]]*?([0-9a-f]{32})/gi;
// 长得像工单号、其实不是的：编码、标准、算法名。
const NOT_TICKETS = new Set(["UTF", "ISO", "SHA", "RFC", "HTTP", "TLS", "SSL", "MD", "GPT", "CVE", "ES", "IE", "COVID"]);

export function githubKey(owner: string, repo: string, kind: string, num: number | string): string {
  return `github.com/${owner.toLowerCase()}/${repo.toLowerCase()}/${kind === "issues" ? "issues" : "pull"}/${num}`;
}

export function keysOf(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(GITHUB)) out.add(githubKey(m[1]!, m[2]!, m[3]!.toLowerCase(), m[4]!));
  for (const m of text.matchAll(TICKET)) if (!NOT_TICKETS.has(m[1]!)) out.add(`${m[1]}-${m[2]}`);
  for (const m of text.matchAll(NOTION)) out.add(`notion:${m[1]!.toLowerCase()}`);
  return [...out];
}

// 键只能是这些字符：命令行收到的键先过这一关。
export const KEY = /^[\w.:/#@-]{1,200}$/;
