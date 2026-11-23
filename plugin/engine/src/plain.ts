// 写给用户看的话（问题、建议、事情标题和进展、回复正文）里，看的人得知道每个编号指的是什么：
//   - chief 自己的编号一律不许写（「#98」「问题 #63」「回复 107」「事件 #552」「待发出 #99」）：看的人拿着它没用，
//     改成一句话说清是哪一条。
//   - 外部的编号（PR #87、Notion #195、admin #10821、acme/shop#12，单写的 #179 也一样）可以写，
//     但后面要紧跟括号说清是什么事：「#179（批准后自动处理的 PR）」「Notion #195（要验 OS 侧的那条）」。
// 引擎在这些话进 chief 之前挡一道，拦下来让写的人改，不靠主会话自觉。
//
// 不用括号也放行的：
//   - 链接里的（连同链接文字）：https://github.com/o/r/pull/12、[PR #12](https://…)、<https://…|#12>，点开就知道
//   - Jira 单号：PROJ-35189（不带 #，本来就不会被认成编号）
//   - 回 GitHub 的评论里的 #123：GitHub 会把它链到同一个仓库的 PR / issue，对方点得开

// chief 里有编号的东西。后面跟数字（可带「号」「#」）就是在说 chief 的编号。
const NOUNS = "回复|问题|事件|事情|判断|提议|待发出|要你定";
const NOUN_ID = new RegExp(`(?:${NOUNS})\\s*号?\\s*([#＃])?\\s*(\\d{1,7})(?!\\d)`, "gu");
// 不带 # 的「问题 3」后面是量词、日期、时间、小数的，是在说数量或时间（问题 3 个、事件 3 天前、回复 10:30），不是编号。
const NOT_AN_ID = /^\s*(?:[个条件次位句段封行页张轮遍天周月年岁点分秒%％]|小时|分钟|多|号|[-/:：.．]\d)/u;
// 外部编号：#98，前面可以带名字（PR #87、Notion #195、admin #10821、PR#87、shop#535、acme/shop#12）。
// 后面紧跟字母数字的不算（#12ab 是颜色之类）；七位以上不算（颜色、时间戳）。
const REF = /(?<![\w./-])(?:(?:[A-Za-z][\w.-]*\/)?[A-Za-z][\w.-]*\s?)?[#＃]\d{1,6}(?!\w)/gu;
// 紧跟在编号后面的括号：里面得有字（不能只是别的编号），才算说清了是什么事。
const EXPLAINED = /^\s?[（(]([^()（）\n]{2,80})[)）]/u;
const saysWhat = (inside: string) => /\p{L}/u.test(inside.replace(/[#＃]\d+/gu, ""));
// 链接整段跳过：Markdown 的 [文字](地址)、Slack 的 <地址|文字>、裸地址（只认 ASCII 字符，后面紧跟的中文不算进地址）。
const LINKS = /\[[^\]\n]*\]\(\s*https?:\/\/[^)\s]*\)|<https?:\/\/[^>\n]*>|https?:\/\/[!-;=?-~]+/giu;

export type IdsOptions = {
  // 回 GitHub 的评论：单写的 #123 是 GitHub 自己的写法，放行；「回复 107」这种不带 # 的 chief 说法照样拦。
  github?: boolean;
  // 事情标题：整个标题就是在说这个 PR 是什么（「shop-api#2286 同步 master 到 release/tidy」），带仓库名的编号不用再加括号；单写的 #63 照样拦。
  title?: boolean;
};

// 找出文字里看的人看不懂的编号：chief 自己的编号，和后面没用括号说清是什么事的外部编号。原样返回（去重，按出现顺序）；没有就是空数组。
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
    for (const m of plain.matchAll(REF)) {
      const at = m.index;
      if (hits.some((h) => at < h.end && at + m[0].length > h.at)) continue;
      const after = EXPLAINED.exec(plain.slice(at + m[0].length));
      if (after && saysWhat(after[1]!)) continue;
      if (opts.title && /^[A-Za-z]/.test(m[0]) && saysWhat(plain.slice(0, at) + plain.slice(at + m[0].length))) continue;
      hits.push({ at, end: at + m[0].length, text: m[0] });
    }
  }
  return [...new Set(hits.sort((a, b) => a.at - b.at).map((h) => h.text))];
}

// 拦下来时告诉写的人怎么改。
export function idsMessage(what: string, ids: string[], hint = ""): string {
  return `${what}里有看的人看不懂的编号：${ids.map((x) => `「${x}」`).join("")}。`
    + "chief 自己的编号（问题 #63、回复 107、待发出 #99、单写的 #98 指 chief 里的某条）不要写，改成一句话说清是哪一条（比如「给 Alice 的那条回复」「Joe 问上线时间的那个问题」）。"
    + `外部的编号（PR、Notion、仓库里的 #123）可以写，但后面紧跟括号说清是什么事：「#179（批准后自动处理的 PR）」「Notion #195（要验 OS 侧的那条）」；完整链接不用括号。${hint}`;
}
