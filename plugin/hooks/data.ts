// 读 ~/chief-home/data 里的文件（规矩在 ~/chief-home/rules.json），算出面板要的一份。只读文件，不起进程（除了第一次问一下 HOME）。
import { atom, update } from 'claude-code'
import type { EngineInterface as Engine } from 'claude-code'

import type { AskRow, DecisionRow, PolicyFile, ReplyRow, Reviews, Snapshot, ThingRow } from '../types'

// 面板的状态都在 PluginState['chief'] 里（types/index.d.ts）；引擎要求每个文件用到哪份就在本文件里声明哪份。
const snap = atom({ plugin: 'chief', key: 'snap' } as const, null)

// 主会话 / 引擎多久没报到算不在了（它们 20 秒报一次）。
const STALE_MS = 60_000
// 测评看最近几天。
export const EVAL_DAYS = 7

let dir: string | null = null
let rules: string | null = null

// chief 的数据目录：CHIEF_HOME，没设就是 ~/chief-home/data（和 chief 自己的规则一样）。chief 命令在它下面的 bin/chief。
export async function chiefDir($: Engine): Promise<string> {
  if (dir === null) {
    const env = (await $.process.run(['/usr/bin/env'])).stdout.split('\n')
    const get = (k: string) => env.find(l => l.startsWith(`${k}=`))?.slice(k.length + 1).trim() ?? ''
    const custom = get('CHIEF_HOME')
    dir = custom.startsWith('/') ? custom : `${get('HOME')}/chief-home/data`
    // 规矩放在工作目录最上层（data 的上一层）；CHIEF_HOME 指到别处时和数据放一起。
    rules = custom.startsWith('/') ? `${custom}/rules.json` : `${get('HOME')}/chief-home/rules.json`
  }
  return dir
}

async function rulesFile($: Engine): Promise<string> {
  await chiefDir($)
  return rules!
}

async function readJson<T>($: Engine, path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await $.fs.read(path)) as T
  } catch {
    return fallback
  }
}

async function readLines<T>($: Engine, path: string): Promise<T[]> {
  try {
    return (await $.fs.read(path)).split('\n').flatMap(l => {
      try {
        return l.trim() ? [JSON.parse(l) as T] : []
      } catch {
        return []
      }
    })
  } catch {
    return []
  }
}

export async function refresh($: Engine) {
  const dir = await chiefDir($)
  const [alive, engine, state, dispatch, things, replies, decisions, reviews, policy, sources, activity, evals, people] = await Promise.all([
    readJson<{ at?: string; stopped?: boolean }>($, `${dir}/alive.json`, {}),
    readJson<{ at?: string; health?: Snapshot['health'] }>($, `${dir}/engine.json`, {}),
    readJson<{ nextId?: number }>($, `${dir}/state.json`, {}),
    readJson<Record<string, unknown>>($, `${dir}/dispatch.json`, {}),
    readJson<{ things: ThingRow[]; asks: AskRow[] }>($, `${dir}/things.json`, { things: [], asks: [] }),
    readJson<{ items: ReplyRow[] }>($, `${dir}/replies.json`, { items: [] }),
    readLines<DecisionRow>($, `${dir}/decisions.jsonl`),
    readJson<Reviews>($, `${dir}/reviews.json`, {}),
    readJson<PolicyFile | null>($, await rulesFile($), null),
    readJson<Record<string, boolean>>($, `${dir}/sources.json`, {}),
    readJson<Snapshot['activity']>($, `${dir}/activity.json`, {}),
    readJson<Snapshot['evals']>($, `${dir}/evals.json`, { cases: [], runs: [] }),
    readJson<Record<string, string>>($, `${dir}/people.json`, {}),
  ])
  const maxEvent = (state.nextId ?? 1) - 1
  const since = Date.now() - EVAL_DAYS * 86_400_000
  const next: Snapshot = {
    hub: { listening: !alive.stopped && alive.at !== undefined && Date.now() - Date.parse(alive.at) < STALE_MS, lastAt: alive.at ?? null },
    engineAt: engine.at !== undefined && Date.now() - Date.parse(engine.at) < STALE_MS ? engine.at : null,
    health: engine.health ?? {},
    unhandled: Math.max(0, maxEvent - Object.keys(dispatch).length),
    maxEvent,
    things: things.things.map(t => ({ ...t, events: t.events ?? [], log: t.log ?? [] })),
    asks: things.asks,
    replies: replies.items,
    decisions: decisions.filter(d => Date.parse(d.at) >= since && !d.dry),
    dryDecisions: decisions.filter(d => d.dry),
    evals: { cases: evals.cases ?? [], runs: evals.runs ?? [] },
    reviews,
    policy: policy === null ? await fullPolicy($) : await policyOf($, policy),
    sources,
    activity: Object.fromEntries(Object.entries(activity).filter(([k]) => k !== '_hub')),
    people,
    hubMode: ((activity as Record<string, unknown>)._hub as { permissionMode?: string | null } | undefined)?.permissionMode ?? null,
  }
  await update($, snap, () => next)
}

// rules.json 还没写过时，场景表在 chief 里有默认值：问 chief 要一份完整的。
async function policyOf($: Engine, p: PolicyFile): Promise<PolicyFile> {
  // 旧的 rules.json 里没有后来加的场景和「我加的情况」：问 chief 要一份补全的。
  if (Object.keys(p.scenarios ?? {}).length > 0 && p.custom !== undefined && 'slack_self' in p.scenarios) return { scenarios: p.scenarios, custom: p.custom, notes: p.notes ?? [], proposals: p.proposals ?? [] }
  return fullPolicy($)
}

export async function fullPolicy($: Engine): Promise<PolicyFile> {
  // 引擎还没装时没有 chief 命令：先给空的，装好后再读。
  try {
    const out = await $.process.run([`${await chiefDir($)}/bin/chief`, 'rules', 'json'])
    return JSON.parse(out.stdout) as PolicyFile
  } catch {
    return { scenarios: {}, custom: [], notes: [], proposals: [] }
  }
}

// 测评：最近 EVAL_DAYS 天。
export type Stats = {
  judged: number
  byVerdict: Record<string, number>
  reviewed: number
  wrong: number
  asks: number
  replies: { asIs: number; edited: number; dropped: number; redo: number; auto: number; failed: number }
  days: { label: string; judged: number; dispatched: number; asks: number }[]
  // 替你做了：没打扰你就处理掉的、派出去的、替你写好发出的回复、approve、主动发的消息、办完的事，和估算省下的分钟数。
  value: { quiet: number; dispatched: number; replies: number; approves: number; messages: number; done: number; minutes: number }
}

// 省时间的估算：每类事按你自己做要花几分钟算（读消息、判断、找会话交代、写回复、看 PR 点 approve）。
export const MINUTES = { quiet: 1, dispatched: 5, reply: 4, approve: 3, message: 4 }

export function statsOf(s: Snapshot): Stats {
  const since = Date.now() - EVAL_DAYS * 86_400_000
  const byVerdict: Record<string, number> = {}
  for (const d of s.decisions) byVerdict[d.verdict] = (byVerdict[d.verdict] ?? 0) + 1
  const judgedIds = new Set(s.decisions.map(d => String(d.event)))
  const reviews = Object.entries(s.reviews).filter(([id]) => judgedIds.has(id))
  const recent = s.replies.filter(r => Date.parse(r.at) >= since)
  const asks = s.asks.filter(a => Date.parse(a.at) >= since)
  const days: Stats['days'] = []
  for (let i = EVAL_DAYS - 1; i >= 0; i--) {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    start.setDate(start.getDate() - i)
    const end = start.getTime() + 86_400_000
    const inDay = (iso: string) => Date.parse(iso) >= start.getTime() && Date.parse(iso) < end
    const ds = s.decisions.filter(d => inDay(d.at))
    days.push({
      label: `${start.getMonth() + 1}/${start.getDate()}`,
      judged: ds.length,
      dispatched: ds.filter(d => d.verdict === 'forwarded' || d.verdict === 'opened').length,
      asks: asks.filter(a => inDay(a.at)).length,
    })
  }
  return {
    judged: s.decisions.length,
    byVerdict,
    reviewed: reviews.length,
    wrong: reviews.filter(([, r]) => !r.ok).length,
    asks: asks.length,
    replies: {
      asIs: recent.filter(r => r.status === 'sent' && r.by === 'you' && r.original === undefined).length,
      edited: recent.filter(r => r.status === 'sent' && r.original !== undefined).length,
      dropped: recent.filter(r => r.status === 'dropped').length,
      redo: recent.filter(r => r.status === 'redo').length,
      auto: recent.filter(r => r.status === 'sent' && r.by === 'policy').length,
      failed: recent.filter(r => r.status === 'failed').length,
    },
    days,
    value: (() => {
      const quiet = (byVerdict.noted ?? 0) + (byVerdict.ignored ?? 0)
      const dispatched = (byVerdict.forwarded ?? 0) + (byVerdict.opened ?? 0)
      const sent = recent.filter(r => r.status === 'sent')
      const replies = sent.filter(r => (r.kind ?? 'reply') === 'reply').length
      const approves = sent.filter(r => r.kind === 'approve').length
      const messages = sent.filter(r => r.kind === 'message').length
      const done = s.things.filter(t => t.status === 'done' && Date.parse(t.updatedAt) >= since).length
      const minutes = quiet * MINUTES.quiet + dispatched * MINUTES.dispatched + replies * MINUTES.reply + approves * MINUTES.approve + messages * MINUTES.message
      return { quiet, dispatched, replies, approves, messages, done, minutes }
    })(),
  }
}

// 最近 7 天每天判断了多少（派活的单独一色）、打扰你几次：一张小柱状图。
export function chartSvg(days: Stats['days']): string {
  const w = 336
  const h = 120
  const top = Math.max(1, ...days.map(d => d.judged))
  const bw = 28
  const gap = (w - bw * days.length) / (days.length + 1)
  const scale = (n: number) => (n / top) * (h - 34)
  const bars = days.map((d, i) => {
    const x = gap + i * (bw + gap)
    const all = scale(d.judged)
    const disp = scale(d.dispatched)
    return [
      `<rect x="${x}" y="${h - 18 - all}" width="${bw}" height="${all}" rx="3" fill="#9AA4B2"/>`,
      `<rect x="${x}" y="${h - 18 - disp}" width="${bw}" height="${disp}" rx="3" fill="#3B82F6"/>`,
      d.asks > 0 ? `<circle cx="${x + bw / 2}" cy="${h - 24 - all}" r="4" fill="#F59E0B"/>` : '',
      `<text x="${x + bw / 2}" y="${h - 4}" font-size="10" text-anchor="middle" fill="#8A8F98">${d.label}</text>`,
      d.judged > 0 ? `<text x="${x + bw / 2}" y="${h - 22 - all - (d.asks > 0 ? 8 : 0)}" font-size="10" text-anchor="middle" fill="#8A8F98">${d.judged}</text>` : '',
    ].join('')
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${bars.join('')}</svg>`
}
