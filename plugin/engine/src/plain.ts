// 写给用户看的话（问题、建议、事情标题和进展、回复正文）里不许出现 chief 自己的编号：
// 用户看不懂「#98」「问题 #63」「回复 107」「事件 #552」指的是哪一条。引擎在这些话进 chief 之前挡一道，
// 拦下来让写的人改成一句话说清是哪一条，不靠主会话自觉。
//
// 外部的编号照常放行：
//   - 前面带仓库名的：owner/repo#123、shop#535
//   - 链接里的（连同链接文字）：https://github.com/o/r/pull/12、[PR #12](https://…)、<https://…|#12>
//   - Jira 单号：PROJ-35189（不带 #，本来就不会被认成 chief 的编号）
//   - 回 GitHub 的评论里单写的 #123：GitHub 会把它链到同一个仓库的 PR / issue，对方点得开

// chief 里有编号的东西。后面跟数字（可带「号」「#」）就是在说 chief 的编号。
const NOUNS = "回复|问题|事件|事情|判断|提议|待发出|要你定";
const NOUN_ID = new RegExp(`(?:${NOUNS})\\s*号?\\s*([#＃])?\\s*(\\d{1,7})(?!\\d)`, "gu");
// 不带 # 的「问题 3」后面是量词、日期、时间、小数的，是在说数量或时间（问题 3 个、事件 3 天前、回复 10:30），不是编号。
const NOT_AN_ID = /^\s*(?:[个条件次位句段封行页张轮遍天周月年岁点分秒%％]|小时|分钟|多|号|[-/:：.．]\d)/u;
// 单写的 #98：前面紧挨着的不是仓库名（字母、数字、. _ - /）。后面紧跟字母数字的不算（#12ab 是颜色之类）；六位以上不算（颜色、时间戳）。
const BARE = /(?<![\w./-])[#＃](\d{1,5})(?!\w)/gu;
// PR#98、issue#98：前面是「PR」不是仓库名，一样看不出是哪个仓库。
const PR_BARE = /(?<![\w./-])(?:pr|mr|issue|issues|pull)[#＃](\d{1,6})(?!\w)/giu;
// 链接整段跳过：Markdown 的 [文字](地址)、Slack 的 <地址|文字>、裸地址（只认 ASCII 字符，后面紧跟的中文不算进地址）。
const LINKS = /\[[^\]\n]*\]\(\s*https?:\/\/[^)\s]*\)|<https?:\/\/[^>\n]*>|https?:\/\/[!-;=?-~]+/giu;

export type IdsOptions = {
  // 回 GitHub 的评论：单写的 #123 是 GitHub 自己的写法，放行；「回复 107」这种不带 # 的 chief 说法照样拦。
  github?: boolean;
};

// 找出文字里 chief 自己的编号写法，原样返回（去重，按出现顺序）；没有就是空数组。
export function chiefIds(text: string, opts: IdsOptions = {}): string[] {
  const plain = text.replace(LINKS, (m) => " ".repeat(m.length));
  const hits: { at: number; end: number; text: string }[] = [];
  for (const m of plain.matchAll(NOUN_ID)) {
    const hash = m[1] !== undefined;
    if (hash && opts.github) continue;
    if (!hash && NOT_AN_ID.test(plain.slice(m.index + m[0].length))) continue;
    hits.push({ at: m.index, end: m.index + m[0].length, text: m[0].trim() });
  }
  if (!opts.github) {
    for (const re of [PR_BARE, BARE]) {
      for (const m of plain.matchAll(re)) {
        const at = m.index;
        if (hits.some((h) => at >= h.at && at < h.end)) continue;
        hits.push({ at, end: at + m[0].length, text: m[0] });
      }
    }
  }
  return [...new Set(hits.sort((a, b) => a.at - b.at).map((h) => h.text))];
}

// 拦下来时告诉写的人怎么改。
export function idsMessage(what: string, ids: string[], hint = ""): string {
  return `${what}里有 chief 自己的编号：${ids.map((x) => `「${x}」`).join("")}。看的人不知道这些编号指的是哪一条：改成一句话说清是哪一条（比如「给 Alice 的那条回复」「Joe 问上线时间的那个问题」「压测报告那件事」）。`
    + `PR、Jira 单照常写：owner/repo#123、完整链接、PROJ-123 这样的单号，先一句话说清是什么再附上。${hint}`;
}
