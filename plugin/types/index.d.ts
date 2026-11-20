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
}

export type Tab = 'now' | 'outbox' | 'things' | 'policy' | 'eval' | 'control' | 'setup'

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
  // 工作目录 ~/chief：消息中心开在这里（ready：CLAUDE.md 在）
  workspace: { path: string; ready: boolean }
}

// 设置页：引擎装没装（~/chief/data/bin/chief 在不在）、doctor 的结果、正在做哪一步、上一步的输出。
export type Setup = {
  installed: boolean
  doctor: Doctor | null
  busy: '' | 'engine' | 'slack' | 'github' | 'jira' | 'check'
  said: string
  // 本会话开在哪个目录：和工作目录对不上时，提醒消息中心换个地方开
  cwd: string
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
      // 控制页里看的最近日志。
      logs: string
      // 攒着要一起发给主会话的批注：批在哪（t<事情号> / a<问题号> / r<回复号> / d<事件号> / note）、那是什么、你说的话。
      basket: { key: string; label: string; text: string }[]
      setup: Setup
    }
  }
}
