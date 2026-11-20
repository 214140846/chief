// 照搬 aide 的 channels/src/slack/api.ts。
// 去掉文字里的 Slack 令牌和 cookie：先换掉给定的，再按格式兜底。
export function scrubTokens(text: string, tokens: readonly string[] = []): string {
  let out = text;
  for (const t of tokens) if (t) out = out.split(t).join("[令牌]");
  return out.replace(/\b(xox[a-z]-|xoxe\.xox[a-z]-|xapp-|xoxd-)[A-Za-z0-9-]+/g, "[令牌]");
}
