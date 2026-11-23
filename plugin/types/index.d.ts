// 面板直接读 ~/chief/data 里的文件（见 src/store.ts），这里是它用到的那部分。
export type Source = 'slack' | 'github' | 'jira' | 'notion' | 'session'

export type ReplyRow = {
  id: number
  kind?: 'reply' | 'approve' | 'message'
  event: number
  thing?: number
  source: Source
  target: Record<string, string>
  context: { who: string | null; where: string; said: string; url: string | null }
  body: string
  custom?: number
  // 以你的名义发是怎么确认的：panel 面板上点的；chat 你在会话里说的（said 是你的原话）。
  confirm?: { how: 'panel' | 'chat'; said?: string; at: string }
  // 主会话说你在会话里同意发了，插件还没核对上。
  confirmAsk?: { at: string }
  // 附的图（只有 Slack）：正文发完发到同一个地方。file 是复制进 drafts/images 后的路径。
  images?: { file: string; name: string; bytes: number; mime: string }[]
  original?: string
  status: 'pending' | 'queued' | 'sending' | 'sent' | 'failed' | 'dropped' | 'redo'
  by?: 'you' | 'policy'
  sendAt?: string
  sentAt?: string
  error?: string
  feedback?: string
  at: string
  url?: string
}

export type ThingRow = {
  id: number
  title: string
  session?: string
  status: 'doing' | 'waiting_you' | 'waiting_others' | 'done' | 'dropped'
  progress: string
  next?: string
  blocker?: string
  results?: string[]
  due?: string
  keys?: string[]
  origin?: 'chief' | 'import'
  events: number[]
  updatedAt: string
  log: { at: string; text: string }[]
}

export type AskRow = {
  id: number
  thing: number
  question: string
  suggest: string
  status: 'open' | 'answered'
  answer?: string
  at: string
}

export type Verdict = 'ignored' | 'noted' | 'forwarded' | 'opened' | 'asked'

export type DecisionRow = {
  dry?: boolean
  at: string
  event: number
  scenario: string
  verdict: Verdict
  reason: string
  thing?: number
  session?: string
  what?: { source: Source; title: string; from: string | null; text: string }
}

export type Handle = 'dispatch' | 'note' | 'ignore' | 'approve' | 'command'
export type ReplyMode = 'ask' | 'auto'

export type Rule = { handle: Handle; reply: ReplyMode; brief?: string }

export type PolicyFile = {
  scenarios: Record<string, Rule>
  // 固定回复：回复和其中一句一字不差，才能不问你直接发。
  quick?: string[]
  custom: (Rule & { id: number; when: string })[]
  notes: string[]
  signature?: string
  style?: string[]
  trusted?: string[]
  placement?: Record<'direct' | 'group' | 'channel' | 'self', 'inline' | 'thread'>
  proposals: { id: number; text: string; basis: string; at: string }[]
}

export type Reviews = Record<string, { ok: boolean; note?: string; at: string }>

// 面板每次刷新读出来的一份。
export type Snapshot = {
  hub: { listening: boolean; lastAt: string | null }
  engineAt: string | null
  // 每个来源最近一次收 / 拉的结果（引擎写在 engine.json）：fails 是连着失败几次。
  health: Record<string, { ok: boolean; at: string; fails: number; error?: string }>
  unhandled: number
  maxEvent: number
  things: ThingRow[]
  asks: AskRow[]
  replies: ReplyRow[]
  decisions: DecisionRow[]
  reviews: Reviews
  policy: PolicyFile | null
  sources: Record<string, boolean>
  // 事情挂着的会话最近的动静（引擎读 Claude App 的会话记录得来）。
  activity: Record<string, { at: string; saidAt?: string | null; waiting?: string | null; title: string; last: string; permissionMode: string | null; archived: boolean }>
  // 主会话的权限模式（和工作会话不是同一类时，主会话转告过去的消息会被扣住）。
  hubMode: string | null
  // 查过的 Slack 人：用户编号 → 名字（稿子里的 <@U…> 显示成 @名字）。
  people: Record<string, string>
  // 演练用的例子和最近一次演练（见 chief eval）。
  evals: { cases: { id: number; text: string; from: string; expect: 'dispatch' | 'note' | 'ignore' | 'ask'; note?: string }[]; runs: { id: number; at: string; events: Record<string, number> }[] }
  // 演练消息的判断（不算进「替你做了」）。
  dryDecisions: DecisionRow[]
  // 主会话用掉的订阅额度（hub-usage.json）。
  hubUsage: HubUsage
}

// 主会话一天用掉的额度（hooks/usage.ts 记）：five / week 是 5 小时、每周窗口涨了几个百分点（量到的加估的），
// weight 是 token 按价钱折算的份量，measured 是其中量到的那部分。
export type UsageDay = { calls: number; weight: number; five: number; week: number; measured: { weight: number; five: number; week: number } }
export type HubUsage = {
  days: Record<string, UsageDay>
  // 量到的平均速度：每份 token 涨几个百分点（估隔得久的那次用）。
  rate?: { five: number; week: number }
  // 最近一次读数：上下文多长、整个账号两个窗口用了多少、什么时候重置。
  now?: { at: string; context: number | null; window: number; five: number | null; week: number | null; fiveReset?: string; weekReset?: string }
}

export type Tab = 'now' | 'outbox' | 'things' | 'policy' | 'eval' | 'setup'

// chief doctor 的结果：设置页按它打勾。
export type Doctor = {
  version: string | null
  node: string
  engine: 'running' | 'stopped' | 'missing'
  chrome: boolean
  sources: {
    slack: { enabled: boolean; ready: boolean }
    github: { enabled: boolean; tool: boolean; ok: boolean; detail: string }
    jira: { enabled: boolean; tool: boolean; ok: boolean; detail: string }
    notion: { enabled: boolean; ready: boolean }
  }
  hub: { listening: boolean; lastAt: string | null }
  // 插电时不让电脑睡（引擎挂着 caffeinate -s）
  awake: boolean
  // 记下的 Slack 工作区（子域名），登录窗口从这里打开；没记过是 null
  slackWorkspace: string | null
  // 工作目录 ~/chief：消息中心开在这里（ready：CLAUDE.md 在）
  workspace: { path: string; ready: boolean }
}

// 设置页：引擎装没装（~/chief/data/bin/chief 在不在）、doctor 的结果、正在做哪一步、上一步的输出。
export type Setup = {
  installed: boolean
  doctor: Doctor | null
  busy: '' | 'engine' | 'slack' | 'github' | 'jira' | 'awake' | 'check'
  said: string
  // 本会话开在哪个目录：和工作目录对不上时，提醒消息中心换个地方开
  cwd: string
  // 「以你的名义发」的钥匙：ok 配好了；mismatch 引擎记的是另一把（重装过插件），面板上的发送用不了；none 引擎还没装
  key: 'ok' | 'mismatch' | 'none'
}

declare module 'claude-code' {
  interface PluginState {
    'chief': {
      snap: Snapshot | null
      note: string
      tab: Tab
      // 你在待发出里改了还没发的稿子：回复号 → 改后的文字。
      edits: Record<string, string>
      // 展开着的行（事情、判断）。
      open: string[]
      // 设置页里看的最近日志。
      logs: string
      // 攒着要一起发给主会话的批注：批在哪（t<事情号> / a<问题号> / r<回复号> / d<事件号> / note）、那是什么、你说的话。
      basket: { key: string; label: string; text: string }[]
      setup: Setup
      // 你在这个会话里最近亲口说的一句话（插件核对「你在会话里说了发」用）。
      said: { text: string; at: number } | null
      // 本会话是不是主会话（挂过 chief events --follow 的 Monitor）。
      hub: boolean
      // 本会话上一次调完模型读到的额度百分比。
      reading: { at: number; five: number | null; week: number | null } | null
    }
  }
}
