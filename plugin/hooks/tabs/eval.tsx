// 「测评」页：替你做了多少、主会话用掉的额度、演练、最近 7 天的判断和准不准。
import type { EngineInterface as Engine } from 'claude-code'

import { EXPECT_LABELS, expectOf } from '../../engine/src/shared/rules'
import type { DecisionRow, HubUsage, Snapshot } from '../../types'
import { markRight, markWrong, removeCase, runEvals, saveCase, toggle } from '../actions'
import { SCENARIO, VERDICT, ago, select, short, type Els } from '../ui'
import { EVAL_DAYS, MINUTES, chartSvg, statsOf } from '../data'
import { dayOf } from '../usage'

// 上下文超过这么多，每来一条消息都要把它整个读一遍，额度涨得快：提醒换个新主会话。
const LONG_CONTEXT = 300_000

const pts = (n: number) => (n < 0.05 ? '不到 0.1' : n.toFixed(1))

const WEEKDAY = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function resetAt(iso: string | undefined, withDay: boolean): string {
  if (!iso) return ''
  const d = new Date(iso)
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return `，${withDay ? WEEKDAY[d.getDay()] : ''}${hm} 重置`
}

// 主会话用掉的订阅额度（hooks/usage.ts 记的）：今天、最近几天、账号现在的两个窗口、上下文多长。
export function usageBox(ui: Els, u: HubUsage) {
  const { Box, Text } = ui
  const days = Object.entries(u.days).sort(([a], [b]) => b.localeCompare(a))
  const now = u.now
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="inactive" paddingX="md" paddingY="sm" gap="xs" marginTop="sm">
      <Text weight="semibold">主会话用掉的额度</Text>
      {days.length === 0
        ? <Text dimColor wrap="wrap">还没记到。主会话挂上收消息的 Monitor 以后开始记（插件刚更新的话，等它下次重挂，最多半小时）。</Text>
        : (
          <Box flexDirection="column" gap="xs">
            {days.slice(0, 7).map(([day, d], i) => (
              <Text key={`ud-${day}`} wrap="wrap" dimColor={i > 0}>
                {day === dayOf(Date.now()) ? '今天' : day.slice(5)}：5 小时额度约 {pts(d.five)} 个点 · 每周额度约 {pts(d.week)} 个点 · 调了 {d.calls} 次模型
              </Text>
            ))}
          </Box>
        )}
      {now && (now.five !== null || now.week !== null) && (
        <Text size="footnote" dimColor wrap="wrap">
          整个账号现在（含你别的会话）：{now.five !== null ? `5 小时已用 ${now.five}%${resetAt(now.fiveReset, false)}` : ''}{now.five !== null && now.week !== null ? ' · ' : ''}{now.week !== null ? `每周已用 ${now.week}%${resetAt(now.weekReset, true)}` : ''}
        </Text>
      )}
      {now && now.context !== null && (
        <Text size="footnote" color={now.context > LONG_CONTEXT ? 'warning' : undefined} dimColor={now.context <= LONG_CONTEXT} wrap="wrap">
          主会话上下文 {Math.round(now.context / 10_000)} 万 token
          {now.context > LONG_CONTEXT ? '：太长了，每来一条消息都要整个读一遍，额度涨得快。开个新会话说「开 chief 消息中心」接手（进度、规矩都在 chief 里，不会丢）。' : ''}
        </Text>
      )}
      <Text size="caption" dimColor wrap="wrap">主会话每调完一次模型，看两个窗口的百分比涨了多少，记在它头上；闲了一阵后的第一次按平均速度估。百分比只精确到 0.1，你同时用着别的会话也会混进一点，所以是「约」。账号的总用量在任意会话里输入 /usage 看。</Text>
    </Box>
  )
}

export function evalTab($: Engine, ui: Els, s: Snapshot, opened: string[]) {
  const { Box, Text, Button } = ui
  const st = statsOf(s)
  const accuracy = st.reviewed === 0 ? '还没标过' : `${Math.round(((st.reviewed - st.wrong) / st.reviewed) * 100)}%（标了 ${st.reviewed} 条，错 ${st.wrong}）`
  const sentByYou = st.replies.asIs + st.replies.edited
  const recent = [...s.decisions].reverse().slice(0, 30)

  const decisionRow = (d: DecisionRow) => {
    const key = `d${d.event}`
    const r = s.reviews[String(d.event)]
    const isOpen = opened.includes(key)
    return (
      <Box key={key} flexDirection="column" marginTop="xs" gap="xs">
        <Box flexDirection="row" alignItems="center" gap="xs">
        
        <Button key={`dt${d.event}`} plain onPress={() => toggle($, key)}>
          {isOpen ? '▾ ' : '▸ '}{VERDICT[d.verdict]} <Text dimColor>· {SCENARIO[d.scenario] ?? d.scenario} · {ago(d.at)}</Text>
          {r ? (r.ok ? ' ✓' : ' ✗') : ''}
        </Button>
        </Box>
        <Box paddingLeft="md" flexDirection="column">
          {d.what && <Text dimColor wrap="truncate-end">{d.what.from ? `${d.what.from}：` : ''}{short(d.what.text, 80)}</Text>}
          <Text wrap="wrap">{short(d.reason, isOpen ? 300 : 80)}</Text>
          {r && !r.ok && r.note && <Text color="error" size="caption" wrap="wrap">你说：{r.note}</Text>}
        </Box>
        {isOpen && !r && (
          <Box flexDirection="column" paddingLeft="md" gap="xs">
            <Box flexDirection="row" gap="sm">
              <Button key={`ok-${d.event}`} onPress={() => markRight($, d.event)}>判断对</Button>
            </Box>
            {'Input' in ui && (
              <ui.Input key={`wr-${d.event}`} placeholder="判断错了？说应该怎样（会变成规矩提议）" submitLabel="判断错了" onSubmit={(v: string) => {
                if (v.trim()) void markWrong($, d.event, v.trim())
              }} />
            )}
          </Box>
        )}
        {isOpen && (
          <Box flexDirection="row" gap="sm" alignItems="center" paddingLeft="md">
            <Text size="caption" dimColor>存成演练例子，应该：</Text>
            {select(ui, `sc-${d.event}`, r && !r.ok ? '' : expectOf(d.verdict), Object.entries(EXPECT_LABELS).map(([value, label]) => ({ value, label })), val => { if (val) void saveCase($, d.event, val) })}
          </Box>
        )}
      </Box>
    )
  }

  const v = st.value
  const hours = v.minutes >= 60 ? `${(v.minutes / 60).toFixed(1)} 小时` : `${v.minutes} 分钟`
  const EXPECT: Record<string, string> = EXPECT_LABELS
  const kind = expectOf
  const lastRun = s.evals.runs.at(-1)
  const results = lastRun ? s.evals.cases.filter(c => lastRun.events[c.id] !== undefined).map(c => {
    const d = [...s.dryDecisions].reverse().find(x => x.event === lastRun.events[c.id])
    return { c, d, ok: d ? kind(d.verdict) === c.expect : null }
  }) : []
  const judged = results.filter(r => r.ok !== null)

  return (
    <Box flexDirection="column" marginTop="sm" gap="xs">
      <Box flexDirection="column" borderStyle="round" borderColor="success" paddingX="md" paddingY="sm" gap="xs">
        <Text weight="semibold">最近 {EVAL_DAYS} 天替你做了</Text>
        <Text size="heading" weight="semibold" color="success">省下约 {hours}</Text>
        <Text wrap="wrap">
          没打扰你就处理掉 {v.quiet} 条 · 派人去办 {v.dispatched} 件 · 替你回了 {v.replies} 条 · approve {v.approves} 个 PR · 主动发 {v.messages} 条 · 办完 {v.done} 件
        </Text>
        <Text size="caption" dimColor wrap="wrap">
          估算：只记下 / 忽略的每条按 {MINUTES.quiet} 分钟（读、判断），派活每件 {MINUTES.dispatched} 分钟（找会话、交代），回复每条 {MINUTES.reply} 分钟，approve 每个 {MINUTES.approve} 分钟。只算它替你做的，不算会话里干的活。
        </Text>
      </Box>

      {usageBox(ui, s.hubUsage)}

      <Box flexDirection="column" borderStyle="round" borderColor="inactive" paddingX="md" paddingY="sm" gap="xs" marginTop="sm">
        <Box flexDirection="row" justifyContent="space-between" alignItems="center">
          <Text weight="semibold">演练 · {s.evals.cases.length} 个例子</Text>
          {s.evals.cases.length > 0 && <Button key="run-evals" variant="primary" onPress={() => runEvals($)}>跑一遍</Button>}
        </Box>
        <Text size="caption" dimColor wrap="wrap">拿例子测主会话会怎么判断：它只说会怎么办，不真的派活、不发消息。改了规矩以后跑一遍，看有没有改坏。下面判断记录里点开一条就能「存成例子」。</Text>
        {lastRun && (
          <Text>上次（{ago(lastRun.at)}）：{judged.length < results.length ? `判断了 ${judged.length}/${results.length}，还在跑` : `${judged.filter(r => r.ok).length}/${results.length} 对`}</Text>
        )}
        {results.map(({ c, d, ok }) => (
          <Box key={`ev-${c.id}`} flexDirection="column" paddingY="xs">
            <Box flexDirection="row" gap="sm" alignItems="flex-start">
              <Text color={ok === null ? undefined : ok ? 'success' : 'error'}>{ok === null ? '…' : ok ? '✓' : '✗'}</Text>
              <Box flexGrow={1} flexShrink={1}><Text size="footnote" wrap="truncate-end">{c.from}：{c.text}</Text></Box>
              <Button key={`rmcase-${c.id}`} plain onPress={() => removeCase($, c.id)}>删</Button>
            </Box>
            <Box paddingLeft="md" flexDirection="column">
              <Text size="caption" dimColor>应该：{EXPECT[c.expect]}{d ? `　它：${EXPECT[kind(d.verdict)]}` : ''}</Text>
              {d && ok === false && <Text size="caption" color="error" wrap="wrap">它的理由：{d.reason}</Text>}
            </Box>
          </Box>
        ))}
      </Box>

      <Box marginTop="md"><Text weight="semibold">最近 {EVAL_DAYS} 天</Text></Box>
      <Text wrap="wrap">
        判断 {st.judged} 条：派人去办 {(st.byVerdict.forwarded ?? 0) + (st.byVerdict.opened ?? 0)} · 只记下 {st.byVerdict.noted ?? 0} · 忽略 {st.byVerdict.ignored ?? 0} · 直接问你 {st.byVerdict.asked ?? 0}
      </Text>
      <Text>打扰你：要你定 {st.asks} 次</Text>
      <Text>判断准确率：{accuracy}</Text>
      <Text wrap="wrap">
        回复：你确认原样发 {st.replies.asIs} · 改了再发 {st.replies.edited} · 不发 {st.replies.dropped} · 让重写 {st.replies.redo} · 按规矩自动发 {st.replies.auto}{st.replies.failed > 0 ? ` · 没发出去 ${st.replies.failed}` : ''}
      </Text>
      {sentByYou > 0 && <Text dimColor size="caption">稿子原样可用的比例：{Math.round((st.replies.asIs / sentByYou) * 100)}%（越高越可以放开「对外直接发」）</Text>}
      {'Svg' in ui && st.judged > 0 && (
        <Box flexDirection="column" marginTop="sm">
          <ui.Svg source={chartSvg(st.days)} alt={st.days.map(d => `${d.label} 判断 ${d.judged} 派活 ${d.dispatched} 问你 ${d.asks}`).join('；')} />
          <Text dimColor size="caption">灰：判断的消息 · 蓝：其中派人去办的 · 橙点：那天要你定过</Text>
        </Box>
      )}

      <Box marginTop="md"><Text weight="semibold">判断记录（点开标对错）</Text></Box>
      {recent.length === 0 && <Text dimColor>还没有判断。主会话开始工作后，每条消息怎么处理、为什么，都会记在这里。</Text>}
      {recent.map(decisionRow)}
    </Box>
  )
}
